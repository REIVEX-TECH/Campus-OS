# fix(lost-found): delete photo files when an item is withdrawn or removed

Withdrawing, moderator-removing, or expiring a Lost & Found item left every photo
behind: the lifecycle transitions only flipped `lf_items.status` and never touched
`lf_item_photos` rows or the object-store files (the `removed_at` column was dead).
Every taken-down listing leaked its full + thumb WebP blobs on disk forever.

## What

- `withdrawItem` and `removeItem` now hard-delete the item's `lf_item_photos` rows
  in the same transaction as the status change and return the storage keys (full +
  thumb). A shared `deleteItemPhotoRows(tx, itemId)` helper does the delete.
- The withdraw and moderation API routes delete those files from the object store
  after the transaction commits (best-effort: a missing object is not an error, and
  a file-op is not transactional, so the DB is the source of truth and a rare
  failure only leaves a reclaimable blob).

## Scope

Withdraw and remove, per the brief. **Expire and resolve still retain photos**
(resolved items stay viewable; expired rows persist out of browse) — a general
garbage-collection sweep is the right long-term answer and is flagged as a
follow-up. The service's ownership/moderation checks are the access control; the
tenant-only RLS on `lf_item_photos` is not.

## Data & migration impact

No schema change. Behavioural: withdrawn/removed items no longer keep photo rows or
files.

## Tests

- Integration: the withdraw test now asserts the photo rows are gone and the keys
  returned; the moderation-removal test attaches a photo and asserts the same on
  the moderator path. Typecheck + lint green locally; integration is CI-only.

## Verification

Withdraw an item that has photos, then check `MEDIA_DATA_DIR`: the full + thumb
files are gone, and `select count(*) from lf_item_photos where item_id = ...` is 0.
Same for a moderator removal.

## Follow-ups

A GC sweep to reclaim photos of expired and resolved items (and any orphaned by a
mid-operation crash).
