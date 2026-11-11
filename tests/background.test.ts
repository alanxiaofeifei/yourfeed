import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({meta:new Map<string,string>(),cleanup:vi.fn(),sync:vi.fn(),analyze:vi.fn(),admit:vi.fn()}));
vi.mock('../server/db',()=>({getState:async(_e:unknown,key:string)=>state.meta.get(key)||null,setState:async(_e:unknown,key:string,value:string)=>{state.meta.set(key,value);},getConfig:async()=>({enabled:true,provider:'openai',dailyLimit:20,monthlyBudget:20}),getProviderKey:async()=> 'mock-only-key',getUsage:async()=>({analyzedToday:0,cost:0,reserved:0})}));
vi.mock('../server/retention',()=>({cleanupRetention:state.cleanup}));
vi.mock('../server/ingest',()=>({syncSources:state.sync}));
vi.mock('../server/ai',()=>({analyzePending:state.analyze}));
vi.mock('../server/hosted',()=>({assertHostedAdmission:state.admit}));
import {runBackground,saveBackgroundPolicy} from '../server/background';
const env:any={DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})}};
beforeEach(()=>{state.meta.clear();vi.clearAllMocks();state.cleanup.mockResolvedValue({cleared:0});state.sync.mockResolvedValue({pending:0,processed:1});state.analyze.mockResolvedValue({analyzed:1});state.admit.mockResolvedValue(undefined);});
describe('independent opt-in tasks',()=>{
 it('runs cache maintenance without fetching sources or calling AI when fetching is off',async()=>{expect(await runBackground(env)).toMatchObject({ran:false,reason:'disabled'});expect(state.cleanup).toHaveBeenCalledOnce();expect(state.sync).not.toHaveBeenCalled();expect(state.analyze).not.toHaveBeenCalled();});
 it('never runs AI without a proven saved owner and passes feedback identity when explicitly configured',async()=>{await saveBackgroundPolicy(env,{enabled:true,aiEnabled:false},'original-site-owner');await runBackground(env);expect(state.analyze).not.toHaveBeenCalled();state.meta.delete('background:last-run');await saveBackgroundPolicy(env,{aiEnabled:true},'original-site-owner');await runBackground(env);expect(state.analyze).toHaveBeenCalledWith(env,1,'original-site-owner');});
 it('fails closed before cache changes or network work after hosted revocation',async()=>{state.admit.mockRejectedValue(Error('revoked'));await expect(runBackground({...env,HOSTING_MODE:'hosted'})).rejects.toThrow('revoked');expect(state.cleanup).not.toHaveBeenCalled();expect(state.sync).not.toHaveBeenCalled();});
});
