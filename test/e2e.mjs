import fs from 'fs';
// Smoke test end-to-end in Chrome headless (viewport iPhone).
// Uso: node test/e2e.mjs  — richiede private/Karma-8A+.yaml (programma personale, non versionato).
import { existsSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const PLAN = fileURLToPath(new URL('../private/Karma-8A+.yaml', import.meta.url));
const url = 'file://' + fileURLToPath(new URL('../dist/index.html', import.meta.url));
if (!existsSync(PLAN)) { console.log('E2E saltato: manca ' + PLAN); process.exit(0); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ok = (c, msg) => { if (!c) throw new Error('FALLITO: ' + msg); console.log('ok  ' + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = sel => pg.$eval(sel, e => e.innerText);
// clicca l'ultimo (first=false) o il primo elemento visibile il cui testo inizia con t
const clickText = async (t, root = 'body', first = false) => {
  const done = await pg.evaluate((t, root, first) => { let all = [...document.querySelectorAll(root + ' button, ' + root + ' .tap, ' + root + ' .blk')].filter(x => x.innerText.trim().startsWith(t) && x.offsetParent); const e = first ? all[0] : all[all.length - 1]; if (e) e.click(); return !!e; }, t, root, first);
  if (!done) throw new Error('pulsante non trovato: ' + t);
  await sleep(60);
};
const go = async h => { await pg.evaluate(h => { location.hash = h; }, h); await sleep(100); };
const shot = (n, fullPage) => (process.env.SHOTS ? pg.screenshot({ path: `${process.env.SHOTS}/${n}.png`, fullPage: !!fullPage }) : null);
const adv = async ms => { await pg.evaluate(ms => { window.__adv += ms; }, ms); await sleep(450); };
const setVal = (sel, v) => pg.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }, v);

// Data fissata a mercoledì 25 nov 2026 (settimana 2 del programma di prova).
await pg.evaluateOnNewDocument(() => { const RD = Date, t0 = new RD(2026, 10, 25, 9, 0, 0).getTime(), s = RD.now();
  window.__adv = 0;
  class D extends RD { constructor(...a) { if (a.length) super(...a); else super(t0 + (RD.now() - s) + window.__adv); } static now() { return t0 + (RD.now() - s) + window.__adv; } }
  window.Date = D; });
await pg.goto(url);

// Home vuota: solo Rest day e i due pulsanti, nessun riferimento ai piani
let home = await txt('#view');
await shot('0-home-riposo'); ok(home.includes('Home') && home.includes('Rest day') && home.includes('+ Exercise') && !/session/i.test(home), 'Home al primo avvio: Rest day con + Exercise, nessun "crea sessione"');
ok(!/programme|this week/i.test(home), 'Home: nessun riferimento al piano né riepiloghi');
ok((await txt('#tabs')).replace(/\s+/g, ' ').trim() === 'Home Calendar Trips Analytics More', 'navigazione: Home, Calendar, Trips, Analytics, More (Nota in More)');

// Import: si sceglie la data di inizio e il programma finisce nel calendario
await go('programmes');
await (await pg.$('#view input[type=file]')).uploadFile(PLAN); await sleep(400);
ok((await txt('.sheet')).includes('Import programme') && (await pg.$eval('.sheet input[type=date]', e => e.value)) === '2026-11-16', 'import: chiede da quando parte (default dal file)');
await clickText('Import', '.sheet');
ok((await txt('#toast')).includes('Imported Karma 8A+'), 'programma importato');
ok(await pg.evaluate(() => location.hash === '#calendar-2026-11-25' && __app.state.plans[0].shownFrom === '2026-11-25'), 'import con inizio nel passato: i giorni prima di oggi non compaiono, si apre il calendario su oggi');
await go('calendar-2026-11-18');
ok(!(await txt('#view')).includes('Done') && (await txt('#view')).includes('Rest day'), 'giorno passato del nuovo programma: non compare');
// Il resto della prova usa il programma come se fosse in corso da lunedì 16: si toglie il limite
await pg.evaluate(() => { delete __app.state.plans[0].shownFrom; localStorage.setItem('allenamento.v1', JSON.stringify(__app.state)); __app.render(); });
await go('calendar-2026-11-16');
let cal = await txt('#view');
ok(cal.includes('Test: Open hand') && cal.includes('Overhead press') && !/Off the wall|Wall ·/.test(cal), 'una sola sessione al giorno, senza etichette Muro / Fuori muro');
ok(await pg.evaluate(() => __app.state.plans[0].weeks.every(w => w.every(d => d.sessions.length <= 1))), 'ogni giorno del programma ha al massimo una sessione');
ok(await pg.evaluate(() => Object.values(__app.state.exercises).every(e => !('prescription' in e) && !('base' in e)) && new Set(__app.state.plans[0].weeks.flatMap(w => w.flatMap(d => d.sessions.flatMap(x => x.blocks.map(b => b.exId))))).size === Object.keys(__app.state.exercises).length), 'import: nessuna descrizione testuale negli esercizi; ogni blocco ha i suoi parametri (nessuna versione condivisa)');
ok(await pg.evaluate(() => Object.values(__app.state.exercises).every(e => !e.interval || e.interval.cues.length === 0 || e.interval.cues.join() === 'L,R')), 'import: i cue diventano solo l\'alternanza SX/DX (il resto va nella nota)');
await go('calendar-2026-11-25');
ok((await txt('#view')).includes('4 × 7" · rest 3\' · 82.5%') && (await txt('#view')).includes('margine 2-3"'), 'la riga dell\'esercizio nasce dai parametri; il testo non parametrico resta come nota della sessione');
await shot('1-calendario');

// Massimali → kg
await go('tests');
let tests = await txt('#view');
ok(!/zavorra max|· max/.test(tests) && tests.includes('20 mm · 7" · added weight') && tests.includes('Open hand') && (await pg.evaluate(() => __app.state.testDefs.map(d => d.key).join())) === 'bw,oh,hc,sl,pinchL,pinchR,wrist', 'Test: solo quelli usati dal programma, parametri accanto al nome, niente "zavorra max"');
ok(!tests.includes('Body weight'), 'Test: il peso corporeo non è tra i test (sta nel profilo)');
await go('home'); { const v = await txt('#view'); ok(v.includes('body weight in More → Profile'), 'senza peso corporeo: il messaggio rimanda al profilo (' + (v.match(/kg: .*/g) || []).join(' / ') + ')'); }
// Profilo: peso corporeo (usato per i kg), altezza e ape index (negativo con ±)
await go('more'); ok((await txt('#more-profile')).includes('Body weight missing'), 'More: voce Profile, peso mancante');
await pg.click('#more-profile'); await sleep(150);
const pin = await pg.$$('#view input');
await pin[0].type('70'); await pin[1].type('178'); await pin[2].type('3'); await clickText('±', '#view'); await clickText('Save', '#view'); await sleep(100);
const prof = await pg.evaluate(() => ({ p: __app.state.profile, bw: __app.state.tests.filter(t => t.key === 'bw').map(t => t.value + '@' + t.date) }));
ok(prof.p.height === 178 && prof.p.ape === -3 && prof.bw.join() === '70@2026-11-25', 'Profile: peso salvato nello storico (oggi), altezza 178, ape index -3 (' + JSON.stringify(prof) + ')');
await go('more'); ok((await txt('#more-profile')).includes('70 kg · 178 cm · ape index -3 cm'), 'More: riepilogo del profilo');
await shot('9c-profilo');
// Suoni (26 nov): di default "duck" (bip sempre udibili col volume alzato, anche in silenzioso): ambient a riposo, playback durante i bip
await pg.evaluate(() => { Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true }); });
const audioType = async () => { await go('diagnostics'); await clickText('Run the checks', '#view'); await sleep(300); return pg.evaluate(() => navigator.audioSession.type); };
{ const during = await audioType(); await sleep(2700); const after = await pg.evaluate(() => navigator.audioSession.type);
  ok(during === 'playback' && after === 'ambient' && await pg.evaluate(() => __app.state.settings.audioMode === 'duck'), 'audio: di default "Interrupt the music briefly": playback durante il bip (udibile anche in silenzioso), poi ambient (' + during + ' → ' + after + ')'); }
