-- A typing indicator for active conversations. `typing_until` is a short-lived
-- "typing until" stamp the composer refreshes every couple of seconds while the
-- actor types, and clears on send or blur; the other side's thread shows "typing"
-- while it is in the future. It is written on the actor's OWN participant-state row
-- (the own-row insert/update policies from 0000 already cover it) and read by the
-- other participant (both may read the state rows), so no new policy or definer.
ALTER TABLE "msg_participant_state" ADD COLUMN "typing_until" timestamptz;
