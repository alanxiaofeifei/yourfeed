import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({meta:new Map<string,string>(),cleanup:vi.fn(),sync:vi.fn(),analyze:vi.fn(),admit:vi.fn()}));
vi.mock('../server/db',()=>({getState:async(_e:unknown,key:string)=>state.meta.get(key)||null,setState:async(_e:unknown,key:string,value:string)=>{state.meta.set(key,value);},getConfig:async()=>({enabled:true,provider:'openai',dailyLimit:20,monthlyBudget:20}),getProviderKey:async()=> 'mock-only-key',getUsage:async()=>({analyzedToday:0,cost:0,reserved:0})}));
vi.mock('../server/retention',()=>({cleanupRetention:state.cleanup}));
vi.mock('../server/ingest',()=>({syncSources:state.sync}));
vi.mock('../server/ai',()=>({analyzePending:state.analyze}));
vi.mock('../server/hosted',()=>({assertHostedAdmission:state.admit}));
import {backgroundStatus,runBackground,saveBackgroundPolicy} from '../server/background';
const env:any={BACKGROUND_SCHEDULE_CONFIGURED:'true',DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})}};
beforeEach(()=>{state.meta.clear();vi.clearAllMocks();state.cleanup.mockResolvedValue({cleared:0});state.sync.mockResolvedValue({pending:0,processed:1});state.analyze.mockResolvedValue({analyzed:1});state.admit.mockResolvedValue(undefined);});
describe('independent opt-in tasks',()=>{
 it('runs cache maintenance without fetching sources or calling AI when fetching is off',async()=>{expect(await runBackground(env)).toMatchObject({ran:false,reason:'disabled'});expect(state.cleanup).toHaveBeenCalledOnce();expect(state.sync).not.toHaveBeenCalled();expect(state.analyze).not.toHaveBeenCalled();});
 it('never runs AI without a proven saved owner and passes feedback identity when explicitly configured',async()=>{await saveBackgroundPolicy(env,{enabled:true,aiEnabled:false},'original-site-owner');await runBackground(env);expect(state.analyze).not.toHaveBeenCalled();state.meta.delete('background:last-run');await saveBackgroundPolicy(env,{aiEnabled:true},'original-site-owner');await runBackground(env);expect(state.analyze).toHaveBeenCalledWith(env,1,'original-site-owner');});
 it('fails closed before cache changes or network work after hosted revocation',async()=>{state.admit.mockRejectedValue(Error('revoked'));await expect(runBackground({...env,HOSTING_MODE:'hosted'})).rejects.toThrow('revoked');expect(state.cleanup).not.toHaveBeenCalled();expect(state.sync).not.toHaveBeenCalled();});
});

describe('refresh modes and due ticks',()=>{
 it('maps legacy opt-in to scheduled and defaults everyone else to on-open',async()=>{
  expect(await backgroundStatus(env)).toMatchObject({refreshMode:'on_open',effectiveRefreshMode:'on_open',intervalHours:6,enabled:false});
  state.meta.set('background:policy',JSON.stringify({enabled:true,intervalHours:2}));
  expect(await backgroundStatus(env)).toMatchObject({refreshMode:'scheduled',enabled:true,intervalHours:2});
  state.meta.set('background:policy','{broken');expect((await backgroundStatus(env)).refreshMode).toBe('on_open');
 });
 it.each(['manual','on_open'] as const)('never fetches or analyzes on a tick in %s mode',async refreshMode=>{
  await saveBackgroundPolicy(env,{refreshMode,aiEnabled:true},'owner');
  expect(await runBackground(env)).toEqual({ran:false,reason:'disabled'});
  expect(state.sync).not.toHaveBeenCalled();expect(state.analyze).not.toHaveBeenCalled();
 });
 it('keeps a saved scheduled choice but falls back to on-open without a verified scheduler',async()=>{
  const noCron={...env,BACKGROUND_SCHEDULE_CONFIGURED:undefined};
  expect(await saveBackgroundPolicy(noCron,{refreshMode:'scheduled'},'owner')).toMatchObject({refreshMode:'scheduled',effectiveRefreshMode:'on_open',schedulerConfigured:false});
  expect(await runBackground(noCron)).toEqual({ran:false,reason:'scheduler-unavailable'});expect(state.sync).not.toHaveBeenCalled();
  expect((await backgroundStatus(env)).effectiveRefreshMode).toBe('scheduled');
 });
 it.each([1,2,4,6,12,24,168])('runs at exactly %i hours, skips earlier ticks, and keeps per-tick limits',async intervalHours=>{
  const now=Date.parse('2026-11-15T12:00:00Z');await saveBackgroundPolicy(env,{refreshMode:'scheduled',intervalHours});
  state.meta.set('background:last-run',new Date(now-intervalHours*3600000+1).toISOString());
  expect(await runBackground(env,now)).toEqual({ran:false,reason:'not-due'});expect(state.sync).not.toHaveBeenCalled();
  expect(await runBackground(env,now+1)).toMatchObject({ran:true});expect(state.sync).toHaveBeenCalledWith(env,{limit:1,intervalHours});
  expect(await runBackground(env,now+900000)).toEqual({ran:false,reason:'not-due'});expect(state.sync).toHaveBeenCalledTimes(1);
 });
 it('counts a newer foreground refresh towards the interval',async()=>{
  const now=Date.now();await saveBackgroundPolicy(env,{refreshMode:'scheduled',intervalHours:1});
  state.meta.set('background:last-run',new Date(now-86400000).toISOString());state.meta.set('last-sync',new Date(now-60000).toISOString());
  expect(await runBackground(env,now)).toEqual({ran:false,reason:'not-due'});expect(state.sync).not.toHaveBeenCalled();
 });
 it('continues pending work next tick instead of delaying unfinished sources a whole interval',async()=>{
  const now=Date.now();await saveBackgroundPolicy(env,{refreshMode:'scheduled',intervalHours:24});state.sync.mockResolvedValueOnce({pending:2,processed:1});
  await runBackground(env,now);expect(state.meta.get('background:last-run')).toBeUndefined();await runBackground(env,now+900000);expect(state.sync).toHaveBeenCalledTimes(2);
 });
 it('lets explicit mode override legacy enabled and supports legacy clients',async()=>{
  expect(await saveBackgroundPolicy(env,{enabled:true,refreshMode:'manual'})).toMatchObject({refreshMode:'manual',enabled:false});
  expect(await saveBackgroundPolicy(env,{enabled:true})).toMatchObject({refreshMode:'scheduled',enabled:true});
  expect(await saveBackgroundPolicy(env,{enabled:false})).toMatchObject({refreshMode:'on_open',enabled:false});
 });
 it.each([0,169,1.5,'invalid'])('rejects invalid interval %s without changing the saved policy',async intervalHours=>{
  await saveBackgroundPolicy(env,{refreshMode:'manual'});const saved=state.meta.get('background:policy');
  await expect(saveBackgroundPolicy(env,{intervalHours})).rejects.toThrow();expect(state.meta.get('background:policy')).toBe(saved);
 });
 it('rejects invalid modes',async()=>{await expect(saveBackgroundPolicy(env,{refreshMode:'sometimes'})).rejects.toThrow();});
});
