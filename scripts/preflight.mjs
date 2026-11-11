import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACCOUNT=/^[a-f0-9]{32}$/i;
const SHA=/^[a-f0-9]{40}$/i;
function fail(message){throw new Error(message);}
export function readJson(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail(`Cannot read JSON configuration: ${path}`);}}
export function inspectTarget({root=process.cwd(),env=process.env,configPath='dist/server/wrangler.json',manifestPath=env.YOURFEED_RELEASE_MANIFEST}={}){
 const config=readJson(resolve(root,configPath));
 if(config.vars?.AUTH_MODE==='sites')fail('Native Sites releases use the Sites workflow; do not deploy this manifest to an ordinary Worker.');
 if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(config.name||''))fail('Worker name is missing or invalid.');
 const databases=(config.d1_databases||[]).filter(item=>item.binding==='DB');
 if(databases.length!==1||!UUID.test(databases[0].database_id||'')||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databases[0].database_id))fail('DB must have one actual non-placeholder database ID. Build after provisioning the binding.');
 const databaseId=databases[0].database_id;
 const accountId=env.CLOUDFLARE_ACCOUNT_ID||config.account_id;
 if(!ACCOUNT.test(accountId||''))fail('Set CLOUDFLARE_ACCOUNT_ID to the reviewed target account; account selection must not be implicit.');
 const mode=env.YOURFEED_DEPLOY_MODE;
 if(!['initial','release'].includes(mode))fail('Set YOURFEED_DEPLOY_MODE to initial for an empty database or release with a private release manifest.');
 const ciBranch=env.WORKERS_CI_BRANCH||env.CF_PAGES_BRANCH;
 if(ciBranch&&ciBranch!==(env.YOURFEED_PRODUCTION_BRANCH||'main'))fail('Preview branches cannot use the production deployment script.');
 if(env.YOURFEED_PREVIEW==='true')fail('Use a separate preview Worker/database; production deployment is disabled in preview mode.');
 let origin;try{const url=new URL(env.AUTH_BASE_URL||config.vars?.AUTH_BASE_URL||'');if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error();origin=url.origin;}catch{fail('Set AUTH_BASE_URL to the exact HTTPS deployment origin before publishing.');}
 const migrations=readdirSync(resolve(root,'drizzle')).filter(name=>/^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
 if(!migrations.length)fail('No SQL migrations found.');
 const script=readJson(resolve(root,'package.json'));
 let manifest=null;
 if(mode==='release'){
  if(!manifestPath)fail('Existing deployments need YOURFEED_RELEASE_MANIFEST, stored outside Git.');
  manifest=readJson(resolve(root,manifestPath));
  if(manifest.version!==1||manifest.worker!==config.name||manifest.databaseId!==databaseId||manifest.accountId!==accountId||manifest.origin!==origin)fail('Release manifest does not match the exact Worker, DB, account and origin.');
  if(!SHA.test(manifest.sourceSha||''))fail('Manifest needs a complete 40-character source SHA.');
  const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
  if(git.status!==0||git.stdout.trim()!==manifest.sourceSha)fail('Release manifest source SHA differs from the checkout.');
  const clean=spawnSync('git',['diff','--quiet','HEAD','--'],{cwd:root});
  if(clean.status!==0)fail('Commit tracked source changes before releasing a fixed SHA.');
  if(typeof manifest.previousCodeVersion!=='string'||!manifest.previousCodeVersion.trim()||typeof manifest.backupRef!=='string'||!manifest.backupRef.trim())fail('Record previousCodeVersion and a verified private backupRef before migration.');
  if(!Array.isArray(manifest.appliedMigrations)||!manifest.appliedMigrations.every(name=>typeof name==='string'&&migrations.includes(name)))fail('Record the actual applied migration names from the target DB.');
  if(manifest.recoveryVerified!==true)fail('Verify database recovery before a schema-changing release.');
 }
 return {mode,accountId,worker:config.name,databaseId,origin,migrations,configPath:resolve(root,configPath),manifest,packageVersion:script.version};
}
export function flattenWranglerRows(output){
 let value;try{value=JSON.parse(output);}catch{fail('Wrangler query did not return JSON; no migration was attempted.');}
 const chunks=Array.isArray(value)?value:[value];
 if(chunks.some(chunk=>chunk.success===false))fail('Read-only database preflight query failed.');
 return chunks.flatMap(chunk=>Array.isArray(chunk.results)?chunk.results:[]);
}
export function validateRemoteState(target,{tables=[],applied=[]}={}){
 const actual=applied.map(row=>row.name).filter(Boolean).sort();
 if(target.mode==='initial'){
  const application=tables.map(row=>row.name).filter(name=>name&&!name.startsWith('_cf')&&!name.startsWith('sqlite_')&&name!=='d1_migrations');
  if(application.length||actual.length)fail('Initial deployment requires an empty DB. Existing data must use release mode with backup and migration checks.');
 }else if(JSON.stringify(actual)!==JSON.stringify([...target.manifest.appliedMigrations].sort()))fail('Applied migrations changed since the release manifest was reviewed.');
 const unknown=actual.filter(name=>!target.migrations.includes(name));
 if(unknown.length)fail('The database has migration history absent from this checkout.');
 return {appliedMigrations:actual,pendingMigrations:target.migrations.filter(name=>!actual.includes(name))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const target=inspectTarget();const {manifest,...safe}=target;console.log(JSON.stringify({...safe,remoteChecked:false,note:'Local-only preflight. npm run deploy performs read-only remote checks before any migration.'},null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
