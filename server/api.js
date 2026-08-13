'use strict';

const week = require('./week');

// All board mutations live here as plain functions over `state`, so the test
// suite can exercise them without going near HTTP.

const MAX_TITLE = 80;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let idCounter = 0;
function newId(prefix) {
  idCounter = (idCounter + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function cleanTitle(value) {
  const title = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!title) throw new ApiError(400, 'Title is required');
  return title.slice(0, MAX_TITLE);
}

function validAssignee(state, assignee) {
  if (assignee === 'shared') return 'shared';
  const person = state.settings.people.find((p) => p.id === assignee);
  if (!person) throw new ApiError(400, 'Unknown assignee');
  return person.id;
}

/** Trim, cap and de-blank a user-supplied list of short strings. */
function cleanList(value, { max = 60, maxLength = 24, label = 'list' } = {}) {
  if (!Array.isArray(value)) throw new ApiError(400, `Invalid ${label}`);
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.replace(/\s+/g, ' ').trim().slice(0, maxLength);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  if (!out.length) throw new ApiError(400, `${label} cannot be empty`);
  return out;
}

function validDow(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const dow = Number(value);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new ApiError(400, 'Invalid day');
  return dow;
}

// ---------------------------------------------------------------- board view

/** Everything the UI needs to render one week, in a single response. */
function getBoard(state, key) {
  const weekStartsOn = state.settings.weekStartsOn;
  const resolved = key || week.weekKey(new Date(), weekStartsOn);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolved)) throw new ApiError(400, 'Invalid week');

  const added = week.materialiseWeek(state, resolved);
  const tasks = state.tasks.filter((t) => t.weekKey === resolved);

  return {
    board: {
      weekKey: resolved,
      days: week.weekDays(resolved),
      isCurrentWeek: week.isCurrentWeek(resolved, weekStartsOn),
      tasks,
      shopping: state.shopping,
      templates: state.templates,
      settings: state.settings,
      today: week.toISODate(new Date()),
    },
    changed: added.length > 0,
  };
}

// --------------------------------------------------------------------- tasks

function addTask(state, body) {
  const task = {
    id: newId('task'),
    title: cleanTitle(body.title),
    assignee: validAssignee(state, body.assignee),
    icon: typeof body.icon === 'string' ? body.icon.slice(0, 4) : '',
    weekKey: body.weekKey || week.weekKey(new Date(), state.settings.weekStartsOn),
    dow: validDow(body.dow),
    done: false,
    doneAt: null,
    source: 'adhoc',
    templateId: null,
    createdAt: new Date().toISOString(),
  };
  state.tasks.push(task);
  return task;
}

function updateTask(state, id, body) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new ApiError(404, 'Task not found');

  if (body.done !== undefined) {
    task.done = Boolean(body.done);
    task.doneAt = task.done ? new Date().toISOString() : null;
  }
  if (body.title !== undefined) task.title = cleanTitle(body.title);
  if (body.assignee !== undefined) task.assignee = validAssignee(state, body.assignee);
  if (body.icon !== undefined) task.icon = String(body.icon).slice(0, 4);
  if (body.dow !== undefined) task.dow = validDow(body.dow, task.dow);
  return task;
}

function deleteTask(state, id) {
  const index = state.tasks.findIndex((t) => t.id === id);
  if (index === -1) throw new ApiError(404, 'Task not found');
  const [removed] = state.tasks.splice(index, 1);
  return removed;
}

/** Untick every task in a week. Used by the "start the week over" button. */
function resetWeek(state, key) {
  let count = 0;
  for (const task of state.tasks) {
    if (task.weekKey === key && task.done) {
      task.done = false;
      task.doneAt = null;
      count++;
    }
  }
  return { reset: count };
}

// ----------------------------------------------------------------- templates

