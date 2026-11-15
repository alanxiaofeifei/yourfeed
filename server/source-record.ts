import type {ContentItem} from '../shared/types';

/** Ranked cards can be passed back to ingestion (for example after AI analysis).
 * Source cache rows must never become an alternative store for a user's signals. */
export function sourceRecord(item:ContentItem):ContentItem {
  const source={...item};
  for(const key of ['liked','saved','read','dismissed','disliked','updatedAt','reason'] as const)delete source[key];
  return source;
}
