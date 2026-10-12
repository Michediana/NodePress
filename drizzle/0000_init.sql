CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`scope` enum('read','admin') NOT NULL,
	`created_by` int,
	`last_used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_key_hash_unique` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `languages` (
	`code` varchar(16) NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `languages_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` int AUTO_INCREMENT NOT NULL,
	`file` varchar(255) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`mime` varchar(128) NOT NULL,
	`size` int NOT NULL,
	`width` int,
	`height` int,
	`variants` json NOT NULL,
	`alt` json NOT NULL,
	`uploaded_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `menu_item_translations` (
	`item_id` int NOT NULL,
	`lang` varchar(16) NOT NULL,
	`label` varchar(255) NOT NULL,
	CONSTRAINT `menu_item_translations_item_id_lang_pk` PRIMARY KEY(`item_id`,`lang`)
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`menu_id` int NOT NULL,
	`parent_id` int,
	`sort_order` int NOT NULL DEFAULT 0,
	`node_id` int,
	`url` varchar(1000),
	`new_tab` boolean NOT NULL DEFAULT false,
	CONSTRAINT `menu_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `menus` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`location` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `menus_id` PRIMARY KEY(`id`),
	CONSTRAINT `menus_location_unique` UNIQUE(`location`)
);
--> statement-breakpoint
CREATE TABLE `node_translations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`node_id` int NOT NULL,
	`lang` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`path` varchar(700) NOT NULL,
	`title` varchar(255) NOT NULL,
	`excerpt` text,
	`content` json,
	`status` enum('draft','published','scheduled') NOT NULL DEFAULT 'draft',
	`published_at` datetime,
	`seo_title` varchar(255),
	`seo_description` text,
	`focus_keyword` varchar(255),
	`og_image_id` int,
	`noindex` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `node_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `node_translations_node_lang_uq` UNIQUE(`node_id`,`lang`),
	CONSTRAINT `node_translations_lang_path_uq` UNIQUE(`lang`,`path`)
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int,
	`type` enum('page','collection','item') NOT NULL,
	`template` varchar(64) NOT NULL,
	`item_template` varchar(64),
	`per_page` int NOT NULL DEFAULT 10,
	`sort_order` int NOT NULL DEFAULT 0,
	`author_id` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `password_resets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `redirects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`from_path` varchar(700) NOT NULL,
	`to_path` varchar(1000) NOT NULL,
	`status_code` int NOT NULL DEFAULT 301,
	`automatic` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `redirects_id` PRIMARY KEY(`id`),
	CONSTRAINT `redirects_from_path_unique` UNIQUE(`from_path`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin','editor','author') NOT NULL DEFAULT 'author',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_item_translations` ADD CONSTRAINT `menu_item_translations_item_id_menu_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_item_translations` ADD CONSTRAINT `menu_item_translations_lang_languages_code_fk` FOREIGN KEY (`lang`) REFERENCES `languages`(`code`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_menu_id_menus_id_fk` FOREIGN KEY (`menu_id`) REFERENCES `menus`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_parent_id_menu_items_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `menu_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `node_translations` ADD CONSTRAINT `node_translations_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `node_translations` ADD CONSTRAINT `node_translations_lang_languages_code_fk` FOREIGN KEY (`lang`) REFERENCES `languages`(`code`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `node_translations` ADD CONSTRAINT `node_translations_og_image_id_media_id_fk` FOREIGN KEY (`og_image_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `nodes` ADD CONSTRAINT `nodes_parent_id_nodes_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `nodes` ADD CONSTRAINT `nodes_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_resets` ADD CONSTRAINT `password_resets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `menu_items_menu_idx` ON `menu_items` (`menu_id`);--> statement-breakpoint
CREATE INDEX `nodes_parent_idx` ON `nodes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);