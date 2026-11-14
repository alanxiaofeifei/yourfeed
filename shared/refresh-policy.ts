/** Each standalone/hosted instance has one owner and its own meta store. */
export type RefreshMode = 'manual' | 'on_open' | 'scheduled';
export interface RefreshPolicy {refreshMode:RefreshMode;enabled:boolean;aiEnabled:boolean;intervalHours:number;}
export interface RefreshStatus extends RefreshPolicy {effectiveRefreshMode:RefreshMode;schedulerConfigured:boolean;}
export function isRefreshMode(value:unknown):value is RefreshMode {return value==='manual'||value==='on_open'||value==='scheduled';}
export function normalizeRefreshPolicy(input:Partial<RefreshPolicy>):RefreshPolicy {
 const refreshMode=isRefreshMode(input.refreshMode)?input.refreshMode:input.enabled===true?'scheduled':'on_open';
 const hours=Number(input.intervalHours);
 return {refreshMode,enabled:refreshMode==='scheduled',aiEnabled:input.aiEnabled===true,intervalHours:Number.isInteger(hours)&&hours>=1&&hours<=168?hours:6};
}
export function effectiveRefreshMode(mode:RefreshMode,schedulerConfigured:boolean):RefreshMode {return mode==='scheduled'&&!schedulerConfigured?'on_open':mode;}
export function refreshDue(lastRefresh:string|null|undefined,intervalHours:number,now=Date.now()):boolean {
 const last=Date.parse(lastRefresh||'');return !Number.isFinite(last)||now-last>=intervalHours*3600000;
}
