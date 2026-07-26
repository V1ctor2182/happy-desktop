-- Rig cursors now include the durable stream identity and an encoded position.
-- An old numeric cursor cannot address the new stream, so reset this internal
-- checkpoint while changing both cursor columns to their opaque text contract.
DROP TABLE `rig_event_sync_state`;
--> statement-breakpoint
CREATE TABLE `rig_event_sync_state` (
  `id` INTEGER PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `cursor` TEXT,
  `trimmed_through` TEXT,
  `events_since_trim` INTEGER NOT NULL DEFAULT 0,
  `last_trimmed_at` TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `rig_event_sync_state` (`id`) VALUES (1);