CREATE TABLE `oauth_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_id` varchar(700) NOT NULL,
	`name` varchar(255) NOT NULL,
	`client_uri` varchar(1000),
	`redirect_uris` json NOT NULL,
	`metadata_document` boolean NOT NULL DEFAULT false,
	`fetched_at` datetime,
	`last_used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_clients_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` varchar(64) NOT NULL,
	`client_id` int NOT NULL,
	`user_id` int NOT NULL,
	`scope` enum('admin','theme') NOT NULL,
	`redirect_uri` varchar(1000) NOT NULL,
	`code_challenge` varchar(128) NOT NULL,
	`resource` varchar(1000) NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_id` int NOT NULL,
	`user_id` int NOT NULL,
	`scope` enum('admin','theme') NOT NULL,
	`resource` varchar(1000) NOT NULL,
	`access_hash` varchar(64) NOT NULL,
	`access_expires_at` datetime NOT NULL,
	`refresh_hash` varchar(64) NOT NULL,
	`previous_refresh_hash` varchar(64),
	`refresh_expires_at` datetime NOT NULL,
	`last_used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_grants_access_hash_unique` UNIQUE(`access_hash`),
	CONSTRAINT `oauth_grants_refresh_hash_unique` UNIQUE(`refresh_hash`)
);
--> statement-breakpoint
ALTER TABLE `oauth_codes` ADD CONSTRAINT `oauth_codes_client_id_oauth_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_codes` ADD CONSTRAINT `oauth_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_grants` ADD CONSTRAINT `oauth_grants_client_id_oauth_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_grants` ADD CONSTRAINT `oauth_grants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `oauth_grants_user_idx` ON `oauth_grants` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_prev_idx` ON `oauth_grants` (`previous_refresh_hash`);