await go('more'); await pg.evaluate(() => { const s = [...document.querySelectorAll('#view select')].find(x => [...x.options].some(o => o.value === 'solo')); s.value = 'solo'; s.dispatchEvent(new Event('change')); }); await sleep(100);
ok((await txt('#view')).includes('even in silent mode') && await audioType() === 'playback', 'audio: "Pause the music" → playback');
// "Interrupt the music briefly": playback solo durante i segnali, poi ambient (prova da Diagnostics → Sound test)
await pg.evaluate(() => { const types = []; let t = 'auto'; Object.defineProperty(navigator, 'audioSession', { value: { get type() { return t; }, set type(v) { t = v; types.push(v); } }, configurable: true }); window.__types = types; });
await go('diagnostics');
ok((await pg.$$('#sound-test .blk')).length === 3, 'Diagnostics: Sound test con i tre modi');
await pg.evaluate(() => [...document.querySelectorAll('#sound-test .blk')][0].querySelector('button').click());
await sleep(500); const mid = await pg.evaluate(() => navigator.audioSession.type);
await sleep(6500); const seq = await pg.evaluate(() => window.__types.join('>'));
ok(mid === 'playback' && seq === 'ambient>playback>ambient' && await pg.evaluate(() => __app.state.settings.audioMode) === 'solo', 'duck: ambient → playback durante i bip → ambient dopo; la prova non cambia il modo scelto (' + seq + ')');
await pg.evaluate(() => [...document.querySelectorAll('#sound-test .blk')][1].querySelector('button.pri').click()); await sleep(100);
ok(await pg.evaluate(() => __app.state.settings.audioMode) === 'mix' && (await txt('#sound-test')).includes('Play over the music · in use'), 'Sound test: "Use" sceglie il modo');
// Home → Week: striscia di 7 giorni, ogni giorno con i suoi esercizi, frecce per cambiare settimana
await go('home'); await clickText('Week', '.seg'); await sleep(150);
let wk = await txt('#view');
ok(await pg.evaluate(() => location.hash === '#week') && (await pg.$$('.wk-cal .wk-d')).length === 7 && (await pg.$$('.wk-day')).length === 7 && wk.includes('Wednesday 25 Nov · today') && wk.includes('Sloper hang'), 'Home → Week: 7 giorni con i loro esercizi, oggi evidenziato');
await clickText('›', '.wk'); await sleep(100);
ok(await pg.evaluate(() => location.hash === '#week-2026-11-30') && (await txt('.wk')).includes('Today'), 'Week: settimana dopo e tasto Today');
await clickText('Today', '.wk'); await sleep(100);
// modificare dalla Week: tocco su un esercizio non registrato di domani → Move to… → giovedì
const nameMv = await pg.evaluate(() => { const x = [...document.querySelectorAll('#wd-2026-11-26 .wk-ex')][0]; x.click(); return x.querySelector('.grow').innerText; }); await sleep(150);
await clickText('Move to…', '.sheet'); await sleep(150);
ok((await txt('.sheet')).includes('Move to another day') && (await pg.$$('.sheet .mv-d')).length === 14, 'Move to…: i giorni di questa settimana e della prossima');
await pg.evaluate(() => [...document.querySelectorAll('.sheet .mv-d')][4].click()); await sleep(150); // venerdì 27
const mv = await pg.evaluate(n => ({ thu: [...document.querySelectorAll('#wd-2026-11-26 .wk-ex .grow')].map(x => x.innerText), fri: [...document.querySelectorAll('#wd-2026-11-27 .wk-ex .grow')].map(x => x.innerText) }), nameMv);
ok(!mv.thu.includes(nameMv) && mv.fri[mv.fri.length - 1] === nameMv && await pg.evaluate(() => location.hash === '#week'), 'Week: esercizio spostato da giovedì a venerdì, in fondo (' + nameMv + ')');
// + Exercise su un giorno di riposo
const restIso = await pg.evaluate(() => [...document.querySelectorAll('.wk-day')].find(d => !d.querySelector('.wk-ex')).id.slice(3));
await pg.evaluate(iso => [...document.querySelectorAll('#wd-' + iso + ' .wk-add button')][0].click(), restIso); await sleep(200);
await pg.evaluate(() => [...document.querySelectorAll('.sheet .blk, .sheet button')].find(x => /Hip mobility|Max hang|Limit/.test(x.innerText)).click()); await sleep(200);
ok(await pg.evaluate(iso => document.querySelectorAll('#wd-' + iso + ' .wk-ex').length === 1, restIso), 'Week: + Exercise su un giorno di riposo (' + restIso + ')');
// rimuovere dalla Week
await pg.evaluate(iso => document.querySelector('#wd-' + iso + ' .wk-ex').click(), restIso); await sleep(150);
await clickText('Remove', '.sheet'); await sleep(150);
ok(await pg.evaluate(iso => !document.querySelector('#wd-' + iso + ' .wk-ex'), restIso), 'Week: esercizio rimosso, il giorno torna di riposo');
await shot('9e-week-modifica');
await pg.click('.wk-day.now .wk-h'); await sleep(100);
ok(await pg.evaluate(() => location.hash === '#calendar-2026-11-25'), 'Week: un giorno si apre nel calendario');
await go('home');
await go('profile'); await shot('9d-profilo-pagina'); const pin2 = await pg.$$('#view input'); await pin2[0].click({ clickCount: 3 }); await pin2[0].type('71,5'); await clickText('Save', '#view'); await sleep(100);
ok(await pg.evaluate(() => __app.state.tests.filter(t => t.key === 'bw').map(t => t.value).join() === '71.5'), 'stesso giorno: il peso si aggiorna, niente doppioni');
await pg.evaluate(() => { __app.state.tests.find(t => t.key === 'bw').value = 70; });
await go('tests');
for (const [name, v] of [['Sloper', '20'], ['Pinch block L', '20'], ['Pinch block R', '24'], ['Wrist curl', '22,5']]) {
  await clickText(name, '#view');
  await pg.type('.sheet .cols label:nth-child(2) input', v);
  await clickText('Add result');
}
await go('home');
home = await txt('#view');
ok(home.includes('Sloper hang') && home.includes('Weighted pull-ups') && !home.includes('Sloper BM2000'), 'Home: la giornata di oggi con i nomi della libreria');
ok(home.includes('+4.5 kg') && home.includes('L 15 kg · R 18 kg') && home.includes('20.5 kg'), 'kg calcolati dai massimali');
await shot('2-home');

// Trascinamento: l'ultimo esercizio del giorno diventa il secondo
await go('calendar-2026-11-25');
const names = () => pg.evaluate(() => __app.state.plans[0].weeks[1][2].sessions[0].blocks.map(b => __app.state.exercises[b.exId].name));
const before = await names();
const pos = await pg.evaluate(() => { const g = [...document.querySelectorAll('#view .grip')]; g[g.length - 1].scrollIntoView({ block: 'center' }); const a = g[g.length - 1].getBoundingClientRect(), t = g[g.length - 3].getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2, ty: t.top + 2 }; });
await pg.mouse.move(pos.x, pos.y); await pg.mouse.down(); await pg.mouse.move(pos.x, (pos.y + pos.ty) / 2, { steps: 4 }); await pg.mouse.move(pos.x, pos.ty, { steps: 4 }); await pg.mouse.up(); await sleep(150);
const after = await names(), n = before.length;
ok(after[n - 3] === before[n - 1] && after[n - 1] === before[n - 2] && after[0] === before[0] && after.length === n, 'trascinamento: l\'ultimo esercizio spostato due posizioni più su e salvato');
ok((await pg.$('.sheet')) === null, 'trascinare non apre la scheda dell\'esercizio');
await shot('3-giorno');

// Giornata di oggi: ogni esercizio si avvia dal suo ▶, senza una "sessione" da iniziare
await go('home');
ok((await pg.$$('#view .play')).length === before.length && (await pg.$eval('#player', e => e.hidden)) && !(await pg.$('#runner:not([hidden])')), 'Home: un ▶ per esercizio, nessuna sessione da avviare, nessun timer partito da solo');
await shot('4-sessione');
const play = name => pg.evaluate(n => [...document.querySelectorAll('#view .blk')].find(r => r.innerText.includes(n)).querySelector('.play').click(), name);
// Esercizio a sola durata (Limit bouldering, 30 minuti)
await play('Limit bouldering'); await sleep(60);
ok((await txt('#p-clock')) === '30:00' && (await txt('#p-name')) === 'Limit bouldering', 'esercizio a durata: timer suo, 30:00');
await adv(30 * 60000 + 500);
ok((await pg.$eval('#player', e => e.hidden)) && (await txt('.sheet')).includes('Exercise complete'), 'allo scadere il timer si ferma e chiede la registrazione (non parte l\'esercizio dopo)');
ok((await pg.$eval('.sheet input', e => e.value)) === '30', 'minuti misurati precompilati');
await clickText('Save', '.sheet');
ok((await pg.$$('#view .play.done')).length === 1 && await pg.evaluate(() => __app.state.logs.filter(l => l.date === '2026-11-25').length === 1), 'tornato alla giornata: esercizio segnato come fatto, registrazione del giorno creata');

// Esercizio a tempo (sloper 4 × 7"): preparazione → lavoro → recupero, kg e parametri nel timer
await play('Sloper hang'); await sleep(60);
ok((await txt('#p-ph')) === 'GET READY' && (await txt('#p-name')) === 'Sloper hang', 'sloper: preparazione');
ok((await txt('#p-cue')).includes('82.5% max') && (await txt('#p-note')) === 'margine 2-3"', 'timer: parametri in evidenza, la nota del giorno sotto');
await adv(10500);
ok((await txt('#p-ph')) === 'WORK' && (await txt('#p-round')) === 'Round 1 of 4' && (await txt('#p-kg')).startsWith('+4.5'), 'lavoro: round 1/4 con i kg');
await shot('5-timer');
await adv(7500);
ok((await txt('#p-ph')) === 'REST', 'hang finito → recupero');
const c0 = await txt('#p-clock'); await pg.click('#p-plus'); ok((await txt('#p-clock')) !== c0, '+30 s sul recupero');
await pg.click('#p-pause'); const c1 = await txt('#p-clock'); await adv(60000); ok((await txt('#p-clock')) === c1, 'pausa: il tempo non scorre'); await pg.click('#p-pause');
const tb = await pg.evaluate(() => ({ rows: document.querySelectorAll('#p-table .tb-r').length, done: document.querySelectorAll('#p-table .tb-r.done').length, cur: [...document.querySelectorAll('#p-table .tb-r')].findIndex(r => r.classList.contains('cur')), kg: document.querySelector('#p-table .stp-in').value, head: document.querySelector('#p-table .tb-h').innerText }));
ok(tb.rows === 4 && tb.done === 1 && tb.cur === 1 && tb.kg === '4.5' && tb.head.includes('kg over body weight'), 'tabella nel timer: 4 serie, la prima fatta, la seconda evidenziata, kg precompilati (' + JSON.stringify(tb) + ')');
await shot('5b-timer-tabella');
// nota 24 nov: si scrive sopra al valore (niente "016"), e "+ Add set" aggiunge una serie vera al timer
await pg.click('#p-table .stp-in'); await sleep(30); await pg.keyboard.type('6');
ok(await pg.$eval('#p-table .stp-in', e => e.value) === '6', 'campo numerico: al tocco si scrive sopra (' + await pg.$eval('#p-table .stp-in', e => e.value) + ')');
await pg.evaluate(() => [...document.querySelectorAll('#p-table .linkbtn')].find(b => b.innerText === '+ Add set').click());
ok(await pg.$$eval('#p-table .tb-r', r => r.length) === 5 && (await txt('#p-round')).includes('of 5'), '+ Add set: 5 righe e il timer conta 5 serie (' + await txt('#p-round') + ')');
const geo = await pg.evaluate(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }; return { done: r('p-done'), back: r('p-back'), tbl: r('p-table'), quit: r('p-quit'), vh: innerHeight }; });
ok(Math.abs(geo.done.top - geo.back.top) < 2 && geo.quit.top > geo.tbl.top && geo.tbl.top < geo.vh * 0.6, 'timer compatto: Done sulla riga dei comandi, tabella nella metà alta, End exercise in fondo (' + JSON.stringify({ d: geo.done.top, b: geo.back.top, t: geo.tbl.top, vh: geo.vh }) + ')');
await shot('5c-timer-compatto');
let doneSteps = 0;
for (let i = 0; i < 30 && !(await pg.$eval('#player', e => e.hidden)); i++) { if ((await txt('#p-ph')) === 'WORK') { await adv(7500); doneSteps++; } else await pg.click('#p-done'); }
ok(doneSteps === 4, 'la serie aggiunta si esegue davvero col timer (' + doneSteps + ' serie a tempo dopo la prima)');
for (let i = 0; i < 20 && !(await pg.$eval('#player', e => e.hidden)); i++) await pg.click('#p-done'); // salta le altre serie
ok((await txt('.sheet .sum')) === '5/5 sets · +6 kg', 'conferma breve: 5 serie su 5 con la serie aggiunta, +6 kg (' + await txt('.sheet .sum') + ')');
ok(!(await txt('.sheet')).includes('Sets done') && !(await txt('.sheet')).includes('Added load'), 'conferma breve: niente campi già compilati nella tabella');
await pg.evaluate(() => { const i = [...document.querySelectorAll('.sheet label')].find(l => l.innerText.startsWith('Exercise RPE')).querySelector('input'); i.value = '7'; });
await clickText('Save', '.sheet');
const saved = await pg.evaluate(() => { const st = JSON.parse(localStorage.getItem('allenamento.v1')); const l = st.logs.find(x => (x.blocks || []).some(b => /Sloper/.test(b.label || b.key))); const b = l.blocks.find(b => /Sloper/i.test(b.label || b.key)); return { sets: b.sets, rows: (b.rows || []).length, kgs: b.kgs }; });
ok(saved.rows === 5 && JSON.stringify(saved.sets).includes('5') && saved.kgs[0].kg === 6, 'registrazione: 5 righe, serie 5/5 e 6 kg salvati (' + JSON.stringify(saved) + ')');

