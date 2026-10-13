ALTER TABLE `api_keys` MODIFY COLUMN `scope` enum('read','admin','theme') NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `theme_developer` boolean DEFAULT false NOT NULL;