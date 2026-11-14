/** Tour position is not proof of product configuration or verification. */
export const ONBOARDING_STEPS = [
  'welcome.language','profile.interests','profile.save','sources.entry','sources.curated',
  'feed.update','feed.read','feed.search','feed.shuffle','ai.purpose','ai.provider',
  'ai.credentials','ai.test','ai.save','youtube.intro','youtube.cloud','youtube.save',
  'youtube.channel','finish',
] as const;
export const TOUR_STEP_IDS = ONBOARDING_STEPS;
export type StepId = typeof ONBOARDING_STEPS[number];
export const ONBOARDING_SCHEMA_VERSION = 1;
export const ONBOARDING_TOUR_VERSION = 1;
export type OnboardingStatus = 'not_started'|'in_progress'|'dismissed'|'completed';
export type OnboardingAction = 'start'|'back'|'next'|'skip'|'dismiss'|'resume'|'restart'|'finish';
export interface OnboardingMutation { action:OnboardingAction; expectedRevision:number; /** Chapter selection is allowed only with resume. */ step?:StepId; }
export interface OnboardingState {
  schemaVersion:1; tourVersion:1; revision:number; status:OnboardingStatus;
  currentStep:StepId; skippedSteps:StepId[]; viewedSteps:StepId[];
  firstOfferedAt?:string; updatedAt:string; completedAt?:string;
}
export interface OnboardingSourceEvidence {
  id:string; platform:'rss'|'youtube'; enabled:boolean;
  health:'ready'|'checked_empty'|'pending'|'error'|'blocked';
  hasContent:boolean; lastSuccess?:string;
}
export interface OnboardingEvidence {
  hasSavedProfile:boolean; profileReady:boolean;
  hasRssSource:boolean; hasRssContent:boolean; rssReady:boolean;
  aiConfigured:boolean; aiEnabled:boolean;
  /** Persisted credentials never establish that a connection test ran. */
  aiTested:boolean; aiVerification:'not_recorded'|'connection_test'; aiTestedAt?:string;
  youtubeConfigured:boolean; hasYoutubeSource:boolean; hasYoutubeContent:boolean; youtubeReady:boolean;
  sources:OnboardingSourceEvidence[];
}
export interface OnboardingResponse {
  state:OnboardingState; evidence:OnboardingEvidence; autoOffer:boolean;
  /** Invalid/unknown persisted versions always fall back to the manual entry. */
  storage:'new'|'saved'|'invalid';
}
export function isStepId(value:unknown):value is StepId {return typeof value==='string'&&(ONBOARDING_STEPS as readonly string[]).includes(value);}
