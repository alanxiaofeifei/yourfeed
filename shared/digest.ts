import {z} from 'zod';
import type {Language} from './language';
import type {ContentItem} from './types';
// .js is a code extension, not a domain suffix; keep dotted tech names usable.
const plain=z.string().trim().min(1).max(1200).refine(text=>!/(?:(?:https?|ftp|mailto|javascript|data):|[a-z][a-z0-9+.-]*:\/\/|\/\/[\w.-]+|\bwww\.|\b(?:[a-z0-9-]+\.)+(?!js\b)[a-z]{2,}(?:\b|\/))/i.test(text),'URLs are not allowed');
export const digestSchema=z.object({overview:plain,points:z.array(z.object({text:plain,itemIds:z.array(z.string().min(1)).min(1).max(3)}).strict()).min(1).max(5)}).strict();
export type DigestResult=z.infer<typeof digestSchema>;
export type DigestReason='throttled'|'empty'|'sensitive'|'free_unavailable'|'own_key'|'budget'|'invalid_output'|'network';
export interface DailyDigest {date:string;timeZone:string;window:'today'|'recent'|'empty';language:Language;fingerprint:string;channel:'free'|'own';provider:string;model:string;createdAt:string;result:DigestResult;items:ContentItem[];}
export interface DigestResponse {status:'fresh'|'stale'|'none';digest?:DailyDigest;channel:'free'|'own';nextAllowedAt:number;reason?:DigestReason;message?:string;fallback?:{label:string;items:{item:ContentItem;text:string}[]};}
/** Chinese source strings are translated by the shared interface dictionaries. */
export const digestReasonText:Record<DigestReason,string>={
 throttled:'请稍等 60 秒再生成，已有速览仍可阅读。',empty:'今天还没有可总结的内容。',sensitive:'条目包含敏感信息，未发送给 AI。',free_unavailable:'免费公共通道暂不可用：可能限流、超时或今日额度已用完。',own_key:'你的 AI 连接暂不可用，请检查 AI 设置。',budget:'已达到每日次数或月预算上限，原始内容仍可阅读。',invalid_output:'AI 返回的速览未通过验证，请稍后重试。',network:'未能加载速览，请检查网络后重试。',
};
