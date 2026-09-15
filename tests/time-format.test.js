const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTime12h, formatWindow12h } = require("../lib/time-format.js");

test("formats 24-hour rule boundaries as am/pm", () => {
  assert.equal(formatTime12h("14:00"), "2:00 PM");
  assert.equal(formatTime12h("19:00"), "7:00 PM");
  assert.equal(formatTime12h("09:05"), "9:05 AM");
  assert.equal(formatTime12h("05:30"), "5:30 AM");
});

test("handles the midnight and noon edges", () => {
  assert.equal(formatTime12h("00:00"), "12:00 AM");
  assert.equal(formatTime12h("12:00"), "12:00 PM");
  assert.equal(formatTime12h("12:59"), "12:59 PM");
  assert.equal(formatTime12h("23:59"), "11:59 PM");
  assert.equal(formatTime12h("24:00"), "12:00 AM");
});

test("passes through values that are not HH:MM", () => {
  assert.equal(formatTime12h(""), "");
  assert.equal(formatTime12h("not a time"), "not a time");
  assert.equal(formatTime12h("25:00"), "25:00");
});

test("formatWindow12h renders a full window", () => {
  assert.equal(formatWindow12h("14:00", "19:00"), "2:00 PM – 7:00 PM");
  assert.equal(formatWindow12h("22:00", "06:00"), "10:00 PM – 6:00 AM");
});
