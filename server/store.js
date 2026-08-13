'use strict';

const fs = require('fs');
const path = require('path');
const week = require('./week');

const SCHEMA_VERSION = 2;

/**
 * The whole board lives in one JSON file. It is small (a few hundred tasks at
 * most), it is human-readable, and it is trivial to back up by copying.
 *
 * Writes are debounced and atomic (temp file + rename) so an unplugged Pi
 * cannot leave behind a half-written file.
 */
class Store {
  constructor(file, { writeDelayMs = 250 } = {}) {
    this.file = file;
    this.tmpFile = `${file}.tmp`;
    this.writeDelayMs = writeDelayMs;
    this.state = null;
    this._timer = null;
    this._writing = false;
    this._dirtyWhileWriting = false;
  }

  load() {
    let raw = null;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (raw) {
      try {
        this.state = migrate(JSON.parse(raw));
      } catch (err) {
        // A corrupt file must not brick the wall display. Keep the bad copy
        // for forensics and start fresh rather than crash-looping.
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.file, backup);
        } catch (_) {
          /* best effort */
        }
        console.error(`[store] board.json was unreadable (${err.message}); moved to ${backup}`);
        this.state = defaultState();
      }
    } else {
      this.state = defaultState();
    }

    return this.state;
  }

  /** Mark the state dirty; the actual disk write is debounced. */
  touch() {
    if (this._writing) {
      this._dirtyWhileWriting = true;
      return;
    }
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush().catch((err) => console.error('[store] write failed:', err.message));
    }, this.writeDelayMs);
  }

  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._writing = true;
    try {
      const json = JSON.stringify(this.state, null, 2);
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(this.tmpFile, json, 'utf8');
      await fs.promises.rename(this.tmpFile, this.file);
    } finally {
      this._writing = false;
    }
    if (this._dirtyWhileWriting) {
      this._dirtyWhileWriting = false;
      this.touch();
    }
  }

  flushSync() {
    try {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.tmpFile, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(this.tmpFile, this.file);
    } catch (err) {
      console.error('[store] final write failed:', err.message);
    }
  }
}

/* Anything a user might reasonably want to change lives in settings rather
   than in the code. These are only the starting values. */

const DEFAULT_ICONS = [
  '🧹', '🍽️', '🗑️', '🧺', '🛒', '🪴', '🐕', '🐈', '🛁', '🛏️', '🧽', '🚗',
  '💊', '💌', '📦', '💰', '🍳', '📚', '🏃', '🧴', '🔧', '✨',
];

const DEFAULT_AVATARS = [
  '🐻', '🐰', '🐱', '🐶', '🦊', '🐼', '🐧', '🦉', '🌸', '⭐', '🌙', '🍀',
];

const DEFAULT_QUICK_ADD = [
  'Milk', 'Eggs', 'Bread', 'Coffee', 'Bananas', 'Chicken', 'Pasta', 'Cheese',
  'Butter', 'Rice', 'Onions', 'Paper towels', 'Toilet paper', 'Dish soap',
  'Cat food', 'Snacks',
];

const DEFAULT_MODULES = [
  { id: 'tasks', label: 'Week', icon: '📋', enabled: true },
  { id: 'shopping', label: 'Shopping', icon: '🛒', enabled: true },
];

function defaultState() {
  const now = new Date().toISOString();
  return {
    version: SCHEMA_VERSION,
    settings: {
      title: 'Our Week',
      theme: 'sakura',
      accent: null,                // null = whatever the theme provides
      weekStartsOn: 1,
      // The shared column is a configurable pseudo-person, not a fixed label.
      shared: { name: 'Both of us', icon: '💞', color: 'shared', enabled: true },
      modules: DEFAULT_MODULES.map((m) => ({ ...m })),
      icons: DEFAULT_ICONS.slice(),
      avatars: DEFAULT_AVATARS.slice(),
      quickAdd: DEFAULT_QUICK_ADD.slice(),
      // Placeholders — rename them in Settings → People on first run.
      people: [
        { id: 'p1', name: 'Me', icon: '🐻', color: 'blue' },
        { id: 'p2', name: 'You', icon: '🐰', color: 'pink' },
      ],
    },
    templates: [
      { id: 'tpl1', title: 'Take out trash', assignee: 'p1', icon: '🗑️', days: [2], paused: false },
      { id: 'tpl2', title: 'Dishes', assignee: 'p1', icon: '🍽️', days: [1, 3, 5], paused: false },
      { id: 'tpl3', title: 'Laundry', assignee: 'p2', icon: '🧺', days: [0], paused: false },
      { id: 'tpl4', title: 'Water plants', assignee: 'p2', icon: '🪴', days: [6], paused: false },
      { id: 'tpl5', title: 'Tidy living room', assignee: 'shared', icon: '🛋️', days: [6], paused: false },
    ],
    tasks: [],
    shopping: [],
    createdAt: now,
  };
}

