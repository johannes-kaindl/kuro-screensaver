# v1/v2-Merge — Build-Variants Refactor

**Datum:** 2026-05-26
**Repos:** `kuro-theme-settings/` (Master, Git) + `kuro2-theme-settings/` (wird absorbiert)
**Strategie:** Build-Variants per env-Var `KURO_THEME=v1|v2`

## Was ist v1-spezifisch vs v2-spezifisch?

**v2-only Feature: Aspects (Statusbar-Chip + Frontmatter-Override)**
- `main.ts`: +44 Zeilen — `aspectStatusEl`, Click-Handler cycelt Aspect, `renderAspectChip()`
- `legacy.ts`: `ASPECTS`, `ASPECT_LABELS`, `ASPECT_KANJI` Exports + Aspect-Resolver-Logik (+349 Zeilen)
- `settings/tab.ts`: Aspect-Picker UI (+16 Zeilen)
- `styles.css`: `.kuro2-aspect-chip`, `.kuro2-aspect-glyph` (+116 Zeilen)

**Theme-Identität (immer pro Variant unterschiedlich):**
- `manifest.json`: id, name, description, version
- Plugin-Klasse intern: kein Unterschied beim Klassenname (`KuroThemeSettingsPlugin`), aber DEFAULT_SETTINGS-Inhalt
- `sync.sh`: Ziel-Vault-Pfad
- Color-Presets (v1 = Kuro-Style, v2 = Signal-Protocol)

**Identisch v1+v2:**
- Komplett: `src/screensaver/` (Engine, Scenes, FX, Audio, Terminal, HUD, Data)
- `src/settings/tab-screensaver.ts`
- `esbuild.config.mjs` (50 Zeilen, identisch)
- `tsconfig.json`, `lefthook.yml`, docs

## Refactor-Architektur

```
kuro-theme-settings/  (= Master)
├── manifest.v1.json          ← _kuro-theme-settings, v0.4.0
├── manifest.v2.json          ← _kuro2-theme-settings, v2.0.0
├── styles.v1.css             ← v1-Styles
├── styles.v2.css             ← v2-Styles + Aspect-Chip
├── esbuild.config.mjs        ← liest env KURO_THEME, outdir = dist/<variant>/
├── sync.v1.sh                ← Sync v1 ins Vault
├── sync.v2.sh                ← Sync v2 ins Vault
├── src/
│   ├── main.ts               ← THEME = import.meta.env.KURO_THEME | esbuild --define
│   ├── settings/
│   │   ├── tab.ts            ← rendert variant-aware (Aspect-Picker nur bei v2)
│   │   └── tab-screensaver.ts
│   ├── screensaver/          (unverändert)
│   ├── legacy.ts             ← gemeinsame Plugin-Klasse, DEFAULT_SETTINGS gemerged
│   └── themes/
│       ├── types.ts          ← interface ThemeVariant { id, name, presets, aspects?, ... }
│       ├── variant.ts        ← exports active variant (chosen by build-time define)
│       ├── v1.ts             ← const V1: ThemeVariant = { ... Kuro v1 ... }
│       └── v2.ts             ← const V2: ThemeVariant = { ... Signal Protocol mit aspects ... }
└── dist/
    ├── v1/main.js, manifest.json, styles.css
    └── v2/main.js, manifest.json, styles.css
```

## Build-Mechanik

```js
// esbuild.config.mjs (Auszug)
const variant = process.env.KURO_THEME || 'v1';
await build({
  entryPoints: ['src/main.ts'],
  outdir: `dist/${variant}`,
  define: { '__KURO_VARIANT__': JSON.stringify(variant) },
});
// + copy: manifest.${variant}.json → dist/${variant}/manifest.json
// + copy: styles.${variant}.css → dist/${variant}/styles.css
```

```ts
// src/themes/variant.ts
declare const __KURO_VARIANT__: 'v1' | 'v2';
import { V1 } from './v1';
import { V2 } from './v2';
export const THEME = __KURO_VARIANT__ === 'v2' ? V2 : V1;
```

```ts
// src/main.ts (Auszug)
import { THEME } from './themes/variant';

export default class Plugin extends Plugin {
  async onload() {
    // ...
    if (THEME.hasAspects) {
      this.setupAspectChip();  // v2-only path
    }
  }
}
```

## Migrations-Reihenfolge

1. Auf Feature-Branch `feat/v1-v2-merge` arbeiten.
2. Theme-Variant Interface + V1/V2 Module anlegen.
3. legacy.ts splitten: gemeinsamer Code bleibt, Theme-spezifisches in `themes/v1.ts` und `themes/v2.ts`.
4. main.ts: Aspect-Setup hinter `THEME.hasAspects`-Guard.
5. settings/tab.ts: Aspect-Picker hinter Guard.
6. styles.css → styles.v1.css + styles.v2.css.
7. manifest.v1.json + manifest.v2.json anlegen.
8. esbuild.config.mjs anpassen für Variant-Build.
9. Beide Builds testen (Output ≡ aktuelle v1- und v2-Dist).
10. Branch mergen.
11. `kuro2-theme-settings/` ins Attic.

## Verifikations-Kriterien

- `KURO_THEME=v1 npm run build` produziert `dist/v1/main.js` + `manifest.json` + `styles.css` — funktional identisch zu aktuellem v1-Output.
- `KURO_THEME=v2 npm run build` produziert dasselbe für v2 (inkl. Aspect-Chip).
- Beide Plugins lassen sich parallel in Vaults installieren (unterschiedliche manifest-ids).
- Kein Code-Block in src/screensaver/ angefasst (Engine bleibt unverändert).

## Out-of-Scope für diesen Refactor

- Engine als externes pnpm-Workspace-Package extrahieren (= übernächste Iteration).
- v1+v2 Theme-Files (`Kuro/`) konsolidieren (= separater Refactor, Themes sind nicht Plugin).
- kuro-gamification Source-Reconstruction (= separate Aufgabe).
