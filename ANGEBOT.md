---
repo: kuro-screensaver
stand: 2026-10-05
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
  - id: szene-bildfolge
    artefakt: deterministische PNG-Bildfolge einer Szene in einem Preset aus Seed, Dauer und Bildrate, dasselbe Bild bei derselben Zeit, mit bildfolge.json (Parameter, Zeit und sha256 je Bild, Herkunft mit Commit)
    format: "PNG frame-NNNN.png, Groesse und fps als Parameter (Standard 1920x1080, 24 fps), ohne HUD und Terminal; bildfolge.json daneben"
    deterministisch_aus: [szene, preset, seed, fps, dauer, vorlauf, threat, extra, groesse, commit, chromium-version, gpu]
    befehl: "node scripts/render-sequence.mjs --scene <szene> --preset <id> --seed <n> --seconds <s> --fps <n> (startet seinen eigenen Dev-Server); --check rendert zweimal und vergleicht Hashes und Pixeldifferenz"
    lizenz: "AGPL-3.0-only; kommerzielle Lizenz auf Anfrage (LICENSING.md)"
  - id: absturz-bildfolge
    artefakt: die CRT-Absturzsequenz (Signalstoerung, Kollaps auf die Linie, Schwarz, Reboot-Flackern) ueber einer Szene als Bildfolge, vorwaerts oder rueckwaerts
    format: "wie szene-bildfolge; --crash forward|reverse, rueckwaerts mit neu ab 0 gezaehltem t"
    deterministisch_aus: [szene, preset, seed, fps, dauer, vorlauf, threat, extra, groesse, commit, chromium-version, gpu]
    befehl: "node scripts/render-sequence.mjs --scene <szene> --preset kuro --crash forward --seconds 1.6 (startet seinen eigenen Dev-Server)"
    lizenz: "AGPL-3.0-only; kommerzielle Lizenz auf Anfrage (LICENSING.md)"
nicht_geliefert:
  - was: Szene als Live-Ebene in einer fremden Komposition (Three.js-Adapter von HyperFrames)
    grund: braucht einen Modus der Engine, der t von aussen nimmt; die Bildfolge umgeht ihn ueber die gestellte Uhr des Renderers
  - was: CRT-Pass als eigenstaendiger Effekt auf fremdem Material
    grund: Der Pass haengt an der Engine (src/engine/fx/crt-sim.ts); als Baustein kommt er in clipwerk, nachgebaut aus den Werten im Rollenblatt von birds of yore
---
# Angebot

Der Screensaver liefert **Bewegtbild seiner Welt**: acht geseedete Szenen, dreizehn Phosphor-Presets, Bankflüge, die CRT-Absturzsequenz. Seit 2026-10-05 als **deterministische Bildfolge** (`szene-bildfolge`, `absturz-bildfolge`) neben der Aufnahme der laufenden Engine (`szene-video`).

Wie die Bildfolge deterministisch wird, ohne die Engine umzubauen: Die Engine läuft weiter nach Wanduhr, aber der Renderer (`scripts/render-sequence.mjs`, Playwright) stellt die Uhr. `page.clock` wird vor dem Laden auf einen festen Zeitpunkt pausiert und je Bild um `1000/fps` ms vorgerückt, `Math.random` ist vor dem Laden durch einen geseedeten Generator ersetzt, `?seed=` pinnt `settings.seedLock`, `?hud=off` und `?ping=off` nehmen Readouts, Kontrollleiste, Kanji und den Radar-Ring aus dem Bild, die Animationsuhr des Compositors ist per CDP eingefroren und wird je Bild über die Web-Animations-API auf die gestellte Zeit gesetzt; das Skript startet seinen eigenen Dev-Server auf einem freien Port, damit kein fremder Stand aufgenommen wird. Jede dieser Stufen ist gemessen (2026-10-05, CITY und TUNNEL in `kuro`, Chromium 148 über Metal): ohne sie weichen zwei Läufe in jedem Bild ab, mit ihnen sind Zeitachse, Kamera und Szene gleich und die Bytes bis auf höchstens 2 von 255 je Kanal (GPU-Rundung in der Effektkette; bei 24 fps 45 bis 48 von 48 Bildern byte-gleich, bei 30 fps keines, max 2). Byte-Gleichheit ist also nicht die Zusage, Gleichheit bis auf diese Rundung schon. `chromium-version` und `gpu` stehen deshalb in `deterministisch_aus`: ein anderer Rasterizer gibt andere Bytes (SwiftShader gemessen: 1 von 48 gleich). `--check` rendert zweimal und meldet `byte-gleich`, `gleich bis auf Rauschen` (bis 8 von 255) oder `verschieden` mit den Bildern.

## Holen

`node scripts/render-sequence.mjs --scene city --preset kuro --seed 7 --seconds 9 --fps 30` (das Skript startet und beendet seinen eigenen Vite-Dev-Server, DEV-Build mit dem Hook `window.__kuro` für den Absturz; ein `--out`-Ordner mit fremden Dateien wird nicht geleert); Ergebnis `render-out/<szene>-<preset>-s<seed>/` mit `frame-NNNN.png` und `bildfolge.json` (Herkunft: Repo, Commit, Lizenz, Playwright- und Chromium-Version, dazu `unsauber` leer, sonst bricht das Skript ab, außer mit `--allow-dirty` für Messläufe). Ein Konsument übernimmt `bildfolge.json` → `herkunft` ins Manifest (PROF-MEDIA-02); `render-out/` ist nicht im Git. Für das WebM weiter `node scripts/render-proof.mjs` (Szene und Preset in der URL-Konstante des Skripts).

## Was es nicht ist

Keine Tonspur im Export; die prozedurale Klangschicht läuft nur live. Die Skripte laufen headful mit Metal (`--use-angle=metal`), brauchen also einen Mac mit GPU und ein sichtbares Fenster (`--renderer swiftshader` läuft headless, ist aber gemessen langsamer und weniger reproduzierbar); `render-sequence.mjs --check` und das GIF-Skript brauchen `ffmpeg` im PATH. Das WebM aus `render-proof.mjs` bleibt nicht seekbar (Wanduhr); wer Determinismus braucht, nimmt die Bildfolge.

## Geprüft

`npm test` (vitest, 141 Tests bestanden am 2026-10-05, darunter `tests/bildfolge.test.ts` für Argumente, Umkehrung, Manifest und Vergleich); `render-sequence.mjs --check` am 2026-10-05: CITY 2 s bei 24 fps 45–48/48 byte-gleich (max 1/255), TUNNEL 47/48 (max 1), Absturz 3 s in drei Läufen 17/72, 17/72, 72/72 (max 2, 2, 0), nach der Review bei 30 fps 0/60 byte-gleich mit max 2/255. Gelieferte Folgen 2026-10-05 (Gate 6 der Welle Medien-1): CITY 9 s und TUNNEL 6 s, Absturz vorwärts und rückwärts je 1,6 s, Preset `kuro`, Seed 7, 30 fps. `node scripts/verify-crt.mjs` für den CRT-Pass (nicht erneut gelaufen); das Motion-GIF liegt unter Budget (1756 KB von 2048 KB am 2026-10-04).
