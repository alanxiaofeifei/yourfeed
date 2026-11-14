import {isStepId, type OnboardingResponse} from '../../../shared/onboarding';
/** A bad/partial response must not turn into a new-account welcome or crash Home. */
export function parseTourResponse(input:unknown):OnboardingResponse {
 if(!input||typeof input!=='object')throw new Error('TOUR_RESPONSE_INVALID');
 const value=input as OnboardingResponse;const state=value.state;const evidence=value.evidence;
 if(!state||state.schemaVersion!==1||state.tourVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!['not_started','in_progress','dismissed','completed'].includes(state.status)||!isStepId(state.currentStep)||!Array.isArray(state.viewedSteps)||!state.viewedSteps.every(isStepId)||!Array.isArray(state.skippedSteps)||!state.skippedSteps.every(isStepId)||typeof value.autoOffer!=='boolean'||!['new','saved','invalid'].includes(value.storage)||!evidence)throw new Error('TOUR_RESPONSE_INVALID');
 for(const key of ['hasSavedProfile','profileReady','hasRssSource','hasRssContent','rssReady','aiConfigured','aiEnabled','aiTested','youtubeConfigured','hasYoutubeSource','hasYoutubeContent','youtubeReady'] as const){if(typeof evidence[key]!=='boolean')throw new Error('TOUR_RESPONSE_INVALID');}
 return value;
}
