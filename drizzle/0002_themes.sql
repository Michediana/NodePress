CREATE TABLE `theme_assets` (
	`hash` varchar(64) NOT NULL,
	`mime` varchar(128) NOT NULL,
	`content` longblob NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `theme_assets_hash` PRIMARY KEY(`hash`)
);
--> statement-breakpoint
CREATE TABLE `theme_builds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`theme_id` int NOT NULL,
	`data` json NOT NULL,
	`published_at` datetime,
	`created_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `theme_builds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `theme_files` (
	`theme_id` int NOT NULL,
	`path` varchar(255) NOT NULL,
	`content` longblob NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `theme_files_theme_id_path_pk` PRIMARY KEY(`theme_id`,`path`)
);
--> statement-breakpoint
CREATE TABLE `themes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`draft_build_id` int,
	`published_build_id` int,
	`build_error` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `themes_id` PRIMARY KEY(`id`),
	CONSTRAINT `themes_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `theme_builds` ADD CONSTRAINT `theme_builds_theme_id_themes_id_fk` FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `theme_builds` ADD CONSTRAINT `theme_builds_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `theme_files` ADD CONSTRAINT `theme_files_theme_id_themes_id_fk` FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `theme_builds_theme_idx` ON `theme_builds` (`theme_id`);