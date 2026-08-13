/* Settings module.
 *
 * A hub of sections rather than one long scroll: at 480px tall, a single pane
 * holding everything means hunting. Each row opens a focused sheet.
 *
 * Everything the app renders is editable from here — who is on the board, what
 * the shared column is called, the tab labels and order, the icon and
 * quick-add palettes, colours, and the week itself.
 */
window.TB = window.TB || {};
TB.modules = TB.modules || {};

TB.modules.settings = (function () {
  'use strict';

  const { el, clear, toast, openSheet, confirm, plural, DAY_SHORT, DAY_LETTER } = TB.ui;

  const THEMES = [
    { id: 'sakura', label: 'Sakura', bg: '#ffe9ef', ink: '#59404c' },
    { id: 'mint', label: 'Mint', bg: '#e2f5ec', ink: '#38564b' },
    { id: 'lavender', label: 'Lavender', bg: '#ece5fb', ink: '#4a4160' },
    { id: 'night', label: 'Night', bg: '#262232', ink: '#ece8f5' },
  ];
  const COLORS = ['blue', 'pink', 'mint', 'peach', 'lilac', 'lemon'];

  let root = null;
  let ctx = null;

  function mount(node, context) {
    root = node;
    ctx = context;
  }

  const settings = () => ctx.board.settings;

  // --------------------------------------------------------------- the hub

  function render(board) {
    ctx.board = board;
    const s = board.settings;
    const pane = el('div.list-pane.scroll');

    const section = (icon, title, subtitle, onOpen) =>
      el('button.row.press', { type: 'button', onclick: onOpen }, [
        el('div.column-avatar', { text: icon }),
        el('div.row-main', null, [
          el('div.row-title', { text: title }),
          el('div.row-sub', { text: subtitle }),
        ]),
        el('div', { text: '›', style: 'font-size:20px;color:var(--ink-faint);padding-right:4px' }),
      ]);

    const peopleNames = s.people.map((p) => p.name).join(', ');
    const enabledTabs = s.modules.filter((m) => m.enabled).map((m) => m.label).join(', ');

    pane.append(
      el('div.section-title', { text: 'Board' }),
      el('div.rows', null, [
        section('👥', 'People', `${plural(s.people.length, 'person')} · ${peopleNames}`, editPeople),
        section(s.shared.icon || '💞', 'Shared column',
          s.shared.enabled ? `Shown as "${s.shared.name}"` : 'Hidden', editShared),
        section('🔁', 'Repeating chores',
          board.templates.length ? plural(board.templates.length, 'chore') : 'None yet', editChores),
        section('🗂️', 'Tabs', enabledTabs || 'None', editModules),
      ]),

      el('div.section-title', { text: 'Look' }),
      el('div.rows', null, [
        section('🎨', 'Theme & colour',
          `${THEMES.find((t) => t.id === s.theme)?.label || s.theme}${s.accent ? ` · ${s.accent}` : ''}`,
          editAppearance),
        section('✏️', 'Board name', s.title, editTitle),
        section('📅', 'Week starts on', s.weekStartsOn === 1 ? 'Monday' : 'Sunday', editWeekStart),
      ]),

      el('div.section-title', { text: 'Lists' }),
      el('div.rows', null, [
        section('😀', 'Icon palette', `${s.icons.length} icons`, () => editPalette('icons')),
        section('🙂', 'Avatar palette', `${s.avatars.length} avatars`, () => editPalette('avatars')),
        section('🛒', 'Quick-add items', `${s.quickAdd.length} suggestions`, editQuickAdd),
      ]),

      el('div.section-title', { text: 'Start over' }),
      el('div.rows', null, [
        el('button.btn.ghost.block.press', {
          type: 'button', text: '↺  Untick everything this week', onclick: resetWeek,
        }),
        el('button.btn.danger.block.press', {
          type: 'button', text: '⚠  Reset the whole board', onclick: resetEverything,
        }),
      ]),

      el('p', {
        text: 'Everything lives in data/board.json on the Pi. Copy that file to back the board up.',
        style: 'font-size:11px;color:var(--ink-faint);padding:6px 2px 12px;line-height:1.45',
      })
    );

    clear(root).append(pane);
  }

  async function patch(body, message) {
    try {
      await TB.api.updateSettings(body);
      if (message) toast(message);
      ctx.refresh();
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- people

  function editPeople() {
    openSheet('People', () => {
      const s = settings();
      const rows = el('div.rows');

      s.people.forEach((person, index) => {
        rows.append(el('div.row', { dataset: { color: person.color } }, [
          el('div.row-move', null, [
            el('button.press', {
              type: 'button', 'aria-label': 'Move up', disabled: index === 0,
              onclick: () => movePerson(index, -1),
            }, '▲'),
            el('button.press', {
              type: 'button', 'aria-label': 'Move down', disabled: index === s.people.length - 1,
              onclick: () => movePerson(index, 1),
            }, '▼'),
          ]),
          el('div.column-avatar', { text: person.icon }),
          el('div.row-main', null, [
            el('div.row-title', { text: person.name }),
            el('div.row-sub', { text: `${countFor(person.id)} this week` }),
          ]),
          el('button.icon-btn.small.press', {
            type: 'button', 'aria-label': `Edit ${person.name}`,
            onclick: () => editPerson(person),
          }, '✎'),
        ]));
      });

      return [
        rows,
        el('p', {
          text: 'The board fits up to six columns. Three stays comfortable to read at arm\'s length.',
          style: 'font-size:11.5px;color:var(--ink-faint);line-height:1.4',
        }),
        el('div.sheet-actions', null, [
          el('button.btn.primary.press', { type: 'button', text: '+  Add person', onclick: addPerson }),
        ]),
      ];
    });
  }

  function countFor(personId) {
    const tasks = ctx.board.tasks.filter((t) => t.assignee === personId);
    return tasks.length ? plural(tasks.length, 'task') : 'no tasks';
  }

  async function movePerson(index, delta) {
    const people = settings().people.slice();
    const target = index + delta;
    if (target < 0 || target >= people.length) return;
    [people[index], people[target]] = [people[target], people[index]];
    try {
      await TB.api.reorderPeople(people.map((p) => p.id));
      ctx.refresh();
      TB.ui.closeSheet();
      editPeople();
    } catch (err) { toast(err.message); }
  }

  async function addPerson() {
    const name = await TB.kb.prompt({ title: 'Who is joining?', placeholder: 'Their name', maxLength: 14 });
    if (name === null) return;
    const icon = await TB.emoji.pick({ title: `Pick an avatar for ${name}` });
    try {
      await TB.api.addPerson({ name, icon: icon || '🙂' });
      toast(`${name} added 🎉`);
      ctx.refresh();
      TB.ui.closeSheet();
      editPeople();
    } catch (err) { toast(err.message); }
  }

  function editPerson(person) {
    const draft = { name: person.name, icon: person.icon, color: person.color };

    openSheet(`Edit ${person.name}`, (done) => {
      const nameButton = el('button.text-input.press', {
        type: 'button', text: draft.name,
        onclick: async () => {
          const value = await TB.kb.prompt({ title: 'Name', value: draft.name, maxLength: 14 });
          if (value === null) return;
          draft.name = value;
          nameButton.textContent = value;
        },
      });

      const avatarRow = TB.ui.buildIconRow({
        icons: settings().avatars,
        value: draft.icon,
        allowNone: false,
        onChange: (icon) => { draft.icon = icon; },
      });

      const colorRow = el('div.swatches');
      const paintColors = () => {
        clear(colorRow);
        for (const color of COLORS) {
          colorRow.append(el('button.swatch.press', {
            type: 'button',
            dataset: { color },
            'aria-label': color,
            'aria-pressed': draft.color === color ? 'true' : 'false',
            onclick: () => { draft.color = color; paintColors(); },
          }));
        }
      };
      paintColors();

      const actions = el('div.sheet-actions');
      if (settings().people.length > 1) {
        actions.append(el('button.btn.danger.press', {
          type: 'button', text: 'Remove',
          onclick: () => removePerson(person, done),
        }));
      }
      actions.append(el('button.btn.primary.press', {
        type: 'button', text: 'Save',
        onclick: async () => {
          try {
            await TB.api.updatePerson(person.id, draft);
            toast('Saved');
            done(true);
            ctx.refresh();
          } catch (err) { toast(err.message); }
        },
      }));

      return [
        el('div.field', null, [el('label', { text: 'Name' }), nameButton]),
        el('div.field', null, [el('label', { text: 'Avatar' }), avatarRow]),
        el('div.field', null, [el('label', { text: 'Colour' }), colorRow]),
        actions,
      ];
    });
  }

  /**
   * Removing somebody has to decide what happens to their work. Deleting it by
   * default would quietly bin real tasks, so the choice is made explicitly.
   */
  function removePerson(person, closeParent) {
    const s = settings();
    const owned = ctx.board.tasks.filter((t) => t.assignee === person.id).length
      + ctx.board.templates.filter((t) => t.assignee === person.id).length;

    if (!owned) {
      confirmRemoval(person, null, closeParent);
      return;
    }

    openSheet(`Remove ${person.name}`, (done) => {
      const others = s.people.filter((p) => p.id !== person.id);
      const options = el('div.rows');

      for (const other of others) {
        options.append(el('button.row.press', {
          type: 'button', dataset: { color: other.color },
          onclick: () => { done(true); confirmRemoval(person, other.id, closeParent, other.name); },
        }, [
          el('div.column-avatar', { text: other.icon }),
          el('div.row-main', null, [
            el('div.row-title', { text: `Give it all to ${other.name}` }),
            el('div.row-sub', { text: `${owned} item${owned === 1 ? '' : 's'} move across` }),
          ]),
        ]));
      }

      if (s.shared.enabled) {
        options.append(el('button.row.press', {
          type: 'button',
          onclick: () => { done(true); confirmRemoval(person, 'shared', closeParent, s.shared.name); },
        }, [
          el('div.column-avatar', { text: s.shared.icon }),
          el('div.row-main', null, [
            el('div.row-title', { text: `Move to "${s.shared.name}"` }),
            el('div.row-sub', { text: 'Becomes everybody\'s job' }),
          ]),
        ]));
      }

      options.append(el('button.row.press', {
        type: 'button',
        onclick: () => { done(true); confirmRemoval(person, null, closeParent); },
      }, [
        el('div.column-avatar', { text: '🗑️' }),
        el('div.row-main', null, [
          el('div.row-title', { text: 'Delete their tasks too' }),
          el('div.row-sub', { text: `${owned} item${owned === 1 ? '' : 's'} will be lost` }),
        ]),
      ]));

      return [
        el('p', {
          text: `${person.name} has ${owned} task${owned === 1 ? '' : 's'} and chore${owned === 1 ? '' : 's'} on the board. Where should they go?`,
          style: 'font-size:13px;color:var(--ink-soft);line-height:1.45',
        }),
        options,
      ];
    });
  }

  async function confirmRemoval(person, reassignTo, closeParent, targetName) {
    const message = reassignTo
      ? `${person.name} comes off the board and their tasks go to ${targetName}.`
      : `${person.name} and everything assigned to them will be removed.`;
    const ok = await confirm(`Remove ${person.name}?`, message, 'Remove');
    if (!ok) return;

    try {
      const result = await TB.api.deletePerson(person.id, reassignTo);
      toast(result.moved ? `Moved ${plural(result.moved, 'item')}` : `${person.name} removed`);
      if (closeParent) closeParent(true);
      TB.ui.closeSheet();
      ctx.refresh();
    } catch (err) { toast(err.message); }
  }

  // -------------------------------------------------------- shared column

  function editShared() {
    const draft = { ...settings().shared };

    openSheet('Shared column', (done) => {
      const nameButton = el('button.text-input.press', {
        type: 'button', text: draft.name,
        onclick: async () => {
          const value = await TB.kb.prompt({ title: 'Column name', value: draft.name, maxLength: 14 });
          if (value === null) return;
          draft.name = value;
          nameButton.textContent = value;
        },
      });

      const toggle = el('div.seg');
      const paintToggle = () => {
        clear(toggle);
        for (const [value, label] of [[true, 'Shown'], [false, 'Hidden']]) {
          toggle.append(el('button.seg-item.press', {
            type: 'button',
            'aria-pressed': draft.enabled === value ? 'true' : 'false',
            onclick: () => { draft.enabled = value; paintToggle(); },
          }, label));
        }
      };
      paintToggle();

      return [
        el('p', {
          text: 'An extra column for jobs that belong to everybody rather than one person.',
          style: 'font-size:12px;color:var(--ink-faint);line-height:1.4',
        }),
        el('div.field', null, [el('label', { text: 'Name' }), nameButton]),
        el('div.field', null, [
          el('label', { text: 'Icon' }),
          TB.ui.buildIconRow({
            icons: settings().avatars,
            value: draft.icon,
            allowNone: false,
            onChange: (icon) => { draft.icon = icon; },
          }),
        ]),
        el('div.field', null, [el('label', { text: 'On the board' }), toggle]),
        el('div.sheet-actions', null, [
          el('button.btn.primary.press', {
            type: 'button', text: 'Save',
            onclick: async () => {
              if (await patch({ shared: draft }, 'Saved')) done(true);
            },
          }),
        ]),
      ];
    });
  }

  // ---------------------------------------------------------------- tabs

  function editModules() {
    openSheet('Tabs', () => {
      const s = settings();
      const rows = el('div.rows');

      s.modules.forEach((mod, index) => {
        rows.append(el('div.row' + (mod.enabled ? '' : '.paused'), null, [
          el('div.row-move', null, [
            el('button.press', {
              type: 'button', 'aria-label': 'Move up', disabled: index === 0,
              onclick: () => moveModule(index, -1),
            }, '▲'),
            el('button.press', {
              type: 'button', 'aria-label': 'Move down', disabled: index === s.modules.length - 1,
              onclick: () => moveModule(index, 1),
            }, '▼'),
          ]),
          el('div.column-avatar', { text: mod.icon }),
          el('div.row-main', null, [
            el('div.row-title', { text: mod.label }),
            el('div.row-sub', { text: mod.enabled ? 'Shown in the tab bar' : 'Hidden' }),
          ]),
          el('button.icon-btn.small.press', {
            type: 'button', 'aria-label': `Edit ${mod.label}`,
            onclick: () => editModule(mod),
          }, '✎'),
        ]));
      });

      return [
        el('p', {
          text: 'Rename the tabs, change their icons, reorder them, or hide the ones you do not use. Settings always stays reachable.',
          style: 'font-size:12px;color:var(--ink-faint);line-height:1.4',
        }),
        rows,
      ];
    });
  }

  async function moveModule(index, delta) {
    const mods = settings().modules.slice();
    const target = index + delta;
    if (target < 0 || target >= mods.length) return;
    [mods[index], mods[target]] = [mods[target], mods[index]];
    if (await patch({ modules: mods })) {
      TB.ui.closeSheet();
      editModules();
    }
  }

  function editModule(mod) {
    const draft = { ...mod };

    openSheet(`Edit "${mod.label}"`, (done) => {
      const labelButton = el('button.text-input.press', {
        type: 'button', text: draft.label,
        onclick: async () => {
          const value = await TB.kb.prompt({ title: 'Tab name', value: draft.label, maxLength: 14 });
          if (value === null) return;
          draft.label = value;
          labelButton.textContent = value;
        },
      });

      const toggle = el('div.seg');
      const paintToggle = () => {
        clear(toggle);
        for (const [value, label] of [[true, 'Shown'], [false, 'Hidden']]) {
          toggle.append(el('button.seg-item.press', {
            type: 'button',
            'aria-pressed': draft.enabled === value ? 'true' : 'false',
            onclick: () => { draft.enabled = value; paintToggle(); },
          }, label));
        }
      };
      paintToggle();

      return [
        el('div.field', null, [el('label', { text: 'Name' }), labelButton]),
        el('div.field', null, [
          el('label', { text: 'Icon' }),
          TB.ui.buildIconRow({
            icons: settings().icons,
            value: draft.icon,
            allowNone: false,
            onChange: (icon) => { draft.icon = icon; },
          }),
        ]),
        el('div.field', null, [el('label', { text: 'In the tab bar' }), toggle]),
        el('div.sheet-actions', null, [
          el('button.btn.primary.press', {
            type: 'button', text: 'Save',
            onclick: async () => {
              const mods = settings().modules.map((m) => (m.id === draft.id ? draft : m));
              if (await patch({ modules: mods }, 'Saved')) {
                done(true);
                TB.ui.closeSheet();
              }
            },
          }),
        ]),
      ];
    });
  }

  // ------------------------------------------------------------ appearance

  function editAppearance() {
    openSheet('Theme & colour', () => {
      const s = settings();

      const themeRow = el('div.seg');
      for (const theme of THEMES) {
        themeRow.append(el('button.theme-card.press', {
          type: 'button',
          style: `background:${theme.bg};color:${theme.ink}`,
          'aria-pressed': s.theme === theme.id ? 'true' : 'false',
          onclick: async () => {
            if (await patch({ theme: theme.id })) { TB.ui.closeSheet(); editAppearance(); }
          },
        }, theme.label));
      }

      const accentRow = el('div.swatches');
      accentRow.append(el('button.btn.ghost.press', {
        type: 'button',
        text: 'Theme default',
        style: 'min-height:42px;font-size:12px;padding:0 12px',
        'aria-pressed': s.accent ? 'false' : 'true',
        onclick: async () => {
          if (await patch({ accent: null })) { TB.ui.closeSheet(); editAppearance(); }
        },
      }));
      for (const color of COLORS) {
        accentRow.append(el('button.swatch.press', {
          type: 'button',
          dataset: { color },
          'aria-label': color,
          'aria-pressed': s.accent === color ? 'true' : 'false',
          onclick: async () => {
            if (await patch({ accent: color })) { TB.ui.closeSheet(); editAppearance(); }
          },
        }));
      }

      return [
        el('div.field', null, [el('label', { text: 'Theme' }), themeRow]),
        el('div.field', null, [
          el('label', { text: 'Highlight colour' }),
          accentRow,
          el('p', {
            text: 'Overrides the theme\'s own highlight — buttons, the progress ring and the selected tab.',
            style: 'font-size:11px;color:var(--ink-faint);line-height:1.4;margin-top:2px',
          }),
        ]),
      ];
    });
  }

  async function editTitle() {
    const value = await TB.kb.prompt({ title: 'Board name', value: settings().title, maxLength: 30 });
    if (value !== null) patch({ title: value }, 'Saved');
  }

  function editWeekStart() {
    openSheet('Week starts on', (done) => {
      const row = el('div.seg');
      for (const [value, label] of [[1, 'Monday'], [0, 'Sunday']]) {
        row.append(el('button.seg-item.press', {
          type: 'button',
          'aria-pressed': settings().weekStartsOn === value ? 'true' : 'false',
          onclick: async () => { if (await patch({ weekStartsOn: value }, 'Saved')) done(true); },
        }, label));
      }
      return [
        row,
        el('p', {
          text: 'Changes which day the board\'s columns start from. Existing tasks keep their days.',
          style: 'font-size:11.5px;color:var(--ink-faint);line-height:1.4',
        }),
      ];
    });
  }

  // -------------------------------------------------------------- palettes

  /** Shared editor for the icon and avatar palettes. */
  function editPalette(key) {
    const isIcons = key === 'icons';
    const title = isIcons ? 'Icon palette' : 'Avatar palette';

    openSheet(title, () => {
      const list = settings()[key].slice();
      const wrap = el('div.chip-wrap.scroll', { style: 'max-height:200px' });

      const save = async (next) => {
        if (!next.length) { toast('Keep at least one'); return; }
        if (await patch({ [key]: next })) { TB.ui.closeSheet(); editPalette(key); }
      };

      for (const icon of list) {
        wrap.append(el('div.edit-chip.icon-only', null, [
          el('span', { text: icon }),
          el('button.remove.press', {
            type: 'button', 'aria-label': `Remove ${icon}`,
            onclick: () => save(list.filter((i) => i !== icon)),
          }, '✕'),
        ]));
      }

      return [
        el('p', {
          text: isIcons
            ? 'Icons offered when adding a task or a chore.'
            : 'Avatars offered when editing a person or the shared column.',
          style: 'font-size:12px;color:var(--ink-faint);line-height:1.4',
        }),
        wrap,
        el('div.sheet-actions', null, [
          el('button.btn.ghost.press', {
            type: 'button', text: 'Reset',
            onclick: async () => {
              const ok = await confirm('Reset palette?', 'Puts the original set back.', 'Reset');
              if (!ok) return;
              try {
                await TB.api.resetPalette(key);
                TB.ui.closeSheet();
                ctx.refresh();
                editPalette(key);
              } catch (err) { toast(err.message); }
            },
          }),
          el('button.btn.primary.press', {
            type: 'button', text: '+  Add icon',
            onclick: async () => {
              const picked = await TB.emoji.pick({ title: 'Add to palette', allowNone: false });
              if (!picked) return;
              if (list.includes(picked)) { toast('Already in the palette'); return; }
              save([...list, picked]);
            },
          }),
        ]),
      ];
    });
  }

  function editQuickAdd() {
    openSheet('Quick-add items', () => {
      const list = settings().quickAdd.slice();
      const wrap = el('div.chip-wrap.scroll', { style: 'max-height:190px' });

      const save = async (next) => {
        if (!next.length) { toast('Keep at least one'); return; }
        if (await patch({ quickAdd: next })) { TB.ui.closeSheet(); editQuickAdd(); }
      };

      for (const name of list) {
        wrap.append(el('div.edit-chip', null, [
          el('span', { text: name }),
          el('button.remove.press', {
            type: 'button', 'aria-label': `Remove ${name}`,
            onclick: () => save(list.filter((n) => n !== name)),
          }, '✕'),
        ]));
      }

      return [
        el('p', {
          text: 'One-tap suggestions under the shopping list. An item already on the list is hidden from the suggestions.',
          style: 'font-size:12px;color:var(--ink-faint);line-height:1.4',
        }),
        wrap,
        el('div.sheet-actions', null, [
          el('button.btn.primary.press', {
            type: 'button', text: '+  Add suggestion',
            onclick: async () => {
              const value = await TB.kb.prompt({ title: 'Quick-add item', placeholder: 'e.g. Oat milk', maxLength: 24 });
              if (value === null) return;
              save([...list, value]);
            },
          }),
        ]),
      ];
    });
  }

  // ------------------------------------------------------------ the chores

  function editChores() {
    openSheet('Repeating chores', () => {
      const board = ctx.board;
      const rows = el('div.rows');

      if (!board.templates.length) {
        rows.append(el('div.empty', null, [
          el('div.emoji', { text: '📋' }),
          el('p', { text: 'No repeating chores yet' }),
        ]));
      }

      for (const tpl of board.templates) {
        const person = TB.ui.personById(settings(), tpl.assignee);
        rows.append(el('div.row' + (tpl.paused ? '.paused' : ''), {
          dataset: { color: (person && person.color) || 'shared' },
        }, [
          el('div.column-avatar', { text: tpl.icon || (person && person.icon) || '🙂' }),
          el('div.row-main', null, [
            el('div.row-title', { text: tpl.title }),
            el('div.row-sub', {
              text: `${(person && person.name) || '—'} · ${daysLabel(tpl.days, settings().weekStartsOn)}${tpl.paused ? ' · paused' : ''}`,
            }),
          ]),
          el('button.icon-btn.small.press', {
            type: 'button', 'aria-label': 'Edit chore',
            onclick: () => editTemplate(tpl),
          }, '✎'),
        ]));
      }

      return [
        rows,
        el('div.sheet-actions', null, [
          el('button.btn.primary.press', {
            type: 'button', text: '+  New repeating chore', onclick: () => editTemplate(null),
          }),
        ]),
      ];
    });
  }

  function daysLabel(days, weekStartsOn) {
    if (!days || !days.length) return 'never';
    if (days.length === 7) return 'every day';
    const ordered = days.slice().sort((a, b) => ((a - weekStartsOn + 7) % 7) - ((b - weekStartsOn + 7) % 7));
    return ordered.map((d) => DAY_SHORT[d]).join(', ');
  }

  function editTemplate(tpl) {
    const s = settings();
    const isNew = !tpl;
    const draft = {
      title: tpl ? tpl.title : '',
      assignee: tpl ? tpl.assignee : s.people[0].id,
      icon: tpl ? tpl.icon : '',
      days: tpl ? tpl.days.slice() : [],
      paused: tpl ? tpl.paused : false,
    };

    openSheet(isNew ? 'New repeating chore' : 'Edit chore', (done) => {
      const nodes = [];

      const titleButton = el('button.text-input.press' + (draft.title ? '' : '.empty-value'), {
        type: 'button',
        text: draft.title || 'e.g. Take out the bins',
        onclick: async () => {
          const value = await TB.kb.prompt({
            title: 'Chore name', value: draft.title, placeholder: 'e.g. Take out the bins', maxLength: 80,
          });
          if (value === null) return;
          draft.title = value;
          titleButton.textContent = value;
          titleButton.classList.remove('empty-value');
        },
      });
      nodes.push(el('div.field', null, [el('label', { text: 'Chore' }), titleButton]));

      const whoOptions = s.people.map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color }));
      if (s.shared.enabled) {
        whoOptions.push({ id: 'shared', name: s.shared.name, icon: s.shared.icon, color: 'shared' });
      }
      const whoRow = el('div.seg');
      const paintWho = () => {
        clear(whoRow);
        for (const option of whoOptions) {
          whoRow.append(el('button.seg-item.press', {
            type: 'button',
            dataset: { color: option.color || 'shared' },
            'aria-pressed': draft.assignee === option.id ? 'true' : 'false',
            onclick: () => { draft.assignee = option.id; paintWho(); },
          }, [el('span', { text: option.icon }), el('span', { text: option.name })]));
        }
      };
      paintWho();
      nodes.push(el('div.field', null, [el('label', { text: 'Whose job' }), whoRow]));

      const dayRow = el('div.days');
      const paintDays = () => {
        clear(dayRow);
        for (let i = 0; i < 7; i++) {
          const dow = (s.weekStartsOn + i) % 7;
          dayRow.append(el('button.day-btn.press', {
            type: 'button',
            'aria-pressed': draft.days.includes(dow) ? 'true' : 'false',
            onclick: () => {
              const at = draft.days.indexOf(dow);
              if (at === -1) draft.days.push(dow); else draft.days.splice(at, 1);
              paintDays();
            },
          }, DAY_LETTER[dow]));
        }
      };
      paintDays();
      nodes.push(el('div.field', null, [el('label', { text: 'Repeats on' }), dayRow]));

      nodes.push(el('div.field', null, [
        el('label', { text: 'Icon' }),
        TB.ui.buildIconRow({
          icons: s.icons,
          value: draft.icon,
          onChange: (icon) => { draft.icon = icon; },
        }),
      ]));

      if (!isNew) {
        const pauseRow = el('div.seg');
        const paintPause = () => {
          clear(pauseRow);
          for (const [value, label] of [[false, 'Active'], [true, 'Paused']]) {
            pauseRow.append(el('button.seg-item.press', {
              type: 'button',
              'aria-pressed': draft.paused === value ? 'true' : 'false',
              onclick: () => { draft.paused = value; paintPause(); },
            }, label));
          }
        };
        paintPause();
        nodes.push(el('div.field', null, [el('label', { text: 'Status' }), pauseRow]));
      }

      const actions = el('div.sheet-actions');
      if (!isNew) {
        actions.append(el('button.btn.danger.press', {
          type: 'button', text: 'Delete',
          onclick: async () => {
            const ok = await confirm('Delete chore?', `"${tpl.title}" stops repeating. Already-ticked history is kept.`, 'Delete');
            if (!ok) return;
            try {
              await TB.api.deleteTemplate(tpl.id);
              toast('Deleted');
              done(true);
              ctx.refresh();
              TB.ui.closeSheet();
              editChores();
            } catch (err) { toast(err.message); }
          },
        }));
      }
      actions.append(el('button.btn.primary.press', {
        type: 'button', text: isNew ? 'Add chore' : 'Save',
        onclick: async () => {
          if (!draft.title.trim()) { toast('Give it a name first'); return; }
          if (!draft.days.length) { toast('Pick at least one day'); return; }
          try {
            if (isNew) await TB.api.addTemplate(draft);
            else await TB.api.updateTemplate(tpl.id, draft);
            toast(isNew ? 'Chore added 🌱' : 'Saved');
            done(true);
            ctx.refresh();
            TB.ui.closeSheet();
            editChores();
          } catch (err) { toast(err.message); }
        },
      }));
      nodes.push(actions);

      return nodes;
    });
  }

  // ------------------------------------------------------------ start over

  async function resetWeek() {
    const ok = await confirm(
      'Reset this week?',
      'Every task in the current week goes back to not-done. Nothing is deleted.',
      'Reset week'
    );
    if (!ok) return;
    try {
      await TB.api.resetWeek(ctx.board.weekKey);
      toast('Fresh start ✨');
      ctx.refresh();
    } catch (err) { toast(err.message); }
  }

  function resetEverything() {
    openSheet('Reset the board', (done) => {
      const draft = { keepPeople: true, keepChores: false };

      const makeToggle = (key, label, help) => {
        const row = el('div.seg');
        const paint = () => {
          clear(row);
          for (const [value, text] of [[true, 'Keep'], [false, 'Clear']]) {
            row.append(el('button.seg-item.press', {
              type: 'button',
              'aria-pressed': draft[key] === value ? 'true' : 'false',
              onclick: () => { draft[key] = value; paint(); },
            }, text));
          }
        };
        paint();
        return el('div.field', null, [
          el('label', { text: label }),
          row,
          el('p', { text: help, style: 'font-size:11px;color:var(--ink-faint);line-height:1.4' }),
        ]);
      };

      return [
        el('p', {
          text: 'Clears every task and the shopping list, and puts the look and the palettes back to how they started.',
          style: 'font-size:13px;color:var(--ink-soft);line-height:1.45',
        }),
        makeToggle('keepPeople', 'People', 'Keep the names, avatars and colours you set up.'),
        makeToggle('keepChores', 'Repeating chores', 'Keep your weekly chore list.'),
        el('div.sheet-actions', null, [
          el('button.btn.ghost.press', { type: 'button', text: 'Cancel', onclick: () => done(null) }),
          el('button.btn.danger.press', {
            type: 'button', text: 'Reset board',
            onclick: async () => {
              const ok = await confirm('Really reset?', 'This cannot be undone.', 'Reset everything');
              if (!ok) return;
              try {
                await TB.api.resetAll(draft);
                toast('Board reset');
                done(true);
                ctx.refresh();
              } catch (err) { toast(err.message); }
            },
          }),
        ]),
      ];
    });
  }

  return { mount, render };
})();
