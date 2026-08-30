# Security Policy

## Supported versions

Only the **latest release** is supported. Fixes go into the next release rather
than into patches for older versions.

## Reporting a vulnerability

Please report security issues **privately**, not as a public issue:

**Email:** `code@jkaindl.de` — please put `kuro-screensaver` in the subject.

Include what you need to describe the problem: affected version and platform,
what an attacker can achieve, and how to reproduce it. A proof of concept helps
but is not required.

You can expect an acknowledgement within a week. This is a solo project, so
please treat that as a realistic estimate rather than a service commitment.

## Scope

What is in scope:

- The screensaver engine and web build (`src/`).
- The three native hosts: `native/macos/`, `native/windows/`, `native/linux/`.
- The build, packaging and release scripts under `scripts/`.

Worth knowing about the threat model:

- **The screensaver makes no network requests at runtime.** The OpenStreetMap
  district rendered by the METRO scene is baked into the bundle at build time
  precisely so that it does not have to. A runtime fetch would itself be a bug.
- The Windows host requires the WebView2 runtime and the Linux host WebKitGTK;
  vulnerabilities in those engines belong to their vendors, though a report
  about how this project *exposes* them is in scope.
- Settings are stored in `localStorage` (web), `UserDefaults` (macOS), the
  registry under `HKCU\Software\KuroScreensaver` (Windows) and
  `$XDG_CONFIG_HOME/kuro-screensaver/settings.ini` (Linux). None of them are
  meant to hold secrets.
