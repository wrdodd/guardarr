/**
 * Display-side time formatting, shared by the dashboard, rules list and any API
 * route that renders a rule boundary. CommonJS so the test suite can require it
 * directly without a TypeScript build step.
 *
 * Rule windows are STORED as 24-hour "HH:MM" because the enforcer compares them as
 * strings; these helpers are presentation only and never feed enforcement.
 */

function formatTime12h(hhmm) {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return String(hhmm);
  const hour = parseInt(m[1], 10);
  const minute = m[2];
  if (!Number.isFinite(hour) || hour > 24) return String(hhmm);
  // 24:00 is sometimes emitted for midnight; treat it as 12 AM.
  const h = hour % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${minute} ${suffix}`;
}

function formatWindow12h(start, end) {
  return `${formatTime12h(start)} – ${formatTime12h(end)}`;
}

module.exports = { formatTime12h, formatWindow12h };
