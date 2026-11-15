import bank from './preference-bank.json';
import {z} from 'zod';
import {sourceCatalog} from './source-catalog';
import type {Topic} from './types';
export const CARD_TOPICS=['ai','automation','network','linux','it','code','making','cooking','science','humanities','english','tools'] as const;
import type {Language} from './language';
import type {UserProfile} from './profile';

export const DIMENSIONS=['intent','tech','depth','pace','science','relax','hands_on','humanities','language','density'] as const;
export const preferenceCatalog=sourceCatalog.filter(entry=>entry.platform==='rss'&&!entry.requiresApi&&entry.verification.status==='verified');
const ids=new Set(preferenceCatalog.map(entry=>entry.id));
const plain=(min:number,max:number)=>z.string().trim().min(min).max(max).refine(value=>!/[<>\u0000-\u001f\u007f]|https?:\/\/|www\./i.test(value));
const optionSchema=z.object({label:plain(2,40),subtitle:plain(2,80),topics:z.array(z.enum(CARD_TOPICS)).min(1).max(3),sourceIds:z.array(z.enum([...ids] as [string,...string[]])).min(1).max(2)}).strict();
export const questionSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),dimension:z.enum(DIMENSIONS),prompt:plain(4,120),optionA:optionSchema,optionB:optionSchema}).strict();
export const questionsSchema=z.object({questions:z.array(questionSchema).length(10)}).strict().refine(({questions})=>new Set(questions.map(q=>q.id)).size===10&&new Set(questions.map(q=>q.dimension)).size===10);
export type PreferenceQuestion=z.infer<typeof questionSchema>;
export type Answers=Record<string,'A'|'B'|'skipped'>;
export const preferenceStateSchema=z.object({revision:z.number().int().nonnegative(),completedAt:z.string().datetime().optional(),answers:z.record(z.string(),z.enum(['A','B','skipped'])),source:z.enum(['curated','ai']),questions:z.array(questionSchema).length(10),language:z.enum(['zh','en','zh-TW','vi']),position:z.number().int().min(0).max(10),manualTopics:z.array(z.enum(CARD_TOPICS)).max(12),manualInterest:z.string().trim().max(240).refine(v=>!/[\u0000-\u001f\u007f]/.test(v))}).strict().refine(v=>questionsSchema.safeParse({questions:v.questions}).success&&Object.keys(v.answers).every(id=>v.questions.some(q=>q.id===id)));
export type PreferenceState=z.infer<typeof preferenceStateSchema>;

/** Balanced four-language bank; plain data is also used by the synthetic browser fixture. */
export function curatedQuestions(language:Language):PreferenceQuestion[]{return structuredClone(bank[language]) as PreferenceQuestion[];}
export function newPreferenceState(language:Language):PreferenceState{return {revision:0,answers:{},source:'curated',questions:curatedQuestions(language),language,position:0,manualTopics:[],manualInterest:''};}
/** A locale switch uses the static bank, never an AI call. Keep question order,
 * stable answer IDs and the cursor, including AI IDs matched by dimension. */
export function localizePreferenceState(state:PreferenceState,language:Language):PreferenceState{
 if(state.language===language)return state;
 const bank=curatedQuestions(language);
 const questions=state.questions.map(question=>{
  const translated=bank.find(q=>q.id===question.id&&q.dimension===question.dimension)??bank.find(q=>q.dimension===question.dimension)!;
  return {...translated,id:question.id};
 });
 return {...state,language,source:'curated',questions};
}
export function preferenceSummary(state:PreferenceState){
 const sourceIds=new Set<string>();const topicWeights:Partial<Record<Topic,number>>={};
 for(const q of state.questions){const choice=state.answers[q.id];if(choice!=='A'&&choice!=='B')continue;const option=choice==='A'?q.optionA:q.optionB;option.sourceIds.forEach(id=>sourceIds.add(id));option.topics.forEach(topic=>topicWeights[topic]=Math.min(1,(topicWeights[topic]||0)+.25));}
 for(const topic of state.manualTopics)topicWeights[topic]=Math.min(1,(topicWeights[topic]||0)+.5);
 if(state.manualTopics.length)preferenceCatalog.filter(entry=>entry.topics.some(topic=>state.manualTopics.includes(topic))).slice(0,8).forEach(entry=>sourceIds.add(entry.id));
 return {sources:preferenceCatalog.filter(entry=>sourceIds.has(entry.id)),topicWeights};
}
export function preferenceProfile(state:PreferenceState,profile:UserProfile):UserProfile{const {topicWeights}=preferenceSummary(state);return {...profile,topicWeights:Object.keys(topicWeights).length?topicWeights:profile.topicWeights,goals:state.manualInterest?[state.manualInterest,...profile.goals.filter(goal=>goal!==state.manualInterest)].slice(0,8):profile.goals};}
