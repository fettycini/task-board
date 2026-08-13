/* Emoji picker.
 *
 * Every icon in the app is an emoji, and the on-screen keyboard is letters
 * only, so without this the icon palettes would be editable in theory and not
 * in practice. Categories are a curated household-oriented subset rather than
 * the full Unicode set — scrolling thousands of glyphs on a 7" panel is worse
 * than having the fifty you actually want.
 *
 * Usage:  const icon = await TB.emoji.pick();   // string, or null if cancelled
 */
window.TB = window.TB || {};

TB.emoji = (function () {
  'use strict';

  const { el, clear, openSheet } = TB.ui;

  const CATEGORIES = [
    {
      id: 'home', label: '🏠', name: 'Home',
      items: ['🧹', '🧺', '🧽', '🧼', '🪣', '🗑️', '♻️', '🛏️', '🛋️', '🚪', '🪟', '🪴',
              '🚿', '🛁', '🚽', '🧻', '🪠', '🔌', '💡', '🔥', '❄️', '🧯', '🔧', '🔨',
              '🪛', '📦', '🧰', '🪑', '🖼️', '🕯️'],
    },
    {
      id: 'food', label: '🍽️', name: 'Kitchen',
      items: ['🍽️', '🍳', '🥘', '🍲', '🥗', '🍞', '🥛', '🥚', '🧀', '🥩', '🍗', '🐟',
              '🍎', '🍌', '🍓', '🥦', '🥕', '🧅', '🥔', '☕', '🍵', '🍷', '🍺', '🧃',
              '🛒', '🥫', '🍚', '🧂', '🍰', '🍪'],
    },
    {
      id: 'pets', label: '🐾', name: 'Pets',
      items: ['🐕', '🐈', '🐇', '🐹', '🐦', '🐠', '🐢', '🦎', '🐾', '🦴', '🥎', '🧶',
              '🐻', '🐰', '🐱', '🐶', '🦊', '🐼', '🐧', '🦉', '🦜', '🐷', '🐮', '🐸'],
    },
    {
      id: 'life', label: '📅', name: 'Life',
      items: ['📅', '⏰', '💊', '🩺', '💉', '🏥', '💌', '📮', '💰', '💳', '🧾', '🏦',
              '📚', '✏️', '📝', '💻', '📱', '🎧', '🎮', '📺', '🎬', '🎵', '🎨', '🧵'],
    },
    {
      id: 'out', label: '🚗', name: 'Out',
      items: ['🚗', '⛽', '🚲', '🛴', '🚌', '✈️', '🧳', '🗺️', '🏃', '🚶', '🏋️', '🧘',
              '⚽', '🏀', '🎾', '🏊', '⛰️', '🏖️', '🌳', '🌧️', '☀️', '🌙', '⛄', '🌸'],
    },
    {
      id: 'faces', label: '🙂', name: 'Faces',
      items: ['🙂', '😀', '😅', '😍', '🥰', '😎', '🤓', '🤔', '😴', '🥳', '😇', '🤗',
              '💞', '❤️', '💛', '💚', '💙', '💜', '⭐', '✨', '🌟', '🔥', '🍀', '🎀'],
    },
  ];

  /**
   * Open the picker. Resolves to the chosen emoji, or null.
   * `options.allowNone` adds a "no icon" choice, resolving to ''.
   */
  function pick(options = {}) {
    return new Promise((resolve) => {
      let chosen = null;
      let activeCategory = CATEGORIES[0].id;

      openSheet(options.title || 'Pick an icon', (done) => {
        const grid = el('div.emoji-grid.scroll');
        const tabs = el('div.emoji-tabs');

        const paintGrid = () => {
          clear(grid);
          if (options.allowNone) {
            grid.append(el('button.emoji-cell.press', {
              type: 'button',
              style: 'font-size:11px;font-weight:700;color:var(--ink-faint)',
              onclick: () => { chosen = ''; done(true); },
            }, 'none'));
          }
          const category = CATEGORIES.find((c) => c.id === activeCategory);
          for (const item of category.items) {
            grid.append(el('button.emoji-cell.press', {
              type: 'button',
              'aria-label': item,
              onclick: () => { chosen = item; done(true); },
            }, item));
          }
        };

        const paintTabs = () => {
          clear(tabs);
          for (const category of CATEGORIES) {
            tabs.append(el('button.emoji-tab.press', {
              type: 'button',
              'aria-label': category.name,
              'aria-pressed': activeCategory === category.id ? 'true' : 'false',
              onclick: () => { activeCategory = category.id; paintTabs(); paintGrid(); },
            }, category.label));
          }
        };

        paintTabs();
        paintGrid();
        return [tabs, grid];
      }, { onClose: () => resolve(chosen) });
    });
  }

  return { pick, CATEGORIES };
})();
