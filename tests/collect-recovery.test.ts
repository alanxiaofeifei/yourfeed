import {describe,it,expect} from 'vitest';
import {createCipheriv,randomBytes,publicEncrypt,createPublicKey,constants} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error Offline native ESM utility, never loaded in browser/server app.
import {collectRecovery} from '../scripts/collect-recovery.mjs';
// @ts-expect-error Offline native ESM utility, never loaded in browser/server app.
import {TABLE_COLUMNS,openSnapshot} from '../scripts/recovery-snapshot.mjs';

function fixture({changeDuringBackup=false,contentRows=1}={}){
 const master='ab'.repeat(32),namespace='alanfeed',grant='owner-recovery-grant-'.repeat(3),sitesToken='platform-dispatch-token',large='Original long source paragraphs\n'.repeat(7000);
 const rows:Record<string,any[]>=Object.fromEntries(Object.keys(TABLE_COLUMNS).map(name=>[name,[]]));
 rows.content=Array.from({length:contentRows},(_,index)=>({id:index?'extra-'+index:'old-id',source_id:'old-source',kind:'article',url:'https://public.reader.net/story/'+index,json:JSON.stringify({id:index?'extra-'+index:'old-id',body:index?'Additional cached text':large}),updated_at:'2026-01-01T00:00:00Z'}));
 rows.sources=[{id:'old-source',json:JSON.stringify({id:'old-source',enabled:true})}];rows.feedback=[{user_id:'original-owner',item_id:'old-id',json:'{"saved":true,"liked":true}'}];
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(master,'hex'),iv);cipher.setAAD(Buffer.from(namespace+':openai'));const encrypted=Buffer.concat([cipher.update('never-exposed-provider-key'),cipher.final(),cipher.getAuthTag()]);
 rows.settings=[{id:'key:openai',json:JSON.stringify({cipher:JSON.stringify({v:1,iv:iv.toString('base64'),data:encrypted.toString('base64')})})}];
 let contentPass=0,keyRequests=0;const requests:string[]=[];
 const input={origin:'https://existing-private.chatgpt.site',projectId:'original-site-id',sourceCommit:'a'.repeat(40),grant,sitesToken,outputDirectory:'/tmp/not-written-in-test',secretNamespace:namespace};
 const transport=async(url:string,options:any)=>{
  expect(options.redirect).toBe('manual');expect(options.headers.Authorization).toBe('Bearer '+grant);expect(options.headers['OAI-Sites-Authorization']).toBe('Bearer '+sitesToken);
  const parsed=new URL(url);
  requests.push(parsed.pathname+parsed.search);
  if(parsed.pathname.endsWith('/key-envelope')){
   keyRequests++;const {publicKey}=JSON.parse(options.body),key=randomBytes(32),iv=randomBytes(12),format='yourfeed-private-key-envelope-v1',cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(format));const data=Buffer.concat([cipher.update(JSON.stringify({APP_ENCRYPTION_KEY:master,SECRET_NAMESPACE:namespace})),cipher.final(),cipher.getAuthTag()]);
   const wrapped=publicEncrypt({key:createPublicKey({key:publicKey,format:'jwk'}),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
   return Response.json({format,version:1,algorithm:'RSA-OAEP-256+A256GCM',iv:iv.toString('base64'),wrappedKey:wrapped.toString('base64'),ciphertext:data.toString('base64')});
  }
  const name=parsed.searchParams.get('table')!;let current=rows[name];if(name==='content'&&++contentPass>1&&changeDuringBackup)current=[{...current[0],json:'changed-between-passes'}];
  const offset=Number(parsed.searchParams.get('offset')),limit=Number(parsed.searchParams.get('limit')),page=current.slice(offset,offset+limit),hasMore=offset+page.length<current.length;
  return Response.json({project_id:'',binding_name:'DB',table_name:name,columns:TABLE_COLUMNS[name],rows:page,offset,limit,has_more:hasMore,model_projection:{truncated:false,truncated_values:0,omitted_rows:0,omitted_columns:0,next_offset:hasMore?offset+page.length:null}});
 };
 return {input,transport,large,master,requests,getKeyRequests:()=>keyRequests};
}
describe('private read-only recovery collection',()=>{
 it('validates two stable full passes, recovers the original encrypted master, and verifies all data without a provider call',async()=>{
  const {input,transport,large,master}=fixture(),result=await collectRecovery(input,{transport,writeOutput:false});expect(result.verification).toMatchObject({verified:true,masterKeyIncluded:true,credentialDecryptionVerified:true,credentialsChecked:1});
  const snapshot=openSnapshot(result.encrypted,result.key);expect(snapshot.runtimeSecrets.APP_ENCRYPTION_KEY).toBe(master);expect(JSON.parse(snapshot.tables.content.rows[0].json).body).toBe(large);expect(JSON.stringify(result.verification)).not.toContain(master);expect(JSON.stringify(result.encrypted)).not.toContain('never-exposed-provider-key');
 });
 it('stops before requesting master secrets and identifies only table names if source data changes between passes',async()=>{const f=fixture({changeDuringBackup:true});let error:any;try{await collectRecovery(f.input,{transport:f.transport,writeOutput:false});}catch(value){error=value;}expect(error).toMatchObject({code:'data_changed',tables:['content']});expect(error.message).toContain('tables: content');expect(error.message).not.toContain('changed-between-passes');expect(error.message).not.toContain(f.master);expect(f.getKeyRequests()).toBe(0);});
 it('uses ten-row pages and follows the returned offsets through two complete passes',async()=>{const f=fixture({contentRows:21}),result=await collectRecovery(f.input,{transport:f.transport,writeOutput:false});expect(result.verification.tableCounts.content).toBe(21);const pages=f.requests.filter(value=>value.includes('table=content&')).map(value=>new URL(value,f.input.origin));expect(pages.map(url=>url.searchParams.get('offset'))).toEqual(['0','10','20','0','10','20']);expect(pages.every(url=>url.searchParams.get('limit')==='10')).toBe(true);});
 it('includes newly deployed provenance tables only when their full authoritative scope is explicitly reviewed',async()=>{const f=fixture(),result=await collectRecovery({...f.input,requiredTables:Object.keys(TABLE_COLUMNS)},{transport:f.transport,writeOutput:false});expect(result.verification.tableCounts).toMatchObject({content_sources:0,content_aliases:0});await expect(collectRecovery({...f.input,requiredTables:['content']},{transport:f.transport,writeOutput:false})).rejects.toThrow(/every authoritative table/);});
 it('writes only private encrypted backups and a key file, never raw content or secrets in the report',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'yourfeed-recovery-'));try{const f=fixture(),result=await collectRecovery({...f.input,outputDirectory:join(directory,'new')},{transport:f.transport});expect(statSync(result.archive).mode&0o777).toBe(0o600);expect(statSync(result.keyFile).mode&0o777).toBe(0o600);expect(statSync(join(directory,'new')).mode&0o777).toBe(0o700);expect(readFileSync(result.archive,'utf8')).not.toContain(f.master);expect(readFileSync(result.report,'utf8')).not.toContain(f.master);expect(readFileSync(result.report,'utf8')).not.toContain('Original long source paragraphs');await expect(collectRecovery({...f.input,outputDirectory:join(directory,'new')},{transport:f.transport})).rejects.toThrow(/NEW private/);}finally{rmSync(directory,{recursive:true,force:true});}
 });
 it('does not follow redirects or expose upstream response bodies in errors',async()=>{const f=fixture();await expect(collectRecovery(f.input,{transport:async()=>new Response('sensitive-upstream-body',{status:302,headers:{location:'https://other.reader.net'}}),writeOutput:false})).rejects.toThrow('HTTP 302');});
});
