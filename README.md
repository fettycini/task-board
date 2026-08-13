# 🌸 Task Board

A cute, modular chore and task board for a Raspberry Pi with a 7" touchscreen.
Built for the official 800×480 Pi display, in kiosk mode, with no keyboard.

- **Weekly chores that repeat themselves.** Define "Trash — every Tuesday" once;
  it reappears every week on its own.
- **One-off tasks** for everything else.
- **A shared shopping list** with quick-add buttons for the usual suspects.
- **An on-screen keyboard**, because a Pi in kiosk mode does not have one.
- **Everything is editable from the touchscreen** — see below.
- **No accounts, no cloud, no dependencies.** Everything lives in one JSON file
  on the Pi.

## Install on the Pi

Copy this folder to the Pi (e.g. to `~/task-board`), then:

```bash
cd ~/task-board
bash scripts/install-pi.sh
sudo reboot
```

It comes up full-screen on the touchscreen by itself after that.

The installer registers a `systemd` service for the server and an autostart
entry that opens Chromium in kiosk mode. It also installs `fonts-noto-color-emoji`
— without it the icons render as grey boxes.

## Run it anywhere (to try it out first)

Node 18+ is the only requirement.

```bash
npm start           # http://127.0.0.1:8080
npm test            # 44 tests, no dependencies
```

Resize your browser window to 800×480 to see it as the Pi will.

---
## Layout

```
task-board/
├── server/
│   ├── index.js      HTTP server, routing, static files
│   ├── api.js        every board mutation, as plain functions
│   ├── store.js      atomic JSON persistence + schema migration
│   └── week.js       week maths and recurring-chore expansion
├── web/
│   ├── index.html    the shell
│   ├── css/          base · themes · layout · components
│   └── js/
│       ├── app.js       module registry, tabs, week nav, midnight rollover
│       ├── api.js       fetch wrapper
│       ├── ui.js        DOM helpers, sheets, toasts, confetti, icon rows
│       ├── keyboard.js  the on-screen keyboard
│       ├── emoji.js     the emoji picker
│       └── modules/     tasks · shopping · settings
├── scripts/          install-pi.sh · kiosk.sh · taskboard.service
├── test/run-tests.js
└── data/board.json   ← everything you own, in one file
```

## Adding a module

The board is modular on purpose. To add one (a clock, weather, notes, points):

1. Write `web/js/modules/<name>.js` exposing `{ mount(node, ctx), render(board) }`.
2. Add `<section class="view" id="view-<name>" hidden></section>` to `index.html`,
   and a `<script>` tag for it.
3. Add an entry to `MODULES` at the top of `web/js/app.js` — id, plus optionally
   an `addAction` for the `+` button.
4. Add a matching entry to `DEFAULT_MODULES` in `server/store.js` with its
   starting label and icon.

The registry in `app.js` holds only what the code provides. The label, icon,
visibility and tab order all come from settings, so they stay editable on the
touchscreen. A module added to `DEFAULT_MODULES` is appended to existing
`board.json` files by the migration, so it appears rather than staying hidden.

`ctx.refresh()` reloads the board from the server; `ctx.board` is the current week.

---

## Licence

MIT — see [LICENSE](LICENSE).