function addTemplate(state, body) {
  const days = Array.isArray(body.days) ? [...new Set(body.days.map((d) => validDow(d)))].sort() : [];
  if (!days.length) throw new ApiError(400, 'Pick at least one day');
  const tpl = {
    id: newId('tpl'),
    title: cleanTitle(body.title),
    assignee: validAssignee(state, body.assignee),
    icon: typeof body.icon === 'string' ? body.icon.slice(0, 4) : '',
    days,
    paused: false,
  };
  state.templates.push(tpl);
  return tpl;
}

function updateTemplate(state, id, body) {
  const tpl = state.templates.find((t) => t.id === id);
  if (!tpl) throw new ApiError(404, 'Chore not found');

  if (body.title !== undefined) tpl.title = cleanTitle(body.title);
  if (body.assignee !== undefined) tpl.assignee = validAssignee(state, body.assignee);
  if (body.icon !== undefined) tpl.icon = String(body.icon).slice(0, 4);
  if (body.paused !== undefined) tpl.paused = Boolean(body.paused);
  if (body.days !== undefined) {
    const days = [...new Set((body.days || []).map((d) => validDow(d)))].sort();
    if (!days.length) throw new ApiError(400, 'Pick at least one day');
    tpl.days = days;
  }

  // Generated tasks for weeks that have not happened yet should follow the
  // edit; past weeks are history and stay as they were.
  const currentKey = week.weekKey(new Date(), state.settings.weekStartsOn);
  for (const task of state.tasks) {
    if (task.templateId !== tpl.id || task.weekKey < currentKey) continue;
    if (!tpl.days.includes(task.dow) || tpl.paused) {
      task._orphaned = true;
    } else {
      task.title = tpl.title;
      task.assignee = tpl.assignee;
      task.icon = tpl.icon;
    }
  }
  // Drop generated-but-no-longer-scheduled tasks, unless already ticked off.
  state.tasks = state.tasks.filter((t) => {
    if (!t._orphaned) return true;
    if (t.done) {
      delete t._orphaned;
      return true;
    }
    return false;
  });

  return tpl;
}

function deleteTemplate(state, id) {
  const index = state.templates.findIndex((t) => t.id === id);
  if (index === -1) throw new ApiError(404, 'Chore not found');
  const [removed] = state.templates.splice(index, 1);

  // Remove its not-yet-done instances from the current and future weeks.
  const currentKey = week.weekKey(new Date(), state.settings.weekStartsOn);
  state.tasks = state.tasks.filter(
    (t) => !(t.templateId === id && t.weekKey >= currentKey && !t.done)
  );
  return removed;
}

// ------------------------------------------------------------------ shopping

function addShopping(state, body) {
  const title = cleanTitle(body.title);
  const existing = state.shopping.find(
    (item) => item.title.toLowerCase() === title.toLowerCase() && !item.checked
  );
  if (existing) {
    existing.qty = (existing.qty || 1) + 1;
    return existing;
  }
  const item = {
    id: newId('shop'),
    title,
    qty: 1,
    checked: false,
    createdAt: new Date().toISOString(),
  };
  state.shopping.unshift(item);
  return item;
}

function updateShopping(state, id, body) {
  const item = state.shopping.find((s) => s.id === id);
  if (!item) throw new ApiError(404, 'Item not found');
  if (body.checked !== undefined) item.checked = Boolean(body.checked);
  if (body.title !== undefined) item.title = cleanTitle(body.title);
  if (body.qty !== undefined) item.qty = Math.max(1, Math.min(99, Number(body.qty) || 1));
  return item;
}

function deleteShopping(state, id) {
  const index = state.shopping.findIndex((s) => s.id === id);
  if (index === -1) throw new ApiError(404, 'Item not found');
  const [removed] = state.shopping.splice(index, 1);
  return removed;
}

function clearCheckedShopping(state) {
  const before = state.shopping.length;
  state.shopping = state.shopping.filter((s) => !s.checked);
  return { removed: before - state.shopping.length };
}

// ------------------------------------------------------------------ settings

