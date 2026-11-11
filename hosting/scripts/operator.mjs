#!/usr/bin/env node
// Operators supply the control secret through process environment, never an argument.
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';

const args=process.argv.slice(2),dryRun=args.includes('--dry-run'),values=args.filter(x=>x!=='--dry-run');
try{
 if(values.length!==2)throw new Error('Usage: operator.mjs CONTROL_HTTPS_ORIGIN REQUEST_JSON_FILE [--dry-run]');
 const base=new URL(values[0]);if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw new Error('An exact HTTPS control origin is required');
 const raw=readFileSync(values[1],'utf8');if(Buffer.byteLength(raw)>8192)throw new Error('Operator request too large');
 const data=JSON.parse(raw);if(!['register','invite','list','revoke','expire','renew'].includes(data.operation))throw new Error('Invalid operator operation');
 if(dryRun){console.log(JSON.stringify({dryRun:true,origin:base.origin,operation:data.operation,network:false,payloadPrinted:false}));}
 else{
  const secret=process.env.CONTROL_ADMIN_SECRET;if(!secret||secret.length<43)throw new Error('Provide CONTROL_ADMIN_SECRET through the operator secret environment');
  const timestamp=String(Date.now()),nonce=randomBytes(24).toString('hex'),digest=createHash('sha256').update(raw).digest('hex'),canonical=`POST\n/admin\n${timestamp}\n${nonce}\n${digest}`,signature=createHmac('sha256',secret).update(canonical).digest('hex');
  const response=await fetch(new URL('/admin',base),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15_000),headers:{'Content-Type':'application/json','x-hosting-timestamp':timestamp,'x-hosting-nonce':nonce,'x-hosting-signature':signature},body:raw});
  if(!response.ok)throw new Error('Control operation failed (HTTP '+response.status+'); inspect the authenticated control state before retrying');
  const result=await response.json();
  // register payload contains a capability; the response does not. Operator lists may contain invite emails.
  console.log(JSON.stringify(result,null,2));
 }
}catch(error){console.error(error instanceof Error?error.message:'Operator operation failed');process.exitCode=1;}
