import {describe,it,expect} from 'vitest';
import {Miniflare} from 'miniflare';

describe('mail fetch in the production workerd runtime',()=>{
 it.each([200,302])('supports manual POST and never follows a %s response',async(status)=>{
  const destinations:string[]=[];
  const mf=new Miniflare({
   modules:true,compatibilityDate:'2026-05-15',
   script:`export default {async fetch(){
    const response=await fetch('https://api.resend.com/emails',{
     method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Authorization:'Bearer test-only-key'},
     body:JSON.stringify({from:'sender@example.com',to:['owner@example.com'],text:'test-only'})
    });
    return Response.json({status:response.status,ok:response.ok});
   }};`,
   outboundService:async (request:{url:string;method:string;headers:{get(name:string):string|null}})=>{
    destinations.push(request.url);
    expect(request.method).toBe('POST');
    expect(request.headers.get('Authorization')).toBe('Bearer test-only-key');
    return new Response(status===200?JSON.stringify({id:'test-only-mail'}):null,{status,headers:status===302?{Location:'https://untrusted.example/collect'}:{}});
   },
  });
  try{
   const response=await mf.dispatchFetch('https://yourfeed.example/');
   expect(response.status).toBe(200);
   expect(await response.json()).toEqual({status,ok:status===200});
   expect(destinations).toEqual(['https://api.resend.com/emails']);
  }finally{await mf.dispose();}
 },30000);
});
