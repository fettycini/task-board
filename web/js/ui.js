/* DOM helpers, the modal sheet, toasts and the confetti burst. */
window.TB = window.TB || {};

TB.ui = (function () {
  'use strict';

  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * el('div.card', { onclick }, [children])
   * Text children are appended as text nodes, so nothing here can inject HTML.
   */
  function el(spec, props, children) {
    const [tagPart, ...classes] = String(spec).split('.');
    const node = document.createElement(tagPart || 'div');
    if (classes.length) node.className = classes.join(' ');

    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = `${node.className} ${value}`.trim();
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      }
    }

    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // ------------------------------------------------------------------ dates

  function parseISO(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function shortDate(iso) {
    const d = parseISO(iso);
    return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  }

  function weekRangeLabel(weekKey) {
    const start = parseISO(weekKey);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const endLabel = start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : `${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${endLabel}`;
  }

  // ------------------------------------------------------------------ toast

  let toastTimer = null;
  function toast(message, ms = 1900) {
    const node = document.getElementById('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ sheet

  let onSheetClose = null;

  /** Open the bottom sheet. `build(close)` returns the body content. */
  function openSheet(title, build, options = {}) {
    const scrim = document.getElementById('scrim');
    const sheet = document.getElementById('sheet');
    clear(sheet);

    const close = (result) => {
      scrim.hidden = true;
      clear(sheet);
      const handler = onSheetClose;
      onSheetClose = null;
      if (handler) handler(result);
    };
    onSheetClose = options.onClose || null;

    const head = el('div.sheet-head', null, [
      el('h2', { text: title }),
      el('button.icon-btn.small.press', { 'aria-label': 'Close', onclick: () => close(null) }, '✕'),
    ]);

    const body = el('div.sheet-body.scroll');
    body.append(...[].concat(build(close) || []));

    sheet.append(head, body);
    scrim.hidden = false;

    // Tapping the dimmed area closes; taps inside the sheet must not.
    scrim.onclick = (event) => { if (event.target === scrim) close(null); };
    return close;
  }

  function closeSheet() {
    const scrim = document.getElementById('scrim');
    scrim.hidden = true;
    clear(document.getElementById('sheet'));
    onSheetClose = null;
  }

  /** Yes/no sheet. Resolves true only if the confirm button is tapped. */
  function confirm(title, message, confirmLabel = 'Yes, do it') {
    return new Promise((resolve) => {
      let answered = false;
      const close = openSheet(title, (done) => [
        el('p', { text: message, style: 'font-size:14px;color:var(--ink-soft);line-height:1.45' }),
        el('div.sheet-actions', null, [
          el('button.btn.ghost.press', { text: 'Cancel', onclick: () => done(null) }),
          el('button.btn.danger.press', {
            text: confirmLabel,
            onclick: () => { answered = true; done(true); },
          }),
        ]),
      ], { onClose: () => resolve(answered) });
      void close;
    });
  }

  // --------------------------------------------------------------- confetti

  function celebrate(count = 26) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = document.getElementById('confetti');
    const colors = ['#f47ba7', '#7ecfa8', '#f6c45e', '#8fb8f0', '#c79bee', '#f79c78'];
    for (let i = 0; i < count; i++) {
      const bit = document.createElement('i');
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.top = `${-10 - Math.random() * 40}px`;
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${Math.random() * 260}ms`;
      bit.style.animationDuration = `${1100 + Math.random() * 700}ms`;
      host.append(bit);
      setTimeout(() => bit.remove(), 2400);
    }
  }

  // ------------------------------------------------------------- icon picker

  /**
   * A row of selectable icons drawn from the user's editable palette, ending
   * in a "+" that opens the full emoji picker. Used by the task editor, the
   * chore editor and the person editor, so they cannot drift apart.
   *
   * Returns an element that repaints itself when a choice is made.
   */
  function buildIconRow({ icons, value, onChange, allowNone = true }) {
    const row = el('div.chip-row.scroll', { style: 'max-height:78px;padding:0' });
    let current = value || '';

    const paint = () => {
      clear(row);

      if (allowNone) {
        row.append(el('button.chip.press', {
          type: 'button',
          class: current ? '' : 'selected',
          onclick: () => { current = ''; onChange(''); paint(); },
        }, 'none'));
      }

      // A custom icon chosen from the picker is not in the palette; show it
      // anyway so the current selection is always visible.
      const list = icons.includes(current) || !current ? icons : [current, ...icons];

      for (const icon of list) {
        row.append(el('button.chip.press', {
          type: 'button',
          class: current === icon ? 'selected' : '',
          style: 'font-size:17px;padding:4px 9px',
          onclick: () => { current = icon; onChange(icon); paint(); },
        }, icon));
      }

      row.append(el('button.chip.press', {
        type: 'button',
        style: 'font-size:15px;padding:4px 11px',
        'aria-label': 'More icons',
        onclick: async () => {
          const picked = await TB.emoji.pick({ title: 'Pick an icon', allowNone: false });
          if (picked === null) return;
          current = picked;
          onChange(picked);
          paint();
        },
      }, '＋'));
    };

    paint();
    return row;
  }

  // ----------------------------------------------------------- misc helpers

  function personById(settings, id) {
    if (id === 'shared') {
      return {
        id: 'shared',
        name: settings.shared.name,
        icon: settings.shared.icon,
        color: 'shared',
      };
    }
    return settings.people.find((p) => p.id === id) || null;
  }

  /** Simple pluraliser for the few nouns used here, irregulars included. */
  const IRREGULAR = { person: 'people' };
  function plural(n, word) {
    if (n === 1) return `${n} ${word}`;
    return `${n} ${IRREGULAR[word] || `${word}s`}`;
  }

  return {
    el, clear, toast, openSheet, closeSheet, confirm, celebrate, buildIconRow,
    parseISO, shortDate, weekRangeLabel, personById, plural,
    DAY_SHORT, DAY_LETTER, MONTH_SHORT,
  };
})();
