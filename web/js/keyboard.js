/* On-screen keyboard.
 *
 * A Raspberry Pi running Chromium in kiosk mode has no touch keyboard of its
 * own, so without this you would need to plug in a USB keyboard every time you
 * wanted to add a task. This is deliberately a full-screen takeover: it shows
 * what you are typing in its own preview line, so it does not matter that it
 * covers the sheet underneath.
 *
 * Usage:  const text = await TB.kb.prompt({ title: 'New task', value: '' });
 *         // resolves to a string, or null if cancelled
 */
window.TB = window.TB || {};

TB.kb = (function () {
  'use strict';

  const { el, clear } = TB.ui;

  const LAYOUTS = {
    letters: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      [{ key: 'shift', label: '⇧', cls: 'wide muted' }, 'z', 'x', 'c', 'v', 'b', 'n', 'm',
       { key: 'back', label: '⌫', cls: 'wide muted' }],
    ],
    symbols: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['-', '/', ':', '(', ')', '$', '&', '@', '"'],
      [{ key: 'symbols2', label: '#+=', cls: 'wide muted' }, '.', ',', '?', '!', "'", '+', '=',
       { key: 'back', label: '⌫', cls: 'wide muted' }],
    ],
    symbols2: [
      ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
      ['_', '\\', '|', '~', '<', '>', '€', '£', '¥'],
      [{ key: 'symbols', label: '123', cls: 'wide muted' }, '.', ',', '?', '!', "'", '"', ';',
       { key: 'back', label: '⌫', cls: 'wide muted' }],
    ],
    number: [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      [{ key: 'back', label: '⌫', cls: 'muted' }, '0', { key: 'done', label: '✓', cls: 'accent' }],
    ],
  };

  const state = {
    active: false,
    value: '',
    shift: true,          // start capitalised, like a phone keyboard
    shiftLock: false,
    layout: 'letters',
    maxLength: 80,
    resolve: null,
    placeholder: '',
    title: '',
    numeric: false,
  };

  const host = () => document.getElementById('keyboard');

  function open(options = {}) {
    return new Promise((resolve) => {
      // A second prompt while one is open cancels the first.
      if (state.active && state.resolve) state.resolve(null);

      state.active = true;
      state.value = String(options.value || '');
      state.numeric = options.numeric === true;
      state.layout = state.numeric ? 'number' : 'letters';
      state.shift = !state.value;      // capitalise a fresh entry
      state.shiftLock = false;
      state.maxLength = options.maxLength || 80;
      state.placeholder = options.placeholder || 'Type here…';
      state.title = options.title || '';
      state.resolve = resolve;

      document.body.classList.add('kb-open');
      host().hidden = false;
      host().setAttribute('aria-hidden', 'false');
      render();
      window.addEventListener('keydown', onPhysicalKey, true);
    });
  }

  function finish(result) {
    if (!state.active) return;
    state.active = false;
    window.removeEventListener('keydown', onPhysicalKey, true);
    document.body.classList.remove('kb-open');
    const node = host();
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    clear(node);
    const resolve = state.resolve;
    state.resolve = null;
    if (resolve) resolve(result);
  }

  function commit() {
    const trimmed = state.value.replace(/\s+/g, ' ').trim();
    finish(trimmed ? trimmed : null);
  }

  function insert(char) {
    if (state.value.length >= state.maxLength) return;
    state.value += char;
    if (state.shift && !state.shiftLock) state.shift = false;
    render();
  }

  function backspace() {
    // Remove a whole surrogate pair (emoji) rather than half of one.
    state.value = Array.from(state.value).slice(0, -1).join('');
    render();
  }

  function handleKey(key) {
    switch (key) {
      case 'shift':
        // Tap for one letter, tap again within the same session to lock.
        if (state.shiftLock) { state.shiftLock = false; state.shift = false; }
        else if (state.shift) { state.shiftLock = true; }
        else { state.shift = true; }
        render();
        break;
      case 'back': backspace(); break;
      case 'space': insert(' '); break;
      case 'done': commit(); break;
      case 'cancel': finish(null); break;
      case 'clear': state.value = ''; state.shift = true; render(); break;
      case 'symbols': state.layout = 'symbols'; render(); break;
      case 'symbols2': state.layout = 'symbols2'; render(); break;
      case 'letters': state.layout = 'letters'; render(); break;
      default: insert(state.shift ? key.toUpperCase() : key);
    }
  }

  /* A USB keyboard should still work if one happens to be plugged in. */
  function onPhysicalKey(event) {
    if (!state.active) return;
    if (event.key === 'Enter') { event.preventDefault(); commit(); return; }
    if (event.key === 'Escape') { event.preventDefault(); finish(null); return; }
    if (event.key === 'Backspace') { event.preventDefault(); backspace(); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (state.value.length < state.maxLength) {
        state.value += event.key;
        render();
      }
    }
  }

  function keyButton(spec) {
    const isObject = typeof spec === 'object';
    const key = isObject ? spec.key : spec;
    const label = isObject ? spec.label : (state.shift ? spec.toUpperCase() : spec);
    const cls = `key press ${isObject && spec.cls ? spec.cls : ''}`.trim();

    const button = el(`button.${cls.split(' ').join('.')}`, {
      type: 'button',
      'aria-label': key,
      'aria-pressed': key === 'shift' && (state.shift || state.shiftLock) ? 'true' : null,
      // pointerdown, not click: it feels immediate and avoids the tap delay.
      onpointerdown: (event) => { event.preventDefault(); handleKey(key); },
    }, label);
    return button;
  }

  function render() {
    const node = clear(host());
    const rows = LAYOUTS[state.layout];

    const showPlaceholder = state.value.length === 0;
    const preview = el('div.kb-preview', null, [
      el('div.kb-text' + (showPlaceholder ? '.placeholder' : ''), null, [
        el('span', { text: showPlaceholder ? state.placeholder : state.value }),
      ]),
      !showPlaceholder && el('div.kb-caret'),
      el('button.icon-btn.small.press', {
        type: 'button',
        'aria-label': 'Clear',
        onpointerdown: (event) => { event.preventDefault(); handleKey('clear'); },
      }, '⨯'),
    ]);

    node.append(preview);

    for (const row of rows) {
      node.append(el('div.kb-row', null, row.map(keyButton)));
    }

    // Bottom row differs per layout.
    if (state.layout === 'number') {
      node.append(el('div.kb-row', null, [
        keyButton({ key: 'cancel', label: 'Cancel', cls: 'wide muted' }),
      ]));
    } else {
      node.append(el('div.kb-row', null, [
        keyButton({ key: state.layout === 'letters' ? 'symbols' : 'letters',
                    label: state.layout === 'letters' ? '123' : 'ABC',
                    cls: 'wide muted' }),
        keyButton({ key: 'cancel', label: 'Cancel', cls: 'wide muted' }),
        keyButton({ key: 'space', label: 'space', cls: 'space' }),
        keyButton({ key: 'done', label: '✓  Done', cls: 'wide accent' }),
      ]));
    }
  }

  return {
    prompt: open,
    close: () => finish(null),
    get isOpen() { return state.active; },
  };
})();
