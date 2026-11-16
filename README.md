# Allenamento

PWA offline per pianificare e registrare l'allenamento di arrampicata: calendario, sessioni con un timer per esercizio,
test e massimali, progressione dei carichi, analisi. Nessun backend e nessun account: i dati stanno sul dispositivo,
con backup su file o automatico su un repository GitHub privato.

App: https://ldvdauer.github.io/allenamento/ · Guida all'uso: [GUIDA.md](GUIDA.md)

## Come è fatta
| File | Contenuto |
|---|---|
| `src/core.js` | Logica pura, senza DOM: date, libreria standard, carichi e progressione, passi del timer, import/export `.blokplan`, aggregazioni per l'analisi. È l'unico file coperto da unit test. |
| `src/charts.js` | Grafici SVG senza dipendenze (colonne, colonne impilate, linee, barre orizzontali) con tooltip e tabella. |
| `src/app.js` | Interfaccia: Home, calendario, sessione in corso, test, analisi, impostazioni, backup, taccuino, diagnostica. |
| `src/style.css`, `src/index.html` | Stile e scheletro della pagina. |
| `public/` | Manifest, service worker e icona. |
| `build.mjs` | Produce `dist/index.html` (file unico per l'anteprima) e `docs/` (versione installabile pubblicata da GitHub Pages). |
| `test/` | `core.test.js` (unit test), `e2e.mjs` (smoke test in Chrome headless), `fixture.js` (programma di esempio). |

## Modello dei dati (in breve)
- **Libreria**: 50 esercizi standard con solo nome e sezione (`LIBRARY` in `core.js`), più quelli creati dall'utente.
- **Sessione**: legata a una data (creata a mano) oppure a un programma importato. Contiene blocchi.
- **Blocco**: un esercizio *in quella sessione*, con i suoi parametri (round, secondi o ripetizioni, recuperi, SX/DX, test di riferimento e %, superficie, nota). Niente è condiviso tra sessioni.
- **Test**: definizioni con parametri propri; l'ultimo risultato è il massimale usato per i kg.
- **Registrazione**: sessione fatta, con minuti, RPE e, per ogni esercizio, minuti, carico, RPE, superficie/grado.
- Lo stato ha una versione (`v`) e `migrate()` in `app.js` porta avanti i dati vecchi a ogni apertura.

## Comandi
```bash
npm test            # unit test (node --test, nessuna dipendenza)
npm run build       # genera dist/ e docs/
npm i --no-save puppeteer-core && node test/e2e.mjs   # smoke test end-to-end, dopo la build
```
Il test end-to-end usa un programma personale non versionato (`private/Karma-8A+.blokplan`); se manca viene saltato.

## Pubblicare un aggiornamento
`npm run build`, commit e push su `main`: GitHub Pages pubblica la cartella `docs/`. Ogni build ha una versione
(data e ora); l'app la confronta con `docs/version.json` e mostra "È disponibile una versione aggiornata".

## Personalizzare
- Esercizi standard e sezioni: `LIBRARY` e `SECTIONS` in `core.js`. Riconoscimento dei nomi all'import: `STD_RULES`.
- Modelli dei test: `TEST_TEMPLATES`. Formula dei kg: `loadKg`. Regola di progressione: `nextLoad`.
- Colori: variabili CSS in cima a `style.css`. I tre colori dei gruppi nei grafici sono validati per il daltonismo: se li cambi, rifai la verifica.

## Limiti noti
- iOS: nessun timer a schermo spento, nessun backup con l'app chiusa, dati rimovibili dal sistema se l'app non viene aperta per settimane.
- Gradi solo in scala Font.
