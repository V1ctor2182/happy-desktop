-- An archived channel has no members. Archiving used to deactivate memberships
-- only when the caller asked for it, so existing archives still hold active
-- members and therefore still stand in those people's sidebars.
--
-- Every active membership in an archived channel, or in a descendant of one,
-- becomes a voluntary departure: the row and its role survive and
-- `removed_by_user_id` stays NULL, so any manager can still unarchive and
-- everyone can return with the role they had. The personal sidebar position is
-- dropped with the membership, exactly as leaving does.
CREATE TEMP TABLE `_0051_archived_chat` (`chat_id` TEXT PRIMARY KEY NOT NULL);
--> statement-breakpoint
WITH RECURSIVE `archived_tree` (`id`) AS (
  SELECT `id` FROM `chats` WHERE `archived_at` IS NOT NULL AND `deleted_at` IS NULL
  UNION
  SELECT `child`.`id`
  FROM `chats` AS `child`
  INNER JOIN `archived_tree` ON `child`.`parent_chat_id` = `archived_tree`.`id`
  WHERE `child`.`deleted_at` IS NULL
)
INSERT INTO `_0051_archived_chat` (`chat_id`) SELECT `id` FROM `archived_tree`;
--> statement-breakpoint
UPDATE `user_chat_preferences`
SET `order_key` = NULL, `updated_at` = CURRENT_TIMESTAMP
WHERE `order_key` IS NOT NULL
  AND `chat_id` IN (SELECT `chat_id` FROM `_0051_archived_chat`)
  AND EXISTS (
    SELECT 1
    FROM `chat_members`
    WHERE `chat_members`.`chat_id` = `user_chat_preferences`.`chat_id`
      AND `chat_members`.`user_id` = `user_chat_preferences`.`user_id`
      AND `chat_members`.`left_at` IS NULL
  );
--> statement-breakpoint
UPDATE `chat_members`
SET `left_at` = CURRENT_TIMESTAMP, `updated_at` = CURRENT_TIMESTAMP
WHERE `left_at` IS NULL
  AND `chat_id` IN (SELECT `chat_id` FROM `_0051_archived_chat`);
--> statement-breakpoint
DROP TABLE `_0051_archived_chat`;
