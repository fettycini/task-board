#!/usr/bin/env bash
# Launch Chromium full-screen on the Pi's touchscreen, pointed at the board.
# Started automatically at login; also runnable by hand for testing.
#
# Handles both display stacks: Raspberry Pi OS trixie (Debian 13) and later
# default to labwc/Wayland, while older releases use X11. The X11-only tools
# (xset, unclutter) are skipped entirely under Wayland.
set -u

URL="${TASKBOARD_URL:-http://127.0.0.1:8080/}"

# Wait for the server before opening the browser, otherwise a cold boot lands
# on an error page and just sits there.
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${URL}api/board"; then break; fi
  sleep 1
done

if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  SESSION="wayland"
elif [ -n "${DISPLAY:-}" ]; then
  SESSION="x11"
else
  SESSION="unknown"
fi
echo "[kiosk] session type: ${SESSION}"

if [ "$SESSION" = "x11" ]; then
  # Stop the screen blanking / dimming — this is a wall display.
  command -v xset >/dev/null 2>&1 && { xset s off; xset s noblank; xset -dpms; }
  # Hide the mouse pointer; a touchscreen has no use for it. X11 only —
  # unclutter cannot see a Wayland cursor.
  command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.1 -root &
fi
# Under Wayland, blanking is the compositor's business; install-pi.sh turns it
# off via `raspi-config nonint do_blanking 1`, which covers both stacks.

# Chromium's binary name differs across Raspberry Pi OS releases.
BROWSER=""
for candidate in chromium-browser chromium; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
done
if [ -z "$BROWSER" ]; then
  echo "chromium not found — install it with: sudo apt install -y chromium" >&2
  exit 1
fi

# A crashed session otherwise greets you with a "restore pages?" bubble
# forever, which is unusable without a keyboard.
PROFILE="${HOME}/.config/taskboard-kiosk"
mkdir -p "$PROFILE/Default"
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE/Default/Preferences" 2>/dev/null || true

ARGS=(
  --kiosk
  --app="$URL"
  --user-data-dir="$PROFILE"
  --window-position=0,0
  --window-size=800,480
  --start-fullscreen
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --disable-features=TranslateUI,Translate
  --no-first-run
  --check-for-update-interval=31536000
  --overscroll-history-navigation=0
  --disable-pinch
  --touch-events=enabled
)

# Let Chromium use the Wayland compositor directly rather than going through
# XWayland — smoother touch scrolling, and no blurry scaling.
if [ "$SESSION" = "wayland" ]; then
  ARGS+=(--ozone-platform=wayland --enable-features=UseOzonePlatform)
fi

exec "$BROWSER" "${ARGS[@]}"
