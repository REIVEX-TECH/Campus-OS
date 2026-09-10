# Rides sweep

The rides module has no in-request path that ends a ride: an offer/request just sits
until its departure passes. A scheduled sweep closes the loop — it completes or
expires past rides and spawns the next occurrence of a recurring offer.

Run it per tenant that has `rides` enabled:

```bash
pnpm rides:sweep -- --tenant lgu
# raise the grace window to match a tenant that changed completeAfterHours:
pnpm rides:sweep -- --tenant lgu --hours 3
```

## What it does

For rides past `--hours` (default 2, the module's `completeAfterHours` default) after
their departure, still `active`/`full` and not moderator-removed:

- **completed** if the ride carried at least one accepted seat request (this opens the
  rating window for both parties),
- **expired** otherwise (nobody rode; it simply leaves browse).

Then, for each **recurring** offer that ended in this run, it spawns the next
occurrence: a fresh offer at the next matching weekday/time computed through the
tenant timezone (so it is correct across DST), seats reset, linked to the recurrence
root. This is idempotent — a `(recurrence_parent_id, depart_at)` unique index means a
re-run never double-spawns, and only rows this run touched are considered.

The work runs inside the `auth_rides_sweep` SECURITY DEFINER: deciding completed vs
expired reads seat requests across users, which the application role cannot see
without an actor, so the owner does it. The script only invokes the definer and
prints `completed N, expired N, spawned N`.

## Schedule

Hourly is plenty (the window is hours, not minutes). After the Lost & Found expiry
(03:20) and before the nightly backup (03:30) is a natural slot, but any cadence
works since the sweep is idempotent:

```cron
# rides lifecycle sweep, hourly, per enabled tenant
0 * * * * cd /srv/campusos && pnpm rides:sweep -- --tenant lgu >> /var/log/campusos/rides-sweep.log 2>&1
```

A non-zero exit (the script is fail-loud) leaves a visible error; alert on the
"rides sweep" line not appearing, not only on errors.
