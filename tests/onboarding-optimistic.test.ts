import {describe,it,expect} from 'vitest';
import {ONBOARDING_STEPS,type OnboardingResponse} from '../shared/onboarding';
import {projectTour,TourQueue,TourConflict,tourSummary,type TourIntent,type TourQueueEvent} from '../app/components/onboarding/optimistic';

const fresh=():OnboardingResponse=>({state:{schemaVersion:1,tourVersion:1,revision:0,status:'not_started',currentStep:'welcome.language',viewedSteps:[],skippedSteps:[],updatedAt:'2026-11-12T00:00:00Z'},storage:'new',autoOffer:false,evidence:{hasSavedProfile:false,profileReady:false,hasRssSource:false,hasRssContent:false,rssReady:false,aiConfigured:false,aiEnabled:false,aiTested:false,aiVerification:'not_recorded',youtubeConfigured:false,hasYoutubeSource:false,hasYoutubeContent:false,youtubeReady:false,sources:[]}});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(initial=fresh()){
 let data:OnboardingResponse|null=null,error=false,event:TourQueueEvent='read';
 const writes:{intent:TourIntent;revision:number;reply:ReturnType<typeof deferred<OnboardingResponse>>}[]=[];
 const reads:ReturnType<typeof deferred<OnboardingResponse>>[]=[];
 const queue=new TourQueue({read:()=>{const read=deferred<OnboardingResponse>();reads.push(read);return read.promise;},write:(intent,revision)=>{const reply=deferred<OnboardingResponse>();writes.push({intent,revision,reply});return reply.promise;}},(value,failed,kind)=>{data=value;error=failed;event=kind;});
 const initialize=async()=>{const read=queue.refresh();reads[0].resolve(initial);await read;};
 return {queue,writes,reads,initialize,get data(){return data!;},get error(){return error;},get event(){return event;}};
}
function ack(value:OnboardingResponse,intent:TourIntent):OnboardingResponse {const next=projectTour(value,intent);return {...next,storage:'saved',state:{...next.state,revision:value.state.revision+1,updatedAt:'2026-11-14T01:00:00Z'}};}

describe('optimistic tour projection',()=>{
 it('keeps all nineteen viewed/skipped steps, restart history and confirmed evidence distinct',()=>{
  const initial=fresh();let value=projectTour(initial,{action:'start'});
  for(let i=0;i<18;i++)value=projectTour(value,{action:'skip'});
  expect(value.state.currentStep).toBe('finish');expect(value.state.viewedSteps).toEqual(ONBOARDING_STEPS);
  expect(value.state.skippedSteps).toEqual(ONBOARDING_STEPS.slice(0,-1));
  value=projectTour(value,{action:'finish'});expect(value.state.status).toBe('completed');
  value=projectTour(value,{action:'restart'});expect(value.state.status).toBe('in_progress');expect(value.state.currentStep).toBe('welcome.language');
  expect(value.state.viewedSteps).toEqual(ONBOARDING_STEPS);expect(value.evidence).toBe(initial.evidence);expect(value.state.revision).toBe(0);
 });
 it('projects back, dismissal and chapter resume without clearing history',()=>{
  let value=projectTour(fresh(),{action:'resume',step:'ai.test'});
  value=projectTour(value,{action:'back'});expect(value.state.currentStep).toBe('ai.credentials');
  value=projectTour(value,{action:'dismiss'});expect(value.state.status).toBe('dismissed');
  value=projectTour(value,{action:'resume'});expect(value.state.currentStep).toBe('ai.credentials');expect(value.state.status).toBe('in_progress');expect(value.state.viewedSteps).toContain('ai.test');
 });
 it('shows at most two sentences in Latin and CJK without changing the original',()=>{
  expect(tourSummary('First sentence. Second sentence! Third sentence.')).toBe('First sentence. Second sentence!');
  expect(tourSummary('第一句。第二句！第三句。')).toBe('第一句。第二句！');
  expect(tourSummary('One short instruction')).toBe('One short instruction');
  expect(tourSummary('Use v3.5 with your key. Test it. Then save.')).toBe('Use v3.5 with your key. Test it.');
 });
});

