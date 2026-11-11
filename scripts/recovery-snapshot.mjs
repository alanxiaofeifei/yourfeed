import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,statSync,realpathSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// Offline recovery only. No HTTP client, cloud credential, runtime endpoint or
// caller-supplied SQL. These are the complete authoritative application tables;
// the FTS virtual/shadow tables are derived and can be rebuilt after recovery.
export const TABLE_COLUMNS=Object.freeze({
 auth_user:['id','name','email','email_verified','image','created_at','updated_at'],
 auth_account:['id','account_id','provider_id','user_id','access_token','refresh_token','id_token','access_token_expires_at','refresh_token_expires_at','scope','password','created_at','updated_at'],
 auth_session:['id','expires_at','token','created_at','updated_at','ip_address','user_agent','user_id'],
 auth_verification:['id','identifier','value','expires_at','created_at','updated_at'],
 auth_rate:['id','hits','reset_at'],
 content:['id','source_id','kind','url','json','updated_at'],
 sources:['id','json'],feedback:['user_id','item_id','json'],settings:['id','json'],meta:['key','value'],
 reservations:['id','day','month','content_id','reserved_cost','cost','input_tokens','output_tokens','is_test','status','created_at'],
 analysis_cache:['content_id','fingerprint','provider','model','json'],
 content_sources:['content_id','source_id','name','url','first_seen_at','last_seen_at'],
 content_aliases:['alias','content_id'],
});
const CORE_TABLES=['content','sources','feedback','settings','meta','reservations','analysis_cache'];
const RUNTIME_KEYS=['APP_ENCRYPTION_KEY','AUTH_SECRET','SECRET_NAMESPACE','AUTH_MODE','AUTH_BASE_URL'];
const MAX_BYTES=128*1024*1024;
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=message=>{throw new Error(message);};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const scalar=value=>value===null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value);
function rowsFor(name,rows){
 const columns=TABLE_COLUMNS[name];if(!columns||!Array.isArray(rows))fail('Unsupported recovery table or row list.');
 return rows.map(row=>{
  if(!object(row)||Object.keys(row).length!==columns.length||columns.some(column=>!Object.hasOwn(row,column)||!scalar(row[column])))fail('Incomplete or non-scalar recovery row.');
  return Object.fromEntries(columns.map(column=>[column,row[column]]));
 });
}
const ordered=rows=>rows.map(row=>JSON.stringify(row)).sort();
export function tableDigest(name,rows){return createHash('sha256').update(JSON.stringify([name,TABLE_COLUMNS[name],ordered(rowsFor(name,rows))])).digest('hex');}
function metadata(input){
 if(!object(input)||typeof input.projectId!=='string'||!input.projectId||input.projectId.length>200||typeof input.bindingName!=='string'||!input.bindingName||input.bindingName.length>100||!/^\w[\w:.-]{0,99}$/.test(input.secretNamespace||'')||!['sites','standalone'].includes(input.authMode)||!/^[a-f0-9]{40}$/.test(input.sourceCommit||''))fail('Review the exact project, binding, auth mode, namespace and source commit first.');
 return {projectId:input.projectId,bindingName:input.bindingName,secretNamespace:input.secretNamespace,authMode:input.authMode,sourceCommit:input.sourceCommit};
}
/** Native row pages must be retained verbatim, including projection metadata.
 * Never bless HTTP 200, missing pages or truncated cells as a complete backup. */
