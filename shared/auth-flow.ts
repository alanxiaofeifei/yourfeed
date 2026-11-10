export const socialProviders=['google','github','facebook'] as const;
export type SocialProvider=typeof socialProviders[number];
export function socialProvider(value:unknown):SocialProvider|undefined{return socialProviders.find(provider=>provider===value);}
export function linkReauthPath(provider:SocialProvider):string{return '/login?reauth=1&link='+provider;}
export function loginIntent(search:string){
 const query=new URLSearchParams(search),pendingLink=socialProvider(query.get('link'));
 const error=query.get('error');const oauthFailure=error==='account_not_linked'?'not_linked':error==='invalid_code'?'exchange':error?.startsWith('state_')?'state':error==='OWNER_ONLY'||error==='email_does_not_match'?'owner':error==='access_denied'?'denied':error==='unable_to_get_user_info'?'identity':'unavailable';
 return {pendingLink,reauth:query.get('reauth')==='1'||!!pendingLink,oauthFailed:query.has('error'),accountNotLinked:error==='account_not_linked',oauthFailure,failedProvider:socialProvider(query.get('provider'))};
}
export function allowedLoginProviders(config:Partial<Record<SocialProvider,boolean>>,reauth:boolean,pendingLink:SocialProvider|undefined,linkedProviders:readonly SocialProvider[]=[]):SocialProvider[]{
 if(pendingLink)return [];
 return socialProviders.filter(provider=>config[provider]&&(!reauth||linkedProviders.includes(provider)));
}
export function socialDestination(provider:SocialProvider,value:unknown):string{
 if(typeof value!=='string')throw new Error('Invalid social destination');
 const url=new URL(value),host=provider==='google'?'accounts.google.com':provider==='facebook'?'www.facebook.com':'github.com';
 if(url.protocol!=='https:'||url.hostname!==host||url.username||url.password||(url.port&&url.port!=='443'))throw new Error('Invalid social destination');
 return url.href;
}
export type AuthPost=(path:string,body:unknown)=>Promise<{url?:string;success?:boolean}>;
export async function continueSocialLink(post:AuthPost,provider:SocialProvider):Promise<string>{
 const result=await post('/api/auth/link-social',{provider,callbackURL:'/'});return socialDestination(provider,result.url);
}
export class LinkContinuationError extends Error {constructor(readonly cause:unknown){super('Verified owner; account linking did not start');}}
/** The link request only occurs after the server has issued a verified OTP session. */
export async function verifyAndContinue(post:AuthPost,email:string,otp:string,pendingLink?:SocialProvider):Promise<string>{
 await post('/api/auth/sign-in/email-otp',{email:email.trim(),otp});
 if(!pendingLink)return '/';
 try{return await continueSocialLink(post,pendingLink);}catch(error){throw new LinkContinuationError(error);}
}
