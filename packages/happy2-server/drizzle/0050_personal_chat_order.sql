-- A personal sidebar order is a fractional index per (user, chat), the same
-- opaque lexicographic key the local Rig workspace already sorts by. The old
-- integer `sort_order` only ordered starred chats and cannot express an
-- insertion between two rows without renumbering the whole list.
DROP INDEX `user_chat_preferences_order_idx`;
--> statement-breakpoint
ALTER TABLE `user_chat_preferences` DROP COLUMN `sort_order`;
--> statement-breakpoint
ALTER TABLE `user_chat_preferences` ADD COLUMN `order_key` TEXT;
--> statement-breakpoint
CREATE INDEX `user_chat_preferences_order_idx`
ON `user_chat_preferences` (`user_id`, `order_key`, `chat_id`);
