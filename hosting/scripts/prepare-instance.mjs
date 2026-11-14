#!/usr/bin/env node
// Offline preparation only: no Cloudflare API calls, provisioning or deployment.
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

export const HOSTED_CRON='*/15 * * * *';

export function validateManifest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid instance manifest');
 for(const key of ['instanceId','workerName','databaseName','controlWorker'])if(typeof input[key]!=='string'||!/^[a-z][a-z0-9-]{2,62}$/.test(input[key]))throw new Error('Invalid '+key);
 if(!input.instanceId.startsWith('yf-'))throw new Error('instanceId must start with yf-');
 if(typeof input.databaseId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.databaseId)||/^0+-0+-0+-0+-0+$/.test(input.databaseId))throw new Error('Supply the independently provisioned D1 database ID');
 const url=new URL(input.origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Supply the exact HTTPS tenant origin');
 return {...input,origin:url.origin};
}
export function prepareInstance(input){
 const manifest=validateManifest(input),instanceToken=randomBytes(32).toString('hex');
 return {manifest,
  bindings:{name:manifest.workerName,workers_dev:false,preview_urls:false,triggers:{crons:[HOSTED_CRON]},vars:{HOSTING_MODE:'hosted',AUTH_MODE:'standalone',INSTANCE_ID:manifest.instanceId,AUTH_BASE_URL:manifest.origin,SECRET_NAMESPACE:'yourfeed:'+manifest.instanceId,BACKGROUND_SCHEDULE_CONFIGURED:'true'},d1_databases:[{binding:'DB',database_name:manifest.databaseName,database_id:manifest.databaseId,migrations_dir:'drizzle'}],services:[{binding:'HOSTED_CONTROL_SERVICE',service:manifest.controlWorker}]},
  secrets:{APP_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AUTH_SECRET:randomBytes(32).toString('hex'),HOSTED_INSTANCE_TOKEN:instanceToken},
  register:{operation:'register',instanceId:manifest.instanceId,origin:manifest.origin,databaseId:manifest.databaseId,instanceToken},
  marker:`-- Apply ONLY to the verified empty tenant DB after ALL core migrations.\n-- No existing data or identity is overwritten. No marker means admission stays locked.\nINSERT INTO meta(key,value) SELECT 'hosted:instance','${manifest.instanceId}' WHERE ${['content','sources','settings','feedback','reservations','analysis_cache','content_sources','content_aliases','content_search','auth_user','auth_session','auth_account','auth_verification','auth_rate'].map(table=>'NOT EXISTS(SELECT 1 FROM '+table+')').join(' AND ')} AND NOT EXISTS(SELECT 1 FROM meta WHERE key<>'seeded-v1');\n`
 };
}
export function main(argv=process.argv.slice(2)){
 const args=new Map();for(let i=0;i<argv.length;i+=2){if(!['--manifest','--output'].includes(argv[i])||!argv[i+1])throw new Error('Usage: prepare-instance.mjs --manifest FILE [--output PRIVATE_DIRECTORY]');args.set(argv[i],argv[i+1]);}
 if(!args.has('--manifest'))throw new Error('An instance manifest is required');
 const input=JSON.parse(readFileSync(resolve(args.get('--manifest')),'utf8')),manifest=validateManifest(input);
 if(!args.has('--output')){console.log(JSON.stringify({dryRun:true,instanceId:manifest.instanceId,origin:manifest.origin,databaseId:manifest.databaseId,checks:['independent database required','empty database and migration preflight required','new encryption/session/capability secrets required','verified Google callback and sender domain required'],deploys:false},null,2));return;}
 const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..')),target=resolve(args.get('--output'));
 // Secrets must never be generated within the public/private source checkout.
 const parent=dirname(target);if(!existsSync(parent))throw new Error('Create the private parent directory first');
 const actual=resolve(realpathSync(parent),target.split('/').at(-1));const distance=relative(root,actual);if(!distance||(!distance.startsWith('..')&&!isAbsolute(distance)))throw new Error('Use a new directory outside the source repository');
 const result=prepareInstance(manifest);mkdirSync(actual,{mode:0o700});
 for(const [name,data]of [['bindings.json',result.bindings],['secrets.json',result.secrets],['register.json',result.register]])writeFileSync(resolve(actual,name),JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
 writeFileSync(resolve(actual,'identity-marker.sql'),result.marker,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({prepared:true,directory:actual,instanceId:manifest.instanceId,deploys:false,secretsPrinted:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main();}catch(error){console.error(error instanceof Error?error.message:'Preparation failed');process.exitCode=1;}}
