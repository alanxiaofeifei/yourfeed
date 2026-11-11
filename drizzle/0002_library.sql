/* Additive metadata; existing content IDs and feedback references stay intact. */
CREATE TABLE `content_sources` (
  `content_id` text NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  `source_id` text NOT NULL,
  `name` text NOT NULL,
  `url` text NOT NULL,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  PRIMARY KEY (`content_id`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `content_aliases` (
  `alias` text PRIMARY KEY NOT NULL,
  `content_id` text NOT NULL REFERENCES content(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `content_updated_id_idx` ON content(updated_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX `feedback_item_idx` ON feedback(item_id);
--> statement-breakpoint
CREATE VIRTUAL TABLE `content_search` USING fts5(content_id UNINDEXED, text, tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `content_search_delete` AFTER DELETE ON content BEGIN DELETE FROM content_search WHERE rowid=old.rowid; END;
