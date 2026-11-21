import multi,{runTenantCron} from '../../worker/multi';
import {TenantFeed} from '../../worker/tenant';
export class TestTenantFeed extends TenantFeed {
 async inspect(){return this.ctx.storage.sql.exec("SELECT json FROM settings WHERE id='key:openai'").one().json;}
}
import {DurableObject} from 'cloudflare:workers';
import {SqliteD1} from '../../server/do-d1';
export class AdapterProbe extends DurableObject {
 async fetch(request:Request){
  const db=new SqliteD1(this.ctx.storage);
  const operation=await request.json() as {statements:{sql:string;values?:unknown[]}[];batch?:boolean;method?:'first'|'all'|'run'|'raw';column?:string;columnNames?:boolean};
  const statements=operation.statements.map(s=>db.prepare(s.sql).bind(...(s.values||[])));
  try{
   if(operation.batch)return Response.json(await db.batch(statements));
   const statement=statements[0];
   return Response.json(operation.method==='first'?await statement.first(operation.column):operation.method==='raw'?(operation.columnNames?await statement.raw({columnNames:true}):await statement.raw()):await statement[operation.method||'all']());
  }catch{return Response.json({error:'SQL failed'},{status:400});}
 }
}
export default {async fetch(request:Request,env:any,ctx:ExecutionContext){
 const path=new URL(request.url).pathname;
 // This harness is bundled only by tests, never by deployment configurations.
 if(path==='/__test/inspect')return Response.json(await env.TENANT_FEEDS.getByName(new URL(request.url).searchParams.get('id')).inspect());
 if(path==='/__test/cron')return Response.json(await runTenantCron(env));
 if(path==='/__test/sql')return env.PROBE.getByName('probe').fetch(request);
 return multi.fetch(request,env,ctx);
}};