// Esercizio a ripetizioni: il timer mostra quante farne, non il tempo
await play('Wrist curl'); await sleep(60);
ok((await txt('#p-clock')) === '6' && (await txt('#p-unit')) === 'reps' && (await txt('#p-ph')) === 'GO', 'a ripetizioni: "6" grande e "reps" sotto, niente tempo');
ok(/^Up next: \d+ (min|s).* rest between sets$/.test(await txt('#p-next')), 'Up next: recupero tra le serie (' + await txt('#p-next') + ')');
const wc = await pg.evaluate(() => ({ rows: document.querySelectorAll('#p-table .tb-r').length, reps: [...document.querySelectorAll('#p-table .tb-r')][0].querySelector('.stp-v').innerText, head: document.querySelector('#p-table .tb-h').innerText }));
ok(wc.rows >= 2 && wc.reps === '6' && wc.head.includes('Reps'), 'a ripetizioni: righe con le ripetizioni modificabili (' + JSON.stringify(wc) + ')');
await pg.evaluate(() => [...document.querySelectorAll('#p-table .tb-r')][0].querySelectorAll('.stp-b')[0].click());
ok(await pg.evaluate(() => [...document.querySelectorAll('#p-table .tb-r')][0].querySelector('.stp-v').innerText) === '5', '− sulle ripetizioni');
await pg.click('#p-quit');
ok((await txt('.sheet')).includes('Exercise complete') && (await txt('.sheet')).includes('0/'), 'a ripetizioni: conferma breve');
await clickText('Not done', '.sheet');
// Esercizio per lato: "+ Add set" aggiunge una serie L e una R
await play('Pinch block'); await sleep(60);
const pb0 = await pg.$$eval('#p-table .tb-r', r => r.length);
// fasi: L → cambio lato (10 s) → R → recupero della serie; il conteggio è per serie
const phase = async () => `${await txt('#p-ph')}|${(await txt('#p-cue')).split(' · ')[0]}|${await txt('#p-round')}`;
await adv(10500); const ph1 = await phase(); await adv(7500); const ph2 = await phase(); ok((await txt('#p-next')).startsWith('Up next: right · 7 s work (1/'), 'durante il cambio lato: Up next lavoro a destra (' + await txt('#p-next') + ')');
await adv(10500); const ph3 = await phase(); await adv(7500); const ph4 = await phase();
ok(ph1 === 'WORK|L|Set 1 of ' + pb0 / 2 && ph2.startsWith('SWITCH SIDE|R|Set 1') && ph3 === 'WORK|R|Set 1 of ' + pb0 / 2 && ph4.startsWith('REST|') && ph4.endsWith('Set 1 of ' + pb0 / 2), 'per lato: L → cambio lato → R → recupero (' + [ph1, ph2, ph3, ph4].join(' / ') + ')');
const nums = await pg.$$eval('#p-table .tb-r', r => r.map(x => x.querySelector('.tb-n').innerText + (x.querySelector('.tb-side') || {}).innerText));
ok(nums.slice(0, 4).join() === '1L,1R,2L,2R', 'tabella: righe numerate per serie con il lato (' + nums.join() + ')');
await pg.evaluate(() => [...document.querySelectorAll('#p-table .linkbtn')].find(b => b.innerText === '+ Add set').click());
const pb = await pg.$$eval('#p-table .tb-r', r => r.map(x => (x.querySelector('.tb-side') || {}).innerText || ''));
ok(pb.length === pb0 + 2 && pb.slice(-2).join() === 'L,R', 'per lato: + Add set aggiunge L e R (' + pb.join() + ')');
let pbW = 0;
for (let i = 0; i < 60 && !(await pg.$eval('#player', e => e.hidden)); i++) { if ((await txt('#p-ph')) === 'WORK') { await adv(Math.max(1, Number(await txt('#p-clock')) || 0) * 1000 + 600); pbW++; } else await pg.click('#p-done'); }
ok(pbW === pb0 + 2 - 2 && (await txt('.sheet .sum')).startsWith(`${pb0 / 2 + 1}/${pb0 / 2 + 1} sets`), 'per lato: la serie aggiunta (L+R) va a tempo e conta come una serie (' + pbW + ', ' + await txt('.sheet .sum') + ')');
await clickText('Not done', '.sheet');
ok((await pg.$$('#view .play.done')).length === 2, '"Not done": nessuna registrazione');

// Durante l'allenamento si aggiungono, tolgono e riordinano esercizi dalla giornata stessa
const nBlocks = (await pg.$$('#view .blk')).length;
await clickText('+ Exercise', '#view');
ok((await txt('.sheet')).includes('FINGERS') && (await txt('.sheet')).includes('Limit bouldering') && !/versioni|Karma|MoonBoard/.test(await txt('.sheet')), 'scelta esercizio: solo esercizi di base per categoria');
await pg.type('.sheet input', 'limit'); await sleep(80); await clickText('Limit bouldering', '.sheet', true);
ok((await pg.$$('#view .blk')).length === nBlocks + 1, 'esercizio aggiunto a metà allenamento');
await pg.evaluate(() => { const r = [...document.querySelectorAll('#view .blk')]; r[r.length - 1].querySelector('.play').click(); }); await sleep(60);
ok((await txt('#p-name')) === 'Limit bouldering' && (await txt('#p-clock')) === '40:00', 'il nuovo esercizio parte con il suo timer (durata di base)');
ok(await pg.$eval('#p-quit', e => e.hidden) && (await txt('#p-done')) === 'Done', 'esercizio a durata: solo Done, niente End exercise doppione');
// Arrampicata: superficie nella tabella, "+ Add climb" e grado con −/+ per ogni blocco
await pg.select('#p-table .tb-h select', 'moonboard');
for (let i = 0; i < 3; i++) await pg.evaluate(() => [...document.querySelectorAll('#p-table .linkbtn')].find(b => b.innerText === '+ Add climb').click());
await pg.evaluate(() => { const r = document.querySelectorAll('#p-table .tb-r'); r[0].querySelectorAll('.stp-b')[1].click(); });
const cl = await pg.evaluate(() => ({ rows: document.querySelectorAll('#p-table .tb-r').length, g: document.querySelector('#p-table .tb-r .stp-v').innerText }));
ok(cl.rows === 3 && cl.g !== '—', 'arrampicata: blocchi aggiunti e grado scelto con + (' + JSON.stringify(cl) + ')');
await shot('6-timer-blocchi');
await adv(6 * 60000); await pg.click('#p-done');
ok((await txt('.sheet .sum')).startsWith('3 climbs · top ') && (await txt('.sheet .sum')).includes('MoonBoard'), 'conferma breve: blocchi, grado massimo e superficie');
await pg.evaluate(() => { [...document.querySelectorAll('.sheet label')].find(l => l.innerText.startsWith('Note')).querySelector('input').value = 'buone sensazioni'; });
await clickText('Save', '.sheet');
// grado preciso e blocchi chiusi si correggono poi dalla riga ✓ (scheda completa)
await pg.evaluate(() => { const rows = [...document.querySelectorAll('#view .blk')].filter(b => b.querySelector('.n').innerText.includes('Limit bouldering') && b.querySelector('.logged')); rows[rows.length - 1].querySelector('.logged').click(); }); await sleep(60);
await pg.select('.sheet .cols label:nth-child(2) select', '7A+');
await pg.evaluate(() => { const i = document.querySelector('.sheet .cols + label input'); i.value = '3'; });
await shot('6-registrazione');
await clickText('Save', '.sheet');
await pg.evaluate(() => [...document.querySelectorAll('#view .blk')].find(r => r.innerText.includes('Ab wheel')).click()); await sleep(60);
await clickText('Remove', '.sheet');
ok((await pg.$$('#view .blk')).length === nBlocks && !(await txt('#view')).includes('Ab wheel'), 'esercizio tolto a metà allenamento');

// Niente "Rate the day": quanto registrato si modifica toccando la riga ✓ sotto l'esercizio
ok(!(await txt('#view')).includes('Rate the day'), 'niente Rate the day');
await go('calendar-2026-11-25');
const logRow = name => pg.evaluate(n => { const rows = [...document.querySelectorAll('#view .blk')].filter(b => b.querySelector('.n').innerText.includes(n) && b.querySelector('.logged')); rows[rows.length - 1].querySelector('.logged').click(); }, name);
await logRow('Limit bouldering'); await sleep(80);
const ed = await pg.evaluate(() => ({ t: document.querySelector('.sheet').innerText, sf: document.querySelector('.sheet .cols label:nth-child(1) select').value, gr: document.querySelector('.sheet .cols label:nth-child(2) select').value,
  note: document.querySelector('.sheet label:last-of-type input').value, min: document.querySelector('.sheet label input').value }));
