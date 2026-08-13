'use strict';

/* Zero-dependency test runner. `npm test`.
   Covers the week maths, template expansion, the API mutations and a live
   HTTP round-trip against a real server on a throwaway data file. */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const week = require('../server/week');
const api = require('../server/api');
const { Store, defaultState, migrate } = require('../server/store');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { passed++; console.log(`  ok  ${name}`); },
        (err) => { failed++; failures.push([name, err]); console.log(`  FAIL ${name}`); }
      );
    }
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    failures.push([name, err]);
    console.log(`  FAIL ${name}`);
  }
  return Promise.resolve();
}

function group(name) {
  console.log(`\n${name}`);
}

function freshState() {
  const state = defaultState();
  state.templates = [];
  return state;
}

// ---------------------------------------------------------------- week maths

async function weekTests() {
  group('week maths');

  await test('startOfWeek snaps to Monday when weekStartsOn=1', () => {
    // 2026-08-06 is a Thursday.
    assert.strictEqual(week.weekKey(new Date(2026, 7, 6), 1), '2026-08-03');
    assert.strictEqual(week.weekKey(new Date(2026, 7, 3), 1), '2026-08-03');
    assert.strictEqual(week.weekKey(new Date(2026, 7, 9), 1), '2026-08-03');
    assert.strictEqual(week.weekKey(new Date(2026, 7, 10), 1), '2026-08-10');
  });

  await test('startOfWeek snaps to Sunday when weekStartsOn=0', () => {
    assert.strictEqual(week.weekKey(new Date(2026, 7, 6), 0), '2026-08-02');
    assert.strictEqual(week.weekKey(new Date(2026, 7, 9), 0), '2026-08-09');
  });

  await test('week keys survive a year boundary', () => {
    // 2026-12-31 is a Thursday; its Monday is 2026-12-28.
    assert.strictEqual(week.weekKey(new Date(2026, 11, 31), 1), '2026-12-28');
    // 2027-01-01 is a Friday, same week.
    assert.strictEqual(week.weekKey(new Date(2027, 0, 1), 1), '2026-12-28');
  });

  await test('shiftWeek crosses months and years', () => {
    assert.strictEqual(week.shiftWeek('2026-08-03', 1), '2026-08-10');
    assert.strictEqual(week.shiftWeek('2026-08-03', -1), '2026-07-27');
    assert.strictEqual(week.shiftWeek('2026-12-28', 1), '2027-01-04');
  });

  await test('weekDays returns 7 consecutive days with real day-of-week values', () => {
    const days = week.weekDays('2026-08-03');
    assert.strictEqual(days.length, 7);
    assert.strictEqual(days[0].dow, 1);          // Monday
    assert.strictEqual(days[6].dow, 0);          // Sunday
    assert.strictEqual(days[6].date, '2026-08-09');
  });

  await test('week keys are DST-safe (no UTC drift across a spring-forward)', () => {
    // US DST starts 2026-03-08. A naive UTC/86400000 implementation slips a day.
    assert.strictEqual(week.weekKey(new Date(2026, 2, 9), 1), '2026-03-09');
    assert.strictEqual(week.weekKey(new Date(2026, 2, 15), 1), '2026-03-09');
    const days = week.weekDays('2026-03-09');
    assert.strictEqual(days[6].date, '2026-03-15');
  });
}

// ----------------------------------------------------------------- templates

