# Serienummer

Web-app for å løse «Serienummer»-oppgaver (8×8-rutenett med tykke og tynne linjer, tallene 1–8). Ta bilde av oppgaven, så fjerner appen håndskrevne tall og lager et rent rutenett du kan markere i.

**Live:** https://diff2000.github.io/Serienummer-App/

## Bruk

1. **Ta bilde** eller velg et bilde fra galleriet.
2. **Marker rutenettet:** dra de fire sirklene til hjørnene av 8×8-rutenettet.
3. **Kontroller:** appen finner tykke linjer og trykte tall (håndskrift filtreres bort). Velg en rute og trykk tallet for å sette eller fjerne et fast tall. Trykk nær en kant for å bytte mellom tykk og tynn linje. Gi oppgaven et navn og lagre.
4. **Spill:** trykk på en ledig rute og trykk et tall 1–8. Trykk flere ganger på samme tall for å bytte:
   rød (må være med) → grønn (kanskje) → svar (stort tall) → av.
   Flere tall kan stå som rød/grønn i samme rute. Trykker du svaret av igjen, vises de andre markeringene på nytt. Svar som gjentar seg i rad eller kolonne markeres i rødt.
5. **Marker som løst** med knappen nederst. Løste oppgaver får en grønn merkelapp i listen.

Alle oppgaver, markeringer og svar lagres i nettleserens `localStorage` på enheten.

## Teknikk

Ren HTML/CSS/JavaScript, ingen bygging eller avhengigheter.

| Fil | Innhold |
|---|---|
| `index.html` | Sider (hjem, hjørnevalg, kontroll, spill) |
| `app.js` | Grensesnitt, lagring, spillogikk |
| `scan.js` | Perspektivretting, linjedeteksjon, uthenting av trykte tall |
| `style.css` | Utseende |

Skanningen skjer lokalt i nettleseren. Trykte tall leses med [Tesseract.js](https://github.com/naptha/tesseract.js), som lastes fra nett første gang du skanner (krever internett). Tall som ikke kan leses, blir stående tomme.

## Publisering og versjon

GitHub Pages deployes av `.github/workflows/pages.yml` ved hver push. Workflowen:

- stempler JS/CSS med commit-id (unngår gammel cache),
- lager versjonsnummeret `vXX.YY`, som teller opp per commit (v00.01 er første),
- skriver `version.json`, som siden bruker til å laste seg selv på nytt når det finnes en nyere versjon.

Versjonsnummeret vises nederst på startsiden.

## Kjøre lokalt

Åpne `index.html` i en nettleser, eller start en enkel server, for eksempel `python3 -m http.server`. Lokalt vises versjonsnummeret som plassholder.