ok(ed.t.includes('Edit what you logged on 25 Nov') && ed.sf === 'moonboard' && ed.gr === '7A+' && ed.note === 'buone sensazioni' && ed.min === '6' && ed.t.includes('Delete this log') && !ed.t.includes('Done, without logging'), 'modifica: scheda precompilata con quanto registrato');
// Lead: scegliendo una superficie di vie il grado passa alla scala francese e "Problems sent" diventa "Routes sent"
await pg.select('.sheet .cols label:nth-child(1) select', 'lead-gym');
const lead = await pg.evaluate(() => { const g = document.querySelector('.sheet .cols label:nth-child(2) select'); return { o: [...g.options].map(o => o.value).join(','), v: g.value, t: document.querySelector('.sheet').innerText }; });
ok(lead.o.startsWith(',4a,4b,4c,5a') && lead.o.includes('7a+') && !lead.o.includes('7A') && lead.v === '' && lead.t.includes('Routes sent') && !lead.t.includes('Problems sent'), 'lead: scala francese e "Routes sent" sulla superficie Lead (gym)');
await pg.select('.sheet .cols label:nth-child(1) select', 'moonboard');
ok(await pg.$eval('.sheet .cols label:nth-child(2) select', g => [...g.options].some(o => o.value === '7B')) && (await txt('.sheet')).includes('Problems sent'), 'tornando al MoonBoard: scala Font');
await pg.evaluate(() => { const i = document.querySelector('.sheet label:last-of-type input'); i.value = 'Prova automatica'; });
await pg.select('.sheet .cols label:nth-child(2) select', '7B');
const nLogs = await pg.evaluate(() => __app.state.logs.length);
await clickText('Save', '.sheet'); await sleep(80);
ok(await pg.evaluate(n => { const l = __app.state.logs.find(x => x.date === '2026-11-25'), x = l.blocks.filter(b => b.name === 'Limit bouldering').pop();
  return __app.state.logs.length === n && x.note === 'Prova automatica' && x.climb.top === '7B' && l.blocks.filter(b => b.name === 'Limit bouldering').length === 2 && l.climbs.some(c => c.top === '7B'); }, nLogs), 'modifica salvata al posto della registrazione, senza duplicati');
await logRow('Limit bouldering'); await sleep(80);
await pg.select('.sheet .cols label:nth-child(2) select', '7A+'); await pg.evaluate(() => { document.querySelector('.sheet label:last-of-type input').value = 'buone sensazioni'; });
await clickText('Save', '.sheet'); await sleep(80);
let diary = await txt('#view');
ok(diary.includes('MoonBoard 7A+ · 3 sends') && diary.includes('buone sensazioni') && diary.includes('6 min'), 'registrazione nel calendario: minuti, superficie, grado, note');
const calDots = await pg.evaluate(() => { const b = [...document.querySelectorAll('#view .cal-d:not(.out)')]; const at = n => b.find(x => x.firstChild.textContent === String(n));
  const d = n => [...at(n).querySelectorAll('.dots i')].map(i => i.className.replace('cat ', '')).join(' ');
  return { today: d(25), fut: [26, 27, 28, 29, 30].map(d).find(x => x) || '', label: at(25).getAttribute('aria-label'), more: !!document.querySelector('#view .cal-d .more') }; });
ok(/c-\w+ ok/.test(calDots.today) && calDots.fut && !/ok/.test(calDots.fut) && /: \w.* done/.test(calDots.label), 'calendario: un pallino per categoria con il suo colore, pieno se fatta e cerchietto se prevista');
await shot('7b-calendario-categorie');
// Eliminare un esercizio registrato: sparisce con il suo tempo
await go('calendar-2026-11-25');
const before2 = await pg.evaluate(() => { const l = __app.state.logs.find(x => x.date === '2026-11-25'); return { n: l.blocks.length, m: l.minutes }; });
await logRow('Limit bouldering'); await sleep(80);
await clickText('Delete this log', '.sheet'); await sleep(50); await clickText('Delete', '.sheet'); await sleep(80);
ok(await pg.evaluate(b => { const l = __app.state.logs.find(x => x.date === '2026-11-25'); return l.blocks.length === b.n - 1 && l.minutes === b.m - 6 && !l.climbs.length; }, before2), 'registrazione eliminata: esercizio, minuti e arrampicata tolti dalla giornata');
const sloperLog = await pg.evaluate(() => { const row = [...document.querySelectorAll('#view .blk')].find(b => b.querySelector('.n').innerText.includes('Sloper hang')); const x = row && row.querySelector('.logged'); return x ? { t: x.innerText, short: x.classList.contains('short') } : null; });
ok(sloperLog && sloperLog.t.includes('+6 kg') && sloperLog.t.includes('5/5 sets') && !sloperLog.short, 'registrazione sotto il suo esercizio: carico e serie (con quella aggiunta), non evidenziata se completa (' + JSON.stringify(sloperLog) + ')');
ok(!diary.includes('Logged exercises') && !diary.includes('Without a planned day'), 'calendario: niente elenco separato delle registrazioni');
await shot('7-diario', true);
await go('home'); ok(/\d+ of \d+ done/.test(await txt('#view')), 'Home: giornata con gli esercizi fatti contati');
ok((await txt('#view')).includes('has no backup yet') && (await txt('#view')).includes('Save backup'), 'Home: promemoria backup quando ci sono dati non salvati');
// Proposta del carico tolta: niente "Suggested" e niente sezione nelle impostazioni
await go('calendar-2026-12-02'); ok(!(await txt('#view')).includes('Suggested'), 'niente proposta del carico');
await go('more'); ok(!(await txt('#view')).includes('Load progression') && await pg.evaluate(() => !('prog' in __app.state.settings)), 'More: niente Load progression');
await go('calendar-2026-11-25'); ok(!(await pg.$('#view .cal-key')), 'calendario: niente legenda sotto i pallini');

// Il giorno è l'unità: su un giorno di riposo si aggiunge un esercizio e il giorno diventa di allenamento
await go('calendar-2027-06-01');
ok((await txt('#view')).includes('Rest day') && !(await txt('#view')).includes('Create session'), 'calendario: giorno vuoto = Rest day, nessun "crea sessione"');
const nExtras = await pg.evaluate(() => __app.state.extras.length);
await clickText('+ Exercise', '#view'); await clickText('+ New');
await pg.type('.sheet input', 'Circuito spray'); await clickText('Create exercise');
ok((await txt('#view')).includes('Circuito spray') && !(await txt('#view')).includes('Rest day') && await pg.evaluate(n => __app.state.extras.length === n + 1, nExtras), 'primo esercizio aggiunto: il giorno diventa di allenamento');
await clickText('Edit day', '#view'); await pg.type('.sheet label input', 'Natale al muro'); await clickText('Save', '.sheet');
await clickText('Edit day', '#view'); await shot('15-day-sheet'); await pg.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove())); ok((await txt('#view')).includes('Natale al muro'), 'Day…: titolo facoltativo della giornata');
// Libreria → ogni aggiunta è un'istanza con parametri propri: modificarne una non tocca l'altra
await clickText('+ Exercise', '#view'); await pg.type('.sheet input', 'max hang'); await sleep(80); await clickText('Max hang', '.sheet', true);
await clickText('+ Exercise', '#view'); await pg.type('.sheet input', 'max hang'); await sleep(80); await clickText('Max hang', '.sheet', true);
ok(await pg.evaluate(() => { const s = __app.state, x = s.extras[0], ids = x.blocks.slice(-2).map(b => b.exId); return ids[0] !== ids[1] && s.exercises[ids[0]].std === 'max-hang' && x.blocks[x.blocks.length - 1].minutes === 10; }), 'libreria: lo standard si aggiunge con i valori di base, come istanza separata');
await pg.evaluate(() => { const r = [...document.querySelectorAll('#view .blk')].filter(x => x.innerText.includes('Max hang')); r[r.length - 1].click(); }); await sleep(60); // l'ultimo dei due
ok(!/\bCue\b/.test(await txt('.sheet')) && (await txt('.sheet')).includes('Alternate L/R') && (await txt('.sheet')).includes('Note'), 'parametri: un solo campo Nota e l\'interruttore SX/DX, nessun campo Cue');
await pg.evaluate(() => { const l = [...document.querySelectorAll('.sheet label')]; const set = (t, v) => { const i = l.find(x => x.innerText.startsWith(t)).querySelector('input,select'); i.value = v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); };
  set('Round', '6'); set('Work', '10'); set('Rest (s)', '150'); set('Load: reference', 'hc'); set('% of', '90'); set('Note', 'margine 1"'); });
await shot('14-durata'); ok(await pg.evaluate(() => { const f = [...document.querySelectorAll('.sheet label')].find(x => x.innerText.startsWith('Minutes')); return f && f.hidden; })
  && (await txt('.sheet')).includes('Duration: 14 min, calculated from the timer'), 'con un timer i minuti non si scrivono: si calcolano mentre cambi i parametri');
await clickText('Save', '.sheet');
const mh = await txt('#view');
ok(mh.includes('6 × 10" · rest 2\'30" · 90%') && mh.includes('4 × 7" · rest 3\'') && mh.includes('margine 1"'), 'parametri (round, secondi, recupero, %) impostati nella sessione: valgono solo per quel blocco');
ok(await pg.evaluate(() => { const x = __app.state.extras[0]; return x.blocks[x.blocks.length - 1].minutes === 14; }), 'minuti ricalcolati dai parametri');
// Senza timer ("Duration only") i minuti si scrivono a mano e sono obbligatori
await pg.evaluate(() => { const r = [...document.querySelectorAll('#view .blk')].filter(x => x.innerText.includes('Max hang')); r[r.length - 1].click(); }); await sleep(60);
await pg.evaluate(() => { const l = [...document.querySelectorAll('.sheet label')]; const sel = l.find(x => x.innerText.startsWith('Timer')).querySelector('select'); sel.value = 'none'; sel.dispatchEvent(new Event('change'));
  const m = l.find(x => x.innerText.startsWith('Minutes')).querySelector('input'); m.value = ''; m.dispatchEvent(new Event('input')); });
