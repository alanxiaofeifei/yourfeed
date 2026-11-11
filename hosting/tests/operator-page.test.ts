import {describe,it,expect} from 'vitest';
import {runInNewContext} from 'node:vm';
import {operatorPage} from '../control/operator-page';
import {hashToken,signAdmin} from '../control/worker';

describe('hosting operator interface',()=>{
 it('keeps the credential in the tab and signs the exact canonical request used by the control worker',async()=>{
  const response=operatorPage(),html=await response.text();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(html).not.toMatch(/localStorage|sessionStorage/);
  const elements=new Map<string,any>();for(const id of ['secret','list','clear','email','invite','instance','confirmation','revoke','expire','renew','result'])elements.set(id,{value:'',disabled:false,onclick:undefined,textContent:'',attributes:{},setAttribute(name:string,value:string){this.attributes[name]=value;},checkValidity(){return true;}});
  const secret='fixture-only-operator-secret-1234567890-abcdefgh';elements.get('secret').value=secret;
  let captured:RequestInit|undefined;
  runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1],{crypto,TextEncoder,Date,Uint8Array,JSON,document:{getElementById:(id:string)=>elements.get(id),querySelectorAll:()=>['list','clear','invite','revoke','expire','renew'].map(id=>elements.get(id))},fetch:async(path:string,init:RequestInit)=>{expect(path).toBe('/admin');captured=init;return new Response(JSON.stringify({maxTenants:5,slots:[]}));}});
  await elements.get('list').onclick();expect(captured).toBeDefined();
  const headers=captured!.headers as Record<string,string>,canonical=`POST\n/admin\n${headers['x-hosting-timestamp']}\n${headers['x-hosting-nonce']}\n${await hashToken(String(captured!.body))}`;
  expect(headers['x-hosting-signature']).toBe(await signAdmin(secret,canonical));
  expect(JSON.stringify(captured)).not.toContain(secret);expect(elements.get('result').textContent).toContain('maxTenants');
  elements.get('clear').onclick();expect(elements.get('secret').value).toBe('');expect(elements.get('email').value).toBe('');
 });
 it('never inserts tenant or operator values into the initial HTML',async()=>{
  const response=operatorPage(),html=await response.text();expect(html).not.toContain('owner@example.com');expect(html).not.toContain('token_hash');
  const nonce=html.match(/<script nonce="([^"]+)"/)![1];expect(response.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
 });
});
