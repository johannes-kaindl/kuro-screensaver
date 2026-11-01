---
paths:
  - "scripts/bump-version.sh"
  - "scripts/package-native-app.sh"
  - "scripts/package-windows*.sh"
  - "scripts/deploy-page.sh"
  - ".github/workflows/release.yml"
  - "CHANGELOG.md"
---

# Release schneiden und die Seite deployen

Ablauf eines Releases und der separate Deploy der Web-Seite. Lädt, sobald eines der Release-Skripte oder der Release-Workflow berührt wird. Verschoben aus dem Kern der `AGENTS.md` (Wortlaut unverändert).

Releases: GitHub Actions (`johannes-kaindl/kuro-screensaver`) typechecks + runs the
native tests, compile-checks the macOS app, builds the Windows `.scr`, and attaches
the `.scr` to the release. The **notarized macOS app** is built + attached
locally (CI has no Developer ID cert). Cut a release: `bash scripts/bump-version.sh
X.Y.Z` (single source — writes package.json + the app Info.plist together), commit,
then `git tag vX.Y.Z && git push origin main vX.Y.Z` (the Forgejo→GitHub push mirror
forwards the tag to trigger CI). Build + attach the notarized app with
`scripts/package-native-app.sh`. **The web page is not part of any of this** —
`scripts/deploy-page.sh` (rsync, local SSH deploy key, so CI cannot do it) is a
separate manual step and is therefore the one that gets forgotten: on 2026-08-20 the
live bundle was still two releases behind and did not know the METRO scene. After a
release, deploy it and read the live bundle back. See `docs/specs/2026-05-28-screensaver-native-port-*.md`.
