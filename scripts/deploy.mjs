import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectTarget, flattenWranglerRows, validateRemoteState } from './preflight.mjs';

// No shell interpolation, no implicit account or production DB selection.
const root=process.cwd(), dryRun=process.argv.includes('--dry-run');
let temporary;
function wrangler(args,{capture=false}={}){
 const cli=resolve(root,'node_modules/wrangler/bin/wrangler.js');
 if(!existsSync(cli))throw new Error('Wrangler is missing. Install the checked-in dependencies before deployment.');
 const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.status!==0)throw new Error('Wrangler command failed; stop and inspect the target state before retrying.');
 return result.stdout||'';
}
try{
 const target=inspectTarget();
 if(dryRun){const {manifest,...safe}=target;console.log(JSON.stringify({...safe,mutation:false,remoteChecked:false,steps:['Read sqlite_schema and applied migrations from reviewed DB','Require empty DB for initial mode or exact migration list + backup manifest for release','Apply only pending migrations to DB','Publish the built Worker; code rollback does not undo migration']},null,2));}
 else{
  temporary=mkdtempSync(join(tmpdir(),'yourfeed-release-'));
  const config=join(temporary,'wrangler.json');
  writeFileSync(config,JSON.stringify({name:target.worker,account_id:target.accountId,compatibility_date:'2026-11-10',d1_databases:[{binding:'DB',database_name:target.worker,database_id:target.databaseId,migrations_dir:resolve(root,'drizzle')}]}));
  const query=sql=>flattenWranglerRows(wrangler(['d1','execute','DB','--config',config,'--remote','--json','--command',sql],{capture:true}));
  const tables=query("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name");
  const applied=tables.some(row=>row.name==='d1_migrations')?query('SELECT name FROM d1_migrations ORDER BY name'):[];
  const state=validateRemoteState(target,{tables,applied});
  console.log(JSON.stringify({worker:target.worker,databaseId:target.databaseId,mode:target.mode,...state}));
  if(state.pendingMigrations.length)wrangler(['d1','migrations','apply','DB','--config',config,'--remote']);
  // Recheck the actual migration result before publishing code.
  const after=query('SELECT name FROM d1_migrations ORDER BY name').map(row=>row.name).sort();
  if(JSON.stringify(after)!==JSON.stringify([...target.migrations].sort()))throw new Error('Migration result does not match the source migration list; publishing stopped.');
  if(!process.argv.includes('--migrate-only'))wrangler(['deploy','--config',target.configPath]);
 }
}catch(error){console.error(error.message);process.exitCode=1;}finally{if(temporary)rmSync(temporary,{recursive:true,force:true});}
