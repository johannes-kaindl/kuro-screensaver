# Audit: `../kuro/` (Schwester-Ordner `kuro/` im Workspace)

**Datum:** 2026-05-26
**Zweck:** Überblick & Konsolidierungsempfehlungen pro Unterordner.

## Klassifikation

### KEEP — Source-of-Truth, aktiv

| Ordner | Was | Status |
|---|---|---|
| `kuro-theme-settings/` | Companion-Plugin v0.4.0 (TS-Source) — kanonisches Source-Repo | Git ✓, last commit 2026-04-26 |
| `animation/` | Standalone Screensaver-Engine (heute extrahiert) | Git ✓, init heute |

### DELETE — leer / Müll

| Ordner | Was | Empfehlung |
|---|---|---|
| `Neuer Ordner/` | 0 Files | **Sicher löschen** |

### ARCHIVE — Build-Output / Backup-Dateien, nicht source

| Ordner | Was | Empfehlung |
|---|---|---|
| `kuro-companion/` | Dist-Output (bundled main.js) von `kuro-theme-settings` | **In ein `_attic/` schieben.** Bei Bedarf vom Plugin-`sync.sh` regeneriert. |
| `field-report/theme.css.bak`, `theme.css.pre-refactor.bak` | Alte Backups (vor Refactor 2026-05-02) | **In `_attic/` schieben** |
| `_kuro/theme.bak` | Alter Backup | **In `_attic/` schieben** |
| `kuro-theme-2.0-assets/*.zip` Duplikate `(1)`…`(6)` | Nummerierte Download-Duplikate | **In `_attic/` schieben** (Original `.zip` ohne Nummer behalten) |

### UNKLAR — Rückfrage nötig

| Ordner | Frage |
|---|---|
| `_kuro/` vs `Kuro/` | `_kuro` v1.0.0 (Unterstrich-Konvention, Obsidian lädt zuerst). `Kuro/` v3.2.0 (neuer, mit Author/URL). Welches ist die Production-Quelle? Sind beide nötig? |
| `kuro2-theme-settings/` | v2.0.0-Variante, `src/screensaver/` byte-identisch zu v1. Aktive Weiterentwicklung oder Sackgasse? |
| `kuro-theme-2.0-assets/` | Sammlung mit `.css`, `_extracted/`, `wallpapers/`, `README.md`, `SKILL.md` für "Kuro Signal Protocol" (= v2). Soll das in `kuro2-theme-settings/assets/` zusammengeführt werden? |
| `kuro-gamification/` | Eigenes Plugin "Neurodivergence-friendly gamification". Nur bundled main.js, kein Source. Ist das aktiv? Wo ist der Source? |
| `field-report/` | Eigenes Theme "engineered literary simulation". 3 Wo. alt, kein Git. Aktiv weiterentwickelt? |

## Empfohlener Cleanup-Workflow

1. **Sofort autonom:** `Neuer Ordner/` löschen.
2. **Autonom mit Attic:** `_attic/`-Ordner anlegen, dort `kuro-companion/`, `.bak`-Files und nummerierte zip-Duplikate hineinverschieben (nichts wird gelöscht, nur „aus dem Weg geräumt"). User kann jederzeit zurückverschieben.
3. **Mit Rückfrage:** die 5 UNKLAR-Fälle gemeinsam durchgehen.

## Strukturvorschlag nach Cleanup

```
../kuro/
├── animation/                    # Standalone Engine
├── kuro-theme-settings/          # Companion-Plugin Source (Git)
├── [evtl. kuro2-theme-settings/] # falls noch aktiv
├── [evtl. Kuro/ oder _kuro/]     # genau eine Theme-Quelle
├── [evtl. field-report/]         # falls aktiv weiterentwickelt
├── [evtl. kuro-gamification/]    # falls aktiv und Source da
└── _attic/                       # nicht-gelöscht, aber aus dem Weg
    ├── kuro-companion-dist/
    ├── field-report-backups/
    ├── _kuro-theme.bak
    └── kuro-theme-2.0-assets-zip-duplikate/
```