describe('serialized CAS queue',()=>{
 it('immediately accepts rapid actions, serializes every write and rebases evidence without rewinding optimistic position',async()=>{
  const h=harness();await h.initialize();
  const intents:TourIntent[]=[{action:'start'},{action:'next'},{action:'skip'},{action:'back'},{action:'next'},{action:'dismiss'},{action:'resume'},{action:'restart'},{action:'resume',step:'finish'},{action:'finish'}];
  for(const intent of intents)expect(h.queue.enqueue(intent)).toBe(true);
  expect(h.writes).toHaveLength(1);expect(h.data.state.currentStep).toBe('finish');expect(h.data.state.status).toBe('completed');
  let server=fresh();
  for(let i=0;i<intents.length;i++){
   expect(h.writes[i].intent).toEqual(intents[i]);expect(h.writes[i].revision).toBe(i);
   server=ack(server,intents[i]);server.evidence={...server.evidence,aiConfigured:true};h.writes[i].reply.resolve(server);await tick();
   expect(h.data.state.currentStep).toBe('finish');expect(h.data.state.status).toBe('completed');expect(h.data.evidence.aiConfigured).toBe(true);
  }
  expect(h.writes).toHaveLength(intents.length);expect(h.data.state.revision).toBe(intents.length);
  expect(h.data.state.skippedSteps).toEqual(['profile.interests']);expect(h.data.state.viewedSteps).toEqual(['welcome.language','profile.interests','profile.save','finish']);
 });
 it('rolls back a failed dismiss to last confirmed and clears dependent navigation',async()=>{
  const initial=ack(fresh(),{action:'start'}),h=harness(initial);await h.initialize();
  h.queue.enqueue({action:'dismiss'});expect(h.data.state.status).toBe('dismissed');
  h.queue.enqueue({action:'resume'});h.queue.enqueue({action:'next'});
  h.writes[0].reply.reject(Error('offline'));await tick();
  expect(h.data).toEqual(initial);expect(h.error).toBe(true);expect(h.event).toBe('failure');expect(h.writes).toHaveLength(1);
  h.queue.enqueue({action:'skip'});expect(h.writes[1].revision).toBe(initial.state.revision);
 });
 it('rereads a conflict, discards all dependents and never overwrites another tab dismissal',async()=>{
  const initial=ack(fresh(),{action:'start'}),h=harness(initial);await h.initialize();
  h.queue.enqueue({action:'next'});h.queue.enqueue({action:'skip'});h.writes[0].reply.reject(new TourConflict());await tick();
  expect(h.reads).toHaveLength(2);const dismissed=ack(ack(initial,{action:'next'}),{action:'dismiss'});
  h.reads[1].resolve(dismissed);await tick();
  expect(h.data).toEqual(dismissed);expect(h.data.state.status).toBe('dismissed');expect(h.error).toBe(true);expect(h.writes).toHaveLength(1);
 });
 it('treats a PATCH fresh GET reflecting another tab as authoritative, not a rebase target',async()=>{
  const initial=ack(fresh(),{action:'start'}),h=harness(initial);await h.initialize();h.queue.enqueue({action:'next'});h.queue.enqueue({action:'skip'});
  const dismissed=ack(ack(initial,{action:'next'}),{action:'dismiss'});h.writes[0].reply.resolve(dismissed);await tick();
  expect(h.data).toEqual(dismissed);expect(h.error).toBe(true);expect(h.writes).toHaveLength(1);
 });
 it('defers pending refreshes and discards reads that started before a write',async()=>{
  const initial=ack(fresh(),{action:'start'}),h=harness(initial);await h.initialize();
  const staleRead=h.queue.refresh();h.queue.enqueue({action:'skip'});await h.queue.refresh();expect(h.reads).toHaveLength(2);
  h.reads[1].resolve(initial);await staleRead;expect(h.data.state.currentStep).toBe('profile.interests');
  const confirmed=ack(initial,{action:'skip'});h.writes[0].reply.resolve(confirmed);await tick();expect(h.reads).toHaveLength(3);
  h.reads[2].resolve({...confirmed,evidence:{...confirmed.evidence,profileReady:true}});await tick();expect(h.data.state.currentStep).toBe('profile.interests');expect(h.data.evidence.profileReady).toBe(true);
 });
 it('does not strand a late stale GET after the write has already drained',async()=>{
  const initial=ack(fresh(),{action:'start'}),h=harness(initial);await h.initialize();const stale=h.queue.refresh();h.queue.enqueue({action:'next'});
  const confirmed=ack(initial,{action:'next'});h.writes[0].reply.resolve(confirmed);await tick();h.reads[1].resolve(initial);await stale;expect(h.reads).toHaveLength(3);
  h.reads[2].resolve(confirmed);await tick();expect(h.data).toEqual(confirmed);
 });
 it('silences old-identity work on dispose including failures and conflict recovery',async()=>{
  const h=harness();await h.initialize();h.queue.enqueue({action:'start'});const before=h.data;h.queue.dispose();
  h.writes[0].reply.reject(new TourConflict());await tick();expect(h.reads).toHaveLength(1);expect(h.data).toBe(before);expect(h.error).toBe(false);expect(h.queue.enqueue({action:'next'})).toBe(false);
 });
 it('keeps the last confirmed rollback even when an authoritative conflict read fails',async()=>{
  const initial=ack(fresh(),{action:'start'}),h=harness(initial);await h.initialize();h.queue.enqueue({action:'skip'});h.writes[0].reply.reject(new TourConflict());await tick();h.reads[1].reject(Error('offline'));await tick();
  expect(h.data).toEqual(initial);expect(h.error).toBe(true);expect(h.event).toBe('failure');
 });
});
