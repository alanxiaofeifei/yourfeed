import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

// Browser acceptance covers the interaction; these guards protect the secret-adjacent wiring.
describe('provider-test receipt frontend boundary',()=>{
 const source=readFileSync(new URL('../app/components/AiSettings.tsx',import.meta.url),'utf8');
 it('keeps opaque proof in mounted-form memory and never serializes it to browser storage',()=>{
  expect(source).toContain('const testReceipt=useRef<{value:string;revision:number}|null>(null)');
  expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.(log|debug)/);
 });
 it('invalidates proof on all draft edits and rejects stale async test results',()=>{
  expect(source).toContain('const markUnsaved=()=>{testReceipt.current=null;draftRevision.current++');
  expect(source).toContain('if(testedRevision!==draftRevision.current)return;');
  expect(source).toContain('testReceipt.current={value:result.testReceipt,revision:testedRevision}');
  expect(source).toContain('testReceipt.current=null;draftRevision.current++;setSaving(true)');
 });
 it('submits proof only with an explicit save of the same revision',()=>{
  expect(source).toContain('testReceipt:testReceipt.current?.revision===draftRevision.current?testReceipt.current.value:undefined');
  expect(source).toContain("'/api/test-provider',modelPayload()");
  expect(source).toContain("testReceipt.current=null;dirty.current=false;");
  expect(source).toContain("testReceipt.current=null;onDirtyChange?.(false);");
 });
 it('keeps persisted verification out of the tour request body',()=>{
  const tour=readFileSync(new URL('../app/components/onboarding/Tour.tsx',import.meta.url),'utf8');
  expect(tour).not.toContain('testReceipt');
  expect(tour).not.toContain('modelPayload');
 });
});
