const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFilter, buildLabelClause, buildDesiredFilters, describeRule,
  getLocalTime, isRuleActive, pickWinningRule, planUserAction, looksLikeOurs,
} = require("../lib/enforcement.js");

const rule = (over = {}) => ({
  id: 1, name: "Kids Friendly", days: "all", start_time: "14:00", end_time: "19:00",
  allowed_ratings: "G,PG,PG-13", blocked_ratings: "",
  allowed_tv_ratings: "TV-Y,TV-G", blocked_tv_ratings: "",
  include_labels: "", exclude_labels: "", priority: 0, ...over,
});
const at = (day, time) => ({ currentDay: day, currentTime: time });

// ─────────────────────────── filter construction ───────────────────────────

test("buildFilter prefers an allow-list over a block-list", () => {
  assert.equal(buildFilter("G,PG", "R"), "contentRating=G,PG");
  assert.equal(buildFilter("", "R,NC-17"), "contentRating!=R,NC-17");
  assert.equal(buildFilter("", ""), "");
});

test("buildFilter expands NR to both spellings Plex uses", () => {
  assert.equal(buildFilter("", "NR"), "contentRating!=NR,Not Rated");
  // and does not duplicate when both are already listed
  assert.equal(buildFilter("", "NR,Not Rated"), "contentRating!=NR,Not Rated");
});

test("buildLabelClause emits include and exclude clauses", () => {
  assert.equal(buildLabelClause("kids", ""), "label=kids");
  assert.equal(buildLabelClause("", "Adult,Unrated"), "label!=Adult,Unrated");
  assert.equal(buildLabelClause("kids", "Adult"), "label=kids|label!=Adult");
  assert.equal(buildLabelClause("", ""), "");
});

test("buildDesiredFilters joins rating and label clauses with |", () => {
  const d = buildDesiredFilters(rule({ exclude_labels: "Adult" }));
  assert.equal(d.movieFilter, "contentRating=G,PG,PG-13|label!=Adult");
  assert.equal(d.tvFilter, "contentRating=TV-Y,TV-G|label!=Adult");
});

test("TV-MA is cross-applied to both movie and TV filters", () => {
  // Plex reports TV-MA on movies too, depending on the matching agent.
  const blocked = buildDesiredFilters(rule({
    allowed_ratings: "", allowed_tv_ratings: "", blocked_ratings: "R", blocked_tv_ratings: "TV-MA",
  }));
  assert.ok(blocked.movieFilter.includes("TV-MA"), blocked.movieFilter);
  assert.ok(blocked.tvFilter.includes("TV-MA"), blocked.tvFilter);
});

test("describeRule summarises allow and block lists", () => {
  assert.match(describeRule(rule()), /Movies allowed: G,PG,PG-13/);
  assert.match(describeRule(rule({ allowed_ratings: "", blocked_ratings: "R" })), /Movies blocked: R/);
  assert.equal(describeRule({ }), "No ratings configured");
});

// ───────────────────────────────── schedule ─────────────────────────────────

test("isRuleActive respects the window boundaries inclusively", () => {
  assert.equal(isRuleActive(rule(), at("mon", "13:59")), false);
  assert.equal(isRuleActive(rule(), at("mon", "14:00")), true);
  assert.equal(isRuleActive(rule(), at("mon", "18:30")), true);
  assert.equal(isRuleActive(rule(), at("mon", "19:00")), true);
  assert.equal(isRuleActive(rule(), at("mon", "19:01")), false);
});

test("isRuleActive honours the day list", () => {
  assert.equal(isRuleActive(rule({ days: "sat,sun" }), at("mon", "15:00")), false);
  assert.equal(isRuleActive(rule({ days: "sat,sun" }), at("sat", "15:00")), true);
  assert.equal(isRuleActive(rule({ days: "all" }), at("wed", "15:00")), true);
});

test("isRuleActive handles windows that cross midnight", () => {
  const overnight = rule({ start_time: "22:00", end_time: "06:00" });
  assert.equal(isRuleActive(overnight, at("mon", "23:30")), true);
  assert.equal(isRuleActive(overnight, at("mon", "02:00")), true);
  assert.equal(isRuleActive(overnight, at("mon", "12:00")), false);
});

test("REGRESSION: a 2pm-7pm rule is not active at 10:41am", () => {
  // The v1.1.14 bug: schedules were evaluated in the container's UTC clock, so a
  // 14:00-19:00 Pacific rule actually ran 07:00-12:00 Pacific and blocked a user
  // late morning while leaving the real afternoon window unenforced.
  const r = rule({ days: "mon,tue,wed,thu,fri" });
  assert.equal(isRuleActive(r, at("mon", "10:41")), false);
  assert.equal(isRuleActive(r, at("mon", "15:00")), true);
});

test("getLocalTime reads the given timezone, not the host clock", () => {
  // A fixed instant: 2026-09-15T01:32:00Z is Mon Sep 14, 6:32pm Pacific.
  const instant = new Date("2026-09-15T01:32:00Z");
  const pacific = getLocalTime("America/Los_Angeles", instant);
  assert.equal(pacific.currentDay, "mon");
  assert.equal(pacific.currentTime, "18:32");

  const utc = getLocalTime("UTC", instant);
  assert.equal(utc.currentDay, "tue");
  assert.equal(utc.currentTime, "01:32");
});

test("getLocalTime folds hour 24 to 00 at midnight", () => {
  const midnight = new Date("2026-09-15T07:00:00Z"); // 00:00 Pacific
  const c = getLocalTime("America/Los_Angeles", midnight);
  assert.equal(c.currentTime, "00:00");
});

test("getLocalTime falls back safely on an invalid timezone", () => {
  const c = getLocalTime("Not/AZone", new Date("2026-09-15T01:32:00Z"));
  assert.equal(c.invalidTimezone, "Not/AZone");
  assert.match(c.currentTime, /^\d{2}:\d{2}$/);
});

test("pickWinningRule resolves overlaps by priority then id", () => {
  const a = rule({ id: 5, name: "low", priority: 0 });
  const b = rule({ id: 9, name: "high", priority: 10 });
  assert.equal(pickWinningRule([a, b], at("mon", "15:00")).name, "high");
  // deterministic tie-break: lowest id, not iteration order
  const c = rule({ id: 2, name: "tie-low-id", priority: 10 });
  assert.equal(pickWinningRule([b, c], at("mon", "15:00")).name, "tie-low-id");
  assert.equal(pickWinningRule([a, b], at("mon", "23:00")), null);
});

test("looksLikeOurs recognises filters this app would have written", () => {
  const live = { movies: "contentRating=G,PG,PG-13", tv: "contentRating=TV-Y,TV-G" };
  assert.equal(looksLikeOurs(live, [rule()]), true);
  assert.equal(looksLikeOurs({ movies: "label!=Adult", tv: "" }, [rule()]), false);
});
