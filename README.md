# Allenamento — clone personalizzabile di Blok Sessions

PWA offline per piani di allenamento di arrampicata: piano settimanale, player guidato con timer,
editor completo, diario con carichi in kg, test/progressi, import ed export `.blokplan`.
Nessun backend e nessun account: i dati stanno nel `localStorage` del dispositivo (backup da *Altro*).

## Struttura
| File | Contenuto |
|---|---|
| `src/core.js` | Logica pura (date, carichi, passi del player, import/export). Unico file coperto da unit test. |
| `src/seed.js` | Piano "Karma 8A+" esportato da Blok Sessions, in forma compatta. |
| `src/app.js` | Interfaccia: viste, editor, player. |
| `src/style.css`, `src/index.html` | Stile e scheletro della pagina. |
| `public/` | Manifest, service worker e icona per la versione installabile. |
| `build.mjs` | Produce `dist/index.html` (file unico) e `docs/` (installabile). |

## Comandi
```bash
npm test            # unit test della logica (node --test, nessuna dipendenza)
npm run build       # genera dist/
npm i --no-save puppeteer-core && node test/e2e.mjs   # smoke test in Chrome headless (dopo la build)
```

## Installazione su iPhone
Serve un indirizzo HTTPS. Il modo più semplice è GitHub Pages:
1. `npm run build` e push su `main` (la cartella `docs/` è quella pubblicata);
2. Settings → Pages → Deploy from a branch → `main` / `/docs`;
3. apri l'indirizzo in Safari → Condividi → **Aggiungi alla schermata Home**.

Limiti iOS: il timer non gira a schermo spento (l'app tiene lo schermo acceso durante la sessione);
i dati di una PWA possono essere rimossi da iOS se non la apri per settimane → fai il backup.

## Personalizzare
- Nuovi tipi di giorno, periodi o test predefiniti: costanti in cima a `core.js`.
- Regole per riconoscere il massimale dal nome dell'esercizio: `inferLoad` in `core.js`.
- Formula dei kg: `loadKg` (zavorra = `round(((peso + max) × % − peso) × 2) / 2`).
- Colori: variabili CSS in cima a `style.css`.