const THEMES = ['sakura', 'mint', 'lavender', 'night'];
const COLORS = ['blue', 'pink', 'mint', 'peach', 'lilac', 'lemon'];
// Three people fit comfortably on an 800px-wide panel; the layout tightens up
// to six, past which the columns are too narrow to read at arm's length.
const MAX_PEOPLE = 6;

function updateSettings(state, body) {
  const s = state.settings;

  if (body.title !== undefined) s.title = String(body.title).trim().slice(0, 30) || 'Our Week';

  if (body.theme !== undefined) {
    if (!THEMES.includes(body.theme)) throw new ApiError(400, 'Unknown theme');
    s.theme = body.theme;
  }

  if (body.accent !== undefined) {
    if (body.accent === null || body.accent === '') s.accent = null;
    else if (COLORS.includes(body.accent)) s.accent = body.accent;
    else throw new ApiError(400, 'Unknown accent colour');
  }

  if (body.weekStartsOn !== undefined) {
    const v = Number(body.weekStartsOn);
    if (v !== 0 && v !== 1) throw new ApiError(400, 'Week must start on Sunday or Monday');
    s.weekStartsOn = v;
  }

  if (body.shared !== undefined) {
    const shared = body.shared || {};
    if (shared.name !== undefined) {
      const name = String(shared.name).trim().slice(0, 14);
      if (!name) throw new ApiError(400, 'Name is required');
      s.shared.name = name;
    }
    if (shared.icon !== undefined) s.shared.icon = String(shared.icon).slice(0, 4);
    if (shared.enabled !== undefined) s.shared.enabled = Boolean(shared.enabled);
  }

  if (body.modules !== undefined) {
    if (!Array.isArray(body.modules)) throw new ApiError(400, 'Invalid modules');
    const known = new Map(s.modules.map((m) => [m.id, m]));
    const next = [];
    for (const incoming of body.modules) {
      const existing = known.get(incoming && incoming.id);
      if (!existing) continue;                       // never invent a module
      next.push({
        id: existing.id,
        label: incoming.label !== undefined
          ? (String(incoming.label).trim().slice(0, 14) || existing.label)
          : existing.label,
        icon: incoming.icon !== undefined
          ? (String(incoming.icon).slice(0, 4) || existing.icon)
          : existing.icon,
        enabled: incoming.enabled !== undefined ? Boolean(incoming.enabled) : existing.enabled,
      });
      known.delete(existing.id);
    }
    for (const leftover of known.values()) next.push(leftover);   // nothing vanishes
    if (!next.some((m) => m.enabled)) {
      throw new ApiError(400, 'At least one tab has to stay switched on');
    }
    s.modules = next;
  }

  if (body.icons !== undefined) s.icons = cleanList(body.icons, { max: 60, maxLength: 8, label: 'Icons' });
  if (body.avatars !== undefined) s.avatars = cleanList(body.avatars, { max: 60, maxLength: 8, label: 'Avatars' });
  if (body.quickAdd !== undefined) s.quickAdd = cleanList(body.quickAdd, { max: 40, maxLength: 24, label: 'Quick-add list' });

  return s;
}

/** Put one editable list back to the values the app ships with. */
function resetPalette(state, key) {
  const fresh = require('./store').defaultState();
  if (!['icons', 'avatars', 'quickAdd'].includes(key)) {
    throw new ApiError(400, 'Unknown palette');
  }
  state.settings[key] = fresh.settings[key];
  return { [key]: state.settings[key] };
}

function addPerson(state, body) {
  const people = state.settings.people;
  if (people.length >= MAX_PEOPLE) {
    throw new ApiError(400, `The board fits ${MAX_PEOPLE} people at most`);
  }
  const name = String((body && body.name) || '').trim().slice(0, 14);
  if (!name) throw new ApiError(400, 'Name is required');

  const used = new Set(people.map((p) => p.color));
  const person = {
    id: newId('p'),
    name,
    icon: String((body && body.icon) || '🙂').slice(0, 4),
    color: COLORS.includes(body && body.color)
      ? body.color
      : (COLORS.find((c) => !used.has(c)) || 'blue'),   // pick an unused colour
  };
  people.push(person);
  return person;
}