ok(await pg.evaluate(() => !document.querySelector('.sheet .sub:not([hidden])').innerText.includes('Duration:') && ![...document.querySelectorAll('.sheet label')].find(x => x.innerText.startsWith('Minutes')).hidden), 'Duration only: campo Minutes visibile, niente durata calcolata');
await clickText('Save', '.sheet');
ok((await txt('#toast')).includes('Type the minutes'), 'Duration only: senza minuti non si salva');
await pg.evaluate(() => { const m = [...document.querySelectorAll('.sheet label')].find(x => x.innerText.startsWith('Minutes')).querySelector('input'); m.value = '25'; m.dispatchEvent(new Event('input')); });
await clickText('Save', '.sheet');
ok(await pg.evaluate(() => { const x = __app.state.extras[0], b = x.blocks[x.blocks.length - 1]; return b.minutes === 25 && __app.state.exercises[b.exId].interval === null; }), 'Duration only: i minuti scritti a mano restano');
await go('home'); await clickText('+ Test', '#view');
ok((await txt('.sheet')).includes('Half-crimp') && (await txt('.sheet')).includes('L and R'), '+ Test: elenco dei test definiti');
await clickText('Half-crimp', '.sheet', true);
ok((await txt('#view')).includes('Test: Half-crimp'), 'test aggiunto alla sessione come esercizio');
await play('Test: Half-crimp'); await sleep(60);
ok(!await pg.$eval('#p-quit', e => e.hidden) && (await txt('#p-done')) === 'Skip', 'durante un timer: End exercise per fermarsi prima');
ok((await txt('#p-ph')) === 'GET READY' && (await txt('#p-note')) === 'Increasing load', 'il test ha il suo timer (7" dai parametri del test)');
const result = v => pg.evaluate(v => { const i = [...document.querySelectorAll('.sheet label')].find(l => l.innerText.startsWith('Result:')).querySelector('input'); i.value = v; }, v);
await pg.click('#p-quit');
await result('32,5'); await clickText('Save', '.sheet');
ok(await pg.evaluate(() => { const t = __app.state.tests.filter(x => x.key === 'hc'); return t.length === 1 && t[0].value === 32.5; }), 'risultato del test salvato subito nella sezione Test');
await play('Test: Half-crimp'); await sleep(60);
await pg.click('#p-quit'); await result('35'); await clickText('Save', '.sheet');
ok(await pg.evaluate(() => { const t = __app.state.tests.filter(x => x.key === 'hc'); return t.length === 1 && t[0].value === 35; }), '"Rifai": il nuovo risultato sostituisce il precedente');
await go('tests'); ok((await txt('#view')).includes('35 kg'), 'sezione Test aggiornata');
// Test personalizzato con parametri propri
await clickText('Custom test', '#view'); await pg.type('.sheet input', 'Hang a una mano');
await pg.evaluate(() => { const i = document.querySelectorAll('.sheet input'); i[1].value = 's'; i[2].value = '22'; const s = document.querySelectorAll('.sheet select'); s[0].value = 'value'; s[1].value = '1'; });
await clickText('Create test', '.sheet');
ok((await txt('#view')).includes('Hang a una mano') && (await txt('#view')).includes('22 mm · one hand'), 'test personalizzato: tacca, mani e unità sono parametri');
await shot('11-test', true);
await go('library'); await shot('12-libreria');
ok((await txt('#view')).includes('Limit bouldering') && (await txt('#view')).includes('MY EXERCISES') && (await txt('#view')).includes('Circuito spray') && !/versioni|Karma|\d ×/.test(await txt('#view')), 'libreria: solo nomi, più i miei esercizi; nessun parametro né descrizione');
await go('calendar-2027-06-01');
await shot('8-calendario-giorno');

// Si registrano esercizi, non sessioni: un esercizio fatto senza timer si registra dal suo foglio
await go('home');
ok(!/log session|logged session/i.test(await txt('#view')), 'Home: nessun "Log session"');
await pg.evaluate(() => [...document.querySelectorAll('#view .blk')].find(r => r.innerText.includes('Pinch block')).click()); await sleep(60);
await clickText('Log without timer', '.sheet');
ok((await txt('.sheet')).includes('Sets done (of 3)') && (await pg.$eval('.sheet .cols label:nth-child(1) input', e => e.value)) === '3', 'registrazione senza timer: serie (L+R) tutte fatte, modificabili');
// Esercizio per lato: due campi kg (L e R); il tasto ± per un carico negativo (scaricato)
const kgIn = await pg.$$('.sheet .kg-in input');
ok(kgIn.length === 2 && (await txt('.sheet .kg-wrap')).includes('L') && (await txt('.sheet .kg-wrap')).includes('R'), 'carico per lato: due campi L/R');
await kgIn[0].type('12'); await kgIn[1].type('10'); await pg.evaluate(() => document.querySelectorAll('.sheet .kg-sign')[1].click());
await clickText('Save', '.sheet');
ok(await pg.evaluate(() => { const b = __app.state.logs.find(x => x.date === '2026-11-25').blocks.find(x => x.name === 'Pinch block'); return b.load === 'L +12 kg · R -10 kg' && b.kgs.length === 2 && b.kgs[1].kg === -10 && b.mode === 'hang'; }), 'carico salvato in kg oltre il peso corporeo, anche negativo');
ok((await txt('#view')).includes('L +12 kg · R -10 kg'), 'carico mostrato sotto l\'esercizio');
ok(await pg.evaluate(() => { const l = __app.state.logs.filter(x => x.date === '2026-11-25'); return l.length === 1 && l[0].blocks.some(b => b.name === 'Pinch block'); }), 'esercizio registrato nella stessa giornata (una sola registrazione per giorno)');

// Programmi: in More solo la voce; la pagina li divide in corso, futuri e passati
await go('more'); ok((await txt('#more-programmes')).includes('Programmes') && (await txt('#more-programmes')).includes('1 in progress') && !(await txt('#view')).includes('Karma 8A+'), 'More: solo la voce Programmes con il riepilogo');
await pg.click('#more-programmes'); await sleep(100);
ok(await pg.evaluate(() => location.hash === '#programmes') && /In progress\nKarma 8A\+[\s\S]*In progress/.test(await txt('#view')) && (await txt('#view')).includes('Import programme'), 'pagina Programmes: programma in corso marcato, import');
await pg.evaluate(() => { const p = JSON.parse(JSON.stringify(__app.state.plans[0])); p.id = 'old'; p.title = 'Old plan'; p.startDate = '2026-06-01'; p.weeks = p.weeks.slice(0, 2); delete p.shownFrom; delete p.shownUntil;
  const q = JSON.parse(JSON.stringify(p)); q.id = 'next'; q.title = 'Next plan'; q.startDate = '2027-06-07';
  for (const x of [p, q]) x.weeks.forEach(w => w.forEach(d => d.sessions.forEach(s => { s.id += x.id; }))); __app.state.plans.push(p, q); __app.render(); });
const pgTxt = await txt('#view');
ok(pgTxt.indexOf('In progress') < pgTxt.indexOf('Upcoming') && pgTxt.indexOf('Upcoming') < pgTxt.indexOf('Past') && /Upcoming\nNext plan/.test(pgTxt) && /Past\nOld plan/.test(pgTxt), 'pagina Programmes: in corso, futuri e passati, ognuno marcato');
await shot('9b-programmi');
await go('more'); ok((await txt('#more-programmes')).includes('1 in progress · 1 upcoming · 1 past'), 'More: riepilogo per stato');
await pg.evaluate(() => { __app.state.plans = __app.state.plans.filter(p => p.id !== 'old' && p.id !== 'next'); });
// Programmi: gestione da Altro, spostare la data di inizio sposta le sessioni nel calendario
await go('programmes'); await clickText('Karma 8A+', '#view', true);
const startBefore = await pg.evaluate(() => __app.state.plans[0].startDate);
ok(await pg.$eval('.sheet input[type=date]', e => e.disabled) && (await txt('.sheet')).includes('cannot be moved'), 'programma già iniziato: la data di inizio non si sposta (le registrazioni resterebbero senza giornata)');
await setVal('.sheet input[type=date]', '2026-11-25'); await clickText('Save', '.sheet');
ok(await pg.evaluate(s0 => __app.state.plans[0].startDate === s0, startBefore), 'Save non sposta un programma iniziato');
// (prova della data scelta su un programma senza registrazioni: come se fosse stato spostato prima di iniziare)
await pg.evaluate(() => { const p = __app.state.plans[0]; p.startDate = Core.startForFirst(p, '2026-11-25'); });
ok(await pg.evaluate(() => Core.firstSessionDate(__app.state.plans[0]) === '2026-11-25'), 'programma: la prima sessione cade nel giorno scelto, anche se non è lunedì');
await shot('9-altro');
// Export YAML: il programma esce come testo leggibile, che l'app rilegge uguale
await go('programmes'); await clickText('Karma 8A+', '#view', true); await clickText('Export .yaml', '.sheet');
const yamlOut = await pg.$eval('.sheet textarea', e => e.value);
ok(/^title: Karma 8A\+$/m.test(yamlOut) && /^first_session: "2026-11-25"$/m.test(yamlOut) && /\n  - week: [\d,-]+\n    day: (mon|tue|wed|thu|fri|sat|sun)\n/.test(yamlOut), 'export: programma in YAML con settimane, giorni e data della prima sessione');
ok(await pg.evaluate(t => { const r = Core.importYaml(t); return r.plan.weeks.length === __app.state.plans[0].weeks.length; }, yamlOut), 'export: il testo esportato si reimporta');
await pg.keyboard.press('Escape'); await pg.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
// Programma che si sovrappone a uno in corso: si sceglie cosa fare, le registrazioni non cambiano mai
const snapOv = () => pg.evaluate(() => JSON.stringify({ l: __app.state.logs, t: __app.state.tests, tr: __app.state.trips }));
const before3 = await snapOv(), nPlansOv = await pg.evaluate(() => __app.state.plans.length), oldId = await pg.evaluate(() => __app.state.plans[0].id);
const importOv = async date => { await go('programmes'); await (await pg.$('#view input[type=file]')).uploadFile(PLAN); await sleep(400);
  await pg.evaluate(d => { document.querySelector('.sheet input[type=date]').value = d; }, date); await clickText('Import', '.sheet'); await sleep(150); };
await importOv('2026-11-20');
let ovt = await txt('.sheet');
ok(ovt.includes('Programmes overlap') && ovt.includes('You are importing “Karma 8A+”. The current programme “Karma 8A+”') && ovt.includes('never changed') && ovt.includes('Use the new one from 26 Nov') && ovt.includes('stops on 25 Nov (today stays as you logged it)') && /Keep the current one, start the new one on \d+ \w+/.test(ovt), 'import sovrapposto: avviso con le due scelte (oggi è già iniziato: si sostituisce da domani)');
await shot('9b-sovrapposti');
await clickText('Don\'t import', '.sheet'); await sleep(80);
ok(await pg.evaluate(n => __app.state.plans.length === n, nPlansOv) && await snapOv() === before3, 'Don\'t import: niente importato');
await pg.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
await importOv('2026-11-20');
await clickText('Use the new one from', '.sheet'); await sleep(200);
const rep = await pg.evaluate(id => { const st = __app.state, old = st.plans.find(p => p.id === id), nw = st.plans[st.plans.length - 1];
  return { until: old.shownUntil, from: nw.shownFrom, n: st.plans.length }; }, oldId);