async function templateTests() {
  group('recurring chores');

  await test('templates expand into one task per scheduled day', () => {
    const state = freshState();
    state.templates = [
      { id: 'a', title: 'Dishes', assignee: 'p1', icon: '🍽️', days: [1, 3, 5], paused: false },
    ];
    const added = week.materialiseWeek(state, '2026-08-03');
    assert.strictEqual(added.length, 3);
    assert.deepStrictEqual(added.map((t) => t.dow).sort(), [1, 3, 5]);
    assert.ok(added.every((t) => t.weekKey === '2026-08-03'));
    assert.ok(added.every((t) => t.source === 'template'));
  });

  await test('re-opening a week never duplicates chores', () => {
    const state = freshState();
    state.templates = [{ id: 'a', title: 'Dishes', assignee: 'p1', days: [1, 3], paused: false }];
    week.materialiseWeek(state, '2026-08-03');
    week.materialiseWeek(state, '2026-08-03');
    week.materialiseWeek(state, '2026-08-03');
    assert.strictEqual(state.tasks.length, 2);
  });

  await test('ticked-off chores survive re-materialisation', () => {
    const state = freshState();
    state.templates = [{ id: 'a', title: 'Dishes', assignee: 'p1', days: [1], paused: false }];
    week.materialiseWeek(state, '2026-08-03');
    state.tasks[0].done = true;
    week.materialiseWeek(state, '2026-08-03');
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].done, true);
  });

  await test('paused chores generate nothing', () => {
    const state = freshState();
    state.templates = [{ id: 'a', title: 'Dishes', assignee: 'p1', days: [1, 2], paused: true }];
    const added = week.materialiseWeek(state, '2026-08-03');
    assert.strictEqual(added.length, 0);
  });

  await test('each week gets its own copy of a chore', () => {
    const state = freshState();
    state.templates = [{ id: 'a', title: 'Dishes', assignee: 'p1', days: [1], paused: false }];
    week.materialiseWeek(state, '2026-08-03');
    week.materialiseWeek(state, '2026-08-10');
    assert.strictEqual(state.tasks.length, 2);
    assert.strictEqual(state.tasks.filter((t) => t.weekKey === '2026-08-10').length, 1);
  });

  await test('pruning drops ancient weeks but keeps recent ones', () => {
    const state = freshState();
    state.tasks = [
      { id: '1', weekKey: '2020-01-06', done: true },
      { id: '2', weekKey: week.weekKey(new Date(), 1), done: false },
    ];
    const removed = week.pruneOldWeeks(state, 12, new Date());
    assert.strictEqual(removed, 1);
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].id, '2');
  });
}

// ----------------------------------------------------------------- api layer

