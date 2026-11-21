import type {D1Database,D1PreparedStatement,D1Result} from '@cloudflare/workers-types';
/** All SQL stays inside one tenant DO. batch executes synchronously in one SQLite
 * transaction, including result materialization, so a later failure rolls back. */
export class SqliteD1 implements D1Database {
 constructor(readonly storage:Pick<DurableObjectStorage,'sql'|'transactionSync'>){}
 prepare(sql:string):SqliteStatement{return new SqliteStatement(this,sql);}
 async batch<T=unknown>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]> {
  return this.storage.transactionSync(()=>statements.map(statement=>{
   if(!(statement instanceof SqliteStatement)||statement.db!==this)throw new Error('Foreign SQL statement');
   return statement.execute<T>().result;
  }));
 }
 async exec(sql:string){const start=Date.now();this.storage.transactionSync(()=>this.storage.sql.exec(sql).toArray());return {count:1,duration:Date.now()-start};}
 withSession(){return {prepare:(sql:string)=>this.prepare(sql),batch:<T=unknown>(s:D1PreparedStatement[])=>this.batch<T>(s),getBookmark:()=>null};}
 async dump():Promise<ArrayBuffer>{throw new Error('Use the application export API for tenant data');}
}
export class SqliteStatement implements D1PreparedStatement {
 constructor(readonly db:SqliteD1,readonly sql:string,readonly values:unknown[]=[]){}
 bind(...values:unknown[]):SqliteStatement {
  const safe=values.map(value=>{
   if(value===null||typeof value==='string'||typeof value==='number'||value instanceof ArrayBuffer)return value;
   if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice().buffer;
   throw new TypeError('Unsupported D1 binding');
  });
  return new SqliteStatement(this.db,this.sql,safe);
 }
 execute<T>(){
  const storage=this.db.storage.sql,start=Date.now();
  const before=storage.exec('SELECT total_changes() AS n').one().n as number;
  const cursor=storage.exec(this.sql,...this.values),columns=cursor.columnNames;
  const raw=[...cursor.raw()];
  const stats=storage.exec('SELECT total_changes() AS total,changes() AS changes,last_insert_rowid() AS last_id').one();
  const changed=Number(stats.total)>before;
  const result:D1Result<T>={success:true,results:raw.map(row=>Object.fromEntries(columns.map((name,i)=>[name,row[i]])) as T),meta:{duration:Date.now()-start,size_after:storage.databaseSize,rows_read:cursor.rowsRead,rows_written:cursor.rowsWritten,last_row_id:Number(stats.last_id),changes:changed?Number(stats.changes):0,changed_db:changed}};
  return {result,raw,columns};
 }
 async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{
  const {result}=this.execute<Record<string,unknown>>(),row=result.results[0];
  if(!row)return null;
  if(column!==undefined&&!Object.hasOwn(row,column))throw new Error('D1 column not found');
  return (column===undefined?row:row[column]) as T;
 }
 async all<T=Record<string,unknown>>(){return this.execute<T>().result;}
 async run<T=Record<string,unknown>>(){return this.execute<T>().result;}
 raw<T=unknown[]>(options:{columnNames:true}):Promise<[string[],...T[]]>;
 raw<T=unknown[]>(options?:{columnNames?:false}):Promise<T[]>;
 async raw<T=unknown[]>(options?:{columnNames?:boolean}):Promise<T[]|[string[],...T[]]>{const value=this.execute();return options?.columnNames?[value.columns,...value.raw as T[]]:value.raw as T[];}
}