export function buildSnapshotFromNativePages(input){
 const context=metadata(input),names=input.requiredTables;
 if(!Array.isArray(names)||new Set(names).size!==names.length||names.some(name=>!Object.hasOwn(TABLE_COLUMNS,name))||CORE_TABLES.some(name=>!names.includes(name))||!Array.isArray(input.pages))fail('List every authoritative table returned by the native overview.');
 const tables={};
 for(const name of names){
  const pages=input.pages.filter(page=>page.table_name===name).sort((a,b)=>a.offset-b.offset);let expected=0;const rows=[];
  if(!pages.length)fail('A required table has no verified native page.');
  for(let index=0;index<pages.length;index++){
   const page=pages[index],projection=page.model_projection;
   if(page.project_id!==context.projectId||page.binding_name!==context.bindingName||page.offset!==expected||!Array.isArray(page.columns)||JSON.stringify([...page.columns].sort())!==JSON.stringify([...TABLE_COLUMNS[name]].sort())||!Array.isArray(page.rows)||!object(projection)||projection.truncated!==false||projection.truncated_values!==0||projection.omitted_columns!==0||projection.omitted_rows!==0)fail('Native export is incomplete, mismatched or truncated; use a lossless export path.');
   rows.push(...rowsFor(name,page.rows));
   if(page.has_more===true){if(!Number.isInteger(projection.next_offset)||projection.next_offset<=expected||index===pages.length-1)fail('Native export is missing its next page.');expected=projection.next_offset;}
   else if(page.has_more===false){if(projection.next_offset!==null||index!==pages.length-1)fail('Native export has an invalid terminal page.');}
   else fail('Native export did not prove pagination completeness.');
  }
  tables[name]={columns:[...TABLE_COLUMNS[name]],rows,digest:tableDigest(name,rows)};
 }
 if(input.pages.some(page=>!names.includes(page.table_name)))fail('Unexpected table outside the reviewed recovery scope.');
 const snapshot={format:'yourfeed-emergency-snapshot',version:1,...context,exportedAt:new Date().toISOString(),masterKeyIncluded:false,tables};
 if(Buffer.byteLength(JSON.stringify(snapshot))>MAX_BYTES)fail('Recovery snapshot exceeds the offline 128 MB bound.');
 return snapshot;
}
export function validateSnapshot(snapshot){
 if(!object(snapshot)||snapshot.format!=='yourfeed-emergency-snapshot'||snapshot.version!==1||typeof snapshot.masterKeyIncluded!=='boolean'||!object(snapshot.tables))fail('Unsupported emergency snapshot.');metadata(snapshot);
 if(snapshot.runtimeSecrets!==undefined){if(!object(snapshot.runtimeSecrets)||Object.keys(snapshot.runtimeSecrets).some(key=>!RUNTIME_KEYS.includes(key))||Object.values(snapshot.runtimeSecrets).some(value=>typeof value!=='string'||value.length>4096))fail('Unsupported runtime recovery key material.');}
 if(snapshot.masterKeyIncluded!==!!snapshot.runtimeSecrets?.APP_ENCRYPTION_KEY)fail('Recovery master key declaration does not match its encrypted payload.');
 if(CORE_TABLES.some(name=>!Object.hasOwn(snapshot.tables,name)))fail('Required application tables are absent.');
 for(const [name,table] of Object.entries(snapshot.tables)){
  if(!Object.hasOwn(TABLE_COLUMNS,name)||!object(table)||JSON.stringify(table.columns)!==JSON.stringify(TABLE_COLUMNS[name])||table.digest!==tableDigest(name,table.rows))fail('Snapshot table schema or checksum mismatch.');
 }
 if(Buffer.byteLength(JSON.stringify(snapshot))>MAX_BYTES)fail('Recovery snapshot exceeds the offline 128 MB bound.');
 return snapshot;
}
/** Use only in memory, immediately before authenticated encryption. The result
 * must never be printed or written as a raw JSON file. */
export function attachRuntimeSecrets(snapshot,secrets){
 validateSnapshot(snapshot);if(!object(secrets)||!secrets.APP_ENCRYPTION_KEY)fail('Runtime recovery envelope did not include the original encryption key.');
 const next={...snapshot,runtimeSecrets:{...secrets},masterKeyIncluded:true};return validateSnapshot(next);
}
/** A boolean-only local check. Provider plaintext is authenticated in memory and
 * immediately discarded; never returned, logged or written to a file. */
