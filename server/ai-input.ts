import {HttpError} from './security';

const CREDENTIAL=/\b(?:sk-[a-z\d_-]{8,}|re_[a-z\d_-]{8,}|Bearer\s+[a-z\d._~+\/-]{8,})/i;
const ASSIGNMENT=/(?:^|[\s{,;])['"]?(?:api[_ -]?key|key|access[_ -]?token|refresh[_ -]?token|token|secret|password|authorization|auth)['"]?\s*[:=]\s*['"]?[^\s"'{}\[\],;]+/i;
const SENSITIVE_QUERY=/^(?:token|access_token|refresh_token|api[_-]?key|key|auth|authorization|signature|sig|code|password|secret)$/i;

/** Check both pasted text and JSON-normalized spelling, without logging input. */
export function hasSensitiveAiInput(text:string):boolean {
  const variants=[text];
  try{variants.push(JSON.stringify(JSON.parse(text)));}catch{/* Plain subscription/chat text is also supported. */}
  // JSON exports can escape slashes or spell credential prefixes as \uXXXX.
  // A bounded additional decode catches the same data outside a complete JSON file.
  variants.push(text.replace(/\\u([a-f\d]{4})/gi,(_match,hex:string)=>String.fromCharCode(parseInt(hex,16))).replace(/\\\//g,'/'));
  return variants.some(value=>{
    value=value.replace(/&(?:amp|#0*38|#x0*26);/gi,'&');
    if(CREDENTIAL.test(value)||ASSIGNMENT.test(value))return true;
    for(const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)){
      try{const url=new URL(match[0].replace(/[.,;，。；、!?！？)\]}]+$/,''));const fragment=new URLSearchParams(url.hash.slice(1).replace(/^.*?\?/,''));if(url.username||url.password||[...url.searchParams.keys(),...fragment.keys()].some(key=>SENSITIVE_QUERY.test(key))||/(?:unsubscribe|signout|logout|oauth|callback|settings\/billing)/i.test(url.pathname))return true;}catch{/* Invalid links are rejected by the source parser, not sent to a URL fetcher. */}
    }
    return false;
  });
}

export function assertSafeAiInput(text:string):void {
  if(hasSensitiveAiInput(text))throw new HttpError(400,'输入似乎含有密钥、令牌或账号操作链接，请先移除这些内容再继续；这些内容不会发送给 AI。');
}