async function apiTests() {
  group('api mutations');

  await test('addTask validates and stores', () => {
    const state = freshState();
    const task = api.addTask(state, { title: '  Sweep   the   floor ', assignee: 'p1', dow: 2 });
    assert.strictEqual(task.title, 'Sweep the floor');   // whitespace collapsed
    assert.strictEqual(task.assignee, 'p1');
    assert.strictEqual(task.done, false);
    assert.strictEqual(state.tasks.length, 1);
  });

  await test('addTask rejects an empty title', () => {
    const state = freshState();
    assert.throws(() => api.addTask(state, { title: '   ', assignee: 'p1' }), /Title is required/);
  });

  await test('addTask rejects an unknown assignee', () => {
    const state = freshState();
    assert.throws(() => api.addTask(state, { title: 'x', assignee: 'nobody' }), /Unknown assignee/);
  });

  await test('addTask accepts the shared pseudo-person', () => {
    const state = freshState();
    const task = api.addTask(state, { title: 'Bills', assignee: 'shared' });
    assert.strictEqual(task.assignee, 'shared');
  });

  await test('addTask rejects an out-of-range day', () => {
    const state = freshState();
    assert.throws(() => api.addTask(state, { title: 'x', assignee: 'p1', dow: 9 }), /Invalid day/);
  });

  await test('toggling done stamps and clears doneAt', () => {
    const state = freshState();
    const task = api.addTask(state, { title: 'x', assignee: 'p1' });
    api.updateTask(state, task.id, { done: true });
    assert.ok(task.doneAt);
    api.updateTask(state, task.id, { done: false });
    assert.strictEqual(task.doneAt, null);
  });

  await test('resetWeek unticks only the requested week', () => {
    const state = freshState();
    const a = api.addTask(state, { title: 'a', assignee: 'p1', weekKey: '2026-08-03' });
    const b = api.addTask(state, { title: 'b', assignee: 'p1', weekKey: '2026-08-10' });
    api.updateTask(state, a.id, { done: true });
    api.updateTask(state, b.id, { done: true });

    const result = api.resetWeek(state, '2026-08-03');
    assert.strictEqual(result.reset, 1);
    assert.strictEqual(a.done, false);
    assert.strictEqual(b.done, true);
  });

  await test('editing a chore rewrites this week\'s undone copies', () => {
    const state = freshState();
    const tpl = api.addTemplate(state, { title: 'Bins', assignee: 'p1', days: [0, 1, 2, 3, 4, 5, 6] });
    const key = week.weekKey(new Date(), 1);
    week.materialiseWeek(state, key);

    api.updateTemplate(state, tpl.id, { title: 'Recycling', assignee: 'p2' });
    const generated = state.tasks.filter((t) => t.templateId === tpl.id);
    assert.ok(generated.length > 0);
    assert.ok(generated.every((t) => t.title === 'Recycling' && t.assignee === 'p2'));
  });

  await test('deleting a chore removes its undone copies but keeps done ones', () => {
    const state = freshState();
    const tpl = api.addTemplate(state, { title: 'Bins', assignee: 'p1', days: [0, 1, 2, 3, 4, 5, 6] });
    const key = week.weekKey(new Date(), 1);
    week.materialiseWeek(state, key);
    const generated = state.tasks.filter((t) => t.templateId === tpl.id);
    api.updateTask(state, generated[0].id, { done: true });

    api.deleteTemplate(state, tpl.id);
    const left = state.tasks.filter((t) => t.templateId === tpl.id);
    assert.strictEqual(left.length, 1);
    assert.strictEqual(left[0].done, true);
  });

  await test('a chore with no days is rejected', () => {
    const state = freshState();
    assert.throws(() => api.addTemplate(state, { title: 'x', assignee: 'p1', days: [] }), /at least one day/);
  });

  await test('adding a duplicate shopping item bumps the quantity', () => {
    const state = freshState();
    api.addShopping(state, { title: 'Milk' });
    const again = api.addShopping(state, { title: '  milk ' });   // case/space insensitive
    assert.strictEqual(state.shopping.length, 1);
    assert.strictEqual(again.qty, 2);
  });

  await test('a ticked item does not absorb a new one of the same name', () => {
    const state = freshState();
    const first = api.addShopping(state, { title: 'Milk' });
    api.updateShopping(state, first.id, { checked: true });
    api.addShopping(state, { title: 'Milk' });
    assert.strictEqual(state.shopping.length, 2);
  });

  await test('clearing the cart removes only ticked items', () => {
    const state = freshState();
    const a = api.addShopping(state, { title: 'Milk' });
    api.addShopping(state, { title: 'Eggs' });
    api.updateShopping(state, a.id, { checked: true });
    const result = api.clearCheckedShopping(state);
    assert.strictEqual(result.removed, 1);
    assert.strictEqual(state.shopping.length, 1);
    assert.strictEqual(state.shopping[0].title, 'Eggs');
  });

  await test('settings reject an unknown theme', () => {
    const state = freshState();
    assert.throws(() => api.updateSettings(state, { theme: 'neon' }), /Unknown theme/);
    api.updateSettings(state, { theme: 'night' });
    assert.strictEqual(state.settings.theme, 'night');
  });

  await test('week start only accepts Sunday or Monday', () => {
    const state = freshState();
    assert.throws(() => api.updateSettings(state, { weekStartsOn: 3 }), /Sunday or Monday/);
  });

  await test('renaming a person keeps their id', () => {
    const state = freshState();
    const person = api.updatePerson(state, 'p1', { name: 'Robin', icon: '🐻', color: 'blue' });
    assert.strictEqual(person.id, 'p1');
    assert.strictEqual(person.name, 'Robin');
  });

  await test('people can be added, renamed, reordered and removed', () => {
    const state = freshState();
    const added = api.addPerson(state, { name: '  Casey  ', icon: '🦊' });
    assert.strictEqual(added.name, 'Casey');
    assert.strictEqual(state.settings.people.length, 3);
    // A new person gets a colour nobody is already using.
    assert.ok(!['blue', 'pink'].includes(added.color));

    api.reorderPeople(state, { order: [added.id, 'p2', 'p1'] });
    assert.deepStrictEqual(state.settings.people.map((p) => p.id), [added.id, 'p2', 'p1']);

    api.deletePerson(state, added.id, {});
    assert.strictEqual(state.settings.people.length, 2);
  });

  await test('adding a person requires a name and respects the column cap', () => {
    const state = freshState();
    assert.throws(() => api.addPerson(state, { name: '   ' }), /Name is required/);
    for (let i = state.settings.people.length; i < api.MAX_PEOPLE; i++) {
      api.addPerson(state, { name: `P${i}` });
    }
    assert.throws(() => api.addPerson(state, { name: 'One too many' }), /at most/);
  });

  await test('removing a person can hand their work to somebody else', () => {
    const state = freshState();
    api.addTask(state, { title: 'Hers', assignee: 'p2' });
    api.addTemplate(state, { title: 'Weekly hers', assignee: 'p2', days: [1] });

    const result = api.deletePerson(state, 'p2', { reassignTo: 'p1' });
    assert.strictEqual(result.moved, 2);
    assert.strictEqual(state.tasks[0].assignee, 'p1');
    assert.strictEqual(state.templates[0].assignee, 'p1');
    assert.strictEqual(state.settings.people.length, 1);
  });

  await test('removing a person without a target deletes their work', () => {
    const state = freshState();
    api.addTask(state, { title: 'Hers', assignee: 'p2' });
    api.addTask(state, { title: 'His', assignee: 'p1' });

    const result = api.deletePerson(state, 'p2', {});
    assert.strictEqual(result.removed, 1);
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].assignee, 'p1');
  });

  await test('a bad reassign target fails before anything is mutated', () => {
    const state = freshState();
    api.addTask(state, { title: 'Hers', assignee: 'p2' });
    assert.throws(() => api.deletePerson(state, 'p2', { reassignTo: 'ghost' }), /Unknown person/);
    // The person and their task both survive the failed call.
    assert.strictEqual(state.settings.people.length, 2);
    assert.strictEqual(state.tasks[0].assignee, 'p2');
  });

  await test('the last person cannot be removed', () => {
    const state = freshState();
    api.deletePerson(state, 'p2', {});
    assert.throws(() => api.deletePerson(state, 'p1', {}), /at least one person/);
  });

  await test('the shared column is renameable and hideable', () => {
    const state = freshState();
    api.updateSettings(state, { shared: { name: 'Together', icon: '🤝', enabled: false } });
    assert.strictEqual(state.settings.shared.name, 'Together');
    assert.strictEqual(state.settings.shared.enabled, false);
    // Hiding it must not invalidate work already assigned to it.
    const task = api.addTask(state, { title: 'Bills', assignee: 'shared' });
    assert.strictEqual(task.assignee, 'shared');
  });

  await test('tabs can be renamed, reordered and hidden — but not all hidden', () => {
    const state = freshState();
    api.updateSettings(state, {
      modules: [
        { id: 'shopping', label: 'Groceries', icon: '🥕', enabled: true },
        { id: 'tasks', label: 'Chores', icon: '🧹', enabled: true },
      ],
    });
    assert.deepStrictEqual(state.settings.modules.map((m) => m.id), ['shopping', 'tasks']);
    assert.strictEqual(state.settings.modules[0].label, 'Groceries');

    assert.throws(() => api.updateSettings(state, {
      modules: state.settings.modules.map((m) => ({ ...m, enabled: false })),
    }), /least one tab/i);
  });

  await test('unknown modules cannot be invented through the settings API', () => {
    const state = freshState();
    api.updateSettings(state, { modules: [{ id: 'crypto-ticker', label: 'Nope', enabled: true }] });
    assert.ok(state.settings.modules.every((m) => m.id !== 'crypto-ticker'));
    // The real modules are still there rather than having been dropped.
    assert.ok(state.settings.modules.some((m) => m.id === 'tasks'));
  });

  await test('palettes are editable, de-duplicated and never left empty', () => {
    const state = freshState();
    api.updateSettings(state, { icons: ['🐙', '🐙', '  ', '🦑'] });
    assert.deepStrictEqual(state.settings.icons, ['🐙', '🦑']);
    assert.throws(() => api.updateSettings(state, { icons: [] }), /cannot be empty/);

    api.updateSettings(state, { quickAdd: ['Oat milk', 'oat milk', 'Tofu'] });
    assert.deepStrictEqual(state.settings.quickAdd, ['Oat milk', 'Tofu']);
  });

  await test('a palette can be reset to the shipped defaults', () => {
    const state = freshState();
    api.updateSettings(state, { icons: ['🐙'] });
    api.resetPalette(state, 'icons');
    assert.ok(state.settings.icons.length > 5);
    assert.throws(() => api.resetPalette(state, 'nonsense'), /Unknown palette/);
  });

  await test('accent colour is optional and validated', () => {
    const state = freshState();
    api.updateSettings(state, { accent: 'lilac' });
    assert.strictEqual(state.settings.accent, 'lilac');
    api.updateSettings(state, { accent: null });
    assert.strictEqual(state.settings.accent, null);
    assert.throws(() => api.updateSettings(state, { accent: 'chartreuse' }), /Unknown accent/);
  });

  await test('resetAll can keep the people you set up', () => {
    const state = freshState();
    api.updatePerson(state, 'p1', { name: 'Robin' });
    api.updatePerson(state, 'p2', { name: 'Sam' });
    api.addTask(state, { title: 'Gone after reset', assignee: 'p1' });
    api.addShopping(state, { title: 'Also gone' });

    api.resetAll(state, { keepPeople: true });
    assert.deepStrictEqual(state.settings.people.map((p) => p.name), ['Robin', 'Sam']);
    assert.strictEqual(state.tasks.length, 0);
    assert.strictEqual(state.shopping.length, 0);
  });

  await test('resetAll keeping chores never leaves them orphaned', () => {
    const state = freshState();
    const extra = api.addPerson(state, { name: 'Guest' });
    api.addTemplate(state, { title: 'Guest chore', assignee: extra.id, days: [1] });

    // Not keeping people wipes the guest, so their chore must be adopted.
    api.resetAll(state, { keepPeople: false, keepChores: true });
    const valid = new Set([...state.settings.people.map((p) => p.id), 'shared']);
    assert.ok(state.templates.every((t) => valid.has(t.assignee)));
  });

  await test('missing ids produce 404-shaped errors', () => {
    const state = freshState();
    assert.throws(() => api.updateTask(state, 'nope', { done: true }), (err) => err.status === 404);
    assert.throws(() => api.deleteShopping(state, 'nope'), (err) => err.status === 404);
  });

  await test('getBoard materialises and returns only that week', () => {
    const state = freshState();
    api.addTemplate(state, { title: 'Dishes', assignee: 'p1', days: [1] });
    api.addTask(state, { title: 'Other week', assignee: 'p1', weekKey: '2020-01-06' });

    const { board, changed } = api.getBoard(state, '2026-08-03');
    assert.strictEqual(changed, true);
    assert.strictEqual(board.weekKey, '2026-08-03');
    assert.ok(board.tasks.every((t) => t.weekKey === '2026-08-03'));
    assert.strictEqual(board.days.length, 7);

    const second = api.getBoard(state, '2026-08-03');
    assert.strictEqual(second.changed, false);   // idempotent
  });

  await test('getBoard rejects a malformed week key', () => {
    const state = freshState();
    assert.throws(() => api.getBoard(state, 'last-tuesday'), /Invalid week/);
  });
}

