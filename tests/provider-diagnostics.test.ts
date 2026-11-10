import {describe,expect,it} from 'vitest';
import {httpFailure,providerErrorDiagnostic,providerMessage,readProviderJson,transportFailure,ProviderDiagnosticError} from '../server/provider-diagnostics';
const fakeKey='fixture-secret-not-real';
describe('Safe provider failure diagnostics',()=>{
 it.each([
  [{name:'TimeoutError',message:'timeout '+fakeKey},'provider_timeout',true],
  [{cause:{code:'ENOTFOUND'},message:'private hostname '+fakeKey},'provider_dns_error',false],
  [{cause:{code:'ERR_TLS_CERT_ALTNAME_INVALID'}},'provider_tls_error',false],
  [{message:'outbound network access is not allowed '+fakeKey},'provider_network_blocked',false],
  [{cause:{code:'ECONNRESET'}},'provider_network_error',true],
 ] as const)('classifies transport without exposing raw exceptions: %s',(error,code,uncertain)=>{
  const failure=transportFailure(error,'openai');expect(failure.diagnostic.code).toBe(code);expect(failure.uncertain).toBe(uncertain);expect(JSON.stringify(providerErrorDiagnostic(providerMessage(failure)))).not.toContain(fakeKey);
 });
 it.each([
  [429,{error:{code:'insufficient_quota'}},'provider_quota_exhausted'],
  [429,{error:{code:'credit_balance_exhausted'}},'provider_quota_exhausted'],
  [429,{error:{code:'rate_limit_exceeded'}},'provider_rate_limited'],
  [429,{},'provider_rate_or_quota'],
  [402,{},'provider_quota_exhausted'],
  [401,{error:{message:'invalid '+fakeKey}},'provider_auth_failed'],
  [403,{error:{code:'model_not_found'}},'provider_model_access'],
  [403,{error:{code:'unsupported_country_region_territory'}},'provider_access_denied'],
  [400,{error:{code:'unsupported_parameter',param:'temperature'}},'provider_bad_request'],
  [503,{},'provider_unavailable'],
 ] as const)('distinguishes API response %s/%j',(status,payload,code)=>{
  const response=new Response('',{status,headers:{'x-request-id':'req_fixture_123','retry-after':'12'}});const failure=httpFailure(response,payload,'openai',fakeKey);const error=providerMessage(failure);
  expect(providerErrorDiagnostic(error)).toMatchObject({code,stage:'http',provider:'openai',upstreamStatus:status,requestId:'req_fixture_123',retryAfterSeconds:12});expect(error.message).not.toContain(fakeKey);
 });
 it('does not echo a credential disguised as a request ID or arbitrary parameter',()=>{
  const failure=httpFailure(new Response('',{status:400,headers:{'x-request-id':fakeKey}}),{error:{param:fakeKey,message:fakeKey}},'custom',fakeKey);
  expect(failure.diagnostic.requestId).toBeUndefined();expect(failure.diagnostic.parameter).toBeUndefined();expect(JSON.stringify(providerErrorDiagnostic(providerMessage(failure)))).not.toContain(fakeKey);
 });
 it('reports non-JSON, empty and oversized responses without returning any body text',async()=>{
  for(const [body,code,max] of [['<html>'+fakeKey+'</html>','provider_non_json',256000],['','provider_empty_response',256000],['x'.repeat(1000),'provider_response_too_large',100]] as const){
   try{await readProviderJson(new Response(body,{headers:{'x-request-id':'req_safe'}}),'deepseek',fakeKey,max);throw new Error('expected failure');}catch(error){const safe=providerMessage(error);expect(providerErrorDiagnostic(safe)?.code).toBe(code);expect(safe.message).not.toContain(fakeKey);}
  }
 });
 it('never serializes diagnostic-looking fields from an arbitrary exception',()=>{
  expect(providerErrorDiagnostic(Object.assign(new Error(fakeKey),{diagnostic:{code:'provider_auth_failed',requestId:fakeKey}}))).toBeUndefined();expect(providerErrorDiagnostic(new ProviderDiagnosticError({code:'provider_auth_failed',provider:'openai',stage:'http'}))?.code).toBe('provider_auth_failed');
 });
});
