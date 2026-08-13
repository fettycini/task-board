/* Tasks module: the week board itself — one column per person, plus a
   shared column. Tapping a card ticks it off; holding it opens the editor. */
window.TB = window.TB || {};
TB.modules = TB.modules || {};

TB.modules.tasks = (function () {
  'use strict';

  const { el, clear, toast, openSheet, confirm, celebrate, personById, DAY_SHORT, DAY_LETTER } = TB.ui;

  let root = null;
  let ctx = null;          // { board, refresh, setBusy }
  let longPressTimer = null;
  let longPressFired = false;

  function mount(node, context) {
    root = node;
    ctx = context;
  }

  // ------------------------------------------------------------------ render

  function render(board) {
    ctx.board = board;
    const settings = board.settings;
    const people = settings.people.slice();
    const columns = people.map((p) => ({ ...p, key: p.id }));
    if (settings.shared.enabled) {
      columns.push({
        id: 'shared',
        key: 'shared',
        name: settings.shared.name,
        icon: settings.shared.icon,
        color: 'shared',
      });
    }

    const grid = el('div.columns', { dataset: { count: String(columns.length) } });

    for (const column of columns) {
      const tasks = board.tasks
        .filter((t) => t.assignee === column.id)
        .sort(sortTasks);
      const doneCount = tasks.filter((t) => t.done).length;

      const list = el('div.column-list.scroll');
      if (!tasks.length) {
        list.append(el('div.empty', null, [
          el('div.emoji', { text: '🌷' }),
          el('p', { text: 'Nothing here yet' }),
        ]));
      } else {
        for (const task of tasks) list.append(taskCard(task, board));
      }

      grid.append(el('div.column', { dataset: { color: column.color || 'shared' } }, [
        el('div.column-head', null, [
          el('div.column-avatar', { text: column.icon || '🙂' }),
          el('div.column-name', { text: column.name }),
          el('div.column-count', { text: `${doneCount}/${tasks.length}` }),
        ]),
        list,
      ]));
    }

    clear(root).append(grid);
  }

  /** Undone first, then by day of week, then by title. */
  function sortTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const dayA = a.dow === null ? 9 : a.dow;
    const dayB = b.dow === null ? 9 : b.dow;
    if (dayA !== dayB) return dayA - dayB;
    return a.title.localeCompare(b.title);
  }

  function taskCard(task, board) {
    const todayDow = TB.ui.parseISO(board.today).getDay();
    const isThisWeek = board.isCurrentWeek;
    const isToday = isThisWeek && task.dow === todayDow;
    const isOverdue = isThisWeek && !task.done && task.dow !== null && dayIndex(task.dow, board) < dayIndex(todayDow, board);

    const classes = ['task', 'press'];
    if (task.done) classes.push('done');
    if (isToday && !task.done) classes.push('is-today');
    if (isOverdue) classes.push('is-overdue');

    const meta = task.done
      ? 'Done ✓'
      : isToday ? 'Today'
      : task.dow === null ? 'Any day'
      : isOverdue ? `${DAY_SHORT[task.dow]} — missed`
      : DAY_SHORT[task.dow];

    const card = el(`button.${classes.join('.')}`, {
      type: 'button',
      dataset: { id: task.id },
    }, [
      el('span.check', { text: '✓' }),
      task.icon ? el('span.task-icon', { text: task.icon }) : null,
      el('span.task-body', null, [
        el('span.task-title', { text: task.title }),
        el('span.task-meta', { text: meta }),
      ]),
    ]);

    attachPressHandlers(card, task);
    return card;
  }

  /** Position of a day within the displayed week, honouring weekStartsOn. */
  function dayIndex(dow, board) {
    const start = board.settings.weekStartsOn;
    return (dow - start + 7) % 7;
  }

  /* Tap toggles done; press-and-hold opens the editor. Long-press is the only
     way to reach edit/delete without cluttering each card with buttons. */
  function attachPressHandlers(node, task) {
    node.addEventListener('pointerdown', () => {
      longPressFired = false;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        if (navigator.vibrate) navigator.vibrate(12);
        editTask(task);
      }, 550);
    });

    const cancel = () => clearTimeout(longPressTimer);
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('pointercancel', cancel);

    node.addEventListener('click', (event) => {
      event.preventDefault();
      if (longPressFired) { longPressFired = false; return; }
      toggle(task, node);
    });
  }

  // ----------------------------------------------------------------- actions

  async function toggle(task, node) {
    const next = !task.done;

    // Optimistic: the tick must feel instant on a Pi, then reconcile.
    task.done = next;
    node.classList.toggle('done', next);
    if (next) {
      node.classList.add('just-done');
      setTimeout(() => node.classList.remove('just-done'), 340);
    }

    try {
      await TB.api.updateTask(task.id, { done: next });
      const board = ctx.board;
      const remaining = board.tasks.filter((t) => !t.done).length;
      if (next && remaining === 0 && board.tasks.length > 0) {
        celebrate(40);
        toast('Everything done this week! 🎉', 2600);
      }
      ctx.refreshProgress();
      render(board);
    } catch (err) {
      task.done = !next;
      node.classList.toggle('done', !next);
      toast(err.message);
    }
  }

  function addTask() {
    openEditor(null);
  }

  function editTask(task) {
    openEditor(task);
  }

  /**
   * One sheet for both create and edit. `task` null means create.
   * Template-generated tasks explain themselves rather than pretending an
   * edit here would stick to next week.
   */
  function openEditor(task) {
    const board = ctx.board;
    const settings = board.settings;
    const isNew = !task;

    const draft = {
      title: task ? task.title : '',
      assignee: task ? task.assignee : settings.people[0].id,
      icon: task ? task.icon : '',
      dow: task ? task.dow : null,
      repeat: false,
      repeatDays: [],
    };

    let titleButton = null;

    const close = openSheet(isNew ? 'New task' : 'Edit task', (done) => {
      const nodes = [];

      // --- title
      titleButton = el('button.text-input.press' + (draft.title ? '' : '.empty-value'), {
        type: 'button',
        text: draft.title || 'What needs doing?',
        onclick: async () => {
          const value = await TB.kb.prompt({
            title: 'Task name',
            value: draft.title,
            placeholder: 'What needs doing?',
            maxLength: 80,
          });
          if (value === null) return;
          draft.title = value;
          titleButton.textContent = value;
          titleButton.classList.remove('empty-value');
        },
      });
      nodes.push(el('div.field', null, [el('label', { text: 'Task' }), titleButton]));

      // --- who
      const whoOptions = settings.people.map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color }));
      if (settings.shared.enabled) {
        whoOptions.push({ id: 'shared', name: settings.shared.name, icon: settings.shared.icon, color: 'shared' });
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
          }, [el('span', { text: option.icon || '🙂' }), el('span', { text: option.name })]));
        }
      };
      paintWho();
      nodes.push(el('div.field', null, [el('label', { text: 'Who' }), whoRow]));

      // --- day
      const dayRow = el('div.days');
      const paintDays = () => {
        clear(dayRow);
        for (let i = 0; i < 7; i++) {
          const dow = (settings.weekStartsOn + i) % 7;
          dayRow.append(el('button.day-btn.press', {
            type: 'button',
            'aria-pressed': draft.dow === dow ? 'true' : 'false',
            onclick: () => { draft.dow = draft.dow === dow ? null : dow; paintDays(); },
          }, DAY_LETTER[dow]));
        }
      };
      paintDays();
      nodes.push(el('div.field', null, [
        el('label', { text: draft.dow === null ? 'Day (optional — none = any day)' : 'Day' }),
        dayRow,
      ]));

      // --- icon
      nodes.push(el('div.field', null, [
        el('label', { text: 'Icon' }),
        TB.ui.buildIconRow({
          icons: settings.icons,
          value: draft.icon,
          onChange: (icon) => { draft.icon = icon; },
        }),
      ]));

      if (task && task.source === 'template') {
        nodes.push(el('p', {
          text: 'This one repeats every week. Changing it here only affects this week — edit the chore in Settings to change it for good.',
          style: 'font-size:11.5px;color:var(--ink-faint);line-height:1.4',
        }));
      }

      // --- actions
      const actions = el('div.sheet-actions');
      if (!isNew) {
        actions.append(el('button.btn.danger.press', {
          type: 'button',
          text: 'Delete',
          onclick: async () => {
            const ok = await confirm('Delete task?', `"${task.title}" will be removed from this week.`, 'Delete');
            if (!ok) return;
            try {
              await TB.api.deleteTask(task.id);
              toast('Deleted');
              ctx.refresh();
            } catch (err) { toast(err.message); }
          },
        }));
      }
      actions.append(el('button.btn.primary.press', {
        type: 'button',
        text: isNew ? 'Add task' : 'Save',
        onclick: () => save(done),
      }));
      nodes.push(actions);

      return nodes;
    });

    async function save(done) {
      if (!draft.title.trim()) { toast('Give it a name first'); return; }
      try {
        if (isNew) {
          await TB.api.addTask({
            title: draft.title,
            assignee: draft.assignee,
            icon: draft.icon,
            dow: draft.dow,
            weekKey: board.weekKey,
          });
          toast('Added ✨');
        } else {
          await TB.api.updateTask(task.id, {
            title: draft.title,
            assignee: draft.assignee,
            icon: draft.icon,
            dow: draft.dow,
          });
          toast('Saved');
        }
        done(true);
        ctx.refresh();
      } catch (err) {
        toast(err.message);
      }
    }

    void close;
  }

  return { mount, render, addTask };
})();
