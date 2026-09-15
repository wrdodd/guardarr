/**
 * Shared enforcement core.
 *
 * Single source of truth for "what filter should this user have, right now".
 * Previously this logic existed in two drifted copies — enforcer.js and
 * app/api/users/[id]/bypass/route.ts — where the route's copy was missing
 * rating normalization, the TV-MA cross-apply and label clauses, so cancelling
 * a bypass applied a different filter than the enforcer would.
 *
 * Deliberately PURE: no database, no fetch, no clock reads except where a time
 * is passed in. That keeps it trivially testable (see tests/) and lets both the
 * CommonJS enforcer and the Next.js app import the same code.
 */

// ───────────────────────────── rating / filter strings ─────────────────────────────

// Plex writes "Not Rated" in some places and "NR" in others; match both.
function normalizeRating(rating) {
  const normalized = String(rating).trim();
  if (normalized === "NR" || normalized === "Not Rated") return ["NR", "Not Rated"];
  return [normalized];
}

// An allow-list wins over a block-list when both are present.
function buildFilter(allowed, blocked) {
  if (allowed) {
    const ratings = String(allowed).split(",").flatMap(normalizeRating).filter(Boolean);
    const unique = [...new Set(ratings)];
    if (unique.length) return `contentRating=${unique.join(",")}`;
  } else if (blocked) {
    const ratings = String(blocked).split(",").flatMap(normalizeRating).filter(Boolean);
    const unique = [...new Set(ratings)];
    if (unique.length) return `contentRating!=${unique.join(",")}`;
  }
  return "";
}

