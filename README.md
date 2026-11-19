# Allenamento

Offline PWA to plan and log climbing training: calendar, training days with one timer per exercise, tests and maxes,
load progression, analytics. No backend and no account: data lives on the device, with backup to a file or
automatically to a private GitHub repository.

App: https://ldvdauer.github.io/allenamento/ · User guide: [GUIDE.md](GUIDE.md)

The interface is in English only. Code comments and test descriptions are still in Italian.

## How it is built
| File | Content |
|---|---|
| `src/core.js` | Pure logic, no DOM: dates, standard library, loads and progression, timer steps, YAML programme import/export, aggregations for analytics. The only file covered by unit tests. |
| `src/vendor/` | [js-yaml](https://github.com/nodeca/js-yaml) 4.1.0 (MIT), the only third-party code, inlined by the build. |
| `src/charts.js` | Dependency-free SVG charts (columns, stacked columns, lines, horizontal bars) with tooltip and table. |
| `src/app.js` | Interface: Home, calendar, timer, tests, analytics, settings, backup, notebook, diagnostics. |
| `src/style.css`, `src/index.html` | Style and page skeleton. |
| `public/` | Manifest, service worker and icon. |
| `build.mjs` | Produces `dist/index.html` (single file for previews) and `docs/` (installable version published by GitHub Pages). |
| `test/` | `core.test.js` (unit tests), `e2e.mjs` (smoke test in headless Chrome), `fixture.yaml` (sample programme). |

## Data model (in short)
- **Library**: 53 standard exercises with only a name and a category (`LIBRARY` and `SECTIONS` in `core.js`), plus the ones the user creates. Categories are training qualities (Fingers, Strength, Power endurance, Endurance, Technique, Conditioning, Mobility, Other); there is no warm-up category. Their colours (`--c-*` in `style.css`) were chosen by hand: some pairs are close (see the comment there), so the category name is also in the library and in the accessible label.
- **Training day** (internally still a "session" object): the exercises of one date, from an imported programme or added by hand. The day is the unit: a day with no exercises is a rest day and is removed from the data (`pruneEmpty` on every save). Copying or moving onto a day that already has exercises appends to it.
- **Block**: an exercise *on that day*, with its own parameters (rounds, seconds or reps, rests, L/R, grip, reference test and %, surface, note). Nothing is shared between days.
- **Test**: definitions with their own parameters; the latest result is the max used to compute kg.
- **Trip** (`S.trips`, v13): name, place, approximate dates (`YYYY-MM` or `YYYY-MM-DD`), status, notes, projects (grade, sector, style, status, sent date, notes) and a free checklist. Separate from training data; cleaned by `Core.cleanTrips` on load and restore.
- **Day log** (`S.logs`): one per training day, filled exercise by exercise (`bid` = block id): minutes, sets done, missed reps, load, RPE, surface/grade, note. RPE, feeling and notes of the day are optional ("Rate the day").
- The state has a version (`v`) and `migrate()` in `app.js` brings old data forward on every launch.
  Version 7 moved the interface from Italian to English: default names (standard exercises, test templates, default
  surfaces) and the SX/DX side labels are renamed (`LEGACY_NAMES`, `normSide`); anything the user typed is left alone.

## Commands
```bash
npm test            # unit tests (node --test, no dependencies)
npm run build       # generates dist/ and docs/
npm i --no-save puppeteer-core && node test/e2e.mjs   # end-to-end smoke test, after the build
```
The end-to-end test uses a personal, unversioned programme (`private/Karma-8A+.yaml`); it is skipped if missing.

## Publishing an update
`npm run build`, commit and push to `main`: GitHub Pages publishes the `docs/` folder. Each build has a version
(date and time); the app compares it with `docs/version.json` and shows "A newer version of the app is available."

## Customising
- Programme file format: `importYaml` / `exportYaml` in `core.js`, documented in [GUIDE.md](GUIDE.md#programme-files).
- Standard exercises and sections: `LIBRARY` and `SECTIONS` in `core.js`. Name recognition on import: exact library
  names first (English, and the Italian names of earlier versions), then `STD_RULES`, which accepts both languages.
- Test templates: `TEST_TEMPLATES`. kg formula: `loadKg`. Progression rule: `nextLoad`.
- Colours: CSS variables at the top of `style.css`. The three group colours in the charts are validated for colour
  blindness: if you change them, run the check again.

## Known limits
- iOS: no timer with the screen off, no backup while the app is closed, data can be removed by the system if the app is not opened for weeks.
- Grades in the Font scale only.
