import {DurableObject} from 'cloudflare:workers';
import type {Env} from '../server/db';
import type {AuthSession} from '../server/auth';
import {SqliteD1} from '../server/do-d1';
import {tenantEnvironment} from '../server/tenant-env';
import {registerTenantSession} from '../server/tenant-session';
import {handleApi} from '../server/api';
import {runBackground} from '../server/background';
import initial from '../drizzle/0000_boring_enchantress.sql?raw';
import auth from '../drizzle/0001_auth.sql?raw';
import library from '../drizzle/0002_library.sql?raw';
export class TenantFeed extends DurableObject<Env> {
 private database:SqliteD1;
 private erased=false;
 private active=new Set<Promise<unknown>>();
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);this.database=new SqliteD1(ctx.storage);
  ctx.blockConcurrencyWhile(async()=>{
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS tenant_migrations (id INTEGER PRIMARY KEY)');
   [initial,auth,library].forEach((sql,id)=>{
    if(ctx.storage.sql.exec('SELECT id FROM tenant_migrations WHERE id=?',id).toArray().length)return;
    ctx.storage.transactionSync(()=>{
     for(const statement of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))ctx.storage.sql.exec(statement);
     ctx.storage.sql.exec('INSERT INTO tenant_migrations VALUES (?)',id);
    });
   });
  });
 }
 private async environment(user:AuthSession['user']){
  if(this.erased)throw new Error('Tenant deleted');
  const marker=await this.database.prepare("INSERT INTO meta(key,value) VALUES ('tenant:identity',?) ON CONFLICT(key) DO UPDATE SET value=meta.value RETURNING value").bind(user.id).first<string>('value');
  if(marker!==user.id)throw new Error('Tenant identity mismatch');
  return tenantEnvironment(this.env,this.database,user);
 }
 async api(request:Request,session:AuthSession):Promise<Response>{
  const pending=(async()=>{const env=await this.environment(session.user);registerTenantSession(env,session);return handleApi(request,env,this.ctx);})();
  this.active.add(pending);try{return await pending;}finally{this.active.delete(pending);}
 }
 async background(user:AuthSession['user']){
  const pending=(async()=>runBackground(await this.environment(user)))();
  this.active.add(pending);try{return await pending;}finally{this.active.delete(pending);}
 }
 async erase(){
  this.erased=true;
  // Let in-flight I/O finish before a later cron retries; no lock spans network I/O.
  if(this.active.size)return false;
  await this.ctx.storage.deleteAll();return true;
 }
}
