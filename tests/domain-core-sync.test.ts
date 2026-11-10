import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The updater is deliberately a directly runnable JavaScript module.
import { hash, isSharedPath, mergeDependencies, migrationCompatible, planFiles, resolveStableRevision, validRef, validRepository } from '../scripts/update-core.mjs';

const temporary:string[]=[];
afterEach(()=>{for(const path of temporary.splice(0))rmSync(path,{recursive:true,force:true});});
function workspace(){const root=mkdtempSync(join(tmpdir(),'yourfeed-sync-test-'));temporary.push(root);mkdirSync(join(root,'server'));return root;}
describe('shared core update protections',()=>{
 it('includes generic features and schema while protecting credentials, branding and hosting IDs',()=>{
  for(const path of ['server/api.ts','app/page.tsx','app/layout.tsx','app/globals.css','worker/index.ts','vite.config.ts','scripts/build.mjs','db/schema.ts','drizzle/0001_auth.sql','.github/workflows/core-update.yml'])expect(isSharedPath(path),path).toBe(true);
  for(const path of ['data/profile.json','data/branding.ts','.env','.env.production','server/.env','.dev.vars','.openai/hosting.json','wrangler.jsonc','.wrangler/state/db.sqlite','../server/api.ts','server/../../.env','server\\api.ts','package.json'])expect(isSharedPath(path),path).toBe(false);
  expect(isSharedPath('server/api.ts',['db/schema.ts'])).toBe(false);
 });
 it('validates repository and refs before invoking Git',()=>{expect(validRepository('alanxiaofeifei/yourfeed')).toBe(true);expect(validRepository('../yourfeed')).toBe(false);expect(validRef('--upload-pack=evil')).toBe(false);expect(validRef('a..b')).toBe(false);});
 it('preserves consumer name, Sites build and unrelated dependencies',()=>{
  const local={name:'private-personal-feed',private:true,scripts:{build:'YOURFEED_BUILD_PROFILE=sites node scripts/build.mjs'},dependencies:{react:'19.0.0','local-extra':'1.0.0'}};
  const result=mergeDependencies(local,{name:'yourfeed',scripts:{deploy:'evil'},dependencies:{react:'19.2.6','better-auth':'^1.7.19'}},{dependencies:{react:'19.0.0'}});
  expect(result.conflicts).toEqual([]);expect(result.value).toMatchObject({name:local.name,private:true,scripts:local.scripts,dependencies:{react:'19.2.6','local-extra':'1.0.0','better-auth':'^1.7.19'}});
 });
 it('blocks overlapping dependency changes and URL packages',()=>{
  expect(mergeDependencies({dependencies:{react:'consumer'}},{dependencies:{react:'19.2.6'}},{dependencies:{react:'19.0.0'}}).conflicts).toEqual(['dependencies.react']);
  expect(()=>mergeDependencies({},{dependencies:{evil:'git+https://evil.test/x'}})).toThrow('Unsupported dependency source');
 });
 it('updates untouched core files but stops on local edits without writing',()=>{
  const root=workspace(),path=join(root,'server/api.ts');writeFileSync(path,'base');
  let result=planFiles(root,new Map([['server/api.ts',Buffer.from('upstream')]]),{'server/api.ts':hash('base')});expect(result.changes).toHaveLength(1);expect(result.conflicts).toEqual([]);expect(readFileSync(path,'utf8')).toBe('base');
  writeFileSync(path,'private customization');result=planFiles(root,new Map([['server/api.ts',Buffer.from('upstream')]]),{'server/api.ts':hash('base')});expect(result.conflicts).toEqual(['server/api.ts']);expect(readFileSync(path,'utf8')).toBe('private customization');
 });
 it('records initialization without treating local differences as overwriteable',()=>{const root=workspace();writeFileSync(join(root,'server/api.ts'),'custom');const incoming=new Map([['server/api.ts',Buffer.from('upstream')]]);expect(planFiles(root,incoming,{},true)).toEqual({changes:[],conflicts:[]});expect(planFiles(root,new Map([['server/api.ts',Buffer.from('new upstream')]]),{'server/api.ts':hash('upstream')}).conflicts).toHaveLength(1);});
 it('keeps local deletions and refuses changed upstream content over a local deletion',()=>{const root=workspace();expect(planFiles(root,new Map([['server/api.ts',Buffer.from('old')]]),{'server/api.ts':hash('old')}).changes).toEqual([]);expect(planFiles(root,new Map([['server/api.ts',Buffer.from('new')]]),{'server/api.ts':hash('old')}).conflicts).toHaveLength(1);});
 it('refuses destination symlinks including broken links',()=>{const root=workspace();symlinkSync('/does-not-exist',join(root,'server/api.ts'));expect(()=>planFiles(root,new Map([['server/api.ts',Buffer.from('new')]]))).toThrow('symlink');});
 it('requires immutable migration files and append-only journals',()=>{
  expect(migrationCompatible('drizzle/0000.sql','CREATE TABLE a;','DROP TABLE a;')).toBe(false);
  const journal={version:'7',dialect:'sqlite',entries:[{idx:0,tag:'0000'}]};expect(migrationCompatible('drizzle/meta/_journal.json',JSON.stringify(journal),JSON.stringify({...journal,entries:[...journal.entries,{idx:1,tag:'0001'}]}))).toBe(true);
  expect(migrationCompatible('drizzle/meta/_journal.json',JSON.stringify(journal),JSON.stringify({...journal,entries:[{idx:0,tag:'rewritten'}]}))).toBe(false);
 });
 it('pins latest stable release to a full commit and rejects prereleases',async()=>{
  const calls:string[]=[];const sha='a'.repeat(40);const request=async(url:string)=>{calls.push(url);return Response.json(calls.length===1?{tag_name:'v0.1.0',draft:false,prerelease:false}:{sha});};
  expect(await resolveStableRevision('alanxiaofeifei/yourfeed',request)).toBe(sha);expect(calls[1]).toContain('/commits/v0.1.0');await expect(resolveStableRevision('alanxiaofeifei/yourfeed',async()=>Response.json({tag_name:'v1',prerelease:true}))).rejects.toThrow('No stable');
 });
 it('workflow schedules proposals and never merges, deploys or receives production secrets',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/core-update.yml',import.meta.url),'utf8');expect(workflow).toContain("cron: '0 */6 * * *'");expect(workflow).toContain('workflow_dispatch:');expect(workflow).toContain('resolveStableRevision');expect(workflow).toContain('YOURFEED_UPSTREAM_REF: ${{ steps.stable.outputs.sha }}');expect(workflow).toContain('npm install --package-lock-only --ignore-scripts');expect(workflow).toContain('npm run typecheck');expect(workflow).toContain('npm test');expect(workflow).toContain('npm run build');expect(workflow).toContain('create-pull-request@v7');expect(workflow).not.toMatch(/run:.*(?:deploy|merge)|CLOUDFLARE_API_TOKEN|APP_ENCRYPTION_KEY|AUTH_SECRET/);
 });
});
