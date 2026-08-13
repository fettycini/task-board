#!/usr/bin/env bash
# One-shot installer for Raspberry Pi OS.
#
#   cd ~/task-board && bash scripts/install-pi.sh
#
# Installs Node if missing, registers the server as a systemd service, and sets
# Chromium to open the board full-screen when the desktop starts.
set -euo pipefail

APPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="$(id -un)"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }

# ------------------------------------------------------------------ node

if ! command -v node >/dev/null 2>&1; then
  say "Installing Node.js"
  sudo apt-get update
  sudo apt-get install -y nodejs
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node 18+ is required (found $(node -v 2>/dev/null || echo none))." >&2
  echo "Install a newer one with:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  exit 1
fi
say "Node $(node -v) — OK (the board has no npm dependencies to install)"

# --------------------------------------------------------------- packages

say "Installing kiosk helpers"
# fonts-noto-color-emoji is not optional: without it every icon on the board
# renders as a grey box. The rest are best-effort.
sudo apt-get install -y curl fonts-noto-color-emoji \
  || echo "(warning: could not install the emoji font — icons may show as boxes)"

# X11-only helpers. Raspberry Pi OS trixie (Debian 13) and later run labwc on
# Wayland, where these do nothing, so only fetch them if we are on X11.
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  sudo apt-get install -y unclutter x11-xserver-utils \
    || echo "(optional X11 helpers unavailable — continuing)"
fi

# ------------------------------------------------------------ the service

say "Registering the taskboard service"
sed -e "s|__USER__|${USER_NAME}|g" -e "s|__APPDIR__|${APPDIR}|g" \
  "${APPDIR}/scripts/taskboard.service" | sudo tee /etc/systemd/system/taskboard.service >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable taskboard.service
sudo systemctl restart taskboard.service

sleep 2
if systemctl is-active --quiet taskboard.service; then
  say "Server is running on http://127.0.0.1:8080"
else
  echo "The service failed to start. Logs:" >&2
  sudo journalctl -u taskboard.service -n 30 --no-pager >&2
  exit 1
fi

# ---------------------------------------------------------------- kiosk

chmod +x "${APPDIR}/scripts/kiosk.sh"

say "Setting Chromium to open the board at login"

# XDG autostart — honoured by the LXDE/X11 session and by Pi OS's labwc session.
AUTOSTART_DIR="${HOME}/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "${AUTOSTART_DIR}/taskboard-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Task Board
Exec=${APPDIR}/scripts/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

# labwc (Pi OS trixie and later) also reads its own autostart file. Write to it
# as well, idempotently, so the kiosk starts regardless of which stack is live.
LABWC_DIR="${HOME}/.config/labwc"
if [ -d "$LABWC_DIR" ] || command -v labwc >/dev/null 2>&1; then
  mkdir -p "$LABWC_DIR"
  touch "${LABWC_DIR}/autostart"
  if ! grep -qF "${APPDIR}/scripts/kiosk.sh" "${LABWC_DIR}/autostart"; then
    echo "${APPDIR}/scripts/kiosk.sh &" >> "${LABWC_DIR}/autostart"
  fi
  say "labwc detected — kiosk added to ~/.config/labwc/autostart too"
fi

# --------------------------------------------------------------- screen

say "Disabling screen blanking"
# raspi-config's non-interactive mode handles both X11 and Wayland sessions,
# which the old lightdm-only edit did not.
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_blanking 1 || echo "(could not disable blanking via raspi-config)"
elif [ -f /etc/lightdm/lightdm.conf ] && ! grep -q "xserver-command=X -s 0 -dpms" /etc/lightdm/lightdm.conf; then
  sudo sed -i '/^\[Seat:\*\]/a xserver-command=X -s 0 -dpms' /etc/lightdm/lightdm.conf || true
fi

cat <<EOF

  Done.

  The board is running now:   http://127.0.0.1:8080
  Open it full-screen:        bash ${APPDIR}/scripts/kiosk.sh
  Or just reboot — it starts by itself:   sudo reboot

  Useful commands
    sudo systemctl status taskboard      # is it running?
    sudo journalctl -u taskboard -f      # live logs
    sudo systemctl restart taskboard     # after editing files

  Your data lives in ${APPDIR}/data/board.json — copy that file to back it up.

EOF
