import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,randomBytes} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
// @ts-expect-error The offline recovery CLI is intentionally native Node ESM.
import {TABLE_COLUMNS,buildSnapshotFromNativePages,sealSnapshot,openSnapshot,restoreSnapshotToSqlite,tableDigest,attachRuntimeSecrets} from '../scripts/recovery-snapshot.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(name=>/^000[012]_.*\.sql$/.test(name)).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));
 const large='保留段落、原文和版本\n'.repeat(14000),item={id:'old-content',title:'Preserved version',body:large,analysis:{bullets:['Existing note']}};
 db.prepare('INSERT INTO content VALUES (?,?,?,?,?,?)').run(item.id,'old-source','article','https://source.reader.net/article',JSON.stringify(item),'2026-01-01T00:00:00Z');
 db.prepare('INSERT INTO sources VALUES (?,?)').run('old-source',JSON.stringify({id:'old-source',enabled:true,locator:'https://source.reader.net/feed'}));
 db.prepare('INSERT INTO feedback VALUES (?,?,?)').run('original-platform-owner',item.id,JSON.stringify({liked:true,saved:true,read:true}));
 db.prepare('INSERT INTO settings VALUES (?,?)').run('key:openai',JSON.stringify({cipher:'EXACT-CIPHERTEXT-DO-NOT-ROTATE',last4:'1234'}));
 db.prepare('INSERT INTO settings VALUES (?,?)').run('profile:user',JSON.stringify({goals:['Existing personal goals'],version:4}));
 db.prepare('INSERT INTO meta VALUES (?,?)').run('seeded-v1','original-timestamp');
 const requiredTables=Object.keys(TABLE_COLUMNS),pages=requiredTables.map(name=>({project_id:'existing-private-site',binding_name:'DB',table_name:name,columns:TABLE_COLUMNS[name],rows:db.prepare('SELECT * FROM '+name).all(),offset:0,limit:25,has_more:false,model_projection:{next_offset:null,truncated:false,truncated_values:0,omitted_columns:0,omitted_rows:0}}));
 return {db,large,input:{projectId:'existing-private-site',bindingName:'DB',authMode:'sites',secretNamespace:'alanfeed',sourceCommit:'a'.repeat(40),requiredTables,pages}};
}
describe('lossless private recovery snapshots',()=>{
 it('encrypts and restores long source text, exact key ciphertext and original feedback owner without API calls',()=>{
  const {input,large}=fixture(),snapshot=buildSnapshotFromNativePages(input),envelope=sealSnapshot(snapshot,'ab'.repeat(32));
  expect(JSON.stringify(envelope)).not.toContain('EXACT-CIPHERTEXT');expect(JSON.stringify(envelope)).not.toContain('Existing personal goals');
  const restored=openSnapshot(envelope,'ab'.repeat(32)),target=new DatabaseSync(':memory:');expect(restoreSnapshotToSqlite(restored,target)).toMatchObject({verified:true,projectId:'existing-private-site',secretNamespace:'alanfeed',masterKeyIncluded:false});
  expect(JSON.parse(String(target.prepare('SELECT json FROM content').get()?.json)).body).toBe(large);
  expect(target.prepare('SELECT user_id FROM feedback').get()?.user_id).toBe('original-platform-owner');
  expect(JSON.parse(String(target.prepare("SELECT json FROM settings WHERE id='key:openai'").get()?.json)).cipher).toBe('EXACT-CIPHERTEXT-DO-NOT-ROTATE');
  expect(target.prepare("SELECT value FROM meta WHERE key='seeded-v1'").get()?.value).toBe('original-timestamp');
 });
 it('fails closed on omitted/truncated cells, incomplete page chains, missing tables or unknown column names',()=>{
  for(const patch of [{truncated:true},{truncated_values:1},{omitted_rows:1},{omitted_columns:1}]){const {input}=fixture();Object.assign(input.pages[0].model_projection,patch);expect(()=>buildSnapshotFromNativePages(input)).toThrow(/incomplete/);}
  const {input}=fixture();input.pages[0].has_more=true;input.pages[0].model_projection.next_offset=25 as any;expect(()=>buildSnapshotFromNativePages(input)).toThrow(/next page/);
  const missing=fixture().input;missing.pages=missing.pages.filter((page:any)=>page.table_name!=='settings');expect(()=>buildSnapshotFromNativePages(missing)).toThrow(/no verified/);
  const column=fixture().input;column.pages[0].columns=['id); DROP TABLE content;--'];expect(()=>buildSnapshotFromNativePages(column)).toThrow(/incomplete/);
 });
 it('accepts only native next_offset continuation and verifies every encrypted byte before restoring',()=>{
  const {input}=fixture(),page=input.pages.find((page:any)=>page.table_name==='settings')!;page.has_more=true;page.model_projection.next_offset=25 as any;const last={...page,rows:page.rows.slice(1),offset:25,has_more:false,model_projection:{...page.model_projection,next_offset:null}};page.rows=page.rows.slice(0,1);input.pages.push(last as any);
  const snapshot=buildSnapshotFromNativePages(input);expect(snapshot.tables.settings.rows).toHaveLength(2);
  const envelope=sealSnapshot(snapshot,'ab'.repeat(32));expect(()=>openSnapshot(envelope,'cd'.repeat(32))).toThrow(/authentication failed/);envelope.data=envelope.data.slice(0,-10)+'AAAAAAAAAA';expect(()=>openSnapshot(envelope,'ab'.repeat(32))).toThrow(/authentication failed/);
 });
 it('never overwrites a populated database and rejects table data whose checksums changed',()=>{
  const {db,input}=fixture(),snapshot=buildSnapshotFromNativePages(input);expect(()=>restoreSnapshotToSqlite(snapshot,db)).toThrow(/new empty/);
  snapshot.tables.content.rows[0].json='changed';expect(()=>sealSnapshot(snapshot,'ab'.repeat(32))).toThrow(/checksum/);
 });
 it('uses bound cells rather than interpreting source text as SQL and leaves derived indexes rebuildable',()=>{
  const {input}=fixture(),snapshot=buildSnapshotFromNativePages(input);snapshot.tables.settings.rows.push({id:"x'); DROP TABLE content;--",json:'{"source":"unchanged"}'});snapshot.tables.settings.digest=tableDigest('settings',snapshot.tables.settings.rows);
  const db=new DatabaseSync(':memory:');expect(restoreSnapshotToSqlite(snapshot,db).verified).toBe(true);expect(db.prepare('SELECT COUNT(*) n FROM content').get()?.n).toBe(1);expect(db.prepare('SELECT COUNT(*) n FROM content_search').get()?.n).toBe(0);
 });
 it('keeps the original runtime master inside encryption and verifies provider ciphertext without exposing plaintext',()=>{
  const {input}=fixture(),snapshot=buildSnapshotFromNativePages(input),master='ab'.repeat(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(master,'hex'),iv);cipher.setAAD(Buffer.from('alanfeed:openai'));
  const data=Buffer.concat([cipher.update('provider-value-never-in-report'),cipher.final(),cipher.getAuthTag()]);
  snapshot.tables.settings.rows.find((row:any)=>row.id==='key:openai').json=JSON.stringify({cipher:JSON.stringify({v:1,iv:iv.toString('base64'),data:data.toString('base64')})});snapshot.tables.settings.digest=tableDigest('settings',snapshot.tables.settings.rows);
  const withMaster=attachRuntimeSecrets(snapshot,{APP_ENCRYPTION_KEY:master,SECRET_NAMESPACE:'alanfeed',AUTH_MODE:'sites'}),sealed=sealSnapshot(withMaster,'cd'.repeat(32));expect(JSON.stringify(sealed)).not.toContain(master);
  const target=new DatabaseSync(':memory:'),report=restoreSnapshotToSqlite(openSnapshot(sealed,'cd'.repeat(32)),target);expect(report).toMatchObject({verified:true,masterKeyIncluded:true,credentialDecryptionVerified:true,credentialsChecked:1});expect(JSON.stringify(report)).not.toContain(master);expect(JSON.stringify(report)).not.toContain('provider-value-never-in-report');
  const wrong=attachRuntimeSecrets(snapshot,{APP_ENCRYPTION_KEY:'ef'.repeat(32)});expect(()=>restoreSnapshotToSqlite(wrong,new DatabaseSync(':memory:'))).toThrow(/did not authenticate/);
 });
});