// --------------------------------------------------------------------- store

async function storeTests() {
  group('storage');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-'));

  await test('a missing file yields sensible defaults', () => {
    const store = new Store(path.join(dir, 'a.json'));
    const state = store.load();
    assert.strictEqual(state.settings.people.length, 2);
    assert.ok(state.templates.length > 0);
  });

  await test('state survives a save/load round trip', async () => {
    const file = path.join(dir, 'b.json');
    const store = new Store(file);
    store.load();
    api.addTask(store.state, { title: 'Persisted', assignee: 'p1' });
    await store.flush();

    const reopened = new Store(file);
    const state = reopened.load();
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].title, 'Persisted');
  });

  await test('a corrupt file is quarantined instead of crashing', () => {
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, '{ this is not json');
    const store = new Store(file);
    const state = store.load();
    assert.ok(state.settings);                                  // recovered
    assert.ok(fs.readdirSync(dir).some((f) => f.includes('corrupt')));
  });

  await test('migration backfills fields missing from an older file', () => {
    const file = path.join(dir, 'd.json');
    fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: 'x' }] }));
    const store = new Store(file);
    const state = store.load();
    assert.ok(Array.isArray(state.settings.people));
    assert.ok(Array.isArray(state.shopping));
    assert.strictEqual(state.tasks.length, 1);
  });

  group('migration from v1');

  /** A realistic v1 file, as written by the previous version of the app. */
  function v1File(overrides = {}) {
    return Object.assign({
      version: 1,
      settings: {
        title: 'Our Week',
        theme: 'mint',
        weekStartsOn: 1,
        showShared: true,
        modules: ['tasks', 'shopping'],
        // Deliberately not the shipped defaults, so "names are preserved"
        // is a real assertion rather than one that passes either way.
        people: [
          { id: 'p1', name: 'Robin', icon: '🦊', color: 'peach' },
          { id: 'p2', name: 'Sam', icon: '🐼', color: 'lilac' },
        ],
      },
      templates: [{ id: 't1', title: 'Dishes', assignee: 'p1', days: [1], paused: false }],
      tasks: [{ id: 'k1', title: 'Old task', assignee: 'p2', weekKey: '2026-08-03', done: true }],
      shopping: [{ id: 's1', title: 'Milk', checked: false }],
    }, overrides);
  }

  await test('v1 people are preserved, not overwritten by the defaults', () => {
    // A migration must never clobber something the user typed, so names,
    // avatars and colours all have to survive untouched.
    const state = migrate(v1File());
    assert.deepStrictEqual(state.settings.people.map((p) => p.name), ['Robin', 'Sam']);
    assert.deepStrictEqual(state.settings.people.map((p) => p.icon), ['🦊', '🐼']);
    assert.deepStrictEqual(state.settings.people.map((p) => p.color), ['peach', 'lilac']);
  });

  await test('v1 user data survives the upgrade intact', () => {
    const state = migrate(v1File());
    assert.strictEqual(state.settings.theme, 'mint');
    assert.strictEqual(state.tasks.length, 1);
    assert.strictEqual(state.tasks[0].done, true);
    assert.strictEqual(state.templates.length, 1);
    assert.strictEqual(state.shopping.length, 1);
  });

  await test('showShared becomes the shared pseudo-person', () => {
    const shown = migrate(v1File());
    assert.strictEqual(shown.settings.shared.enabled, true);
    assert.strictEqual(shown.settings.shared.name, 'Both of us');
    assert.ok(!('showShared' in shown.settings));

    const raw = v1File();
    raw.settings.showShared = false;
    const hidden = migrate(raw);
    assert.strictEqual(hidden.settings.shared.enabled, false);
  });

  await test('the v1 module string list becomes configurable objects', () => {
    const raw = v1File();
    raw.settings.modules = ['tasks'];        // shopping had been switched off
    const state = migrate(raw);
    const tasks = state.settings.modules.find((m) => m.id === 'tasks');
    const shopping = state.settings.modules.find((m) => m.id === 'shopping');
    assert.strictEqual(tasks.enabled, true);
    assert.strictEqual(shopping.enabled, false);   // preference carried over
    assert.strictEqual(typeof tasks.label, 'string');
    assert.strictEqual(typeof tasks.icon, 'string');
  });

  await test('v1 files gain the new editable palettes', () => {
    const state = migrate(v1File());
    assert.ok(state.settings.icons.length > 5);
    assert.ok(state.settings.avatars.length > 5);
    assert.ok(state.settings.quickAdd.length > 5);
    assert.strictEqual(state.settings.accent, null);
    assert.strictEqual(state.version, 2);
  });

  await test('migrating twice changes nothing the second time', () => {
    const once = migrate(v1File());
    const snapshot = JSON.stringify(once);
    const twice = migrate(JSON.parse(snapshot));
    assert.strictEqual(JSON.stringify(twice), snapshot);
  });

  await test('work assigned to a person who no longer exists is adopted', () => {
    const raw = v1File();
    raw.tasks.push({ id: 'k2', title: 'Ghost task', assignee: 'deleted-person', weekKey: '2026-08-03' });
    raw.templates.push({ id: 't2', title: 'Ghost chore', assignee: 'deleted-person', days: [2] });

    const state = migrate(raw);
    const valid = new Set([...state.settings.people.map((p) => p.id), 'shared']);
    // Nothing is dropped, and nothing is left invisible.
    assert.strictEqual(state.tasks.length, 2);
    assert.ok(state.tasks.every((t) => valid.has(t.assignee)));
    assert.ok(state.templates.every((t) => valid.has(t.assignee)));
  });

  await test('a file with no people at all is repaired rather than rejected', () => {
    const raw = v1File();
    raw.settings.people = [];
    const state = migrate(raw);
    assert.ok(state.settings.people.length >= 1);
    const valid = new Set([...state.settings.people.map((p) => p.id), 'shared']);
    assert.ok(state.tasks.every((t) => valid.has(t.assignee)));
  });
}

