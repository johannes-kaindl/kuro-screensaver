# 2026-05-27 — Companion Rollback

Rückspulen der animation-Engine auf den deployed-Companion-Stand vom 2026-05-13.

## Kontext

Am 2026-05-26 wurde die Screensaver-Engine in zwei Schritten umgebaut:

1. **Extract** aus `kuro-companion` → Standalone-Projekt `animation/` (Vite/TS).
2. **Konsolidierung** — Engine wurde dabei deutlich abgespeckt (≈700 Zeilen
   Netto-Reduktion verteilt über 10 Files; `menubar.ts` fiel raus). Das
   Refactor führte ein `ScreensaverHost`-Interface ein als saubere
   Boundary, sodass die Engine keinen `from 'obsidian'`-Import mehr braucht.

Heute (2026-05-27) festgestellt: das tatsächlich im X1_v6t2b9-Vault deployed
Plugin (`main.js` vom 13.5., 707 KB) hat **funktional mehr** drin als die
konsolidierte Variante. Die Slimming-Refactors am 26.5. haben Features
weggekürzt, die der User noch nutzen wollte (reichere Audio-Layer,
embedded-Menubar, mehr Detail in Scenes void/tunnel/core).

## Entscheidung

Voll-Rollback der `src/engine/`-Engine auf den Source-Stand vom 13.5., der
zum deployed `main.js` gehört. Im Tausch:

- Die `ScreensaverHost`-Boundary-Abstraktion aus dem Konsolidierungs-Pass
  fällt aus dem Standalone wieder weg.
- Stattdessen erwartet `controller.ts` wieder ein **Plugin-shaped Objekt**
  (settings-Tree + `saveData()`); im Standalone-Web-Host wird das von einem
  Shim erfüllt.

## Was sich geändert hat

### Engine (`src/engine/`)
- **Files überschrieben** (alle aus
  `<kuro-konsolidierung>/kuro-companion/src/screensaver/` (maintainer-lokaler Konsolidierungs-Ordner) Stand
  2026-05-13): `audio/synth.ts`, `controller.ts`, `data/defaults.ts`,
  `data/dictionary.ts`, `engine/color.ts`, `engine/core.ts`,
  `engine/scenes/tunnel.ts`, `engine/scenes/void.ts`, `hud/boot.ts`,
  `hud/index.ts`.
- **Neu**: `src/engine/menubar.ts` (Embed-Pane-Steuerleiste; im Standalone
  derzeit ungenutzt, behalten für Plugin-Backport).
- **Behalten**: `host.ts` (jetzt ungenutzt im Standalone, aber als Doku des
  Konsolidierungs-Versuchs vorerst belassen — kann beim nächsten Plugin-
  Sync-Roundtrip entschieden werden), `data/presets.ts` (PRESETS-Konstante
  aus dem 26.5.-Refactor).
- **Boundary-Patches in der zurückgespulten Source**:
  - `controller.ts`: `import type { Plugin } from 'obsidian'` ersetzt durch
    lokales `interface HostPlugin`, sodass die Engine compiliert ohne dass
    `obsidian` in den Dependencies steckt.
  - `controller.ts`, `engine/color.ts`: `import { PRESETS } from '../legacy'`
    → `from './data/presets'` (legacy.ts existiert nur im Plugin-Repo).

### Web-Host (`src/host-web/`)
- **Neu**: `plugin-shim.ts` — wrappt `WebHost` als Plugin-shaped Objekt
  (settings-Tree, async `saveData`, leerer App-Stub). Live-Referenz auf
  `screensaver`-Settings, sodass in-place-Mutationen vom Controller
  persistieren.
- **Neu**: `obsidian-dom-polyfill.ts` — füllt `HTMLElement.prototype` mit
  `createEl`/`createDiv`/`createSpan`/`empty` (Obsidian-Erweiterungen), die
  die zurückgespulte Engine in mehreren Files verwendet. Wird einmal in
  `mount.ts` ganz oben importiert.
- `mount.ts`: nutzt `makePluginShim(host)` statt direkt `host` als
  Controller-Konstruktor-Argument.

### Inhaltliche Fixes obendrauf
- `engine/scenes/terrain.ts`: `heightAt(x,z,t)` → `heightAt(x,z)`. Der
  `t`-Anteil hatte die Heightfield per-Frame moduliert (Berge sahen aus
  wie Wellen). Der Code-Kommentar im File hatte das schon als
  unbeabsichtigt beschrieben.
- `engine/scenes/terrain.ts`: Heightfield-Sampling von per-Frame auf
  per-Wrap umgestellt. Da `heightAt` jetzt zeitunabhängig ist, ändert sich
  pro Vertex zwischen Wraps nichts; vorher: ≈37k `setY()` + 2
  `computeVertexNormals()` pro Frame, jetzt: 0.
- `controller.ts`: Space-Taste mappt jetzt auf Pause-Toggle (gleiche
  Handler-Stelle wie `P`). Vorher fiel Space in den default-"any key
  closes"-Pfad.

## Was das für `kuro-theme-settings` bedeutet

Das `sync-to-plugin.sh` würde aktuell die Engine **mit Plugin-Type-Erwartung**
ins Plugin schreiben. Das Plugin hat aber einen `ObsidianScreensaverHost`-
Adapter, der auf der 26.5.-`ScreensaverHost`-Boundary baut. Naiver Sync
würde das Plugin brechen.

**Bevor der nächste Sync passiert**, im Plugin entscheiden:
- **Option A**: Plugin auf zurückgespulten Stand bringen — `host-obsidian.ts`
  raus, `main.ts` (oder wo der Controller instanziiert wird) übergibt
  wieder direkt das Plugin selbst (`new ScreensaverController(this)`).
- **Option B**: Sync deaktivieren, Engine im Plugin manuell pflegen.
- **Option C**: Boundary-Refactor (26.5.) erneut machen, diesmal **ohne**
  Slimming der Engine-Features — controller.ts auf `ScreensaverHost`
  umbauen, aber audio/synth, scenes etc. so reich lassen wie heute.

Bis Entscheidung: `sync-to-plugin.sh` bricht standardmäßig ab (siehe Skript-
Header). Override über `--i-know-what-im-doing`.

## Verify

- `npm run typecheck` ✓
- `npm run build` ✓ (Bundle 602 KB, 40 Module)
- Browser-Verify durch User: Boot, alle Szenen, Audio, Hotkeys (inkl. neuer
  Space-Pause), Terrain ohne Wellen — ✓.

## Verwandte Specs

- `2026-05-26-screensaver-extract-design.md` — der ursprüngliche Extract;
  beschreibt die Slimming-Intention, die dieses Doc rückgängig macht.
- `2026-05-26-v1-v2-merge-design.md` — separater Plugin-Refactor, vom
  Rollback nicht betroffen.
