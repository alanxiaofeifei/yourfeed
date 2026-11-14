import {describe,expect,it} from 'vitest';
import {effectiveRefreshMode,normalizeRefreshPolicy,refreshDue} from '../shared/refresh-policy';
import {refreshMessages} from '../shared/refresh-messages';
describe('refresh defaults and browser due logic',()=>{
 it('uses explicit modes before the legacy enabled bit',()=>{expect(normalizeRefreshPolicy({refreshMode:'manual',enabled:true})).toMatchObject({refreshMode:'manual',enabled:false});});
 it.each([undefined,null,'invalid'])('refreshes when no valid last timestamp exists (%s)',last=>{expect(refreshDue(last,6)).toBe(true);});
 it('uses the chosen interval including its exact boundary and future timestamps',()=>{const now=Date.now();expect(refreshDue(new Date(now-3599999).toISOString(),1,now)).toBe(false);expect(refreshDue(new Date(now-3600000).toISOString(),1,now)).toBe(true);expect(refreshDue(new Date(now+3600000).toISOString(),1,now)).toBe(false);});
 it('only falls back scheduled mode when the instance lacks a scheduler',()=>{expect(effectiveRefreshMode('scheduled',false)).toBe('on_open');expect(effectiveRefreshMode('manual',false)).toBe('manual');expect(effectiveRefreshMode('scheduled',true)).toBe('scheduled');});
 it('provides every refresh message in four languages',()=>{const keys=Object.keys(refreshMessages.zh).sort();for(const messages of Object.values(refreshMessages)){expect(Object.keys(messages).sort()).toEqual(keys);for(const text of Object.values(messages))expect(text.trim().length).toBeGreaterThan(0);expect(messages.cost).toContain('AI');}});
});
