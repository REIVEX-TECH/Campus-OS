-- Store the raw source room string on each entry so a pending room value can be
-- counted (how many entries it blocks) and back-filled directly when an admin
-- maps it to a canonical room. Additive and nullable: backwards compatible.
-- Excluded from content_hash (which hashes room_id), so populating it on the
-- next ingest does not churn existing versions. Rollback: DROP COLUMN.
ALTER TABLE "timetable_entries" ADD COLUMN "room_source" text;
