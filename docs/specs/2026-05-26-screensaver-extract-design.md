# Screensaver-Extract Design — animation/

**Datum:** 2026-05-26
**Status:** Approved (mündlich), in Umsetzung
**Quelle:** `kuro-companion` Obsidian-Plugin (Source liegt in `kuro-theme-settings/src/screensaver/`)
**Ziel:** Standalone Vite/TS-Projekt; Engine bleibt rückführbar ins Plugin.

## Motivation

Der retro 3D Screensaver (TERRAIN · CITY · RIFT · TUNNEL · VOID + CRT-Sim + Narrative Terminal + Audio) ist im Obsidian-Plugin `kuro-companion` verbacken. Wir lösen die Engine als eigenständiges Projekt heraus, damit sie:

- standalone (im Browser) weiterentwickelt werden kann
- später per Sync ins Plugin zurückgeführt wird
- in andere Projekte (kuro-gamification, field-report, …) einbindbar wird

## Architektur

```
animation/
├── package.json          # Vite 5 + three 0.164 + TS 5.4
├── tsconfig.json
├── vite.config.ts
├── index.html            # Web-Host-Entry, AutoStart-Default
├── src/
│   ├── main.ts           # Web-Host Bootstrap
│   ├── engine/           # ← portable Engine (kein 'obsidian'-Import)
│   │   ├── controller.ts # ScreensaverController, refactored: host: ScreensaverHost
│   │   ├── host.ts       # NEU: ScreensaverHost-Interface
│   │   ├── engine/core.ts, materials.ts, rng.ts, color.ts, scenes/*
│   │   ├── fx/crt-sim.ts
│   │   ├── terminal/*    # narrative, persona, typing, script-bank
│   │   ├── audio/synth.ts
│   │   ├── hud/*
│   │   └── data/         # defaults.ts, dictionary.ts, presets.ts (NEU: PRESETS extrahiert)
│   └── host-web/
│       ├── mount.ts        # Engine in #app einhängen
│       ├── persistence.ts  # localStorage-Adapter
│       └── settings.ts     # default-Settings für Standalone
```

## ScreensaverHost-Interface

Die einzige Abstraktion zwischen Engine und Außenwelt:

```ts
export interface ScreensaverHost {
  getSettings(): ScreensaverSettings;
  saveSettings(settings: ScreensaverSettings): void | Promise<void>;
  getActivePreset?(): string;   // optional, für colorMode 'kuro-auto'
  getVaultKanji?(): string;     // optional, fürs HUD
}
```

Implementierungen:
- `WebHost` (in `host-web/`): liest/schreibt `localStorage`, default-Preset `toxic-haze`
- später `ObsidianHost` (im Plugin): liest/schreibt `this.plugin.settings`

## Refactoring-Schritte am bestehenden Code

1. `PRESETS`-Konstante aus `kuro-theme-settings/src/legacy.ts` (Zeilen 31-123) als isolierte Datei `src/engine/data/presets.ts` extrahieren
2. In `controller.ts`: `import type { Plugin } from 'obsidian'` entfernen; Constructor nimmt `host: ScreensaverHost`; alle `this.plugin.…`-Aufrufe ersetzen durch `this.host.…`
3. In `engine/color.ts`: `from '../../legacy'` → `from '../data/presets'`
4. In `controller.ts`: `from '../legacy'` → `from './data/presets'`
5. `embed-view.ts` nicht portieren (gehört zum Obsidian-Host)

## Build-Setup

- **Vite 5** für HMR, GLSL-Imports, Worker-Support, moderne Browser-Targets
- **TypeScript 5.4** mit `strict: true`, `moduleResolution: "bundler"`, `target: "ES2022"`
- **three 0.164** (matching Plugin-Version, damit Backport ohne API-Drift)
- Scripts: `dev`, `build`, `preview`, `typecheck`

## Backport-Strategie (für später)

Initial: `scripts/sync-to-plugin.sh` kopiert `src/engine/` nach `kuro-theme-settings/src/screensaver/`. Plugin liefert einen `ObsidianScreensaverHost`-Adapter, der das Host-Interface implementiert.

Spätere Endstufe: pnpm-Workspace mit `packages/animation-engine` + `packages/kuro-theme-settings`, Plugin importiert `@kuro/animation-engine`.

## Verifikations-Kriterien

- `npm run typecheck` läuft fehlerfrei
- `npm run build` produziert `dist/index.html` + JS-Bundle
- `npm run dev` startet, Screensaver läuft mit Default-Scene (`city`)
- Kein `from 'obsidian'`-Import in `src/engine/**`
