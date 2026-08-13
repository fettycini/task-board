/* App shell: module registry, tab bar, week navigation, progress dial and the
   day/midnight rollover that keeps an always-on display honest. */
(function () {
  'use strict';

  const { el, clear, toast, weekRangeLabel } = TB.ui;

  /* The registry is the "modular" part: to add a module later, write
     js/modules/<name>.js exposing { mount, render }, add a <section
     id="view-<name>"> to index.html, and add an entry here.

     This holds only what the *code* provides. The label, icon, whether a tab
     is shown and what order the tabs sit in all come from settings, so they
     are editable from the touchscreen. Settings itself is deliberately not
     configurable — switching off the way back into Settings would strand you. */
  const MODULES = [
    { id: 'tasks',    module: () => TB.modules.tasks,    addAction: () => TB.modules.tasks.addTask() },
    { id: 'shopping', module: () => TB.modules.shopping, addAction: () => TB.modules.shopping.addItem() },
  ];

  const SETTINGS_TAB = {
    id: 'settings', label: 'Settings', icon: '⚙️',
    module: () => TB.modules.settings, addAction: null,
  };

  /** Merge the code registry with the user's configuration, in their order. */
  function configuredTabs() {
    const settings = state.board && state.board.settings;
    const configs = settings ? settings.modules : [];
    const tabs = [];

    for (const config of configs) {
      const entry = MODULES.find((m) => m.id === config.id);
      if (!entry || !config.enabled) continue;
      tabs.push({ ...entry, label: config.label, icon: config.icon });
    }
    // Before the first load, or if a config somehow excludes everything,
    // fall back to the code registry so the board is never a blank slab.
    if (!tabs.length) {
      for (const entry of MODULES) tabs.push({ ...entry, label: entry.id, icon: '📋' });
    }
    tabs.push(SETTINGS_TAB);
    return tabs;
  }

  /** Every view that exists in the DOM, configured or not. */
  function allTabs() {
    return [...MODULES, SETTINGS_TAB];
  }

  const state = {
    weekKey: null,
    activeTab: 'tasks',
    board: null,
    today: null,
    loading: false,
  };

  const ctx = {
    get board() { return state.board; },
    set board(value) { state.board = value; },
    refresh: () => load(state.weekKey),
    refreshProgress: () => paintProgress(),
    refreshBadges: () => paintTabs(),
  };

  // -------------------------------------------------------------------- boot

  function init() {
    for (const entry of allTabs()) {
      entry.module().mount(document.getElementById(`view-${entry.id}`), ctx);
    }

    document.getElementById('prevWeek').addEventListener('click', () => step(-1));
    document.getElementById('nextWeek').addEventListener('click', () => step(1));

    // Tapping the title jumps back to the current week — a one-tap way out of
    // having browsed three weeks ahead and forgotten.
    document.getElementById('boardTitle').addEventListener('click', () => {
      if (state.board && !state.board.isCurrentWeek) {
        state.weekKey = null;
        load(null);
        toast('Back to this week');
      }
    });

    // The tab lives in the hash, so a reload (or a kiosk configured to open
    // #shopping) lands where you expect.
    const fromHash = location.hash.replace(/^#\/?/, '');
    if (allTabs().some((m) => m.id === fromHash)) state.activeTab = fromHash;
    window.addEventListener('hashchange', () => {
      const id = location.hash.replace(/^#\/?/, '');
      if (id && id !== state.activeTab && allTabs().some((m) => m.id === id)) switchTo(id);
    });

    for (const entry of allTabs()) {
      document.getElementById(`view-${entry.id}`).hidden = entry.id !== state.activeTab;
    }

    paintTabs();
    load(null);
    startClock();

    // Chromium in kiosk mode may be restored from a suspended tab; refresh
    // whenever the page becomes visible again so the board is never stale.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) load(state.weekKey);
    });
  }

  // -------------------------------------------------------------------- data

  async function load(weekKey) {
    if (state.loading) return;
    state.loading = true;
    try {
      const board = await TB.api.getBoard(weekKey);
      state.board = board;
      state.weekKey = board.weekKey;
      state.today = board.today;

      const root = document.documentElement;
      root.setAttribute('data-theme', board.settings.theme);
      if (board.settings.accent) root.setAttribute('data-accent', board.settings.accent);
      else root.removeAttribute('data-accent');
      document.getElementById('boardTitle').textContent = board.settings.title;

      // A tab can be switched off from Settings while you are standing on it.
      if (!configuredTabs().some((t) => t.id === state.activeTab)) {
        switchTo('tasks');
        state.loading = false;
        return;
      }

      paintWeekLabel();
      paintProgress();
      paintTabs();
      renderActive();
    } catch (err) {
      toast(err.message);
      // The server may still be starting up at boot; keep trying quietly.
      setTimeout(() => { state.loading = false; load(weekKey); }, 3000);
      return;
    }
    state.loading = false;
  }

  function step(delta) {
    const start = TB.ui.parseISO(state.weekKey);
    start.setDate(start.getDate() + delta * 7);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    state.weekKey = key;
    load(key);
  }

  // ------------------------------------------------------------------ paints

  function paintWeekLabel() {
    const node = document.getElementById('weekLabel');
    clear(node);
    if (state.board.isCurrentWeek) {
      node.append(el('span.this-week', { text: 'This week' }), ` · ${weekRangeLabel(state.weekKey)}`);
    } else {
      node.append(weekRangeLabel(state.weekKey));
    }
  }

  function paintProgress() {
    const board = state.board;
    if (!board) return;
    const total = board.tasks.length;
    const done = board.tasks.filter((t) => t.done).length;
    const ratio = total ? done / total : 0;
    const CIRCUMFERENCE = 97.4;

    document.getElementById('progressFill').style.strokeDashoffset =
      String(CIRCUMFERENCE * (1 - ratio));
    document.getElementById('progressText').textContent = `${done}/${total}`;
    document.getElementById('progress').classList.toggle('complete', total > 0 && done === total);
  }

  function paintTabs() {
    const bar = clear(document.getElementById('tabbar'));
    const tabs = configuredTabs();

    for (const entry of tabs) {
      const badge = badgeFor(entry.id);
      bar.append(el('button.tab.press', {
        type: 'button',
        role: 'tab',
        'aria-selected': state.activeTab === entry.id ? 'true' : 'false',
        onclick: () => switchTo(entry.id),
      }, [
        el('span.tab-icon', { text: entry.icon }),
        el('span', { text: entry.label }),
        badge ? el('span.tab-badge', { text: String(badge) }) : null,
      ]));
    }

    const active = tabs.find((m) => m.id === state.activeTab);
    if (active && active.addAction) {
      bar.append(el('button.tab-add.press', {
        type: 'button',
        'aria-label': 'Add',
        onclick: () => active.addAction(),
      }, '+'));
    }
  }

  function badgeFor(id) {
    if (!state.board) return 0;
    if (id === 'tasks') return state.board.tasks.filter((t) => !t.done).length;
    if (id === 'shopping') return state.board.shopping.filter((i) => !i.checked).length;
    return 0;
  }

  function switchTo(id) {
    state.activeTab = id;
    if (location.hash.replace(/^#\/?/, '') !== id) location.hash = `#${id}`;
    for (const entry of allTabs()) {
      document.getElementById(`view-${entry.id}`).hidden = entry.id !== id;
    }
    paintTabs();
    renderActive();
  }

  function renderActive() {
    if (!state.board) return;
    const entry = allTabs().find((m) => m.id === state.activeTab);
    if (entry) entry.module().render(state.board);
  }

  // ------------------------------------------------------------------- clock

  /* An always-on board must notice midnight: "Today" badges, overdue styling
     and the week rollover all depend on the date. Check once a minute — cheap,
     and it also recovers from the Pi's clock jumping after an NTP sync. */
  function startClock() {
    setInterval(() => {
      if (!state.board || TB.kb.isOpen) return;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (today !== state.today) {
        state.today = today;
        // A new day may also mean a new week; let the server decide which.
        state.weekKey = null;
        load(null);
      }
    }, 60 * 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