ok(rep.until === '2026-11-25' && rep.from === '2026-11-26' && rep.n === nPlansOv + 1 && await snapOv() === before3, 'Replace: il vecchio programma finisce oggi (già iniziato), il nuovo parte domani; registrazioni, test e viaggi identici');
await go('calendar-2026-11-27');
ok((await pg.$$eval('#view .card', c => c.filter(x => /min|Done/.test(x.innerText) && x.querySelector('.blk')).length)) <= 1, 'dopo Replace: una sola giornata per giorno');
await go('calendar-2026-11-25');
ok((await txt('#view')).includes('Sloper hang: +6 kg'), 'le registrazioni di oggi restano visibili');
// Ripristino e prova di "Start after it ends"
await pg.evaluate(id => { const st = __app.state; st.plans = st.plans.filter((p, i) => i < st.plans.length - 1); delete st.plans.find(p => p.id === id).shownUntil; }, oldId);
await importOv('2026-11-20');
await clickText('Keep the current one', '.sheet'); await sleep(200);
const aft = await pg.evaluate(id => { const st = __app.state, old = st.plans.find(p => p.id === id), nw = st.plans[st.plans.length - 1];
  return { oldEnd: Core.planEnd(old), after: Core.addDays(Core.lastSession(old), 1), first: Core.firstSessionDate(nw), until: old.shownUntil || null, from: nw.shownFrom || null }; }, oldId);