/** Bring an older file forward. Kept explicit so upgrades stay debuggable. */
function migrate(state) {
  if (!state || typeof state !== 'object') return defaultState();
  const base = defaultState();
  const fromVersion = state.version || 1;

  state.settings = Object.assign({}, base.settings, state.settings || {});
  const s = state.settings;

  // --- v1 -> v2 -------------------------------------------------------------
  // People keep whatever names they were given; a migration must never
  // overwrite something the user typed, even when it matches an old default.
  if (!Array.isArray(s.people) || !s.people.length) {
    s.people = base.settings.people;
  }
  s.people = s.people
    .filter((p) => p && typeof p === 'object' && p.id)
    .map((p, index) => ({
      id: String(p.id),
      name: String(p.name || `Person ${index + 1}`).slice(0, 14),
      icon: String(p.icon || '🙂').slice(0, 4),
      color: String(p.color || 'blue').slice(0, 16),
    }));
  if (!s.people.length) s.people = base.settings.people;

  // showShared was a bare boolean; it is now a configurable pseudo-person.
  if (typeof s.shared !== 'object' || s.shared === null || Array.isArray(s.shared)) {
    s.shared = { ...base.settings.shared };
  } else {
    s.shared = Object.assign({}, base.settings.shared, s.shared);
  }
  if (Object.prototype.hasOwnProperty.call(state.settings, 'showShared')) {
    if (fromVersion < 2) s.shared.enabled = Boolean(state.settings.showShared);
    delete state.settings.showShared;
  }

  // modules went from ['tasks'] to [{ id, label, icon, enabled }].
  if (!Array.isArray(s.modules) || !s.modules.length) {
    s.modules = base.settings.modules;
  } else if (typeof s.modules[0] === 'string') {
    const wanted = new Set(s.modules);
    s.modules = base.settings.modules.map((m) => ({ ...m, enabled: wanted.has(m.id) }));
  } else {
    s.modules = s.modules
      .filter((m) => m && m.id)
      .map((m) => {
        const fallback = base.settings.modules.find((d) => d.id === m.id) || {};
        return {
          id: String(m.id),
          label: String(m.label || fallback.label || m.id).slice(0, 14),
          icon: String(m.icon || fallback.icon || '📋').slice(0, 4),
          enabled: m.enabled !== false,
        };
      });
  }
  // Any module shipped by the code but absent from the file gets appended, so
  // a new module in a future version shows up instead of staying invisible.
  for (const known of base.settings.modules) {
    if (!s.modules.some((m) => m.id === known.id)) s.modules.push({ ...known });
  }
  if (!s.modules.some((m) => m.enabled)) s.modules[0].enabled = true;

  // Editable palettes.
  for (const [key, fallback] of [
    ['icons', base.settings.icons],
    ['avatars', base.settings.avatars],
    ['quickAdd', base.settings.quickAdd],
  ]) {
    if (!Array.isArray(s[key])) s[key] = fallback.slice();
    s[key] = s[key].filter((v) => typeof v === 'string' && v.trim()).slice(0, 60);
    if (!s[key].length) s[key] = fallback.slice();
  }

  if (s.accent !== null && typeof s.accent !== 'string') s.accent = null;

  state.templates = Array.isArray(state.templates) ? state.templates : [];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.shopping = Array.isArray(state.shopping) ? state.shopping : [];

  for (const tpl of state.templates) {
    if (!Array.isArray(tpl.days)) tpl.days = [];
    tpl.paused = Boolean(tpl.paused);
  }

  // Now that people can be deleted, a hand-edited or half-migrated file can
  // hold work assigned to somebody who no longer exists. Such items would be
  // invisible on the board — no column renders them — so adopt them instead.
  const validIds = new Set([...s.people.map((p) => p.id), 'shared']);
  const fallbackId = s.people[0].id;
  let adopted = 0;
  for (const item of [...state.tasks, ...state.templates]) {
    if (!validIds.has(item.assignee)) {
      item.assignee = fallbackId;
      adopted++;
    }
  }
  if (adopted) console.log(`[store] reassigned ${adopted} orphaned item(s) to ${fallbackId}`);

  state.version = SCHEMA_VERSION;
  return state;
}

module.exports = {
  Store,
  defaultState,
  migrate,
  SCHEMA_VERSION,
  week,
  DEFAULT_ICONS,
  DEFAULT_AVATARS,
  DEFAULT_QUICK_ADD,
  DEFAULT_MODULES,
};
