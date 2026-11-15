import {expect,it} from 'vitest';
import bank from '../shared/preference-bank.json';
import {TOUR_LOCALES} from '../shared/onboarding-messages';
import {preferenceMessages} from '../shared/preference-messages';
import {freeAiMessages} from '../shared/free-ai-messages';
import {sourceCatalog} from '../shared/source-catalog';
import {TOPIC_LABELS} from '../shared/profile';
import {CARD_TOPICS,curatedQuestions,localizePreferenceState,newPreferenceState,preferenceStateSchema} from '../shared/preference-cards';

function leaves(value:unknown,prefix=''):Record<string,string>{
 if(typeof value==='string')return {[prefix]:value};
 if(!value||typeof value!=='object')throw Error(`Invalid copy at ${prefix}`);
 return Object.fromEntries(Object.entries(value).flatMap(([key,entry])=>Object.entries(leaves(entry,`${prefix}.${key}`))));
}
const placeholders=(text:string)=>[...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(match=>match[1]).sort();
function complete(translated:Record<string,string>,english:Record<string,string>,locale:string){
 expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
 for(const [key,text] of Object.entries(english)){
  expect(translated[key]?.trim(),`${locale}${key}`).toBeTruthy();
  expect(placeholders(translated[key]),key).toEqual(placeholders(text));
  expect(translated[key],key).not.toMatch(/TODO|TBD|fallback/i);
  if(locale!=='en')expect(translated[key],`${locale}${key}`).not.toBe(text);
 }
}
const questionCopy=(questions:ReturnType<typeof curatedQuestions>)=>leaves(questions.map(({prompt,optionA,optionB})=>({prompt,optionA:{label:optionA.label,subtitle:optionA.subtitle},optionB:{label:optionB.label,subtitle:optionB.subtitle}})));
it('preference chrome, notices, topics and every question/option have complete four-locale copy without English fallback',()=>{
 expect(Object.keys(bank).sort()).toEqual([...TOUR_LOCALES].sort());
 expect(Object.keys(preferenceMessages).sort()).toEqual([...TOUR_LOCALES].sort());
 for(const locale of TOUR_LOCALES){
  complete(leaves(preferenceMessages[locale]),leaves(preferenceMessages.en),locale);
  complete(leaves({notice:freeAiMessages[locale].notice}),leaves({notice:freeAiMessages.en.notice}),locale);
  complete(questionCopy(curatedQuestions(locale)),questionCopy(curatedQuestions('en')),locale);
  for(const topic of CARD_TOPICS)expect(TOPIC_LABELS[topic][locale]?.trim(),`${topic}.${locale}`).toBeTruthy();
  curatedQuestions(locale).forEach((q,i)=>{
   const english=bank.en[i];expect([q.id,q.dimension]).toEqual([english.id,english.dimension]);
   for(const option of ['optionA','optionB'] as const)expect({topics:q[option].topics,sourceIds:q[option].sourceIds}).toEqual({topics:english[option].topics,sourceIds:english[option].sourceIds});
  });
 }
});
it('catalog UI descriptions, optional display names and verification notes explicitly cover all four locales',()=>{
 for(const locale of TOUR_LOCALES)expect(new Set(sourceCatalog.map(entry=>entry.description[locale])).size,locale).toBe(sourceCatalog.length);
 for(const entry of sourceCatalog){
  expect(entry.name.trim(),entry.id).toBeTruthy(); // Official publication names are proper nouns.
  for(const copy of [entry.description,entry.verification.note,entry.localizedName].filter(Boolean)){
   expect(Object.keys(copy!).sort(),entry.id).toEqual([...TOUR_LOCALES].sort());
   for(const locale of TOUR_LOCALES){
    expect(copy![locale]?.trim(),`${entry.id}.${locale}`).toBeTruthy();
    if(locale!=='en')expect(copy![locale],`${entry.id}.${locale}`).not.toBe(copy!.en);
   }
  }
 }
});
for(const source of ['curated','ai'] as const)for(const from of TOUR_LOCALES)for(const to of TOUR_LOCALES.filter(locale=>locale!==from))it(`${source} ${from} → ${to}: swaps copy while retaining answers, order, cursor and metadata`,()=>{
 const state={...newPreferenceState(from),source,revision:7,position:3,completedAt:'2026-11-15T00:00:00.000Z',manualInterest:'My own text',manualTopics:['science' as const]};
 if(source==='ai')state.questions=state.questions.slice().reverse().map((q,i)=>({...q,id:`ai-${i}`,prompt:'Generated question in the old language?'}));
 state.answers={[state.questions[0].id]:'B',[state.questions[1].id]:'skipped'};
 const before=structuredClone(state),next=localizePreferenceState(state,to);
 expect(state).toEqual(before);expect(preferenceStateSchema.safeParse(next).success).toBe(true);
 expect(next).toMatchObject({...before,language:to,source:'curated',questions:expect.any(Array)});
 expect(next.questions.map(q=>q.id)).toEqual(state.questions.map(q=>q.id));
 next.questions.forEach((q,i)=>expect(q).toEqual({...curatedQuestions(to).find(candidate=>candidate.dimension===state.questions[i].dimension),id:state.questions[i].id}));
 expect(localizePreferenceState(next,to)).toBe(next);
 expect(localizePreferenceState(next,from).answers).toEqual(state.answers);
});
it('AI IDs which collide with curated IDs still match by dimension; same-locale AI is retained',()=>{
 const state={...newPreferenceState('en'),source:'ai' as const};
 state.questions=state.questions.slice().reverse().map((q,i)=>({...q,id:`q${i+1}`}));state.answers={q1:'A'};state.position=1;
 expect(localizePreferenceState(state,'en')).toBe(state);
 expect(localizePreferenceState(state,'vi').questions[0]).toEqual({...curatedQuestions('vi')[9],id:'q1'});
});
