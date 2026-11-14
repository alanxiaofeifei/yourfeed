import {describe,it,expect} from 'vitest';
// @ts-expect-error Operator preparation is an intentionally standalone Node script.
import {prepareInstance,validateManifest} from '../scripts/prepare-instance.mjs';
const manifest={instanceId:'yf-example-001',workerName:'yourfeed-reader-one',databaseName:'yourfeed-reader-one',databaseId:'11111111-1111-4111-8111-111111111111',origin:'https://reader-one.example',controlWorker:'yourfeed-control'};
describe('offline isolated instance preparation',()=>{
 it('generates independent encryption/session/capability values and no owner API keys',()=>{
  const a=prepareInstance(manifest),b=prepareInstance({...manifest,instanceId:'yf-example-002'});
  expect(Object.keys(a.secrets).sort()).toEqual(['APP_ENCRYPTION_KEY','AUTH_SECRET','HOSTED_INSTANCE_TOKEN'].sort());
  expect(new Set([...Object.values(a.secrets),...Object.values(b.secrets)]).size).toBe(6);
  expect(a.bindings.vars).toMatchObject({HOSTING_MODE:'hosted',AUTH_MODE:'standalone',INSTANCE_ID:manifest.instanceId});
  expect(a.bindings.triggers.crons).toEqual(['*/15 * * * *']);
  expect(a.bindings.vars.BACKGROUND_SCHEDULE_CONFIGURED).toBe('true');
  expect(a.register.instanceToken).toBe(a.secrets.HOSTED_INSTANCE_TOKEN);expect(a.marker).toContain("NOT EXISTS(SELECT 1 FROM auth_user)");expect(a.marker).not.toMatch(/UPDATE|DELETE|REPLACE/);
 });
 it('rejects placeholder databases, non-HTTPS origins and unsafe instance identifiers',()=>{
  expect(()=>validateManifest({...manifest,databaseId:'00000000-0000-0000-0000-000000000000'})).toThrow();
  expect(()=>validateManifest({...manifest,origin:'https://reader.example/path'})).toThrow();
  expect(()=>validateManifest({...manifest,origin:'http://reader.example'})).toThrow();
  expect(()=>validateManifest({...manifest,instanceId:"yf-x';DELETE"})).toThrow();
 });
});
