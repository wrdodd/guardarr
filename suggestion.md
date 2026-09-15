# Guardarr — 10 Improvement Suggestions

> **Status:** #1, #2, #3, #8, #9 and #10 were implemented in **v1.2.0**.
> Remaining: #4 (now/next dashboard), #5 (bypass & drift webhooks), #6 (holiday mode),
> #7 (active-stream enforcement).

Compiled 2026-09-14, after the v1.1.14 timezone/durable-state work. Ordered roughly by
value-for-effort, with the reasoning behind each.

---

## 1. Deduplicate enforcement logic shared with the bypass routes  ✅ *Done in v1.2.0*

`app/api/users/[id]/bypass/route.ts` carries its **own older copies** of `buildFilter`
and `applyPlexRestrictions`. Those copies lack the rating normalization (`NR` / `"Not
Rated"`), the TV-MA cross-apply, and the label clauses that `enforcer.js` has. Result:
**cancelling a bypass re-applies a slightly different filter than the enforcer would**,
and the reconcile loop then "corrects" it a minute later — harmless today, but it's two
sources of truth for the most safety-critical string in the app.

Extract `buildDesiredFilters` / `isRuleActive` / the Plex PUT helpers into one shared
module (`lib/enforcement.js`) that both the enforcer and the API routes import.

## 2. Turn the v1.1.14 test harness into a real suite + CI  ✅ *Done in v1.2.0*

The 32 tests used to verify v1.1.14 (schedule logic, reconcile scenarios, bypass
precedence, mocked plex.tv) were throwaway and deleted after passing. This code decides
what a child can watch — regressions should be caught before deploy, not after a friend
reports one. Commit them under `tests/`, and add a GitHub Actions job (the repo already
has `docker.yml`) that runs them on every PR. The pattern that works: require a
startup-stripped copy of the enforcer, mock `global.fetch`, run against a scratch DB.

## 3. Editable per-library access (finish the v1.1.10 feature)  ✅ *Done in v1.2.0*

The read-only per-library viewer shipped in v1.1.10; the editable version was
deliberately deferred because it writes live Plex sharing. The natural completion is
**schedule-aware library access** — e.g. a kid loses the `Movies 4K` library entirely at
bedtime, not just rating-filtered. Build it against a dedicated test user first, since
`shared_servers` writes are immediately live.

## 4. Dashboard: "what's happening now / what's next"

Today, knowing a user's current state means mentally simulating the enforcer. Show per
user: the effective restriction right now, **which rule won** (matters once
multi-rule/priority is in play), any active bypass with its remaining time, and a
countdown to the next transition — "Kids Friendly lifts in 42 min". The
`applied_restrictions` table plus the rule schedule makes this cheap to compute.

## 5. Webhook notifications for bypass and drift events

The webhook currently fires only on enforcement failures and the weekly digest. The
events a parent actually wants pushed: **bypass granted / cancelled / expired**, and
**foreign-filter detected** (the enforcer's `warnedForeign` case currently lands only in
`docker logs`, where nobody will ever see it). All the plumbing (`sendAlert`) exists.

## 6. Calendar exceptions / holiday mode

Rules are weekly-only (`days` + window). School breaks, holidays and sick days all
require hand-editing rules — which is exactly the workflow that surfaced the timezone
bug. Add date-range overrides: "Nov 25–29: weekend schedule", "Jul 1–Aug 31: summer
hours", or "today only: no restrictions" as a first-class object instead of a rule edit
you must remember to revert.

## 7. Enforce against active streams, not just future browsing

A plex.tv filter change doesn't interrupt a stream already in progress — someone who
pressed play on an R movie at 13:59 keeps watching all evening. The local server URL is
already configured (`PLEX_SERVER_URL`): poll `/status/sessions` when a window starts,
and optionally terminate sessions whose content violates the newly applied rule
(Tautulli-style, with a friendly stop message). Make it opt-in per rule.

## 8. Activity log: timezone-correct display + retention  ✅ *Done in v1.2.0*

Activity timestamps are stored UTC and rendered raw — the "06:00 rule_applied" entries
are how the timezone bug was diagnosed, and they're still confusing in the UI. Render
them in `settings.timezone`. While there: the table grows unbounded (fine at today's
~300 rows, less fine with more users and per-bypass events) — prune to a configurable
retention, e.g. 90 days, during the nightly backup pass.

## 9. Replace regex XML parsing with a real parser  ✅ *Done in v1.2.0*

Both the enforcer's `fetchLiveFilters` and the library-access route parse plex.tv XML
with regexes over `<User …>` tags. It works, but it's brittle against attribute
reordering, new escaping, or multiline tags — and this parse now feeds the reconcile
loop, so a silent mis-parse could trigger spurious PUTs. `fast-xml-parser` is tiny,
dependency-free, and drops in.

## 10. Versioned schema migrations  ✅ *Done in v1.2.0*

Migrations today are ad-hoc `PRAGMA table_info` checks scattered through `enforcer.js`
(and historically the API routes). Add a `schema_version` table and one ordered
migration runner shared by the app and the enforcer. That makes future changes — and
rollbacks, which currently depend on "additive-only, hope for the best" — predictable,
and it stops the two processes from racing to create tables at startup.

---

*Not included: a timezone picker in Settings (already exists), ghcr image publishing
(already in `docker.yml`), and token persistence on sign-in (fixed in v1.1.2).*
