import type {Env} from './db';

const CORE_TABLES=['content','sources','feedback','settings','meta','reservations','analysis_cache','content_sources','content_aliases','content_search'];
const AUTH_TABLES=['auth_user','auth_session','auth_account','auth_verification','auth_rate'];
const REQUIRED_COLUMNS:Record<string,string[]>={content:['id','source_id','kind','url','json','updated_at'],sources:['id','json'],feedback:['user_id','item_id','json'],settings:['id','json'],meta:['key','value'],reservations:['id','day','month','content_id','reserved_cost','cost','input_tokens','output_tokens','is_test','status','created_at'],analysis_cache:['content_id','fingerprint','provider','model','json'],content_sources:['content_id','source_id','name','url','first_seen_at','last_seen_at'],content_aliases:['alias','content_id'],content_search:['content_id','text']};
/** Inspect the deployed schema rather than declaring success from one table.
 * Does not apply migrations, seed content, or read credentials. */
export async function schemaHealth(env:Env) {
  if(!env.DB)return {schemaReady:false,schemaVersion:2,missing:['DB']};
  const objects=await env.DB.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','index','trigger')").all<{name:string;type:string}>();
  const names=new Set(objects.results.map(row=>row.name)),tables=env.AUTH_MODE==='sites'?CORE_TABLES:[...CORE_TABLES,...AUTH_TABLES];
  const missing=tables.filter(name=>!names.has(name));
  for(const name of ['content_source_idx','reservation_month_idx','reservation_day_idx','content_updated_id_idx','feedback_item_idx','content_search_delete',...(env.AUTH_MODE==='sites'?[]:['auth_session_user_idx','auth_account_provider_idx','auth_account_user_idx','auth_verification_identifier_idx'])])if(!names.has(name))missing.push(name);
  for(const [table,columns] of Object.entries(REQUIRED_COLUMNS))if(names.has(table)){const info=await env.DB.prepare(`PRAGMA table_info(${table})`).all<{name:string}>();const actual=new Set(info.results.map(column=>column.name));for(const column of columns)if(!actual.has(column))missing.push(table+'.'+column);}
  return {schemaReady:missing.length===0,schemaVersion:2,missing};
}
