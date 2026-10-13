CREATE TABLE `analytics_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`session_id` bigint unsigned NOT NULL,
	`type` enum('pageview','event') NOT NULL,
	`name` varchar(64),
	`view_id` varchar(24),
	`path` varchar(700) NOT NULL,
	`title` varchar(255),
	`lang` varchar(16),
	`node_id` int,
	`status` smallint unsigned,
	`previous_path` varchar(700),
	`engaged_ms` int,
	`scroll_depth` smallint unsigned,
	`ttfb` int,
	`fcp` int,
	`lcp` int,
	`cls` int,
	`inp` int,
	`props` json,
	`created_at` datetime NOT NULL,
	CONSTRAINT `analytics_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analytics_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`visitor_hash` varchar(32) NOT NULL,
	`started_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`entry_path` varchar(700) NOT NULL,
	`exit_path` varchar(700) NOT NULL,
	`pageviews` int NOT NULL DEFAULT 0,
	`events` int NOT NULL DEFAULT 0,
	`engaged_seconds` int NOT NULL DEFAULT 0,
	`channel` varchar(16) NOT NULL,
	`referrer_host` varchar(255),
	`referrer_url` varchar(1000),
	`utm_source` varchar(255),
	`utm_medium` varchar(255),
	`utm_campaign` varchar(255),
	`utm_term` varchar(255),
	`utm_content` varchar(255),
	`country` varchar(2),
	`lang` varchar(16),
	`browser_lang` varchar(16),
	`timezone` varchar(64),
	`browser` varchar(32),
	`browser_version` varchar(16),
	`os` varchar(32),
	`os_version` varchar(16),
	`device` enum('desktop','mobile','tablet'),
	`screen_width` smallint unsigned,
	`screen_height` smallint unsigned,
	`pixel_ratio` float,
	`color_scheme` enum('light','dark'),
	`connection` varchar(16),
	CONSTRAINT `analytics_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `analytics_events` ADD CONSTRAINT `analytics_events_session_id_analytics_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `analytics_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `analytics_events_session_idx` ON `analytics_events` (`session_id`);--> statement-breakpoint
CREATE INDEX `analytics_events_view_idx` ON `analytics_events` (`view_id`);--> statement-breakpoint
CREATE INDEX `analytics_events_created_idx` ON `analytics_events` (`created_at`,`type`);--> statement-breakpoint
CREATE INDEX `analytics_sessions_visitor_idx` ON `analytics_sessions` (`visitor_hash`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `analytics_sessions_started_idx` ON `analytics_sessions` (`started_at`);