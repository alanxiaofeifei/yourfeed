import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {handleMaintenanceBackup,backupWriteLocked} from '../server/maintenance-backup';
import type {Env} from '../server/db';

function fixture(){
 const db=new DatabaseSync(':memory:'),calls:string[]=[];
 db.exec('CREATE TABLE content(id TEXT PRIMARY KEY,json TEXT);CREATE TABLE settings(id TEXT PRIMARY KEY,json TEXT);');
 const prepare=(sql:string)=>{calls.push(sql);const stmt=db.prepare(sql);const result=(args:any[])=>({all:async()=>({results:stmt.all(...args)}),first:async()=>stmt.get(...args),run:async()=>{throw Error('Backup must never write');}});return {...result([]),bind:(...args:any[])=>result(args)};};
 const grant=String(Date.now()+110*60000)+':'+'g'.repeat(43);
 return {db,calls,grant,env:{DB:{prepare},AUTH_MODE:'sites',PRIVATE_BACKUP_GRANT:grant,APP_ENCRYPTION_KEY:'a'.repeat(64),SECRET_NAMESPACE:'alanfeed',AUTH_SECRET:'original-session-secret'} as unknown as Env};
}
function req(grant:string,path='?table=content',method='GET',body?:unknown,extra:Record<string,string>={}){return new Request('https://reader.net/api/maintenance-backup'+path,{method,headers:{Authorization:'Bearer '+grant,...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});}
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
describe('explicit short-lived Sites backup capability',()=>{
 it('limits the write pause to the configured private Site and releases it on expiry',()=>{const {env}=fixture();expect(backupWriteLocked(env)).toBe(false);expect(backupWriteLocked({...env,PRIVATE_BACKUP_LOCK:'true'})).toBe(true);expect(backupWriteLocked({...env,PRIVATE_BACKUP_LOCK:'true',AUTH_MODE:'standalone'})).toBe(false);expect(backupWriteLocked({...env,PRIVATE_BACKUP_LOCK:'true',PRIVATE_BACKUP_GRANT:'0:expired'})).toBe(false);});
 it('refuses absent, expired, wrong and overlong grants before reading any database data',async()=>{
  const {env,grant,calls}=fixture();
  for(const request of [req(''),req(grant+'x'),req(grant,'?table=content','GET',undefined,{Authorization:grant})])expect((await handleMaintenanceBackup(request,env)).status).toBe(401);
  for(const expiry of [Date.now()-1,Date.now()+3*3600000]){const changed={...env,PRIVATE_BACKUP_GRANT:String(expiry)+':'+'g'.repeat(43)};expect((await handleMaintenanceBackup(req(String(changed.PRIVATE_BACKUP_GRANT)),changed)).status).toBe(401);}
  expect(calls).toHaveLength(0);
 });
 it('cannot use caller owner headers or enable the service on standalone/hosted instances',async()=>{
  const {env,grant,calls}=fixture();for(const changed of [{...env,AUTH_MODE:'standalone'},{...env,HOSTING_MODE:'hosted'}])expect((await handleMaintenanceBackup(req(grant),changed)).status).toBe(404);
  expect((await handleMaintenanceBackup(req('', '?table=content','GET',undefined,{'oai-authenticated-user-id':'owner'}),env)).status).toBe(401);expect(calls).toHaveLength(0);
 });
 it('exports a complete long original row and pages stable IDs without truncating cells or writing SQL',async()=>{
  const {db,env,grant,calls}=fixture();const value=JSON.stringify({body:'長い本文'.repeat(30000),privateState:'exact-original'});
  const stmt=db.prepare('INSERT INTO content VALUES (?,?)');stmt.run('one',value);stmt.run('two','two');stmt.run('three','three');
  const first=await handleMaintenanceBackup(req(grant,'?table=content&limit=1'),env);expect(first.status).toBe(200);expect(first.headers.get('cache-control')).toBe('no-store');const page=await first.json() as any;
  expect(page.rows[0]).toEqual({id:'one',json:value});expect(page.model_projection).toMatchObject({truncated:false,truncated_values:0,next_offset:1});expect(page.has_more).toBe(true);
  const next=await (await handleMaintenanceBackup(req(grant,'?table=content&offset='+page.model_projection.next_offset+'&limit=10'),env)).json() as any;expect(next.rows.map((r:any)=>r.id)).toEqual(['three','two']);expect(next.model_projection.next_offset).toBeNull();
  expect(calls.every(sql=>/^(SELECT|PRAGMA)/.test(sql))).toBe(true);expect(db.prepare('SELECT json FROM content WHERE id=?').get('one')?.json).toBe(value);
 });
 it('rejects injection, invalid offsets and all write paths without altering the database',async()=>{
  const {env,grant,db}=fixture();for(const query of ['?table=sqlite_master','?table=content%22%3BDROP%20TABLE%20content','?table=content&offset=-1','?table=content&limit=11'])expect((await handleMaintenanceBackup(req(grant,query),env)).status).toBe(400);
  expect((await handleMaintenanceBackup(req(grant,'','POST',{}),env)).status).toBe(405);expect(db.prepare('SELECT count(*) n FROM content').get()?.n).toBe(0);
 });
 it('reduces page size instead of truncating complete rows when the page exceeds one MB',async()=>{
  const {env,grant,db}=fixture();const stmt=db.prepare('INSERT INTO content VALUES (?,?)');for(let i=0;i<5;i++)stmt.run(String(i),'a'.repeat(300000));const response=await handleMaintenanceBackup(req(grant,'?table=content&limit=5'),env);expect(response.status).toBe(200);const page=await response.json() as any;expect(page.rows).toHaveLength(3);expect(page.rows[2].json).toHaveLength(300000);expect(page.model_projection.next_offset).toBe(3);expect(page.has_more).toBe(true);
 });
 it('returns only a recipient-encrypted key envelope, which decrypts to the original master and namespace',async()=>{
  const {env,grant,calls}=fixture();const keys=await crypto.subtle.generateKey({name:'RSA-OAEP',hash:'SHA-256',modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,['encrypt','decrypt']);
  const publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey);
  const response=await handleMaintenanceBackup(req(grant,'/key-envelope','POST',{publicKey}),env);expect(response.status).toBe(200);const raw=await response.text();expect(raw).not.toContain(String(env.APP_ENCRYPTION_KEY));expect(raw).not.toContain('original-session-secret');expect(raw).not.toContain('alanfeed');
  const e=JSON.parse(raw),rawAes=await crypto.subtle.decrypt({name:'RSA-OAEP'},keys.privateKey,decode(e.wrappedKey));const aes=await crypto.subtle.importKey('raw',rawAes,'AES-GCM',false,['decrypt']);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(e.iv),additionalData:new TextEncoder().encode(e.format)},aes,decode(e.ciphertext));expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({APP_ENCRYPTION_KEY:env.APP_ENCRYPTION_KEY,SECRET_NAMESPACE:'alanfeed',AUTH_SECRET:'original-session-secret'});expect(calls).toHaveLength(0);
 });
 it('rejects private/weak keys and unbounded key-envelope requests',async()=>{
  const {env,grant}=fixture();for(const publicKey of [{kty:'RSA',n:'x'.repeat(342),e:'AQAB',d:'private'},{kty:'RSA',n:'x',e:'AQAB'}])expect((await handleMaintenanceBackup(req(grant,'/key-envelope','POST',{publicKey}),env)).status).toBe(400);
  expect((await handleMaintenanceBackup(req(grant,'/key-envelope','POST',{}, {'Content-Length':'40000'}),env)).status).toBe(413);
 });
});
