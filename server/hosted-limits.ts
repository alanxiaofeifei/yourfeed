import {type Env} from './db';
import {HttpError} from './security';
/** Conservative admission counters are per independent database, never global. */
export async function reserveManualImport(env:Env,now=new Date()){
 if(env.HOSTING_MODE!=='hosted')return;
 const key='limits:manual-import:'+now.toISOString().slice(0,10);
 const r=await env.DB.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(meta.value AS INTEGER)+1 WHERE CAST(meta.value AS INTEGER)<20 RETURNING key').bind(key,'1').first();
 if(!r)throw new HttpError(429,'今日手动导入与网页提取已达 20 次，请明天再试。');
}
