import {describe,it,expect} from 'vitest';
import {sessionForRequest} from '../server/session';
import {handleApi} from '../server/api';
import type {Env} from '../server/db';
describe('dispatch-owned SSO session',()=>{
 it('reveals no user fields when the platform identity is absent',async()=>{
  const session=await sessionForRequest(new Request('https://feed.example/api/session',{headers:{'oai-authenticated-user-email':'private@example.com','oai-authenticated-user-full-name':'Private'}}),{AUTH_MODE:'sites'} as unknown as Env);
  expect(session.authenticated).toBe(false);expect(session.user).toBeUndefined();expect(session.signInPath).toBe('/signin-with-chatgpt?return_to=%2F');expect(session.ownerOnly).toBe(true);
 });
 it('decodes optional trusted displayname and handles malformed encoding safely',async()=>{
  const request=new Request('https://feed.example/api/session',{headers:{'oai-authenticated-user-id':'owner-123','oai-authenticated-user-email':'owner@example.com','oai-authenticated-user-full-name':'Example%20Owner','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
  expect((await sessionForRequest(request,{AUTH_MODE:'sites'} as unknown as Env)).user).toEqual({id:'owner-123',email:'owner@example.com',name:'Example Owner'});
  request.headers.set('oai-authenticated-user-full-name','%broken');expect((await sessionForRequest(request,{AUTH_MODE:'sites'} as unknown as Env)).user?.name).toBeUndefined();
 });
 it('serves session before database initialization while protecting content endpoints',async()=>{
  const env={} as Env;
  const session=await handleApi(new Request('https://feed.example/api/session'),env);
  expect(session.status).toBe(200);expect(((await session.json()) as {authenticated:boolean}).authenticated).toBe(false);
  const feed=await handleApi(new Request('https://feed.example/api/feed'),env);expect(feed.status).toBe(401);
  const settings=await handleApi(new Request('https://feed.example/api/settings'),env);expect(settings.status).toBe(401);
 });
});
