# Portable Pi Configuration

This repository contains the portable parts of the Pi coding agent configuration.

## Included

- `agent/settings.json` — Pi settings and package list
- `agent/APPEND_SYSTEM.md` — appended system instructions
- `agent/extensions/` — local extensions

## Excluded

- `agent/auth.json` — credentials / login data
- `agent/sessions/` — conversation history
- `agent/npm/` — installed package cache / `node_modules`
- `agent/bin/` — local binaries

## Install on another machine

```bash
# Install Pi first, then clone this repo as ~/.pi
git clone <your-private-repo-url> ~/.pi

# Start Pi once, or reconcile packages explicitly:
pi update --extensions
```

If packages are not installed automatically, run:

```bash
pi install npm:pi-web-access
```

Then configure credentials on that machine separately, for example with `pi login`, `/login`, or environment variables. Do not commit `agent/auth.json`.

## Notes

This repo should normally be private because local extensions execute with full system permissions and system prompts may reveal personal workflow preferences.
