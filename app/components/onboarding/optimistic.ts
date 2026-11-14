import {ONBOARDING_STEPS, type OnboardingAction, type OnboardingResponse, type StepId} from '../../../shared/onboarding';

export type TourIntent = {action:OnboardingAction;step?:StepId};
/** Mirrors position/history semantics only. Evidence always comes from the server. */
export function projectTour(value:OnboardingResponse,{action,step}:TourIntent):OnboardingResponse {
 const old=value.state;
 const state={...old,viewedSteps:[...old.viewedSteps],skippedSteps:[...old.skippedSteps]};
 const index=ONBOARDING_STEPS.indexOf(old.currentStep);
 switch(action){
  case 'start':case 'resume':state.status='in_progress';state.currentStep=step??old.currentStep;break;
  case 'restart':state.status='in_progress';state.currentStep='welcome.language';break;
  case 'dismiss':state.status='dismissed';break;
  case 'finish':state.status='completed';break;
  case 'back':state.currentStep=ONBOARDING_STEPS[Math.max(0,index-1)];break;
  default:
   if(action==='skip'&&!state.skippedSteps.includes(old.currentStep))state.skippedSteps.push(old.currentStep);
   state.currentStep=ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length-1,index+1)];
 }
 if(!state.viewedSteps.includes(old.currentStep))state.viewedSteps.push(old.currentStep);
 if(state.status==='in_progress'&&!state.viewedSteps.includes(state.currentStep))state.viewedSteps.push(state.currentStep);
 // Do not fabricate server revisions, timestamps, eligibility or product evidence.
 return {...value,state};
}
export type TourQueueEvent='read'|'optimistic'|'confirmed'|'failure'|'read-error';
type Transport={read:()=>Promise<OnboardingResponse>;write:(intent:TourIntent,revision:number)=>Promise<OnboardingResponse>};
export class TourConflict extends Error {}
/** One CAS in flight; every click is preserved, including skipped/viewed history.
 * Reads overlapping writes are discarded and reissued after the queue drains.
 * An instance belongs to exactly one identity epoch; dispose silences stale work.
 */
export class TourQueue {
 private confirmed:OnboardingResponse|null=null;
 private pending:TourIntent[]=[];
 private writing=false;
 private reading=0;
 private generation=0;
 private disposed=false;
 private reread=false;
 private recovering=false;
 private error=false;
 constructor(private transport:Transport,private changed:(data:OnboardingResponse|null,error:boolean,event:TourQueueEvent)=>void){}
 private publish(event:TourQueueEvent){
  const value=this.pending.reduce((data,intent)=>data?projectTour(data,intent):null,this.confirmed);
  if(!this.disposed)this.changed(value,this.error,event);
 }
 enqueue(intent:TourIntent){
  if(this.disposed||!this.confirmed||this.recovering)return false;
  this.generation++;this.error=false;this.pending.push(intent);this.publish('optimistic');void this.drain();return true;
 }
 async refresh():Promise<OnboardingResponse|undefined>{
  if(this.disposed)return;
  if(this.writing||this.pending.length||this.recovering){this.reread=true;return;}
  const serial=++this.reading,generation=this.generation;
  try{
   const value=await this.transport.read();
   if(this.disposed||serial!==this.reading)return;
   if(generation!==this.generation||this.writing||this.pending.length){
    if(this.writing||this.pending.length)this.reread=true;else void this.refresh();
    return;
   }
   if(value.state.revision<(this.confirmed?.state.revision??0))return;
   this.confirmed=value;this.error=false;this.publish('read');return value;
  }catch{if(!this.disposed&&serial===this.reading&&generation===this.generation){this.error=true;this.publish('read-error');}}
 }
 private async drain(){
  if(this.writing||this.disposed||this.recovering)return;
  this.writing=true;
  try{
   while(this.pending.length&&!this.disposed){
    const intent=this.pending[0],current=this.confirmed!;
    const value=await this.transport.write(intent,current.state.revision);
    if(this.disposed)return;
    this.confirmed=value;this.pending.shift();
    // PATCH returns a fresh GET. A later tab may already have dismissed the tour.
    // Never replay dependent navigation over that authoritative newer revision.
    if(value.state.revision!==current.state.revision+1){this.pending=[];this.error=true;this.publish('failure');break;}
    this.publish('confirmed');
   }
  }catch(error){
   if(this.disposed)return;
   this.pending=[];this.generation++;this.reading++;this.reread=false;this.error=true;
   if(error instanceof TourConflict){
    this.recovering=true;this.publish('failure');
    try{const value=await this.transport.read();if(!this.disposed)this.confirmed=value;}catch{/* Keep last confirmed, never replay a conflicting action. */}
    this.recovering=false;
   }
   this.publish('failure');
  }finally{
   this.writing=false;
   if(this.reread&&!this.disposed){this.reread=false;void this.refresh();}
  }
 }
 dispose(){this.disposed=true;this.pending=[];this.reading++;this.generation++;}
}

/** Short lead-in; retain the exact original text in translated disclosure help. */
export function tourSummary(body:string):string {
 let count=0;
 for(const match of body.matchAll(/[。！？]+|[.!?]+(?=\s|$)/gu)){
  if(++count===2)return body.slice(0,match.index+match[0].length).trim();
 }
 return body;
}
