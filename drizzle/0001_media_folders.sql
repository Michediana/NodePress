CREATE TABLE `media_folders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`parent_id` int,
	`created_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `media_folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `media` ADD `folder_id` int;--> statement-breakpoint
ALTER TABLE `media_folders` ADD CONSTRAINT `media_folders_parent_id_media_folders_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `media_folders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_folders` ADD CONSTRAINT `media_folders_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `media_folders_parent_idx` ON `media_folders` (`parent_id`);--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_folder_id_media_folders_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `media_folders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `media_folder_idx` ON `media` (`folder_id`);