export function verifySavedCredentialEnvelopes(snapshot){
 validateSnapshot(snapshot);const master=snapshot.runtimeSecrets?.APP_ENCRYPTION_KEY;
 if(!master)return {credentialDecryptionVerified:false,credentialsChecked:0};
 let key;try{key=/^[a-f0-9]{64}$/i.test(master)?Buffer.from(master,'hex'):Buffer.from(master,'base64');if(key.length!==32)throw Error();}catch{fail('Original application encryption key is not valid.');}
 let checked=0;
 for(const row of snapshot.tables.settings.rows){if(!row.id.startsWith('key:'))continue;
  try{const stored=JSON.parse(row.json),cipher=JSON.parse(stored.cipher);if(cipher.v!==1)throw Error();const iv=Buffer.from(cipher.iv,'base64'),data=Buffer.from(cipher.data,'base64');if(iv.length!==12||data.length<16)throw Error();const decrypt=createDecipheriv('aes-256-gcm',key,iv);decrypt.setAAD(Buffer.from(snapshot.secretNamespace+':'+row.id.slice(4)));decrypt.setAuthTag(data.subarray(-16));const clear=Buffer.concat([decrypt.update(data.subarray(0,-16)),decrypt.final()]);if(!clear.length)throw Error();clear.fill(0);checked++;}catch{fail('A saved provider credential did not authenticate with its original key and namespace.');}
 }
 return {credentialDecryptionVerified:true,credentialsChecked:checked};
}
function keyBytes(key){if(typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))fail('Use a separate 32-byte recovery key encoded as 64 hex characters.');return Buffer.from(key,'hex');}
export function sealSnapshot(snapshot,key){
 validateSnapshot(snapshot);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);
 const header={format:'yourfeed-encrypted-recovery',version:1,algorithm:'AES-256-GCM'};cipher.setAAD(Buffer.from(JSON.stringify(header)));
 const data=Buffer.concat([cipher.update(JSON.stringify(snapshot),'utf8'),cipher.final()]);
 return {...header,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
export function openSnapshot(envelope,key){
 if(!object(envelope)||envelope.format!=='yourfeed-encrypted-recovery'||envelope.version!==1||envelope.algorithm!=='AES-256-GCM'||typeof envelope.data!=='string'||envelope.data.length>Math.ceil(MAX_BYTES*4/3)+100)fail('Unsupported encrypted recovery file.');
 let snapshot;
 try{const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');if(iv.length!==12||tag.length!==16)throw Error();const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),iv);decipher.setAAD(Buffer.from(JSON.stringify({format:envelope.format,version:envelope.version,algorithm:envelope.algorithm})));decipher.setAuthTag(tag);snapshot=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));}catch{fail('Recovery authentication failed; no data was restored.');}
 return validateSnapshot(snapshot);
}
/** The caller supplies only a NEW local SQLite connection, never a production
 * binding. Trusted migrations create a schema; the input contains no DDL/SQL. */
export function restoreSnapshotToSqlite(snapshot,db,{migrationRoot=root}={}){
 validateSnapshot(snapshot);
 if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get())fail('Recovery requires a new empty local database; existing records are never overwritten.');
 db.exec('PRAGMA foreign_keys=ON; BEGIN');
 try{
  for(const file of ['0000_boring_enchantress.sql','0001_auth.sql','0002_library.sql'])db.exec(readFileSync(join(migrationRoot,'drizzle',file),'utf8'));
  for(const name of Object.keys(TABLE_COLUMNS))if(snapshot.tables[name]){
   const columns=TABLE_COLUMNS[name],statement=db.prepare('INSERT INTO "'+name+'" ('+columns.map(column=>'"'+column+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')');
   for(const row of snapshot.tables[name].rows)statement.run(...columns.map(column=>row[column]));
  }
  const result=verifyRestoredSnapshot(snapshot,db);db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function verifyRestoredSnapshot(snapshot,db){
 validateSnapshot(snapshot);const tableCounts={};
 for(const [name,table] of Object.entries(snapshot.tables)){
  const rows=db.prepare('SELECT '+TABLE_COLUMNS[name].map(column=>'"'+column+'"').join(',')+' FROM "'+name+'"').all();
  if(tableDigest(name,rows)!==table.digest)fail('Local restored table does not match its original checksum.');tableCounts[name]=rows.length;
 }
 return {verified:true,tableCounts,sourceCommit:snapshot.sourceCommit,projectId:snapshot.projectId,secretNamespace:snapshot.secretNamespace,masterKeyIncluded:snapshot.masterKeyIncluded,...verifySavedCredentialEnvelopes(snapshot)};
}
function outsideGit(path){const target=existsSync(path)?realpathSync(path):join(realpathSync(dirname(resolve(path))),resolve(path).split('/').at(-1));let cursor=dirname(target);for(;;){if(existsSync(join(cursor,'.git')))fail('Recovery data and keys must stay outside every Git checkout.');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}return target;}
function exclusivePrivate(path,data){path=outsideGit(path);writeFileSync(path,data,{flag:'wx',mode:0o600});}
async function cli(args){
 const command=args.shift(),flags={};while(args.length){const name=args.shift(),value=args.shift();if(!/^--[a-z-]+$/.test(name||'')||!value||Object.hasOwn(flags,name))fail('Use seal|verify --input FILE --key-file FILE --out NEW_FILE.');flags[name]=value;}
 if(!['seal','verify'].includes(command)||!flags['--input']||!flags['--key-file']||!flags['--out']||Object.keys(flags).some(key=>!['--input','--key-file','--out'].includes(key)))fail('Use seal|verify --input FILE --key-file FILE --out NEW_FILE.');
 if(statSync(flags['--input']).size>MAX_BYTES*1.5)fail('Recovery input exceeds its offline bound.');
 outsideGit(flags['--input']);outsideGit(flags['--key-file']);outsideGit(flags['--out']);
 const input=JSON.parse(readFileSync(flags['--input'],'utf8'));
 if(command==='seal'){
  const snapshot=buildSnapshotFromNativePages(input);let key;
  if(existsSync(flags['--key-file']))key=readFileSync(flags['--key-file'],'utf8').trim();else{key=randomBytes(32).toString('hex');exclusivePrivate(flags['--key-file'],key+'\n');}
  exclusivePrivate(flags['--out'],JSON.stringify(sealSnapshot(snapshot,key))+'\n');console.log(JSON.stringify({encrypted:true,masterKeyIncluded:false,tables:Object.fromEntries(Object.entries(snapshot.tables).map(([name,table])=>[name,table.rows.length]))}));
 }else{
  const snapshot=openSnapshot(input,readFileSync(flags['--key-file'],'utf8').trim()),output=outsideGit(flags['--out']);if(existsSync(output))fail('Recovery output must be a new local file.');writeFileSync(output,'',{flag:'wx',mode:0o600});const db=new DatabaseSync(output);try{console.log(JSON.stringify(restoreSnapshotToSqlite(snapshot,db)));}finally{db.close();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
