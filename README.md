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

## What you can change without touching code

Nothing that appears on screen is baked into the source. All of this is edited
by tapping **Settings**, and stored in `data/board.json`:

| Setting | Where | Notes |
|---|---|---|
| Who is on the board | Settings → People | Add, rename, restyle, reorder, remove. 1–6 columns. |
| Avatars & colours | Settings → People → ✎ | Six colours, plus any emoji via the picker |
| The shared column | Settings → Shared column | Rename it, change its icon, or hide it |
| Repeating chores | Settings → Repeating chores | Title, owner, icon, days, pause |
| Tab names, icons, order | Settings → Tabs | Hide the ones you do not use |
| Theme | Settings → Theme & colour | Sakura, Mint, Lavender, Night |
| Highlight colour | Settings → Theme & colour | Overrides the theme's own accent |
| Board name | Settings → Board name | The title in the top bar |
| Week starts on | Settings → Week starts on | Monday or Sunday |
| Icon palette | Settings → Icon palette | The icons offered on tasks and chores |
| Avatar palette | Settings → Avatar palette | The avatars offered for people |
| Quick-add items | Settings → Quick-add items | The one-tap shopping suggestions |

Removing somebody asks where their tasks should go — hand them to another
person, move them to the shared column, or delete them — rather than picking
for you.

The board ships with two placeholder people called **Me** and **You**. Rename
them in Settings → People the first time you run it.

---

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

## Using it

| Gesture | What happens |
|---|---|
| **Tap a task** | Ticks it off (and unticks it) |
| **Press and hold a task** | Opens the editor — rename, reassign, change day, delete |
| **`+` in the bottom bar** | Adds a one-off task, or a shopping item |
| **`‹` `›` in the top bar** | Previous / next week |
| **Tap the title** | Jumps back to the current week |
| **Tap a shopping item** | Moves it into the cart; **hold** to remove it |

Repeating chores are managed in **Settings → Weekly chores**. Editing one there
changes it everywhere from this week onward; editing a task on the board only
changes that week's copy.

Finish everything in a week and you get confetti.

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

## Notes

- **The server listens on `127.0.0.1` only.** The board is for the Pi's own
  screen, as intended. To open it to phones on your home wifi later, change
  `TASKBOARD_HOST` to `0.0.0.0` in `scripts/taskboard.service` and restart —
  but note there is no authentication, so only do that on a network you trust.
- **Backups:** copy `data/board.json`. That is the whole thing.
- **If `board.json` is ever corrupted** (an unplugged Pi mid-write, say), the
  server renames it to `board.json.corrupt-<timestamp>` and starts fresh rather
  than refusing to boot. Writes are atomic, so this should stay theoretical.
- **Old weeks** are pruned after 12 weeks so the file cannot grow forever.
- **Screen resolution:** the layout is written for 800×480. It reflows on other
  sizes, but the three-column week view is tuned for that panel.

## Licence

MIT — see [LICENSE](LICENSE).
