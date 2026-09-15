const test = require("node:test");
const assert = require("node:assert/strict");
const { planUserAction } = require("../lib/enforcement.js");

// planUserAction is pure: every input is explicit, so each scenario below is the
// exact state the enforcer would have observed.

const RULE = {
  id: 1, name: "Kids Friendly", days: "all", start_time: "14:00", end_time: "19:00",
  allowed_ratings: "G,PG,PG-13", blocked_ratings: "",
  allowed_tv_ratings: "TV-Y,TV-G", blocked_tv_ratings: "",
  include_labels: "", exclude_labels: "", priority: 0,
};
const OURS = { movies: "contentRating=G,PG,PG-13", tv: "contentRating=TV-Y,TV-G" };
const CLEAR = { movies: "", tv: "" };
const IN = { currentDay: "mon", currentTime: "15:00" };   // inside the window
const OUT = { currentDay: "mon", currentTime: "21:00" };  // outside the window

const appliedRow = (over = {}) => ({
  user_id: 33, rule_id: 1, rule_name: "Kids Friendly",
  movie_filter: OURS.movies, tv_filter: OURS.tv, ...over,
});

test("applies when a window opens and nothing is applied yet", () => {
  const a = planUserAction({ rules: [RULE], clock: IN, applied: null, liveState: CLEAR, hasBypass: false });
  assert.equal(a.type, "apply");
  assert.equal(a.logActivity, true);
  assert.equal(a.desired.movieFilter, OURS.movies);
});

test("steady state does nothing — no repeated writes to plex.tv", () => {
  const a = planUserAction({ rules: [RULE], clock: IN, applied: appliedRow(), liveState: OURS, hasBypass: false });
  assert.equal(a.type, "none");
});

test("clears when the window ends", () => {
  const a = planUserAction({ rules: [RULE], clock: OUT, applied: appliedRow(), liveState: OURS, hasBypass: false });
  assert.equal(a.type, "clear");
  assert.equal(a.reason, "Rule time window ended");
});

test("REGRESSION: clears an orphan left by a restart, with no durable record", () => {
  // The v1.1.14 bug: applied-state lived in an in-memory Set. After a restart the
  // Set was empty, so when the window ended nothing cleared the filter and the user
  // stayed restricted indefinitely. Recognising our own filter recovers it.
  const a = planUserAction({ rules: [RULE], clock: OUT, applied: null, liveState: OURS, hasBypass: false });
  assert.equal(a.type, "clear");
});

test("adopts live state that already matches but has no record", () => {
  const a = planUserAction({ rules: [RULE], clock: IN, applied: null, liveState: OURS, hasBypass: false });
  assert.equal(a.type, "adopt");
});

test("drops a stale record when Plex is already clear", () => {
  const a = planUserAction({ rules: [RULE], clock: OUT, applied: appliedRow(), liveState: CLEAR, hasBypass: false });
  assert.equal(a.type, "forget");
});

test("re-applies when live drifts, without spamming the activity feed", () => {
  const drifted = { movies: "contentRating=R", tv: OURS.tv };
  const a = planUserAction({ rules: [RULE], clock: IN, applied: appliedRow(), liveState: drifted, hasBypass: false });
  assert.equal(a.type, "apply");
  assert.equal(a.logActivity, false); // drift repair is not a state change
  assert.equal(a.drift, true);
});

test("re-applies and logs when the rule itself is edited", () => {
  const edited = { ...RULE, allowed_ratings: "G,PG" };
  const a = planUserAction({ rules: [edited], clock: IN, applied: appliedRow(), liveState: OURS, hasBypass: false });
  assert.equal(a.type, "apply");
  assert.equal(a.logActivity, true);
  assert.equal(a.desired.movieFilter, "contentRating=G,PG");
});

test("a bypass clears restrictions and outranks an active rule", () => {
  const a = planUserAction({ rules: [RULE], clock: IN, applied: appliedRow(), liveState: OURS, hasBypass: true });
  assert.equal(a.type, "clear");
  assert.equal(a.reason, "Temporary bypass active");
});

test("REGRESSION: a bypass is not re-applied over, even across a restart", () => {
  // Previously bypasses survived only because the in-memory Set said "already
  // applied"; a restart cleared that and silently re-restricted the user.
  const a = planUserAction({ rules: [RULE], clock: IN, applied: null, liveState: CLEAR, hasBypass: true });
  assert.equal(a.type, "none");
});

test("protection returns as soon as the bypass expires", () => {
  const a = planUserAction({ rules: [RULE], clock: IN, applied: null, liveState: CLEAR, hasBypass: false });
  assert.equal(a.type, "apply");
});

test("a filter Guardarr did not set is left alone", () => {
  const foreign = { movies: "label!=Adult", tv: "" };
  const a = planUserAction({ rules: [RULE], clock: OUT, applied: null, liveState: foreign, hasBypass: false });
  assert.equal(a.type, "foreign");
});

test("falls back to the durable record when plex.tv is unreachable", () => {
  // liveState null = the listing call failed; decisions come from the DB record.
  const ended = planUserAction({ rules: [RULE], clock: OUT, applied: appliedRow(), liveState: null, hasBypass: false });
  assert.equal(ended.type, "clear");
  const steady = planUserAction({ rules: [RULE], clock: IN, applied: appliedRow(), liveState: null, hasBypass: false });
  assert.equal(steady.type, "none");
});

test("higher-priority rule wins when two windows overlap", () => {
  const strict = { ...RULE, id: 2, name: "Little Kids", priority: 5, allowed_ratings: "G" };
  const a = planUserAction({ rules: [RULE, strict], clock: IN, applied: null, liveState: CLEAR, hasBypass: false });
  assert.equal(a.type, "apply");
  assert.equal(a.rule.name, "Little Kids");
  assert.equal(a.desired.movieFilter, "contentRating=G");
});

test("no rule, no record, nothing live — do nothing", () => {
  const a = planUserAction({ rules: [RULE], clock: OUT, applied: null, liveState: CLEAR, hasBypass: false });
  assert.equal(a.type, "none");
});
