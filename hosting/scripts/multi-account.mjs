#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
const [target,action,value]=process.argv.slice(2);
if(!['preview','production'].includes(target)||!['list','approve','delete','cap'].includes(action))throw Error('Usage: node hosting/scripts/multi-account.mjs preview|production list|approve EMAIL|delete EMAIL|cap NUMBER');
const config='wrangler.multi'+(target==='preview'?'.preview':'')+'.jsonc';
const manifest=JSON.parse(readFileSync(config,'utf8'));
const expected=target==='preview'?'yourfeed-app-preview':'yourfeed-app';
if(manifest.name!==expected||manifest.d1_databases?.[0]?.database_name!==expected||manifest.d1_databases[0].binding!=='AUTH_DB')throw Error('Unsafe target configuration');
if(action==='cap'){
 const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>10000)throw Error('Capacity must be 0–10000');
 manifest.vars.MAX_ACCOUNTS=String(n);writeFileSync(config,JSON.stringify(manifest,null,2)+'\n');
 console.log('Updated '+config+'; rebuild and deploy this reviewed configuration to apply.');process.exit(0);
}
if(action!=='list'&&(!value||value.length>254||!/^\S+@[^@\s]+\.[^@\s]+$/.test(value)))throw Error('A valid email is required');
const literal="'"+(value||'').trim().toLowerCase().replaceAll("'","''")+"'";
const sql=action==='list'?`SELECT u.id,u.email,u.created_at,CASE WHEN d.user_id IS NULL THEN 'active' ELSE 'deleting' END AS state FROM auth_user u LEFT JOIN account_deletions d ON d.user_id=u.id ORDER BY u.created_at; SELECT email FROM approved_emails ORDER BY email;`:action==='approve'?`INSERT OR IGNORE INTO approved_emails(email) VALUES (${literal});`:`INSERT OR IGNORE INTO account_deletions(user_id) SELECT id FROM auth_user WHERE email=${literal} COLLATE NOCASE; DELETE FROM approved_emails WHERE email=${literal} COLLATE NOCASE;`;
const privateRoot=resolve(process.env.YOURFEED_PRIVATE_DIR||'../private');
if(privateRoot===process.cwd()||privateRoot.startsWith(process.cwd()+'/'))throw Error('Private files must be outside the repository');
mkdirSync(privateRoot,{recursive:true,mode:0o700});chmodSync(privateRoot,0o700);
const dir=mkdtempSync(join(privateRoot,'yourfeed-account-'));
try{
 const path=join(dir,'operation.sql');writeFileSync(path,sql,{mode:0o600});
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','AUTH_DB','--remote','--config',config,'--file',path],{stdio:'inherit'});
 process.exitCode=result.status??1;
}finally{rmSync(dir,{recursive:true,force:true});}
