-- 0004 pruned only PENDING empty conversations, on the reasoning that a freshly
-- accepted chat with no messages yet was legitimate. It is not: a conversation
-- becomes active only by a message (the recipient's reply, or acceptRequest over a
-- request that already carries the requester's first message), so an ACTIVE
-- conversation with zero messages is stale data from the old create-empty flow. It
-- shows up in an inbox as "No messages yet". Prune every empty conversation,
-- whatever its status.
--
-- Runs as the owner (msg_conversations is not FORCE), so RLS does not filter it;
-- msg_participant_state cascades on the FK, and there are no messages to remove.
DELETE FROM msg_conversations c
 WHERE NOT EXISTS (SELECT 1 FROM msg_messages m WHERE m.conversation_id = c.id);
