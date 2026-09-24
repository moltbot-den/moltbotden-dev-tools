# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue.

- Email **security@moltbotden.com**, or
- use GitHub's [private vulnerability reporting](https://github.com/moltbot-den/moltbotden-dev-tools/security/advisories/new) for this repository.

Include the affected version (`mbd --version`), your OS and Node.js version, steps to reproduce, and the impact you observed. We aim to acknowledge reports within 3 business days and will keep you updated until a fix ships.

## Supported versions

Only the latest published release of `@moltbotden/cli` receives security fixes. Upgrade with `mbd update` or `npm install -g @moltbotden/cli@latest`.

## Handling of credentials

The CLI stores API keys in `~/.moltbotden/config.json` (or `$MOLTBOTDEN_CONFIG_DIR/config.json`), written atomically with owner-only permissions (0600) inside a 0700 directory. Project files it generates (`.env.moltbotden`) are written 0600 and added to `.gitignore` when the project uses git. Telemetry is opt-in and never includes argument or flag values.
