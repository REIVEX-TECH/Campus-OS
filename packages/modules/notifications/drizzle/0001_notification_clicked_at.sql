-- Instrument notification click-through. clicked_at stamps the first time the
-- recipient followed a notification to its target, so click-through rate (clicked
-- over delivered) can be measured for a week before deciding whether notifications
-- earn more investment (the "D: hold, instrument first" decision).
--
-- Additive and nullable: existing rows read back as never-clicked. No new policy is
-- needed -- the write is an own-row UPDATE by the recipient, which the existing
-- RESTRICTIVE own-row policy already admits (the same path markRead uses for
-- read_at). clicked_at is a self-reported UI metric on the user's own row, not an
-- authorization input, so there is no §8 surface here.

ALTER TABLE "notifications" ADD COLUMN "clicked_at" timestamptz;
