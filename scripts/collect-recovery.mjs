import {generateKeyPairSync,privateDecrypt,constants,createDecipheriv,randomBytes} from 'node:crypto';
import {existsSync,realpathSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {TABLE_COLUMNS,buildSnapshotFromNativePages,attachRuntimeSecrets,sealSnapshot,openSnapshot,restoreSnapshotToSqlite} from './recovery-snapshot.mjs';

const LEGACY_TABLES=Object.keys(TABLE_COLUMNS).filter(name=>!['content_sources','content_aliases'].includes(name));
const STABLE_TABLES=['content','settings','sources','feedback'];
const failure=message=>{throw new Error(message);};
export class RecoveryDataChangedError extends Error {
 constructor(tables){super('Personal data changed during backup (tables: '+tables.join(', ')+'). Wait for updates to finish and repeat; no partial backup was accepted.');this.name='RecoveryDataChangedError';this.code='data_changed';this.tables=tables;}
}
function validateInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.grant!=='string'||input.grant.length<32||input.grant.length>1024||typeof input.sitesToken!=='string'||!input.sitesToken||input.sitesToken.length>4096||/[\r\n]/.test(input.grant+input.sitesToken))failure('Provide reviewed recovery configuration through hidden stdin.');
 let origin;try{const url=new URL(input.origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();origin=url.origin;}catch{failure('Recovery origin must be the exact reviewed HTTPS Site origin.');}
 if(typeof input.projectId!=='string'||!input.projectId||input.projectId.length>200||!/^[a-f0-9]{40}$/.test(input.sourceCommit||'')||typeof input.outputDirectory!=='string'||!input.outputDirectory||typeof input.secretNamespace!=='string'&&input.secretNamespace!==undefined)failure('Review the exact Site, source commit and private output directory.');
 const requiredTables=input.requiredTables||LEGACY_TABLES;
 if(!Array.isArray(requiredTables)||new Set(requiredTables).size!==requiredTables.length||LEGACY_TABLES.some(name=>!requiredTables.includes(name))||requiredTables.some(name=>!Object.hasOwn(TABLE_COLUMNS,name)))failure('Review every authoritative table; only the fixed legacy and provenance tables are supported.');
 return {...input,origin,requiredTables,secretNamespace:input.secretNamespace||'yourfeed'};
}
async function jsonResponse(response,limit=4*1024*1024){
 if(!response.ok){await response.body?.cancel();failure('Private backup request failed with HTTP '+response.status+'. No partial backup was accepted.');}
 const reader=response.body?.getReader();if(!reader)failure('Private backup response was empty.');const chunks=[];let size=0;
 try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>limit){await reader.cancel();failure('Private backup page exceeds its bounded response size.');}chunks.push(value.value);}}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{failure('Private backup returned invalid JSON.');}
}
async function request(input,path,{body,transport=fetch}={}){
 const headers={Authorization:'Bearer '+input.grant,'OAI-Sites-Authorization':'Bearer '+input.sitesToken,'Cache-Control':'no-store',...(body?{'Content-Type':'application/json'}:{})};
 let response;try{response=await transport(input.origin+path,{method:body?'POST':'GET',headers,redirect:'manual',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});}catch{failure('Private backup transport failed; credentials were not logged.');}
 return jsonResponse(response);
}
export function unwrapRuntimeEnvelope(envelope,privateKey){
 if(!envelope||envelope.format!=='yourfeed-private-key-envelope-v1'||envelope.version!==1||envelope.algorithm!=='RSA-OAEP-256+A256GCM')failure('Unsupported runtime key envelope.');
 try{
  const aes=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
  const iv=Buffer.from(envelope.iv,'base64'),data=Buffer.from(envelope.ciphertext,'base64');if(aes.length!==32||iv.length!==12||data.length<17||data.length>20000)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',aes,iv);decipher.setAAD(Buffer.from(envelope.format));decipher.setAuthTag(data.subarray(-16));
  const secrets=JSON.parse(Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString('utf8'));
  if(!secrets||typeof secrets.APP_ENCRYPTION_KEY!=='string'||Object.keys(secrets).some(key=>!['APP_ENCRYPTION_KEY','SECRET_NAMESPACE','AUTH_SECRET'].includes(key)))throw Error();
  return secrets;
 }catch{failure('Runtime key envelope authentication failed; no secrets were written.');}
}
async function collectPass(input,transport){
 const pages=[];
 for(const table of input.requiredTables){let offset=0;const seen=new Set();
  for(;;){if(seen.has(offset))failure('Backup pagination repeated a cursor.');seen.add(offset);
   const page=await request(input,'/api/maintenance-backup?'+new URLSearchParams({table,offset:String(offset),limit:'10'}),{transport});
   // The read-only maintenance endpoint is scoped by its Site dispatcher token
   // and exact origin. It has no runtime binding for the opaque hosting ID.
   if(page.project_id!==''&&page.project_id!==input.projectId)failure('Backup response identified a different Site.');
   page.project_id=input.projectId;
   if(page.table_name!==table||page.binding_name!=='DB'||page.offset!==offset)failure('Backup page does not match the requested table or cursor.');
   pages.push(page);const next=page.model_projection?.next_offset;
   if(page.has_more===false&&next===null)break;
   if(page.has_more!==true||!Number.isInteger(next)||next<=offset||next>1000000)failure('Backup pagination is incomplete.');offset=next;
  }
 }
 return buildSnapshotFromNativePages({projectId:input.projectId,bindingName:'DB',authMode:'sites',secretNamespace:input.secretNamespace,sourceCommit:input.sourceCommit,requiredTables:input.requiredTables,pages});
}
function privateDirectory(path){
 const output=resolve(path);let parent=dirname(output);while(!existsSync(parent)){const next=dirname(parent);if(next===parent)failure('Private output parent is unavailable.');parent=next;}
 let cursor=realpathSync(parent);for(;;){if(existsSync(join(cursor,'.git')))failure('Private backup files must remain outside all Git checkouts.');const next=dirname(cursor);if(next===cursor)break;cursor=next;}
 if(existsSync(output))failure('Choose a NEW private backup directory; existing files are never overwritten.');mkdirSync(output,{mode:0o700,recursive:true});return realpathSync(output);
}
/** Two complete read passes must agree on all core user records. Credentials
 * arrive only in an ephemeral public-key envelope; raw records stay in memory. */
