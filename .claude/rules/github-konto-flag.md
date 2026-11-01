---
paths:
  - ".github/**"
  - "README.md"
---

# GitHub-Konto geflaggt — Badge und Actions

Zwei Befunde zum geflaggten GitHub-Konto: warum die README kein CI-Badge trägt und warum Actions kontoweit stehen. Lädt, sobald unter `.github/` oder die README berührt wird. Verschoben aus dem Kern der `AGENTS.md` (Wortlaut unverändert).

- **Kein CI-Badge in der Badge-Zeile (CORE-META-02), weil das GitHub-Konto geflaggt ist.**
  Die Regel nennt die Reihenfolge Lizenz·Release·CI·Plattform·Downloads und sagt "nicht
  zutreffende weglassen". Der CI-Fall ist hier keiner: die Actions laufen auf dem
  GitHub-Mirror, und **GitHub blendet das Konto `johannes-kaindl` fuer nicht angemeldete
  Besucher vollstaendig aus** — Profil, Repos und Badge-URL liefern anonym HTTP 404,
  waehrend eingeloggt alles normal aussieht (das Repo traegt "Public", das Badge zeigt
  `ci · passing`). Ein Actions-Badge waere fuer jeden fremden Leser ein kaputtes Bild.
  Es kommt zurueck, sobald das Flag aufgehoben ist.
  **Wie das belegt ist — und warum es zwei Anlaeufe brauchte:** der erste Befund stuetzte
  sich nur auf 404 aus dieser Entwicklungsumgebung. Das ist zu wenig: ein 404 aus einer
  Sandbox misst die eigene Netzwerkstrecke mit. Der Schluss wurde deshalb zwischenzeitlich
  zurueckgenommen — **und war doch richtig**, was erst die **Kontrollprobe** zeigte, die von
  Anfang an gefehlt hatte: dieselbe Strecke, anonym, gegen fremde oeffentliche Ressourcen
  (`github.com/torvalds`, `api.github.com/repos/microsoft/vscode`) liefert **HTTP 200**, gegen
  jede Ressource dieses Kontos **404**. Dazu unabhaengig: ein privates Browserfenster des
  Maintainers sieht dasselbe 404, und GitHubs eigene Support-Seite antwortet mit
  *"Ihr Konto wurde markiert"* und verlangt eine SMS-Verifizierung. Die Lehre gilt in beide
  Richtungen: ein einzelner 404 ist kein Befund — und eine Widerlegung ohne Kontrollprobe ist
  auch keine.

- **Actions koennen kontoweit stoppen, und der Treiber ist der Speicher, nicht die Minuten.**
  Am 2026-08-30 gegen 21:25 hoerten die Laeufe auf zu starten — mitten in einer Sitzung, ohne
  Fehlermeldung: drei Pushes danach loesten nichts mehr aus, waehrend die 88 Laeufe davor gruen
  in der Liste stehen. Ursache ist kein Repo-Schalter (Actions sind erlaubt) und keine Stoerung,
  sondern **eine Abschaltung auf Kontoebene — GitHub sagt es selbst.** Ein manueller Start
  ueber `POST …/actions/workflows/ci.yml/dispatches` antwortet:
  `HTTP 422 {"message": "Actions has been disabled for this user."}`. Das "for this user" ist
  der Punkt: es haengt am Konto (das seit demselben Abend geflaggt ist, siehe § Abweichungen),
  nicht an diesem Repo. Der zweite Kandidat, ein **Account-Budget von `$0` mit "Stop usage:
  Yes"** unter *Billing → Budgets and alerts*, ist zwar gesetzt, hat diesen Monat aber nicht
  ausgeloest — die Nutzung war voll vom Freikontingent gedeckt ($8,38 brutto, $8,38 Rabatt,
  $0 berechnet). Er bleibt eine zweite scharfe Kante fuer spaeter.
  **Entwarnung fuers Wiederanlaufen:** an diesem Repo ist nichts verstellt —
  `actions/permissions` meldet `enabled: true, allowed_actions: all` (selbst gemessen, ebenso
  fuer `perlin-studio`; die `epub-exporter`-Session sieht dasselbe an drei weiteren Repos).
  Die Sperre sitzt ausschliesslich auf Kontoebene. Nach ihrer Aufhebung muss hier **nichts
  nachgezogen oder neu eingeschaltet werden**, und fuer ein Support-Ticket ist es der Beleg,
  dass keine Fehlkonfiguration vorliegt.
  **Womit man das NICHT misst: der Actions-API.** Sie verschweigt die Laeufe dieses Kontos —
  `actions/runs` meldet fuer jedes Repo hier `total_count: 0`, waehrend fremde Repos echte
  Zahlen liefern (`microsoft/vscode` 40000, `torvalds/linux` 7) und `actions/workflows`
  desselben Repos brav vier aktive Workflows zeigt. Wer mit `gh run list` misst, bekommt also
  **0 auch dann, wenn alles laeuft**. Gueltiges Instrument ist die Weboberflaeche: dort stehen
  88 Laeufe, der letzte am 2026-08-30 um 21:22.
  Die Aufschluesselung dieses Monats zeigt, wohin das Kontingent geht:

  | Posten | Menge | brutto |
  |---|---|---|
  | **Actions storage** | 14.603 GB-hr | **$4,91** |
  | Actions Linux | 331 min | $1,99 |
  | Actions macOS 3-core | 19 min | $1,18 |
  | Actions Windows | 31 min | $0,31 |

  **Knapp 60 % ist Artefakt-Speicher**, nicht Rechenzeit — was zu diesem Repo passt: jeder
  Release-Lauf legt `.scr`, Installer und Zips ab, und die Aufbewahrung steht auf **90 Tagen**
  — **seit 2026-08-30 auf 7 Tage gesenkt**, weil Release-Assets ohnehin dauerhaft am Release
  haengen und die 90 Tage nichts sicherten, was nicht schon woanders liegt. Wer hier
  CI-Kontingent sucht, schaut also zuerst auf den Speicher, nicht auf die Minuten.
