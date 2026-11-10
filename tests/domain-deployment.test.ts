import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../server/db';
const memory=vi.hoisted(()=>new Map<string,string>());
vi.mock('../server/db',()=>({getState:async(_env:unknown,key:string)=>memory.get(key)||null,setState:async(_env:unknown,key:string,value:string)=>{memory.set(key,value);}}));
import { checkDeployment, getDeployment, normalizeDomain, saveDeployment, verifyDeploymentChallenge } from '../server/deployment';

const request=new Request('https://original.example.com/api/deployment');
const env={DB:{},AUTH_MODE:'standalone',APP_ENCRYPTION_KEY:'private-instance-key-'.repeat(4),AUTH_BASE_URL:'https://original.example.com'} as unknown as Env;
beforeEach(()=>memory.clear());
describe('domain connection guide',()=>{
 it('normalizes public hostnames and rejects URL paths, credentials, IPs and local names',()=>{
  expect(normalizeDomain(' Feed.Example.com ')).toBe('feed.example.com');expect(normalizeDomain('https://feed.example.com/')).toBe('feed.example.com');
  for(const value of ['http://feed.example.com','https://user:pass@feed.example.com','feed.example.com/path','127.0.0.1','[::1]','localhost','169.254.169.254','2130706433','https://feed.example.com/?key=x'])expect(()=>normalizeDomain(value),value).toThrow();
 });
 it('saves only advisory hostname and never changes canonical sign-in origin',async()=>{const value=await saveDeployment(env,request,{hostname:'feed.example.com',AUTH_BASE_URL:'https://evil.example.com'});expect(value.hostname).toBe('feed.example.com');expect(value.configuredOrigin).toBe('https://original.example.com');expect(env.AUTH_BASE_URL).toBe('https://original.example.com');expect(await getDeployment(env,request)).toMatchObject({currentOrigin:'https://original.example.com',hostingMode:'cloudflare'});});
 it('never fetches when any DNS address is private',async()=>{await saveDeployment(env,request,{hostname:'feed.example.com'});const fetcher=vi.fn();const value=await checkDeployment(env,request,{resolve:async()=>['8.8.8.8','10.0.0.1'],fetch:fetcher});expect(fetcher).not.toHaveBeenCalled();expect(value.lastCheck).toMatchObject({dns:'unsafe',instance:'unverified'});});
 it('verifies a signed challenge without sending credentials or following redirects',async()=>{
  await saveDeployment(env,request,{hostname:'feed.example.com'});const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{expect(options?.credentials).toBe('omit');expect(options?.redirect).toBe('manual');expect(options?.headers).toEqual({Accept:'application/json'});return verifyDeploymentChallenge(env,String(input).split('/').at(-1)!);});
  const value=await checkDeployment(env,request,{resolve:async()=>['8.8.8.8'],fetch:fetcher as typeof fetch});expect(value.lastCheck).toMatchObject({dns:'public',https:'reachable',instance:'matched'});expect(value.configuredOrigin).toBe('https://original.example.com');
 });
 it('rejects another instance proof even when the nonce is known',async()=>{await saveDeployment(env,request,{hostname:'feed.example.com'});const value=await checkDeployment(env,request,{resolve:async()=>['8.8.8.8'],fetch:async input=>verifyDeploymentChallenge({...env,APP_ENCRYPTION_KEY:'different-instance-key'.repeat(4)},String(input).split('/').at(-1)!)});expect(value.lastCheck?.instance).toBe('unverified');});
 it('reports authentication redirects without following them',async()=>{await saveDeployment(env,request,{hostname:'feed.example.com'});const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}}));const value=await checkDeployment(env,request,{resolve:async()=>['8.8.8.8'],fetch:fetcher});expect(fetcher).toHaveBeenCalledTimes(1);expect(value.lastCheck).toMatchObject({https:'authentication-required',instance:'unverified'});});
 it('bounds response size and handles DNS/TLS failures without exposing secrets',async()=>{await saveDeployment(env,request,{hostname:'feed.example.com'});const value=await checkDeployment(env,request,{resolve:async()=>['8.8.8.8'],fetch:async()=>new Response('x'.repeat(5000))});expect(value.lastCheck?.instance).toBe('unverified');expect(JSON.stringify(value)).not.toContain(env.APP_ENCRYPTION_KEY);const failed=await checkDeployment(env,request,{resolve:async()=>{throw new Error('internal error');},fetch});expect(failed.lastCheck?.dns).toBe('unavailable');expect(failed.lastCheck?.message).not.toContain('internal error');});
 it('verification response is opaque and invalid requests reveal no key material',async()=>{const response=await verifyDeploymentChallenge(env,'f'.repeat(64));const value=await response.json() as any;expect(value.proof).toMatch(/^[a-f0-9]{64}$/);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(JSON.stringify(value)).not.toContain(env.APP_ENCRYPTION_KEY);expect((await verifyDeploymentChallenge(env,'bad')).status).toBe(400);});
});
