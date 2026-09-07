-- Requests now carry their first message: startConversation creates the pending
-- conversation and its message in one transaction, so a request can no longer exist
-- without a message. This removes the ones the old create-empty flow left behind: a
-- PENDING conversation with zero messages was a request that never said anything and
-- showed up in an inbox as "No messages yet".
--
-- Active conversations are untouched (a freshly accepted chat with no messages yet
-- is legitimate). The delete runs as the owner (msg_conversations is not FORCE), so
-- RLS does not filter it; msg_participant_state cascades on the FK.
DELETE FROM msg_conversations c
 WHERE c.status = 'pending'
   AND NOT EXISTS (SELECT 1 FROM msg_messages m WHERE m.conversation_id = c.id);
