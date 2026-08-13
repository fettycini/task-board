'use strict';

// Weeks are identified by the ISO date of their first day, e.g. "2026-08-03".
// This avoids every ISO-week-number edge case (year boundaries, week 53) and
// stays readable when you open board.json by hand.

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Format a Date as a local (not UTC) YYYY-MM-DD string. */
function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse YYYY-MM-DD into a local Date at midnight. */
function fromISODate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Midnight, local time, of the given date. */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * First day of the week containing `date`.
 * weekStartsOn: 0 = Sunday, 1 = Monday.
 */
function startOfWeek(date, weekStartsOn = 1) {
  const d = startOfDay(date);
  const shift = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

function weekKey(date, weekStartsOn = 1) {
  return toISODate(startOfWeek(date, weekStartsOn));
}

/** Shift a week key by N weeks. Returns a new week key. */
function shiftWeek(key, delta) {
  const d = fromISODate(key);
  d.setDate(d.getDate() + delta * 7);
  return toISODate(d);
}

/**
 * The seven days of a week, in display order.
 * `dow` is the real JS day-of-week (0=Sun..6=Sat) so it matches template.days.
 */
function weekDays(key) {
  const start = fromISODate(key);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({ date: toISODate(d), dow: d.getDay(), index: i });
  }
  return out;
}

/** True if `key` is the week containing `now`. */
function isCurrentWeek(key, weekStartsOn = 1, now = new Date()) {
  return key === weekKey(now, weekStartsOn);
}

/**
 * Deterministic id for a task generated from a template. Re-running
 * materialisation for the same week can therefore never create duplicates.
 */
function templateTaskId(templateId, key, dow) {
  return `tpl_${templateId}_${key}_${dow}`;
}

/**
 * Expand recurring templates into concrete tasks for one week.
 *
 * Only *adds* tasks that don't already exist, so a user editing or ticking
 * off a generated task is never clobbered. Returns the tasks that were added.
 */
function materialiseWeek(state, key) {
  const existing = new Set(state.tasks.map((t) => t.id));
  const days = weekDays(key);
  const added = [];

  for (const tpl of state.templates) {
    if (tpl.paused) continue;
    for (const day of days) {
      if (!tpl.days.includes(day.dow)) continue;
      const id = templateTaskId(tpl.id, key, day.dow);
      if (existing.has(id)) continue;
      added.push({
        id,
        title: tpl.title,
        assignee: tpl.assignee,
        icon: tpl.icon || '',
        weekKey: key,
        dow: day.dow,
        done: false,
        doneAt: null,
        source: 'template',
        templateId: tpl.id,
        createdAt: new Date().toISOString(),
      });
      existing.add(id);
    }
  }

  if (added.length) state.tasks.push(...added);
  return added;
}

/**
 * Drop tasks from weeks far enough in the past that nobody will look at them.
 * Keeps board.json from growing without bound on a device that runs for years.
 */
function pruneOldWeeks(state, keepWeeks = 12, now = new Date()) {
  const cutoff = toISODate(
    new Date(startOfWeek(now, state.settings.weekStartsOn).getTime() - keepWeeks * 7 * DAY_MS)
  );
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.weekKey >= cutoff);
  return before - state.tasks.length;
}

module.exports = {
  toISODate,
  fromISODate,
  startOfDay,
  startOfWeek,
  weekKey,
  shiftWeek,
  weekDays,
  isCurrentWeek,
  templateTaskId,
  materialiseWeek,
  pruneOldWeeks,
};
