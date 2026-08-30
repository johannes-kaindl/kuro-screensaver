# Contributing

Thanks for looking. This is primarily a personal project, so the honest
expectation-setting first: **issues and small, focused pull requests are
welcome; large changes should be discussed first**, because much of what looks
like a free-standing improvement here is entangled with a hand-maintained
port on another platform.

By contributing you agree to the [Contributor License Agreement](CLA.md), which
keeps the [dual-licensing model](LICENSING.md) possible.

## What this project is

A retro-CRT 3D screensaver engine that runs in the browser and ships as three
native hosts: a Metal app on macOS, a `.scr` on Windows, and (in progress) a
GTK/WebKit host on Linux. `AGENTS.md` is the working document — read it before
anything non-trivial. It carries the architecture notes, the host boundary, and
the traps that cost real time.

## Getting set up

```bash
npm ci
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # path guard + vitest
```

The native tests need no Xcode, only a Swift toolchain:

```bash
bash scripts/run-native-tests.sh
```

## Before you open a pull request

- `npm run typecheck` and `npm test` pass.
- If you touched anything under `native/macos/`, `bash scripts/run-native-tests.sh`
  passes too.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
  Commits made with an AI pair carry a `Co-Authored-By:` trailer.

## Three things that are easy to get wrong

**1. The engine must not import from `obsidian`.** This engine is shared with an
Obsidian plugin, and the plugin shape it depends on is declared *locally* in
`src/engine/controller.ts`. The web host bridges it via a shim. An `import` from
`obsidian` anywhere under `src/engine/` breaks the standalone build.

**2. The default-settings query is a contract, not a convention.**
`native/shared/query-contract.txt` holds the query that unchanged defaults must
produce, and four test suites read it — the three hosts and the web. Changing
that line means changing all four sides together. Regenerate it from the code
(`options_test --print-default-query`); never retype it.

**3. The macOS engine is a hand-maintained twin, not a build artefact.** Story
*content* is authored once in `src/engine/data/story-content.json` and read by
both sides; story *logic* (phases, timing, RNG) is deliberately duplicated in
Swift. A parity test compares the two. A mismatch there is a content finding,
not a test defect — fix the content or move the literal to the shared source,
but do not relax the test.

## Reporting a bug

Please say which build (web / macOS app / Windows `.scr`), which version, and
what the screen actually did. For anything visual, a photo or screen recording
is worth more than a description — most of this project's bugs are things that
look wrong rather than things that throw.

For security issues, see [`SECURITY.md`](SECURITY.md) instead.
