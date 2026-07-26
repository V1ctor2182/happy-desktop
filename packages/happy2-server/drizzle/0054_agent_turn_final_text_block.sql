-- A cloud turn's reply is every text block the agent committed, joined with a
-- blank line. A collapsed turn shows only the block it finished on, the way a
-- local Rig turn keeps just its final message, so the offset where that block
-- starts travels with the turn summary instead of forcing the transcript to
-- fetch a turn's whole trace before it can fold it away.
ALTER TABLE `agent_turns` ADD COLUMN `trace_final_text_offset` INTEGER NOT NULL DEFAULT 0;
