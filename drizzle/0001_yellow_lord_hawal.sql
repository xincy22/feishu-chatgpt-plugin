CREATE TABLE `refresh_leases` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`token_hash` text NOT NULL,
	`owner` text NOT NULL,
	`phase` text NOT NULL,
	`expires_at` integer NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`pending_cipher` text,
	`error_kind` text
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `authorization_nonce` text;