// Plex restriction filters are "|"-joined clauses, e.g. contentRating=G,PG|label=kids
function buildLabelClause(include, exclude) {
  const clauses = [];
  const inc = String(include || "").split(",").map((s) => s.trim()).filter(Boolean);
  const exc = String(exclude || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (inc.length) clauses.push(`label=${inc.join(",")}`);
  if (exc.length) clauses.push(`label!=${exc.join(",")}`);
  return clauses.join("|");
}

/**
 * The exact filter strings a rule wants, for movies and TV.
 * TV-MA is cross-applied between the movie and TV lists because Plex reports it
 * on both media types depending on the agent that matched the item.
 */
function buildDesiredFilters(rule) {
  const movieBlocked = rule.blocked_ratings || "";
  const tvBlocked = rule.blocked_tv_ratings || "";
  const movieAllowed = rule.allowed_ratings || "";
  const tvAllowed = rule.allowed_tv_ratings || "";

  const hasTvMaBlocked = (movieBlocked + "," + tvBlocked).split(",").some((r) => r.trim() === "TV-MA");
  const hasTvMaAllowed = (movieAllowed + "," + tvAllowed).split(",").some((r) => r.trim() === "TV-MA");

  let effMovieBlocked = movieBlocked;
  let effTvBlocked = tvBlocked;
  let effMovieAllowed = movieAllowed;
  let effTvAllowed = tvAllowed;

  if (hasTvMaBlocked) {
    if (!effMovieBlocked.includes("TV-MA")) effMovieBlocked = effMovieBlocked ? effMovieBlocked + ",TV-MA" : "TV-MA";
    if (!effTvBlocked.includes("TV-MA")) effTvBlocked = effTvBlocked ? effTvBlocked + ",TV-MA" : "TV-MA";
  }
  if (hasTvMaAllowed) {
    if (!effMovieAllowed.includes("TV-MA")) effMovieAllowed = effMovieAllowed ? effMovieAllowed + ",TV-MA" : "TV-MA";
    if (!effTvAllowed.includes("TV-MA")) effTvAllowed = effTvAllowed ? effTvAllowed + ",TV-MA" : "TV-MA";
  }

  const labelClause = buildLabelClause(rule.include_labels, rule.exclude_labels);
  return {
    movieFilter: [buildFilter(effMovieAllowed, effMovieBlocked), labelClause].filter(Boolean).join("|"),
    tvFilter: [buildFilter(effTvAllowed, effTvBlocked), labelClause].filter(Boolean).join("|"),
  };
}

// Human-readable summary of a rule, used in the activity feed.
function describeRule(rule) {
  const parts = [];
  if (rule.allowed_ratings) parts.push(`Movies allowed: ${rule.allowed_ratings}`);
  else if (rule.blocked_ratings) parts.push(`Movies blocked: ${rule.blocked_ratings}`);
  if (rule.allowed_tv_ratings) parts.push(`TV allowed: ${rule.allowed_tv_ratings}`);
  else if (rule.blocked_tv_ratings) parts.push(`TV blocked: ${rule.blocked_tv_ratings}`);
  if (rule.include_labels) parts.push(`Labels: ${rule.include_labels}`);
  if (rule.exclude_labels) parts.push(`Block labels: ${rule.exclude_labels}`);
  return parts.join(" | ") || "No ratings configured";
}

// ───────────────────────────────── schedule ─────────────────────────────────

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Day/time in a given IANA timezone. NEVER uses the host or container clock's
 * timezone — that is what made every rule fire 7 hours early (UTC vs Pacific)
 * until v1.1.14. `now` is injectable for tests.
 */
function getLocalTime(timezone, now) {
  const tz = timezone || "America/Los_Angeles";
  const at = now || new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "numeric", hour12: false, weekday: "short",
    }).formatToParts(at);
    // en-US with hour12:false can use hourCycle h24 and emit "24" at midnight.
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10) % 24;
    const minute = parts.find((p) => p.type === "minute")?.value || "00";
    const day = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase().slice(0, 3);
    return { currentDay: day, currentTime: `${String(hour).padStart(2, "0")}:${minute}`, timezone: tz };
  } catch (e) {
    return {
      currentDay: DAY_KEYS[at.getDay()],
      currentTime: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`,
      timezone: "(host local)",
      invalidTimezone: tz,
    };
  }
}

// Does the rule's day/time window cover `clock` (from getLocalTime)?
function isRuleActive(rule, clock) {
  const days = String(rule.days || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (!days.includes(clock.currentDay) && !days.includes("all")) return false;

  const start = rule.start_time;
  const end = rule.end_time;
  if (start <= end) return clock.currentTime >= start && clock.currentTime <= end;
  return clock.currentTime >= start || clock.currentTime <= end; // crosses midnight
}

/**
 * Plex stores ONE filter per user, so overlapping rules need a single winner.
 * Highest priority wins; ties broken by lowest rule id for determinism.
 * (Before v1.1.14 whichever rule happened to be iterated last silently won.)
 */
function pickWinningRule(rules, clock) {
  const active = rules.filter((r) => isRuleActive(r, clock));
  if (!active.length) return null;
  return active.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id)[0];
}

// ───────────────────────── reconciliation decision ─────────────────────────

/**
 * Decide what should happen to ONE user this cycle. Pure: all state is passed in,
 * nothing is read or written. The enforcer performs the returned action.
 *
 *   rules      - every active rule assigned to this user
 *   clock      - from getLocalTime()
 *   applied    - applied_restrictions row for this user, or null
 *   liveState  - {movies, tv} from plex.tv, or null if plex.tv was unreachable
 *   hasBypass  - true if an unexpired temporary bypass exists
 *
 * Returns { type, rule?, desired?, logActivity?, reason? } where type is one of:
 *   "apply"  - PUT the filters in `desired`
 *   "clear"  - PUT empty filters
 *   "adopt"  - live already matches; just record durable state, no API call
 *   "forget" - Plex is already clear; drop the stale durable row, no API call
 *   "none"   - do nothing
 *   "foreign"- a filter we did not set and that matches no rule; leave it alone
 */
function planUserAction({ rules, clock, applied, liveState, hasBypass }) {
  const liveHasFilter = liveState ? !!(liveState.movies || liveState.tv) : null;

  // A bypass outranks every rule: ensure cleared, never re-apply while it lasts.
  if (hasBypass) {
    if (applied || liveHasFilter) {
      return { type: "clear", reason: "Temporary bypass active", ruleName: applied ? applied.rule_name : "bypass" };
    }
    return { type: "none" };
  }

  const winner = pickWinningRule(rules, clock);

  if (winner) {
    const desired = buildDesiredFilters(winner);

    // Does our durable record already describe exactly this rule and these filters?
    const recordMatches = !!applied
      && applied.rule_id === winner.id
      && applied.movie_filter === desired.movieFilter
      && applied.tv_filter === desired.tvFilter;

    if (liveState) {
      const liveMatches = liveState.movies === desired.movieFilter
                       && liveState.tv === desired.tvFilter;

      // Plex is already correct. Either we knew that (nothing to do) or our record
      // was lost — e.g. a restart — and we adopt it WITHOUT a redundant write.
      if (liveMatches) return recordMatches ? { type: "none" } : { type: "adopt", rule: winner, desired };

      // Plex disagrees, so write. Log to the activity feed only when this is a real
      // state change (window opened, rule edited); repairing external drift would
      // otherwise spam it every time someone edits a filter in Plex directly.
      return { type: "apply", rule: winner, desired, logActivity: !recordMatches, drift: recordMatches };
    }

    // plex.tv unreachable this cycle — fall back to the durable record.
    if (recordMatches) return { type: "none" };
    return { type: "apply", rule: winner, desired, logActivity: true };
  }

  // No rule should be active — the user must end up unrestricted.
  if (liveHasFilter === false) return applied ? { type: "forget" } : { type: "none" };
  if (applied || (liveState && looksLikeOurs(liveState, rules))) {
    return { type: "clear", reason: "Rule time window ended", ruleName: applied ? applied.rule_name : "(recovered)" };
  }
  if (liveHasFilter) return { type: "foreign" };
  return { type: "none" };
}

/**
 * Does a live filter look like something Guardarr set? Lets the enforcer adopt or
 * clear orphans left by an older build without clobbering a filter an admin set by
 * hand in Plex for a user Guardarr also manages.
 */
function looksLikeOurs(liveState, rules) {
  return rules.some((r) => {
    const d = buildDesiredFilters(r);
    return (d.movieFilter && liveState.movies === d.movieFilter)
        || (d.tvFilter && liveState.tv === d.tvFilter);
  });
}

module.exports = {
  normalizeRating, buildFilter, buildLabelClause, buildDesiredFilters, describeRule,
  getLocalTime, isRuleActive, pickWinningRule, planUserAction, looksLikeOurs, DAY_KEYS,
};
