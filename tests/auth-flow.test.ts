import {describe,it,expect,vi} from 'vitest';
import {allowedLoginProviders,continueSocialLink,LinkContinuationError,linkReauthPath,loginIntent,socialDestination,verifyAndContinue} from '../shared/auth-flow';

describe('Explicit OTP-to-social-link continuation used by the authentication UI',()=>{
 it('keeps only a whitelisted provider in a reauthentication intent',()=>{
  expect(linkReauthPath('google')).toBe('/login?reauth=1&link=google');
  expect(loginIntent('?reauth=1&link=google')).toMatchObject({reauth:true,pendingLink:'google'});
  expect(loginIntent('?link=facebook')).toMatchObject({reauth:true,pendingLink:'facebook'});
  expect(loginIntent('?link=https://attacker.invalid/')).toMatchObject({pendingLink:undefined,reauth:false});
  expect(loginIntent('?link=google%26callbackURL=https://attacker.invalid/').pendingLink).toBeUndefined();
 });
 it('hides unlinked social choices during reauthentication and all social sign-in buttons for a pending link',()=>{
  const configured={google:true,github:true,facebook:true};
  expect(allowedLoginProviders(configured,true,'google',['google','github'])).toEqual([]);
  expect(allowedLoginProviders(configured,true,undefined,['github'])).toEqual(['github']);
  expect(allowedLoginProviders(configured,true,undefined,[])).toEqual([]);
  expect(allowedLoginProviders(configured,false,undefined)).toEqual(['google','github','facebook']);
 });
 it('verifies the email first, then explicitly links the selected provider without returning home',async()=>{
  const post=vi.fn(async(path:string)=>path.endsWith('email-otp')?{success:true}:{url:'https://accounts.google.com/o/oauth2/v2/auth?state=fixture-state'});
  expect(await verifyAndContinue(post,' owner@example.com ','123456','google')).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=fixture-state');
  expect(post.mock.calls).toEqual([
   ['/api/auth/sign-in/email-otp',{email:'owner@example.com',otp:'123456'}],
   ['/api/auth/link-social',{provider:'google',callbackURL:'/'}],
  ]);
 });
 it('never requests linking when OTP verification fails',async()=>{
  const denied=new Error('fixture verification rejected'),post=vi.fn(async()=>{throw denied;});
  await expect(verifyAndContinue(post,'owner@example.com','123456','google')).rejects.toBe(denied);expect(post).toHaveBeenCalledTimes(1);
 });
 it('distinguishes a verified owner from a subsequent link failure, allowing a safe link-only retry',async()=>{
  const denied={status:401},post=vi.fn(async(path:string)=>{if(path.endsWith('email-otp'))return {success:true};throw denied;});
  await expect(verifyAndContinue(post,'owner@example.com','123456','google')).rejects.toMatchObject({cause:denied});
  await expect(verifyAndContinue(post,'owner@example.com','123456','google')).rejects.toBeInstanceOf(LinkContinuationError);
  const retry=vi.fn(async()=>({url:'https://github.com/login/oauth/authorize?state=fixture-state'}));
  await expect(continueSocialLink(retry,'github')).resolves.toContain('https://github.com/');expect(retry).toHaveBeenCalledWith('/api/auth/link-social',{provider:'github',callbackURL:'/'});
 });
 it('keeps ordinary email sign-in separate from account linking',async()=>{
  const post=vi.fn(async()=>({success:true}));expect(await verifyAndContinue(post,'owner@example.com','123456')).toBe('/');expect(post).toHaveBeenCalledTimes(1);
 });
 it.each(['https://accounts.google.com.attacker.net/','https://user:password@accounts.google.com/','http://accounts.google.com/','https://accounts.google.com:8443/','javascript:alert(1)','//accounts.google.com/'])('refuses an unsafe social redirect: %s',value=>{
  expect(()=>socialDestination('google',value)).toThrow();
 });
 it('classifies OAuth failures without turning configuration or state errors into an unlinked-account claim',()=>{
  expect(loginIntent('?error=account_not_linked&provider=google')).toMatchObject({accountNotLinked:true,oauthFailure:'not_linked',failedProvider:'google'});
  expect(loginIntent('?error=invalid_code&provider=google')).toMatchObject({accountNotLinked:false,oauthFailure:'exchange'});
  expect(loginIntent('?error=state_mismatch').oauthFailure).toBe('state');
  expect(loginIntent('?error=untrusted-raw-provider-text').oauthFailure).toBe('unavailable');
 });
});
