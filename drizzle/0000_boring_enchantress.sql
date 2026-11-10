CREATE TABLE `analysis_cache` (
	`content_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`content_id`, `fingerprint`, `provider`, `model`)
);
--> statement-breakpoint
CREATE TABLE `content` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_source_idx` ON `content` (`source_id`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`month` text NOT NULL,
	`content_id` text NOT NULL,
	`reserved_cost` real NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`is_test` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_month_idx` ON `reservations` (`month`);--> statement-breakpoint
CREATE INDEX `reservation_day_idx` ON `reservations` (`day`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
