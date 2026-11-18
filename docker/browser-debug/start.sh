#!/bin/sh
set -eu

wait_for_display() {
    attempt=0
    until [ -S /tmp/.X11-unix/X99 ]; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 100 ]; then
            echo 'X display did not start' >&2
            exit 1
        fi
        sleep 0.1
    done
}

case "${1:-}" in
    desktop)
        wait_for_display
        exec /usr/bin/openbox --sm-disable
        ;;
    vnc)
        wait_for_display
        exec /usr/bin/x11vnc -display "$DISPLAY" -forever -shared \
            -rfbport 5900 -localhost -nopw -xkb
        ;;
    input-method)
        wait_for_display
        exec /usr/bin/fcitx5 --replace
        ;;
    browser)
        wait_for_display
        attempt=0
        until /usr/bin/dbus-send --session --print-reply \
            --dest=org.freedesktop.DBus /org/freedesktop/DBus \
            org.freedesktop.DBus.NameHasOwner string:org.fcitx.Fcitx5 \
            2>/dev/null | grep -q 'boolean true'; do
            attempt=$((attempt + 1))
            if [ "$attempt" -ge 100 ]; then
                echo 'Input method did not start' >&2
                exit 1
            fi
            sleep 0.1
        done
        set -- /ms-playwright/chromium-*/chrome-linux64/chrome
        if [ "$#" -ne 1 ] || [ ! -x "$1" ]; then
            echo 'Expected one bundled Chromium executable' >&2
            exit 1
        fi
        exec "$1" --no-sandbox --user-data-dir="$HOME/browser-profile" \
            --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
            --no-first-run --no-default-browser-check --lang=ko-KR \
            --window-size=1440,1000 --start-maximized about:blank
        ;;
    *)
        echo 'Usage: start.sh desktop|vnc|input-method|browser' >&2
        exit 2
        ;;
esac
