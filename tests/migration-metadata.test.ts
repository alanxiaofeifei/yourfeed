import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {getTableName} from 'drizzle-orm';
import * as schema from '../db/schema';

describe('append-only migration metadata',()=>{
 it('records every core schema migration with an immutable snapshot chain',()=>{
  const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
  expect(journal.entries.map((entry:any)=>entry.tag)).toEqual(['0000_boring_enchantress','0001_auth','0002_library']);
  expect(journal.entries[0]).toEqual({idx:0,version:'6',when:1794294754070,tag:'0000_boring_enchantress',breakpoints:true});
  let previous='00000000-0000-0000-0000-000000000000';
  for(const entry of journal.entries){const snapshot=JSON.parse(readFileSync('drizzle/meta/'+String(entry.idx).padStart(4,'0')+'_snapshot.json','utf8'));expect(snapshot.prevId).toBe(previous);previous=snapshot.id;expect(readFileSync('drizzle/'+entry.tag+'.sql','utf8')).toBeTruthy();}
 });
 it('models auth and library tables so future generation cannot recreate or drop them accidentally',()=>{
  const snapshot=JSON.parse(readFileSync('drizzle/meta/0002_snapshot.json','utf8'));
  const tables=Object.values(schema).map(getTableName).sort();expect(Object.keys(snapshot.tables).sort()).toEqual(tables);
  const db=new DatabaseSync(':memory:');for(const tag of ['0000_boring_enchantress','0001_auth','0002_library'])db.exec(readFileSync('drizzle/'+tag+'.sql','utf8'));
  for(const [name,table] of Object.entries(snapshot.tables) as [string,any][]){const columns=db.prepare('PRAGMA table_info('+name+')').all().map(row=>row.name).sort();expect(columns).toEqual(Object.keys(table.columns).sort());}
  // Virtual tables/triggers are deliberately custom SQL, not ordinary tables
  // to be regenerated from Drizzle's supported declarative schema.
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='content_search'").get()).toBeTruthy();
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='content_search_delete'").get()).toBeTruthy();
 });
});
