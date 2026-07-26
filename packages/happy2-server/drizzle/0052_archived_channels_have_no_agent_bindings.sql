-- A live Rig binding is the capability behind an agent's workspace and port
-- shares. Remove bindings left behind by archives created before archive
-- cleanup covered child channels and bindings.
WITH RECURSIVE `archived_tree` (`id`) AS (
  SELECT `id` FROM `chats` WHERE `archived_at` IS NOT NULL AND `deleted_at` IS NULL
  UNION
  SELECT `child`.`id`
  FROM `chats` AS `child`
  INNER JOIN `archived_tree` ON `child`.`parent_chat_id` = `archived_tree`.`id`
  WHERE `child`.`deleted_at` IS NULL
)
UPDATE `port_shares`
SET `disabled_at` = CURRENT_TIMESTAMP
WHERE `disabled_at` IS NULL
  AND `chat_id` IN (SELECT `id` FROM `archived_tree`);
--> statement-breakpoint

WITH RECURSIVE `archived_tree` (`id`) AS (
  SELECT `id` FROM `chats` WHERE `archived_at` IS NOT NULL AND `deleted_at` IS NULL
  UNION
  SELECT `child`.`id`
  FROM `chats` AS `child`
  INNER JOIN `archived_tree` ON `child`.`parent_chat_id` = `archived_tree`.`id`
  WHERE `child`.`deleted_at` IS NULL
)
DELETE FROM `agent_rig_bindings`
WHERE `chat_id` IN (SELECT `id` FROM `archived_tree`);