ok(aft.until === null && aft.from === null && aft.first === aft.after && await snapOv() === before3, 'Start after: il nuovo parte il giorno dopo la fine del vecchio, che resta intatto');
await pg.evaluate(() => { const st = __app.state; st.plans = st.plans.slice(0, st.plans.length - 1); });
await pg.evaluate(() => { localStorage.setItem('allenamento.v1', JSON.stringify(__app.state)); });
// Import di un file con errori: elenco completo, nessun programma aggiunto
const BAD = '/tmp/e2e-bad.yaml';
writeFileSync(BAD, 'title: Rotto\nweeks: 2\nsessions:\n  - week: 3\n    day: mon\n    exercises:\n      - name: Sloper hang\n        sets: 4\n        work: sette secondi\n');
const nPlans = await pg.evaluate(() => __app.state.plans.length);
await go('programmes'); await (await pg.$('#view input[type=file]')).uploadFile(BAD); await sleep(400);
const errTxt = await txt('.sheet'); await shot('11-errori');
ok(errTxt.includes('The programme was not imported') && errTxt.includes('week: "3" is not valid') && errTxt.includes('"sette secondi" is not a duration'), 'import con errori: tutti gli errori elencati, con sessione ed esercizio');
ok(await pg.evaluate(n => __app.state.plans.length === n, nPlans), 'import con errori: nessun programma aggiunto');
await pg.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
await go('analytics');
const an = await txt('#view'); if (process.env.DBG) console.log(an.slice(0, 1400));
ok(an.includes('Training time') && an.includes('35min') && an.includes('86%\nclimbing') && !an.includes('session type') && !/on the wall/i.test(an), 'Analisi: totale ore, ciambella con % arrampicata, niente "tipo di sessione"');
ok(an.includes('Progress') && an.includes('Consistency') && an.includes('Planned days trained') && an.includes('Sets completed'), 'Analisi: sezioni Progress e Consistency');
ok(!an.includes('most time') && !an.includes('Weekly volume'), 'Analisi: niente vecchi grafici');
ok(await pg.evaluate(() => { const b = document.querySelector('#view .viz-donut-li .c-strength'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(213, 81, 129)'; }), 'Analisi: legenda della ciambella con il colore della categoria (Strength = magenta)');
await pg.evaluate(() => { const v = document.querySelectorAll('#view .viz')[1]; const hit = v.querySelectorAll('.hit'); hit[hit.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
ok(/in total/.test(await pg.evaluate(() => document.querySelectorAll('#view .viz')[1].querySelector('.viz-tip').innerText)), 'grafico impilato: tocco su una colonna → totale e gruppi');
await pg.evaluate(() => { const s = document.querySelector('#view .an-sel select'); s.value = 'days'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(100);
ok((await txt('#view')).includes('days / week'), 'Analisi: metrica giorni di allenamento');
ok((await txt('#view')).includes('Average exercise RPE') && !(await txt('#view')).includes('feeling'), 'Analisi: RPE medio degli esercizi, niente sensazione del giorno');
// Toccando un esercizio registrato: "Edit log" e "Delete log"; cancellare la registrazione lascia l'esercizio nella giornata
await go('home');
const target = await pg.evaluate(() => { const row = document.querySelector('#view .blk'); const n = row.querySelector('.n').innerText; row.click(); return n; }); await sleep(60);
await clickText('Log without timer', '.sheet'); await clickText('Save', '.sheet'); await sleep(80);
await pg.evaluate(n => [...document.querySelectorAll('#view .blk')].find(b => b.querySelector('.n').innerText === n).click(), target); await sleep(60);
ok(target && (await txt('.sheet')).includes('Edit log') && (await txt('.sheet')).includes('Delete log') && !(await txt('.sheet')).includes('Log without timer'), 'esercizio registrato: Edit log e Delete log al posto di Log without timer');
const nRows = await pg.$$eval('#view .blk', x => x.length);
await clickText('Delete log', '.sheet'); await sleep(50); await clickText('Delete', '.sheet'); await sleep(100);
ok(await pg.$$eval('#view .blk', x => x.length) === nRows && await pg.evaluate(n => { const row = [...document.querySelectorAll('#view .blk')].find(b => b.querySelector('.n').innerText === n); return row && !row.querySelector('.logged'); }, target), 'Delete log: registrazione tolta, esercizio ancora nella giornata');
await shot('10-analisi', true);

// Viaggi e progetti: sezione a sé, nella barra
await go('trips');
ok((await txt('#view')).includes('Climbing trips and the projects'), 'Trips vuota: spiega a cosa serve');
const sheetSet = (sel, i, v) => pg.evaluate((sel, i, v) => { const el = document.querySelectorAll('.sheet ' + sel)[i]; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, sel, i, v);
const dataBefore = await pg.evaluate(() => JSON.stringify({ p: __app.state.plans, l: __app.state.logs, t: __app.state.tests, e: __app.state.exercises }));
await clickText('+ Trip', '#view');
await sheetSet('input.inp', 0, 'Fontainebleau spring'); await sheetSet('input.inp', 1, 'Fontainebleau, France');
await sheetSet('select', 0, 'confirmed'); await sheetSet('select', 1, 'day');
ok(await pg.$eval('.sheet input[type=date]', e => !!e), 'date esatte: campi data');
await sheetSet('input[type=date]', 0, '2027-03-14'); await sheetSet('input[type=date]', 1, '2027-03-28');
await shot('15-trip-sheet');
await clickText('Save', '.sheet'); await sleep(150);
let tv = await txt('#view');
ok(/^#trip-/.test(await pg.evaluate(() => location.hash)) && tv.includes('Fontainebleau spring') && tv.includes('14 – 28 Mar 2027') && tv.includes('in 109 days') && tv.includes('Confirmed'), 'nuovo viaggio: dettaglio con date e giorni alla partenza');
for (const [name, grade, style] of [['Karma', '8A+', 'boulder'], ['Rainbow', '7a', 'route']]) {
  await clickText('+ Project', '#view');
  await sheetSet('input.inp', 0, name); await sheetSet('select', 1, style); await sheetSet('select', 0, grade); await sheetSet('input.inp', 1, 'Franchard');
  await clickText('Save', '.sheet'); await sleep(100);
}
tv = await txt('#view');
if (process.env.DBG) console.log(JSON.stringify(tv));
ok(tv.includes('Karma8A+') && tv.includes('Rainbow7a') && tv.includes('0/2 sent'), 'progetti: grado Font per i blocchi, scala francese per le vie');
await pg.click('#view .pdot'); await sleep(80);
ok((await pg.$eval('#toast', e => e.innerText)).includes('Karma sent! 1/2') && await pg.$eval('#view .pdot', e => e.classList.contains('pop')), 'un tocco sul cerchio: progetto chiuso, animazione e messaggio');
await sleep(500);
tv = await txt('#view');
ok(tv.includes('1/2 sent') && tv.includes('sent 25 Nov 2026') && await pg.evaluate(() => __app.state.trips[0].projects[0].sentOn === '2026-11-25'), 'progetto chiuso con la data di oggi');
await shot('16-viaggio', true);
ok(!(await txt('#view')).includes('Checklist'), 'viaggio: niente checklist');
await go('trips');
tv = await txt('#view');
ok(tv.includes('Coming up') && tv.includes('Fontainebleau spring') && tv.includes('1/2 sent'), 'elenco: viaggio confermato in evidenza con avanzamento');
ok(await pg.evaluate(() => document.querySelector('#tabs a.on').getAttribute('href') === '#trips'), 'barra: Trips attiva');
ok(await pg.evaluate(b => JSON.stringify({ p: __app.state.plans, l: __app.state.logs, t: __app.state.tests, e: __app.state.exercises }) === b, dataBefore), 'i viaggi non toccano programmi, registrazioni, test ed esercizi');
// Countdown in Home: sotto la giornata di oggi, anello pieno in proporzione da quando il viaggio è confermato
await pg.evaluate(() => { __app.state.trips[0].since = '2026-09-25'; });
await go('home'); await sleep(150);
const cd = await pg.evaluate(() => { const c = document.querySelector('#view .cd'); if (!c) return null; const cards = [...document.querySelectorAll('#view > .card')]; const arc = c.querySelector('.cd-arc');
  return { t: c.innerText, last: cards[cards.length - 1] === c, afterDay: cards.indexOf(c) > cards.findIndex(x => x.innerText.includes('done')), fill: 1 - arc.getAttribute('stroke-dashoffset') / arc.getAttribute('stroke-dasharray') }; });
ok(cd && cd.t.includes('109') && cd.t.includes('NEXT TRIP · CONFIRMED') && cd.t.includes('Fontainebleau spring') && cd.t.includes('1/2 sent') && cd.last && cd.afterDay, 'Home: countdown del prossimo viaggio confermato, dopo la giornata di oggi');
ok(Math.abs(cd.fill - (1 - 109 / 170)) < 0.01, 'countdown: anello pieno per i giorni già passati dalla conferma');
if (process.env.SHOTS) { await pg.evaluate(() => { document.getElementById('tabs').style.visibility = 'hidden'; }); await (await pg.$('#view .cd')).screenshot({ path: process.env.SHOTS + '/19-countdown.png' }); await pg.evaluate(() => { document.getElementById('tabs').style.visibility = ''; }); }
// Un'idea con date più vicina (dal vecchio stato Possible, che diventa Idea) prende il posto del confermato, con il pallino giallo; ne resta uno solo
await pg.evaluate(() => { __app.state.trips.push(Core.cleanTrips([{ id: 'pz', name: 'Albarracin', place: '', from: '2027-01', to: '', status: 'possible', notes: '', since: '2026-11-25', projects: [], }])[0]); __app.render(); });
const cd2 = await pg.evaluate(() => { const c = document.querySelectorAll('#view .cd'); return { n: c.length, t: c[0].innerText, dot: getComputedStyle(c[0].querySelector('.cd-dot')).backgroundColor }; });
ok(cd2.n === 1 && cd2.t.includes('Albarracin') && cd2.t.includes('NEXT TRIP · IDEA') && cd2.t.includes('~37') && cd2.dot === 'rgb(242, 204, 96)', 'Home: un solo viaggio, il più vicino anche se è un\'idea, con pallino giallo e giorni approssimativi');
await pg.evaluate(() => { __app.state.trips = __app.state.trips.filter(t => t.id !== 'pz'); __app.render(); });
await pg.$eval('#view .cd', e => e.click()); await sleep(100);
ok(/^#trip-/.test(await pg.evaluate(() => location.hash)), 'tocco sul countdown: apre il viaggio');
await go('trips');
await pg.reload(); await sleep(400);
ok(await pg.evaluate(() => __app.state.trips.length === 1 && __app.state.trips[0].projects.length === 2 && __app.state.v === 18), 'viaggi salvati sul dispositivo dopo il riavvio');
// v14: esercizi registrati con 0 minuti (Analytics a 0) prendono i minuti previsti dalla giornata
const zero = await pg.evaluate(() => { const st = JSON.parse(localStorage.getItem('allenamento.v1')), l = st.logs.find(x => x.date === '2026-11-25');
  const planned = new Map(); for (const p of st.plans) for (const w of p.weeks) for (const d of w) for (const x of d.sessions) for (const b of x.blocks) planned.set(b.id, b.minutes);
  for (const x of st.extras) for (const b of x.blocks) planned.set(b.id, b.minutes);
  const share = (m, st) => (!st || !st.of ? m : st.done > 0 ? Math.max(1, Math.round(m * st.done / st.of)) : 0);
  const exp = l.blocks.map(x => share(planned.get(x.bid), x.sets)); l.blocks.forEach(x => { x.minutes = 0; }); l.minutes = 0; st.v = 13;
  localStorage.setItem('allenamento.v1', JSON.stringify(st)); return exp; });
await pg.reload(); await sleep(400);
ok(await pg.evaluate(exp => { const l = __app.state.logs.find(x => x.date === '2026-11-25'); return JSON.stringify(l.blocks.map(x => x.minutes)) === JSON.stringify(exp) && l.minutes === exp.reduce((a, b) => a + b, 0) && l.minutes > 0; }, zero),
  'migrazione v14: registrazioni a 0 minuti riprendono i minuti previsti (in proporzione alle serie fatte), totale del giorno ricalcolato');
await shot('17-trips');

// Taccuino: la nota si scrive da More (la barra ora ha Trips), con contesto; elenco esportabile
await go('more'); await pg.click('#more-note');
await shot('12-nota'); ok(await pg.$eval('.sheet textarea', e => getComputedStyle(e).backgroundColor) === 'rgb(16, 19, 22)', 'Nota: campo di testo scuro, testo chiaro leggibile');
await pg.type('.sheet textarea', 'Il grafico del volume è poco leggibile'); await clickText('Save note', '.sheet');
await go('notebook');
const nt = await txt('#view');
ok(nt.includes('Il grafico del volume è poco leggibile') && nt.includes('· more · v'), 'taccuino: nota salvata con schermata e versione');
await clickText('Export list', '#view');
ok(/\[2026-11-25 \d\d:\d\d · more · v[\d.]+\] Il grafico/.test(await pg.$eval('.sheet textarea', e => e.value)), 'taccuino: elenco esportabile come testo');
await pg.evaluate(() => document.querySelector('.overlay').remove());
// Diagnostica: controlli eseguiti sul dispositivo, con esito e rapporto
await go('diagnostics'); await clickText('Run the checks', '#view'); await sleep(600);
const dg = await txt('#view');
ok(['Data storage', 'Offline use', 'Sound signals', 'Screen stays on', 'Installed on the Home Screen', 'Backup'].every(x => dg.includes(x)) && dg.includes('read and write succeeded') && /Version [\d.]+/.test(dg), 'diagnostica: esito di ogni controllo e versione');
await shot('13-diagnostica');
// Aggiornamento disponibile: versione pubblicata diversa da quella in uso
await pg.evaluate(async () => { window.__f0 = window.fetch; window.fetch = async u => (String(u).includes('version.json') ? { ok: true, json: async () => ({ version: '99999999.0000' }) } : window.__f0(u)); await __app.checkUpdate(true); });
await sleep(100); await go('home');
ok((await txt('#view')).includes('A newer version of the app is available'), 'Home: avviso quando c\'è una versione nuova');
await pg.evaluate(() => { window.fetch = window.__f0; });

// Backup automatico su GitHub (rete simulata): primo backup, file senza token, errore di autenticazione
await go('more');
await pg.evaluate(() => { window.__gh = []; window.__ghStatus = { GET: 404, PUT: 201 };
  window.fetch = async (url, o = {}) => { const m = o.method || 'GET'; __gh.push({ url, m, auth: o.headers.Authorization, body: o.body }); const st = __ghStatus[m]; return { ok: st < 300, status: st, json: async () => ({ sha: 'abc' }), text: async () => '{}' }; }; });
await pg.type('#view input[placeholder="user/repository-name"]', 'https://github.com/leo/allenamento-dati/'); await pg.type('#view input[type=password]', 'github_pat_FINTO');
await clickText('Save and test', '#view'); await sleep(200);
const gh = await pg.evaluate(() => { const put = __gh.find(x => x.m === 'PUT'), body = JSON.parse(put.body), txt = new TextDecoder().decode(Uint8Array.from(atob(body.content), c => c.charCodeAt(0))), data = JSON.parse(txt);
  return { url: put.url, auth: put.auth, sha: body.sha, hasToken: txt.includes('github_pat'), logs: data.logs.length, repo: data.settings.gh.repo, toast: document.getElementById('toast').textContent, last: __app.state.settings.lastBackup, kept: __app.state.settings.gh.token }; });
ok(gh.url === 'https://api.github.com/repos/leo/allenamento-dati/contents/allenamento-backup.json' && gh.auth === 'Bearer github_pat_FINTO' && gh.sha === undefined, 'backup GitHub: file creato nel repository indicato');
ok(!gh.hasToken && gh.logs === 1 && gh.repo === 'leo/allenamento-dati' && gh.kept === 'github_pat_FINTO', 'il backup contiene i dati ma non il token, che resta sul dispositivo');
ok(/Backup saved to GitHub/.test(gh.toast) && gh.last === '2026-11-25' && (await txt('#view')).includes('Active. Last backup'), 'esito mostrato e data dell\'ultimo backup aggiornata');
await pg.evaluate(async () => { __ghStatus.GET = 200; __gh.length = 0; await __app.cloudBackup(true); });
ok(await pg.evaluate(() => JSON.parse(__gh.find(x => x.m === 'PUT').body).sha === 'abc'), 'backup successivi: aggiornano il file esistente');
await pg.evaluate(async () => { __ghStatus.GET = 401; __app.state.settings.prep = 11; await __app.cloudBackup(false); });
await go('home'); ok((await txt('#view')).includes('Automatic backup failed: token invalid or expired'), 'errore del backup automatico segnalato in Home, senza perdere dati');
// Offline: la registrazione resta sul dispositivo, il backup fallisce senza danni e riparte da solo quando torna la rete
await pg.evaluate(async () => { window.__okFetch = window.fetch; window.fetch = async () => { throw new TypeError('Failed to fetch'); }; __ghStatus.GET = 200;
  __app.state.logs.push({ id: 'off', date: '2026-11-25', title: 'Fatta offline', minutes: 30, type: 'wall' }); localStorage.setItem('allenamento.v1', JSON.stringify(__app.state)); await __app.cloudBackup(false); });
ok(await pg.evaluate(() => __app.state.settings.gh.error === 'no network' && JSON.parse(localStorage.getItem('allenamento.v1')).logs.some(l => l.id === 'off')), 'offline: la registrazione è salvata sul dispositivo, il backup resta in sospeso');
await pg.evaluate(() => { window.fetch = window.__okFetch; __gh.length = 0; window.dispatchEvent(new Event('online')); }); await sleep(3600);
ok(await pg.evaluate(() => { const put = __gh.find(x => x.m === 'PUT'); if (!put) return false; const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(put.body).content), c => c.charCodeAt(0)))); return d.logs.some(l => l.id === 'off') && d.trips.length === 1 && d.trips[0].projects.length === 2 && __app.state.settings.gh.error === null; }), 'al ritorno della rete il backup parte da solo e include ciò che è stato fatto offline, viaggi compresi');
await pg.evaluate(() => { __gh.length = 0; window.dispatchEvent(new Event('online')); }); await sleep(3600);
ok(await pg.evaluate(() => __gh.length === 0), 'senza modifiche nuove non viene caricato nulla');
await pg.evaluate(() => { __app.state.settings.gh = null; });

// Persistenza e migrazione di un backup v2 con due sessioni nello stesso giorno
await pg.reload();
ok(await pg.evaluate(() => __app.state.logs.length === 2 && __app.state.extras.length === 1 && __app.state.v === 18), 'i dati sopravvivono al ricaricamento');
const mig = await pg.evaluate(async () => {
  const mk = (id, ex) => ({ id, type: 'wall', period: 'base', blocks: [{ id: id + 'b', exId: ex, minutes: 5 }] });
  const old = { v: 2, plans: [{ id: 'p', title: 'Vecchio', startDate: '2026-11-23', weeks: [[{ sessions: [mk('s1', 'e1'), mk('s2', 'e2')] }, ...Array.from({ length: 6 }, () => ({ sessions: [] }))]] }],
    activePlan: 'p', exercises: { e1: { id: 'e1', name: 'A', prescription: '', slot: 'wall', interval: null, load: null }, e2: { id: 'e2', name: 'B', prescription: '', slot: 'strength', interval: null, load: null } },
    logs: [{ id: 'l', date: '2026-11-23', sid: 's2', title: 'x', minutes: 10 }], tests: [], extras: [], live: { sid: 's2', idx: 3, startedAt: 1 } };
  localStorage.setItem('allenamento.v1', JSON.stringify(old)); location.reload(); return true;
});
await sleep(500);
const m2 = await pg.evaluate(() => { const s = __app.state, d = s.plans[0].weeks[0][0]; return { n: d.sessions.length, blocks: d.sessions[0].blocks.length, log: s.logs[0].sid, live: s.live }; });
ok(m2.n === 1 && m2.blocks === 2 && m2.log === 's1' && !m2.live, 'backup v2 migrato: sessioni del giorno unite, diario ricollegato, niente più sessione in corso');
// Dati illeggibili: si tiene una copia, la Home lo segnala e permette di esportarla
await pg.evaluate(() => { localStorage.setItem('allenamento.v1', '{"v":7,"plans":'); location.reload(); });
await sleep(500);
const resc = await pg.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('allenamento.v1.rescue-')).map(k => localStorage.getItem(k)));
ok(resc.length === 1 && resc[0] === '{"v":7,"plans":', 'dati illeggibili: copia intatta messa da parte prima di ripartire da zero');
ok((await txt('#view')).includes('could not be read') && (await txt('#view')).includes('Export old data'), 'la Home avvisa e propone di esportare i vecchi dati');
await pg.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('.rescue-')) localStorage.removeItem(k); });

// Backup reale di Leo (se presente): programma che apre con un giorno di riposo, prima sessione spostata a mercoledì 18
const REAL = new URL('../private/backup-2026-11-17.json', import.meta.url);
if (fs.existsSync(REAL)) {
  await pg.evaluate(t => { localStorage.setItem('allenamento.v1', t); location.reload(); }, fs.readFileSync(REAL, 'utf8'));
  await sleep(500);
  ok(await pg.evaluate(() => Array.isArray(__app.state.trips) && __app.state.trips.length === 0), 'backup reale precedente ai viaggi: si apre senza errori, nessun viaggio');
  await go('programmes'); await clickText('Karma - Fase 1', '#view', true);
  ok(await pg.$eval('.sheet input[type=date]', e => e.value) === '2026-11-17', 'backup reale: la data mostrata è quella della prima sessione (mar 17)');
  await setVal('.sheet input[type=date]', '2026-11-18'); await clickText('Save', '.sheet');
  ok(await pg.evaluate(() => __app.state.plans[0].startDate === '2026-11-17'), 'backup reale: prima sessione mercoledì 18');
  await go('calendar-2026-11-17'); const d17 = await txt('#view');
  await go('calendar-2026-11-18'); const d18 = await txt('#view');
  ok(d17.includes('Rest day') && !d18.includes('Rest day'), 'calendario: nulla il 17, la prima giornata il 18');
  // Copia su un giorno che ha già esercizi: si aggiungono in fondo, nessuna seconda giornata
  const before = await pg.evaluate(() => { const p = __app.state.plans[0], d = iso => { const l = Core.locate(p, iso); return p.weeks[l.w][l.d].sessions; }; return { d20: d('2026-11-20')[0].blocks.length, d18: d('2026-11-18')[0].blocks.length }; });
  await go('calendar-2026-11-18'); await clickText('Edit day', '#view'); await clickText('Copy', '.sheet', true);
  await setVal('.sheet input[type=date]', '2026-11-20'); await clickText('Copy', '.sheet');
  ok(await pg.evaluate(b => { const p = __app.state.plans[0], l = Core.locate(p, '2026-11-20'), d = p.weeks[l.w][l.d].sessions; return d.length === 1 && d[0].blocks.length === b.d20 + b.d18 && !__app.state.extras.some(x => x.date === '2026-11-20'); }, before), 'copia su un giorno con esercizi: aggiunti in fondo, una sola giornata');
  // Svuotare un giorno: diventa riposo, senza contenitore vuoto
  await go('calendar-2026-11-18'); await clickText('Edit day', '#view'); await clickText('Clear the day', '.sheet'); await clickText('Remove', '.sheet');
  ok((await txt('#view')).includes('Rest day') && await pg.evaluate(() => { const p = __app.state.plans[0], l = Core.locate(p, '2026-11-18'); return p.weeks[l.w][l.d].sessions.length === 0; }), 'Clear the day: il giorno torna di riposo e la giornata sparisce dai dati');
}

// Dati salvati con l'interfaccia in italiano (v6): nomi predefiniti e lati passano all'inglese, quello che ha scritto l'utente resta
await pg.evaluate(() => {
  const old = { v: 6, plans: [], activePlan: null, extras: [{ id: 'x0', date: '2026-11-26', title: 'Vuota', blocks: [] }, { id: 'x1', date: '2026-11-25', title: 'Dita a casa', blocks: [{ id: 'b1', exId: 'e1', minutes: 7, note: 'lento' }, { id: 'b2', exId: 'e2', minutes: 8 }, { id: 'b3', exId: 'e3', minutes: 5 }, { id: 'b4', exId: 'e4', minutes: 20 }] }],
    exercises: { e1: { id: 'e1', std: 'wrist-curl', name: 'Flessione polso', slot: 'strength', interval: null, load: null, surface: '' },
      e2: { id: 'e2', std: 'pinch-lift', name: 'Pinch block', slot: 'strength', interval: { rounds: 6, workSeconds: 7, restSeconds: 75, cues: ['SX', 'DX'] }, load: { ref: 'pinch', mode: 'lift', pct: 75 }, surface: '' },
      e3: { id: 'e3', std: null, name: 'Sospensioni di Leo', slot: 'strength', interval: null, load: null, surface: '' },
      e4: { id: 'e4', std: 'warmup-wall', name: 'Riscaldamento al muro', slot: 'warmup', interval: null, load: null, surface: '' } },
    testDefs: [{ key: 'bw', name: 'Peso corporeo', unit: 'kg', mode: 'value' }, { key: 'pinchL', name: 'Pinch block SX', unit: 'kg', mode: 'lift', seconds: 7, hands: 1 }, { key: 'pinchR', name: 'Pinch block DX', unit: 'kg', mode: 'lift', seconds: 7, hands: 1 }],
    tests: [{ id: 't1', key: 'pinchL', date: '2026-11-20', value: 20 }, { id: 't2', key: 'pinchR', date: '2026-11-20', value: 24 }], custom: [], notes: [],
    surfaces: [{ key: 'gym', name: 'Indoor (palestra)' }, { key: 'mine', name: 'Pannello di casa' }],
    logs: [{ id: 'l1', date: '2026-11-24', minutes: 30, blocks: [{ name: 'Pinch block', key: 'pinch-lift|pinch', label: 'Pinch block', kgs: [{ side: 'SX', kg: 15 }, { side: 'DX', kg: 18 }], rpe: 7, mode: 'lift' }, { name: 'Flessione polso (manubri)', key: 'wrist-curl|wrist', minutes: 6 }, { name: 'Circuito mio', sec: 'wall', minutes: 25 }], loads: [{ name: 'Flessione polso (manubri)', kg: '20 kg' }] }] };
  localStorage.setItem('allenamento.v1', JSON.stringify(old)); location.reload();
});
await sleep(500);
const m7 = await pg.evaluate(() => { const s = __app.state; return { v: s.v, trips: s.trips.length, e1: s.exercises.e1.name, cues: s.exercises.e2.interval.cues.join(), e3: s.exercises.e3.name, defs: s.testDefs.map(d => d.name).join('|'), surf: s.surfaces.map(x => x.name).join('|'), sides: s.logs[0].blocks[0].kgs.map(k => k.side).join(), title: s.extras[0].title, note: s.extras[0].blocks[0].note, mins: s.extras[0].blocks.map(b => b.minutes).join(), nx: s.extras.length, lb: s.logs[0].blocks[1].name + '|' + s.logs[0].loads[0].name, nb: s.extras[0].blocks.length, e4: !!s.exercises.e4, secs: s.logs[0].blocks.map(b => b.sec).join(), e3s: s.exercises.e3.section }; });
ok(m7.v === 18 && m7.trips === 0 && m7.e1 === 'Wrist curl' && m7.cues === 'L,R' && m7.defs === 'Body weight|Pinch block L|Pinch block R' && m7.surf === 'Indoor (gym)|Pannello di casa|Lead (gym)|Lead (rock)' && m7.sides === 'L,R', 'dati v6 in italiano: nomi predefiniti, superfici e lati SX/DX passano all\'inglese');
ok(m7.lb === 'Wrist curl|Wrist curl', 'migrazione v10: le registrazioni passate prendono il nome della libreria');
const m17 = await pg.evaluate(() => { const s = __app.state, iv = s.exercises.e2.interval; return { r: iv.rounds, sides: iv.sides, sw: iv.switchSeconds, log: JSON.stringify(s.logs[0].blocks[0].kgs) }; });
ok(m17.r === 3 && m17.sides === 2 && m17.sw === 10 && m17.log === '[{"side":"L","kg":15},{"side":"R","kg":18}]', 'migrazione v17: Pinch block da 6 lati a 3 serie L+R con cambio lato 10 s, log invariato (' + JSON.stringify(m17) + ')');
ok(m7.nb === 3 && !m7.e4, 'migrazione v11: il riscaldamento esce dalle giornate e dai dati');
ok(m7.secs === 'fingers,conditioning,strength' && m7.e3s === 'conditioning', 'migrazione v11: registrazioni ed esercizi personali nelle nuove categorie');
ok(m7.nx === 1, 'migrazione v9: le giornate senza esercizi spariscono');
ok(m7.mins === '7,4,5', 'migrazioni v8 + v17: con un timer i minuti sono quelli calcolati (Pinch 8 → 7 → 4 in serie L+R), senza timer restano (' + m7.mins + ')');
ok(m7.e3 === 'Sospensioni di Leo' && m7.title === 'Dita a casa' && m7.note === 'lento', 'nomi, titoli e note scritti dall\'utente restano come sono');
await go('home');
ok((await txt('#view')).includes('L 15 kg · R 18 kg') && (await txt('#view')).includes('Wrist curl') && (await txt('#view')).includes('Sospensioni di Leo'), 'dopo la migrazione i kg per lato si calcolano ancora dai massimali');
await go('analytics');
ok(/Pinch block L/.test(await txt('#view')) && /Pinch block R/.test(await txt('#view')), 'i carichi registrati prima della migrazione restano nelle serie per lato');
ok(errors.length === 0, 'nessun errore in console' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log('E2E OK');
