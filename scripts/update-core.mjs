import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE='.yourfeed-core.json', MAX_FILE=2*1024*1024;
export const CORE_PATTERNS=['server/**','shared/**','app/components/**','app/i18n.tsx','app/page.tsx','app/layout.tsx','app/globals.css','worker/index.ts','vite.config.ts','scripts/build.mjs','db/schema.ts','drizzle/**','tests/**','scripts/update-core.mjs','scripts/preflight.mjs','scripts/deploy.mjs','scripts/recovery-snapshot.mjs','scripts/collect-recovery.mjs','.github/workflows/core-update.yml'];
const protectedPaths=/^(?:\.git(?:\/|$)|\.openai(?:\/|$)|\.wrangler(?:\/|$)|\.env|\.dev\.vars|data(?:\/|$)|node_modules(?:\/|$)|dist(?:\/|$)|wrangler[^/]*\.(?:jsonc?|toml)$|\.yourfeed-(?:sync|core)\.json$)/;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validRepository(value){return typeof value==='string'&&/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..');}
export function validRef(value){return typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(value)&&!value.includes('..')&&!value.endsWith('/')&&!value.includes('//');}
function matches(path,pattern){return pattern.endsWith('/**')?path.startsWith(pattern.slice(0,-2)):path===pattern;}
export function isSharedPath(path,patterns=CORE_PATTERNS){return typeof path==='string'&&!path.includes('\\')&&!path.split('/').some(part=>part==='..'||part==='.'||!part||part.startsWith('.env')||part.startsWith('.dev.vars'))&&!isAbsolute(path)&&!protectedPaths.test(path)&&CORE_PATTERNS.some(pattern=>matches(path,pattern))&&patterns.some(pattern=>matches(path,pattern));}
export async function resolveStableRevision(repository,request=fetch){
 if(!validRepository(repository))throw new Error('Invalid upstream repository');
 const get=async path=>{const response=await request(`https://api.github.com/repos/${repository}/${path}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'YourFeed-core-updater'}});if(!response.ok)throw new Error('Cannot resolve stable release: HTTP '+response.status);return response.json();};
 const release=await get('releases/latest');if(release.draft||release.prerelease||!validRef(release.tag_name))throw new Error('No stable release available');
 const revision=await get('commits/'+encodeURIComponent(release.tag_name));if(!/^[a-f0-9]{40}$/.test(revision.sha))throw new Error('Invalid stable release revision');return revision.sha;
}
export function migrationCompatible(path,local,incoming){
 if(!path.startsWith('drizzle/'))return true;
 if(path==='drizzle/meta/_journal.json'){
  try{const old=JSON.parse(local),next=JSON.parse(incoming);return old.version===next.version&&old.dialect===next.dialect&&Array.isArray(old.entries)&&Array.isArray(next.entries)&&old.entries.length<=next.entries.length&&old.entries.every((entry,index)=>JSON.stringify(entry)===JSON.stringify(next.entries[index]));}catch{return false;}
 }
 return local===incoming;
}
function validDependency(version){return typeof version==='string'&&version.length<100&&/^[0-9a-zA-Z^~*<>=| .+-]+$/.test(version)&&!version.startsWith('-');}
export function mergeDependencies(local,upstream,baseline={}){
 const result=structuredClone(local),conflicts=[];
 for(const group of ['dependencies','devDependencies']){
  const current=result[group]??={};
  for(const [name,version] of Object.entries(upstream[group]||{})){
   if(!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)||!validDependency(version))throw new Error(`Unsupported dependency source: ${name}`);
   const old=baseline[group]?.[name];if(current[name]===version||version===old)continue;
   if(current[name]!==undefined&&current[name]!==old){conflicts.push(`${group}.${name}`);continue;}
   current[name]=version;
  }
 }
 return {value:result,conflicts};
}
function git(cwd,args){const result=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'}});if(result.status!==0)throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);return result.stdout;}
function blob(cwd,path){const result=spawnSync('git',['show',`HEAD:${path}`],{cwd,maxBuffer:MAX_FILE+1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'}});if(result.status!==0)throw new Error(`Cannot read upstream file: ${path}`);return result.stdout;}
function safeDestination(root,path){
 const target=resolve(root,path);if(relative(root,target).startsWith('..'+sep)||!relative(root,target))throw new Error(`Unsafe destination: ${path}`);
 let cursor=target;while(cursor!==root){try{if(lstatSync(cursor).isSymbolicLink())throw new Error(`Refusing symlink destination: ${path}`);}catch(error){if(error.code!=='ENOENT')throw error;}cursor=dirname(cursor);}
 return target;
}
export function planFiles(root,files,baseline={},initialize=false){
 const changes=[],conflicts=[];
 for(const [path,bytes] of files){
  const target=safeDestination(root,path),incoming=hash(bytes);if(initialize)continue;
  if(!existsSync(target)){if(baseline[path]){if(incoming!==baseline[path])conflicts.push(path+' (locally deleted)');}else changes.push({path,bytes});continue;}
  if(!lstatSync(target).isFile()){conflicts.push(path);continue;}
  const local=readFileSync(target),localHash=hash(local);if(localHash===incoming||incoming===baseline[path])continue;
  if(path.startsWith('drizzle/')&&!migrationCompatible(path,local.toString(),bytes.toString())){conflicts.push(path+' (migrations are append-only)');continue;}
  if(localHash!==baseline[path]&&!(path==='drizzle/meta/_journal.json'&&migrationCompatible(path,local.toString(),bytes.toString()))){conflicts.push(path);continue;}
  changes.push({path,bytes});
 }
 return {changes,conflicts};
}
export async function updateCore({root=process.cwd(),dryRun=false,initialize=false,ref:refOverride}={}){
 root=realpathSync(root);safeDestination(root,'.yourfeed-sync.json');safeDestination(root,STATE);safeDestination(root,'package.json');const config=JSON.parse(readFileSync(join(root,'.yourfeed-sync.json'),'utf8'));
 const upstream=process.env.YOURFEED_UPSTREAM_REPO||config.upstream;let ref=refOverride||process.env.YOURFEED_UPSTREAM_REF||config.ref||'latest-stable';
 if(!validRepository(upstream)||!validRef(ref)||config.version!==1||!Array.isArray(config.include)||config.include.some(pattern=>!CORE_PATTERNS.includes(pattern)))throw new Error('Invalid shared-core configuration');
 if(ref==='latest-stable')ref=await resolveStableRevision(upstream);
 const previous=existsSync(join(root,STATE))?JSON.parse(readFileSync(join(root,STATE),'utf8')):{};
 if(previous.upstream&&previous.upstream!==upstream)throw new Error('Upstream changed. Review and initialize a new baseline explicitly.');
 const temporary=mkdtempSync(join(tmpdir(),'yourfeed-core-'));
 try{
  git(temporary,['init','--quiet']);git(temporary,['-c','core.hooksPath=/dev/null','remote','add','origin',`https://github.com/${upstream}.git`]);git(temporary,['-c','core.hooksPath=/dev/null','fetch','--depth=1','origin',ref]);
  const commit=git(temporary,['rev-parse','FETCH_HEAD']).trim();if(!/^[a-f0-9]{40,64}$/.test(commit))throw new Error('Invalid source revision');git(temporary,['update-ref','HEAD',commit]);
  const files=new Map();
  for(const entry of git(temporary,['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean)){
   const match=/^(\d+) blob [a-f0-9]+\t([\s\S]+)$/.exec(entry);if(!match||!isSharedPath(match[2],config.include))continue;
   if(!['100644','100755'].includes(match[1]))throw new Error(`Refusing non-regular source file: ${match[2]}`);
   const bytes=blob(temporary,match[2]);if(bytes.length>MAX_FILE)throw new Error(`Core file too large: ${match[2]}`);files.set(match[2],bytes);
  }
  const upstreamPackage=JSON.parse(blob(temporary,'package.json').toString()),localPackage=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const plan=planFiles(root,files,previous.files,initialize),packages=initialize?{value:localPackage,conflicts:[]}:mergeDependencies(localPackage,upstreamPackage,previous.package);
  const conflicts=[...plan.conflicts,...packages.conflicts];if(conflicts.length)throw new Error('Local customizations need manual review; nothing was written:\n'+conflicts.map(path=>' - '+path).join('\n'));
  const packageChanged=JSON.stringify(localPackage)!==JSON.stringify(packages.value);
  const next={version:1,upstream,commit,files:Object.fromEntries([...files].map(([path,bytes])=>[path,hash(bytes)])),package:{dependencies:upstreamPackage.dependencies||{},devDependencies:upstreamPackage.devDependencies||{}}};
  const stateChanged=JSON.stringify(previous)!==JSON.stringify(next);
  if(!dryRun){for(const {path,bytes}of plan.changes){const target=safeDestination(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}if(packageChanged)writeFileSync(join(root,'package.json'),JSON.stringify(packages.value,null,2)+'\n');if(stateChanged)writeFileSync(join(root,STATE),JSON.stringify(next,null,2)+'\n');}
  return {upstream,commit,initialize,dryRun,changedFiles:plan.changes.map(change=>change.path),packageChanged,stateChanged};
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),allowed=new Set(['--dry-run','--init','--ref']);for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw new Error('Unknown option '+args[i]);if(args[i]==='--ref'&&(!args[++i]||args[i].startsWith('--')))throw new Error('--ref requires a revision');}const refAt=args.indexOf('--ref');console.log(JSON.stringify(await updateCore({dryRun:args.includes('--dry-run'),initialize:args.includes('--init'),ref:refAt<0?undefined:args[refAt+1]}),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