// ---------------------------------------------------------------- http layer

async function httpTests() {
  group('http server');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-http-'));
  const dataFile = path.join(dir, 'board.json');
  const port = 8137;
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, TASKBOARD_PORT: String(port), TASKBOARD_DATA: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = await waitForServer(base, child);
  if (!ready) {
    failed++;
    failures.push(['server startup', new Error('server did not start')]);
    console.log('  FAIL server startup');
    child.kill();
    return;
  }

  try {
    await test('GET / serves the app shell', async () => {
      const res = await fetch(`${base}/`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('<div id="app"'));
    });

    await test('static assets are served with the right content type', async () => {
      const res = await fetch(`${base}/js/app.js`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('javascript'));
    });

    await test('path traversal is refused', async () => {
      const res = await fetch(`${base}/../server/index.js`);
      assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
    });

    await test('GET /api/board returns the current week', async () => {
      const board = await (await fetch(`${base}/api/board`)).json();
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(board.weekKey));
      assert.strictEqual(board.isCurrentWeek, true);
      assert.ok(board.tasks.length > 0, 'seed chores should have been generated');
    });

    await test('a task can be created, ticked and deleted over HTTP', async () => {
      const created = await postJson(`${base}/api/tasks`, { title: 'HTTP task', assignee: 'p1', dow: 3 });
      assert.strictEqual(created.title, 'HTTP task');

      const ticked = await postJson(`${base}/api/tasks/${created.id}`, { done: true }, 'PATCH');
      assert.strictEqual(ticked.done, true);

      const board = await (await fetch(`${base}/api/board`)).json();
      assert.ok(board.tasks.some((t) => t.id === created.id && t.done));

      const res = await fetch(`${base}/api/tasks/${created.id}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 200);
    });

    await test('validation errors come back as 400 with a message', async () => {
      const res = await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', assignee: 'p1' }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /Title is required/);
    });

    await test('malformed JSON is rejected cleanly', async () => {
      const res = await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ nope',
      });
      assert.strictEqual(res.status, 400);
    });

    await test('unknown endpoints 404', async () => {
      const res = await fetch(`${base}/api/nonsense`);
      assert.strictEqual(res.status, 404);
    });

    await test('emoji survive a request split across chunk boundaries', async () => {
      // Every icon is an emoji, so a body reader that decodes per-chunk would
      // corrupt them whenever a 4-byte character straddles the split.
      const payload = JSON.stringify({ title: 'Feed the cat', assignee: 'p1', icon: '🐈' });
      const bytes = Buffer.from(payload, 'utf8');
      const emojiStart = bytes.indexOf(Buffer.from('🐈', 'utf8'));
      assert.ok(emojiStart > 0);

      const stream = new ReadableStream({
        start(controller) {
          // Cut the stream in the middle of the 4-byte emoji.
          controller.enqueue(bytes.subarray(0, emojiStart + 2));
          controller.enqueue(bytes.subarray(emojiStart + 2));
          controller.close();
        },
      });

      const res = await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      });
      assert.strictEqual(res.status, 200);
      const task = await res.json();
      assert.strictEqual(task.icon, '🐈');
      assert.strictEqual(task.title, 'Feed the cat');
    });

    await test('changes are written to disk', async () => {
      await postJson(`${base}/api/shopping`, { title: 'Persisted milk' });
      await new Promise((r) => setTimeout(r, 600));      // debounce window
      const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      assert.ok(saved.shopping.some((i) => i.title === 'Persisted milk'));
    });
  } finally {
    child.kill();
  }
}

async function waitForServer(base, child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${base}/api/board`);
      if (res.ok) return true;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function postJson(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload;
}

// ---------------------------------------------------------------------- main

(async function main() {
  console.log('task-board test suite\n=====================');
  await weekTests();
  await templateTests();
  await apiTests();
  await storeTests();
  await httpTests();

  console.log(`\n${'='.repeat(21)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const [name, err] of failures) {
      console.log(`\n  ${name}\n    ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