export async function collectRecovery(input,{transport=fetch,writeOutput=true}={}){
 input=validateInput(input);
 const first=await collectPass(input,transport),second=await collectPass(input,transport);
 const changedTables=STABLE_TABLES.filter(name=>first.tables[name].digest!==second.tables[name].digest);
 if(changedTables.length)throw new RecoveryDataChangedError(changedTables);
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const envelope=await request(input,'/api/maintenance-backup/key-envelope',{body:{publicKey:publicKey.export({format:'jwk'})},transport});
 const secrets=unwrapRuntimeEnvelope(envelope,privateKey);
 if(secrets.SECRET_NAMESPACE!==input.secretNamespace)failure('Original encryption namespace differs from the reviewed instance.');
 const snapshot=attachRuntimeSecrets(second,{...secrets,AUTH_MODE:'sites',AUTH_BASE_URL:input.origin}),key=randomBytes(32).toString('hex'),encrypted=sealSnapshot(snapshot,key);
 const db=new DatabaseSync(':memory:');let verification;try{verification=restoreSnapshotToSqlite(openSnapshot(encrypted,key),db);}finally{db.close();}
 if(!writeOutput)return {verification,encrypted,key};
 const directory=privateDirectory(input.outputDirectory),archive=join(directory,'yourfeed-emergency-backup.yfbak'),keyFile=join(directory,'backup-key.hex'),report=join(directory,'verification.json');
 writeFileSync(archive,JSON.stringify(encrypted)+'\n',{flag:'wx',mode:0o600});writeFileSync(keyFile,key+'\n',{flag:'wx',mode:0o600});
 const safe={...verification,stableTables:STABLE_TABLES,stableReadPasses:2,encrypted:true,archive,keyFile};writeFileSync(report,JSON.stringify(safe,null,2)+'\n',{flag:'wx',mode:0o600});chmodSync(directory,0o700);return {...safe,report};
}
async function cli(){
 const tty=process.stdin.isTTY;if(tty&&spawnSync('stty',['-echo'],{stdio:['inherit','ignore','ignore']}).status!==0)failure('Could not disable terminal echo for private configuration.');
 console.log('Ready for recovery JSON on stdin (input is hidden).');
 const reader=createInterface({input:process.stdin,terminal:false});let line;
 try{line=await new Promise((resolve,reject)=>{reader.once('line',resolve);reader.once('close',()=>reject(Error('No hidden recovery configuration was provided.')));});}finally{reader.close();process.stdin.pause();if(tty)spawnSync('stty',['echo'],{stdio:['inherit','ignore','ignore']});}
 if(Buffer.byteLength(String(line))>16000)failure('Hidden configuration exceeds its bound.');let input;try{input=JSON.parse(String(line));}catch{failure('Provide one JSON configuration on hidden stdin.');}console.log(JSON.stringify(await collectRecovery(input)));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(error=>{console.error(error.message);process.exitCode=1;});
