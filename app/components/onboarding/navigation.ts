import type { StepId } from '../../../shared/onboarding';
export type TourTarget = { view: 'feed' | 'settings' | 'sources'; settingsTab?: 'profile' | 'ai'; sourceEntry?: 'curated' | 'manual'; anchor: string };
/** Declarative destinations only: never simulate clicks or read input values. */
export function targetForStep(step: StepId): TourTarget {
 if(step==='welcome.language')return {view:'feed',anchor:'language'};
 if(step.startsWith('profile.'))return {view:'settings',settingsTab:'profile',anchor:step==='profile.save'?'profile-save':'profile-interests'};
 if(step==='sources.curated')return {view:'sources',sourceEntry:'curated',anchor:'curated-list'};
 if(step==='sources.entry')return {view:'sources',anchor:'source-discover'};
 if(step==='youtube.channel')return {view:'sources',sourceEntry:'manual',anchor:'source-add'};
 if(step.startsWith('ai.'))return {view:'settings',settingsTab:'ai',anchor:({'ai.purpose':'ai-provider','ai.provider':'ai-provider','ai.credentials':'ai-key','ai.test':'ai-test','ai.save':'ai-save'} as Record<string,string>)[step]};
 if(step.startsWith('youtube.'))return {view:'settings',settingsTab:'ai',anchor:'youtube-key'};
 return {view:'feed',anchor:({'feed.update':'feed-update','feed.read':'feed-item','feed.search':'feed-search','feed.shuffle':'feed-shuffle'} as Record<string,string>)[step]||'tour-launcher'};
}
export type TourBusinessEvent = 'profile-saved' | 'settings-saved' | 'provider-tested' | 'sources-changed' | 'sources-synced';
