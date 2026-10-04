CREATE TABLE `connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`app_id` text NOT NULL,
	`config_cipher` text NOT NULL,
	`tokens_cipher` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`revision` text NOT NULL,
	`verifier_cipher` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_claims` (
	`claim` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL
);
