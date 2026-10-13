# SilentGroupCall

A Vencord plugin that starts DM and group calls without ringing the other members. They still see the call and can join it; they just don't get the ring.

## Features

- **Silent calls**: the call button joins the call without ringing anyone.
- **Pick who to ring**: right-click the call button in a group DM, tick the friends you want to ring, then click "Start call".
- **Manual rings still work**: right-click someone → "Ring to Call" rings them as usual.

## Settings

- **Silence group calls** (default on)
- **Silence DM calls** (default off)
- **Debug logs** (default off): logs every ring decision to the DevTools console.

## How it works

Discord rings people with a separate `POST /channels/{id}/call/ring` request. The plugin drops that request, or narrows it to the people you picked, but only when it's the automatic ring right after you start a call. It never sends requests of its own.

## Install

See [INSTALL.md](INSTALL.md).

## License

MIT