function updatePerson(state, id, body) {
  const person = state.settings.people.find((p) => p.id === id);
  if (!person) throw new ApiError(404, 'Person not found');
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 14);
    if (!name) throw new ApiError(400, 'Name is required');
    person.name = name;
  }
  if (body.icon !== undefined) person.icon = String(body.icon).slice(0, 4);
  if (body.color !== undefined) {
    if (!COLORS.includes(body.color)) throw new ApiError(400, 'Unknown colour');
    person.color = body.color;
  }
  return person;
}

/**
 * Remove a person. Their tasks and chores have to go somewhere, otherwise they
 * become invisible rather than deleted, so the caller must say which:
 *   reassignTo: '<personId>' | 'shared'  → hand the work over
 *   reassignTo: null / omitted           → delete the work too
 */
function deletePerson(state, id, body = {}) {
  const people = state.settings.people;
  const index = people.findIndex((p) => p.id === id);
  if (index === -1) throw new ApiError(404, 'Person not found');
  if (people.length <= 1) throw new ApiError(400, 'The board needs at least one person');

  const target = body.reassignTo;
  let moved = 0;
  let removed = 0;

  if (target) {
    if (target === id) throw new ApiError(400, 'Pick somebody else to take the tasks');
    // Validate before mutating anything, so a bad id cannot half-apply.
    const exists = target === 'shared' || people.some((p) => p.id === target);
    if (!exists) throw new ApiError(400, 'Unknown person to reassign to');
    for (const item of [...state.tasks, ...state.templates]) {
      if (item.assignee === id) { item.assignee = target; moved++; }
    }
  } else {
    const before = state.tasks.length + state.templates.length;
    state.tasks = state.tasks.filter((t) => t.assignee !== id);
    state.templates = state.templates.filter((t) => t.assignee !== id);
    removed = before - (state.tasks.length + state.templates.length);
  }

  const [person] = people.splice(index, 1);
  return { person, moved, removed };
}

/** Reorder the columns. Ids not mentioned keep their relative order at the end. */
function reorderPeople(state, body) {
  const order = Array.isArray(body && body.order) ? body.order : null;
  if (!order) throw new ApiError(400, 'Invalid order');
  const byId = new Map(state.settings.people.map((p) => [p.id, p]));
  const next = [];
  for (const id of order) {
    const person = byId.get(id);
    if (person) { next.push(person); byId.delete(id); }
  }
  for (const leftover of byId.values()) next.push(leftover);
  if (!next.length) throw new ApiError(400, 'Invalid order');
  state.settings.people = next;
  return state.settings.people;
}

/**
 * Wipe everything back to a fresh board. `keepPeople` lets you start the term
 * over without having to retype who you both are.
 */
function resetAll(state, body = {}) {
  const fresh = require('./store').defaultState();
  const keptPeople = body.keepPeople ? state.settings.people.map((p) => ({ ...p })) : null;

  state.settings = fresh.settings;
  if (keptPeople) state.settings.people = keptPeople;
  state.templates = body.keepChores ? state.templates : fresh.templates;
  state.tasks = [];
  state.shopping = [];

  // Anything kept could still point at a person who no longer exists.
  const valid = new Set([...state.settings.people.map((p) => p.id), 'shared']);
  const fallback = state.settings.people[0].id;
  for (const tpl of state.templates) {
    if (!valid.has(tpl.assignee)) tpl.assignee = fallback;
  }
  return state.settings;
}

module.exports = {
  ApiError,
  THEMES,
  COLORS,
  MAX_PEOPLE,
  getBoard,
  addTask,
  updateTask,
  deleteTask,
  resetWeek,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  addShopping,
  updateShopping,
  deleteShopping,
  clearCheckedShopping,
  updateSettings,
  resetPalette,
  addPerson,
  updatePerson,
  deletePerson,
  reorderPeople,
  resetAll,
};
