---
repo: kuro-screensaver
stand: 2026-10-04
liefert:
  - id: szene-video
    artefakt: eine der acht Szenen in einem Phosphor-Preset als Videoaufnahme der laufenden Engine, Parameter per URL (Szene, Preset, Nebel, Wetter, Bloom, Hoehe, HUD aus)
    format: "WebM 1280x720 aus Playwright (recordVideo), 15 s; Parameter in der URL von screensaver.html"
    deterministisch_aus: []
    befehl: "npm run dev, dann node scripts/render-proof.mjs  (Szene und Preset in der URL-Konstante des Skripts)"
    lizenz: "AGPL-3.0-only; kommerzielle Lizenz auf Anfrage (LICENSING.md)"
  - id: motion-gif
    artefakt: das README-GIF der Terrain-Szene, unter dem GIF-Budget des Workspace-Standards
    format: "GIF 640 px breit, 8 Bilder je Sekunde, 4 s, 16 Farben"
    deterministisch_aus: []
    befehl: "npm run dev, dann node scripts/render-motion-gif.mjs"
    lizenz: "AGPL-3.0-only; kommerzielle Lizenz auf Anfrage (LICENSING.md)"
nicht_geliefert:
  - was: deterministische Bildfolge aus Szene, Seed, Preset und Zeit (dasselbe Bild bei derselben Zeit)
    grund: Die Engine laeuft nach Wanduhr (performance.now, requestAnimationFrame); ein Modus „rendere Zeitpunkt t“ fehlt. Bedarf der Medienintegration (Spec § 6, erste Zeile), wird gebaut, wenn ein Storyboard ihn verlangt
  - was: Szene als Live-Ebene in einer fremden Komposition (Three.js-Adapter von HyperFrames)
    grund: braucht denselben Modus wie die Bildfolge
  - was: Absturzsequenz als Bildfolge oder Video
    grund: nur über scripts/crash-preview.mjs mit DEV-Hook window.__kuro, kein Angebot
  - was: CRT-Pass als eigenstaendiger Effekt auf fremdem Material
    grund: Der Pass haengt an der Engine (src/engine/fx/crt-sim.ts); als Baustein kommt er in clipwerk, nachgebaut aus den Werten im Rollenblatt von birds of yore
---
# Angebot

Der Screensaver liefert **Bewegtbild seiner Welt**: acht geseedete Szenen, dreizehn Phosphor-Presets, Bankflüge; die Absturzsequenz steht unter „nicht geliefert“. Heute als Aufnahme der laufenden Engine, nicht als deterministische Bildfolge; der Unterschied steht oben unter „nicht geliefert“, weil ein Konsument ihn kennen muss.

## Holen

Dev-Server starten, Szene und Parameter in der URL des Skripts setzen, `node scripts/render-proof.mjs` ausführen; Ergebnis `render-out/proof.webm`. Ein Konsument friert die Datei ein und stempelt Repo, Commit, Lizenz, Szene, Preset und URL-Parameter (PROF-MEDIA-02); ohne die Parameter ist die Aufnahme nicht reproduzierbar.

## Was es nicht ist

Kein seekbares Material: zwei Aufnahmen mit denselben Parametern unterscheiden sich im Takt. Keine Tonspur im Export; die prozedurale Klangschicht läuft nur live. Beide Skripte laufen headful mit Metal (`--use-angle=metal`), brauchen also einen Mac mit GPU und ein sichtbares Fenster; das GIF-Skript braucht `ffmpeg` im PATH.

## Geprüft

`npm test` (vitest, 121 Tests bestanden am 2026-10-04); `node scripts/verify-crt.mjs` für den CRT-Pass (am 2026-10-04 nicht erneut gelaufen); das Motion-GIF liegt unter Budget (1756 KB von 2048 KB am 2026-10-04, `render-motion-gif.mjs` bricht sonst ab).
