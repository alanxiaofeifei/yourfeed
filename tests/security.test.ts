import {describe,it,expect} from 'vitest';
import { encryptSecret,decryptSecret,identity,checkWriteRequest,cleanError } from '../server/security';
describe('server secrets and request boundary',()=>{
 it('encrypts with random IVs and binds ciphertext to its provider',async()=>{
  const master='a1'.repeat(32),secret='not-a-real-provider-key';
  const a=await encryptSecret(secret,master,'yourfeed:openai'),b=await encryptSecret(secret,master,'yourfeed:openai');
  expect(a).not.toContain(secret);expect(a).not.toEqual(b);expect(await decryptSecret(a,master,'yourfeed:openai')).toBe(secret);
  await expect(decryptSecret(a,master,'yourfeed:deepseek')).rejects.toThrow();
  await expect(decryptSecret(a,'b2'.repeat(32),'yourfeed:openai')).rejects.toThrow();
 });
 it('requires platform identity and rejects cross-origin writes',()=>{
  expect(()=>identity(new Request('https://feed.example/api/settings'))).toThrow();
  expect(()=>checkWriteRequest(new Request('https://feed.example/api/settings',{method:'PUT',headers:{Origin:'https://attacker.example','Content-Type':'application/json'}}))).toThrow();
  expect(cleanError(new Error('Bearer sk-sensitive-value'))).not.toContain('sk-sensitive');
 });
});
