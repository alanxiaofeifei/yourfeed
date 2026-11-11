import type {Language} from './language';
export type Kind = 'video' | 'article' | 'news' | 'post' | 'project';
export type Mode = 'rest' | 'grow';
export type Provider = 'openai' | 'deepseek' | 'glm' | 'custom';
export type Topic = 'ai' | 'automation' | 'network' | 'linux' | 'it' | 'code' | 'making' | 'cooking' | 'science' | 'humanities' | 'english' | 'tools';
export interface Source { id: string; name: string; platform: 'youtube'|'bilibili'|'rss'|'github'|'x'|'web'; locator: string; topics: Topic[]; enabled: boolean; status?: string; lastSuccess?: string; error?: string; etag?: string; lastModified?: string; failureCount?: number; nextRetryAt?: string; pendingEntries?: number; skippedEntries?: number; lastWarning?: string; lastAttempt?: number; }
export interface Analysis { inputTruncated?: boolean; inputChars?: number; originalChars?: number; summaryLanguage?: Language; profileVersion?: number; bullets: string[]; relevance: string; topics: Topic[]; coverage: 'full_text'|'excerpt'|'metadata'; references: string[]; eventKey?: string; model: string; }
export interface ContentItem { id: string; kind: Kind; platform: string; sourceId: string; sourceName: string; title: string; url: string; summary: string; body?: string; image?: string; publishedAt: string; duration?: number; topics: Topic[]; externalId?: string; parentId?: string; analysis?: Analysis; relatedSources?: {name: string; url: string}[]; liked?: boolean; saved?: boolean; read?: boolean; dismissed?: boolean; reason?: string;
 /** Coverage is evidence about the cached source, never inferred from text length. */
 contentCoverage?: 'metadata'|'excerpt'|'full'|'unknown';
 retrievalMethod?: 'rss-content'|'rss-summary'|'platform-metadata'|'html-extraction'|'manual-link';
 truncated?: boolean; originalLength?: number; retrievedAt?: string;
 dateSource?: 'published'|'updated'|'dc-date'|'missing'|'imported';
}
export interface Feedback { liked?: boolean; saved?: boolean; read?: boolean; dismissed?: boolean; }
export interface ProviderConfig { provider: Provider; model: string; providerName?: string; baseUrl?: string; protocol?: 'responses'|'chat-completions'; temperature?: number; maxOutputTokens?: number; timeoutSeconds?: number; responseFormat?: 'json_schema'|'json_object'|'none'; reasoningEffort?: string; inputPricePerMillion?: number; outputPricePerMillion?: number; key?: string; keyLast4?: string; configured?: boolean; enabled: boolean; monthlyBudget: number; dailyLimit: number; }
export interface Usage { month: string; cost: number; inputTokens: number; outputTokens: number; analyzedToday: number; reserved?: number; }
export interface FeedResponse { items: ContentItem[]; total: number; sources: number; lastUpdated?: string; mode: Mode; }
