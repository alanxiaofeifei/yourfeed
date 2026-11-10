import type {Language} from './profile';
import type {Topic} from './types';

export type ProfileAdviceBasis='goals'|'interest_weights'|'source_topics'|'feedback_topics';
export interface ProfileAdvice {
  description:string;
  descriptionBasis:ProfileAdviceBasis[];
  recommendations:{title:string;detail:string;topics:Topic[];basis:ProfileAdviceBasis[]}[];
  nextSteps:string[];
}
export interface ProfileAdviceResult {
  needsConfiguration:false;
  advice:ProfileAdvice;
  language:Language;
  generatedAt:string;
  model:string;
  evidence:{sourceCount:number;feedbackCount:number;feedbackSampleLimit:number};
}
export type ProfileAdviceResponse=ProfileAdviceResult|{needsConfiguration:true};
