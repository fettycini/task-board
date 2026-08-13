/* Shopping module: a shared list, two columns wide, with quick-add chips for
   the things you buy constantly so most additions never need the keyboard. */
window.TB = window.TB || {};
TB.modules = TB.modules || {};

TB.modules.shopping = (function () {
  'use strict';

  const { el, clear, toast, confirm, plural } = TB.ui;

  let root = null;
  let ctx = null;
  let longPressTimer = null;
  let longPressFired = false;

  function mount(node, context) {
    root = node;
    ctx = context;
  }

  function render(board) {
    ctx.board = board;
    const items = board.shopping;
    const checked = items.filter((i) => i.checked).length;

    const header = el('div.pane-header', null, [
      el('h2', { text: '🛒 Shopping' }),
      el('span', {
        text: items.length ? `${checked}/${items.length} in the cart` : '',
        style: 'font-size:11.5px;color:var(--ink-faint)',
      }),
      checked > 0 && el('button.btn.ghost.press', {
        type: 'button',
        text: `Clear ${checked}`,
        style: 'min-height:34px;padding:0 12px;font-size:12px',
        onclick: clearChecked,
      }),
    ]);

    const pane = el('div.list-pane.scroll');
    if (!items.length) {
      pane.append(el('div.empty', null, [
        el('div.emoji', { text: '🧺' }),
        el('p', { text: 'List is empty. Tap a suggestion below, or + to add something.' }),
      ]));
    } else {
      const grid = el('div.shop-grid');
      // Unchecked first so the things you still need stay at the top.
      const ordered = items.slice().sort((a, b) => Number(a.checked) - Number(b.checked));
      for (const item of ordered) grid.append(itemRow(item));
      pane.append(grid);
    }

    const chips = el('div.chip-row');
    const present = new Set(items.filter((i) => !i.checked).map((i) => i.title.toLowerCase()));
    for (const name of board.settings.quickAdd) {
      if (present.has(name.toLowerCase())) continue;
      chips.append(el('button.chip.press', {
        type: 'button',
        text: `+ ${name}`,
        onclick: () => quickAdd(name),
      }));
    }

    clear(root).append(header, pane, el('div.chip-row.scroll', { style: 'max-height:74px' }, [chips]));
  }

  function itemRow(item) {
    const node = el('button.shop-item.press' + (item.checked ? '.checked' : ''), {
      type: 'button',
      dataset: { id: item.id },
    }, [
      el('span.check', { text: '✓' }),
      el('span.shop-title', { text: item.title }),
      item.qty > 1 ? el('span.qty', { text: `×${item.qty}` }) : null,
    ]);

    node.addEventListener('pointerdown', () => {
      longPressFired = false;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        if (navigator.vibrate) navigator.vibrate(12);
        removeItem(item);
      }, 550);
    });
    for (const event of ['pointerup', 'pointerleave', 'pointercancel']) {
      node.addEventListener(event, () => clearTimeout(longPressTimer));
    }
    node.addEventListener('click', () => {
      if (longPressFired) { longPressFired = false; return; }
      toggle(item, node);
    });

    return node;
  }

  async function toggle(item, node) {
    const next = !item.checked;
    item.checked = next;
    node.classList.toggle('checked', next);
    try {
      await TB.api.updateShopping(item.id, { checked: next });
      ctx.refreshBadges();
    } catch (err) {
      item.checked = !next;
      node.classList.toggle('checked', !next);
      toast(err.message);
    }
  }

  async function quickAdd(name) {
    try {
      await TB.api.addShopping({ title: name });
      ctx.refresh();
    } catch (err) { toast(err.message); }
  }

  async function addItem() {
    const value = await TB.kb.prompt({
      title: 'Add to list',
      placeholder: 'What do we need?',
      maxLength: 40,
    });
    if (value === null) return;
    try {
      await TB.api.addShopping({ title: value });
      toast('Added to the list 🛒');
      ctx.refresh();
    } catch (err) { toast(err.message); }
  }

  async function removeItem(item) {
    const ok = await confirm('Remove item?', `"${item.title}" will be removed from the list.`, 'Remove');
    if (!ok) return;
    try {
      await TB.api.deleteShopping(item.id);
      ctx.refresh();
    } catch (err) { toast(err.message); }
  }

  async function clearChecked() {
    const count = ctx.board.shopping.filter((i) => i.checked).length;
    const ok = await confirm('Clear the cart?', `Removes ${plural(count, 'ticked item')} from the list.`, 'Clear');
    if (!ok) return;
    try {
      await TB.api.clearCheckedShopping();
      toast('Cleared');
      ctx.refresh();
    } catch (err) { toast(err.message); }
  }

  return { mount, render, addItem };
})();
