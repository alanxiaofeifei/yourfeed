import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error Runtime-only Node operations script.
import {inspectTarget,validateRemoteState,flattenWranglerRows} from '../scripts/preflight.mjs';
const db='11111111-1111-4111-8111-111111111111',account='a'.repeat(32);
function fixture(run:(root:string)=>void){const root=mkdtempSync(join(tmpdir(),'yourfeed-preflight-test-'));try{mkdirSync(join(root,'dist/server'),{recursive:true});mkdirSync(join(root,'drizzle'));writeFileSync(join(root,'drizzle/0000_initial.sql'),'CREATE TABLE content(id TEXT);');writeFileSync(join(root,'package.json'),JSON.stringify({version:'test'}));writeFileSync(join(root,'dist/server/wrangler.json'),JSON.stringify({name:'my-feed',d1_databases:[{binding:'DB',database_id:db}],vars:{AUTH_MODE:'standalone'}}));run(root);}finally{rmSync(root,{recursive:true,force:true});}}
const env={CLOUDFLARE_ACCOUNT_ID:account,AUTH_BASE_URL:'https://my-feed.example.com',YOURFEED_DEPLOY_MODE:'initial'};
describe('explicit deployment target and migration protection',()=>{
 it('accepts a configured new target without treating local validation as remote verification',()=>fixture(root=>{const target=inspectTarget({root,env});expect(target.databaseId).toBe(db);expect(target.worker).toBe('my-feed');expect(validateRemoteState(target,{tables:[{name:'_cf_KV'}]}).pendingMigrations).toEqual(['0000_initial.sql']);}));
 it('rejects initial mode on an existing database',()=>fixture(root=>{const target=inspectTarget({root,env});expect(()=>validateRemoteState(target,{tables:[{name:'content'}]})).toThrow('empty DB');expect(()=>validateRemoteState(target,{applied:[{name:'0000_initial.sql'}]})).toThrow('empty DB');}));
 it('does not let preview settings point the production deploy command at data',()=>fixture(root=>{expect(()=>inspectTarget({root,env:{...env,YOURFEED_PREVIEW:'true'}})).toThrow('preview');expect(()=>inspectTarget({root,env:{...env,CF_PAGES_BRANCH:'feature'}})).toThrow('Preview');}));
 it('requires an explicit account and origin',()=>fixture(root=>{expect(()=>inspectTarget({root,env:{...env,CLOUDFLARE_ACCOUNT_ID:''}})).toThrow('account');expect(()=>inspectTarget({root,env:{...env,AUTH_BASE_URL:'http://localhost:5173'}})).toThrow('HTTPS');}));
 it('requires an operator backup manifest for existing instances',()=>fixture(root=>{expect(()=>inspectTarget({root,env:{...env,YOURFEED_DEPLOY_MODE:'release'}})).toThrow('YOURFEED_RELEASE_MANIFEST');}));
 it('rejects placeholder DB and ordinary publication of a Sites config',()=>fixture(root=>{const path=join(root,'dist/server/wrangler.json');writeFileSync(path,JSON.stringify({name:'my-feed',vars:{AUTH_MODE:'sites'},d1_databases:[{binding:'DB',database_id:db}]}));expect(()=>inspectTarget({root,env})).toThrow('Sites');writeFileSync(path,JSON.stringify({name:'my-feed',d1_databases:[{binding:'DB',database_id:'00000000-0000-0000-0000-000000000000'}]}));expect(()=>inspectTarget({root,env})).toThrow('placeholder');}));
 it('checks exact applied migrations on release',()=>{const target={mode:'release',migrations:['0000_initial.sql','0002_library.sql'],manifest:{appliedMigrations:['0000_initial.sql']}};expect(validateRemoteState(target,{applied:[{name:'0000_initial.sql'}]}).pendingMigrations).toEqual(['0002_library.sql']);expect(()=>validateRemoteState(target,{applied:[]})).toThrow('changed');});
 it('accepts only successful JSON query results',()=>{expect(flattenWranglerRows('[{"success":true,"results":[{"name":"content"}]}]')).toEqual([{name:'content'}]);expect(()=>flattenWranglerRows('not JSON')).toThrow('JSON');expect(()=>flattenWranglerRows('[{"success":false}]')).toThrow('failed');});
});
