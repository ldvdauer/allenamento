// Smoke test end-to-end in Chrome headless (viewport iPhone).
// Uso: node test/e2e.mjs  — richiede private/Karma-8A+.blokplan (programma personale, non versionato).
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const PLAN = fileURLToPath(new URL('../private/Karma-8A+.blokplan', import.meta.url));
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
ok(home.includes('Home') && home.includes('Rest day') && home.includes('Crea sessione') && home.includes('Registra sessione'), 'Home al primo avvio: Rest day + crea/registra');
ok(!/pian|programm.*settimana|Questa settimana/i.test(home.replace('in programma oggi', '')), 'Home: nessun riferimento al piano né riepiloghi');
ok((await txt('#tabs')).replace(/\s+/g, ' ').trim() === 'Home Calendario Diario Analisi Altro', 'navigazione: 5 schede, nessuna sezione Piano');

// Import: si sceglie la data di inizio e il programma finisce nel calendario
await go('altro');
await (await pg.$('#view input[type=file]')).uploadFile(PLAN); await sleep(400);
ok((await txt('.sheet')).includes('Importa programma') && (await pg.$eval('.sheet input[type=date]', e => e.value)) === '2026-11-16', 'import: chiede da quando parte (default dal file)');
await clickText('Importa', '.sheet');
ok((await txt('#toast')).includes('Importato Karma 8A+'), 'programma importato');
ok(await pg.evaluate(() => location.hash === '#calendario-2026-11-16'), 'dopo l\'import si apre il calendario sul primo giorno');
let cal = await txt('#view');
ok(cal.includes('TEST open hand') && cal.includes('KB press 1 braccio') && !/Fuori muro|Muro ·/.test(cal), 'una sola sessione al giorno, senza etichette Muro / Fuori muro');
ok(await pg.evaluate(() => __app.state.plans[0].weeks.every(w => w.every(d => d.sessions.length <= 1))), 'ogni giorno del programma ha al massimo una sessione');
await shot('1-calendario');

// Massimali → kg
await go('progressi');
for (const [name, v] of [['Peso corporeo', '70'], ['Sloper BM2000', '20'], ['Pinch block 7" SX', '20'], ['Pinch block 7" DX', '24'], ['Flessione polso', '22,5']]) {
  await clickText(name, '#view');
  await pg.type('.sheet .cols label:nth-child(2) input', v);
  await clickText('Aggiungi risultato');
}
await go('home');
home = await txt('#view');
ok(home.includes('Sloper BM2000 7"') && home.includes('Trazioni zavorrate'), 'Home: la sessione di oggi con tutti gli esercizi');
ok(home.includes('+4,5 kg') && home.includes('SX 15 kg · DX 18 kg') && home.includes('20,5 kg'), 'kg calcolati dai massimali');
await shot('2-home');

// Trascinamento: l'ultimo esercizio del giorno diventa il secondo
await go('calendario-2026-11-25');
const names = () => pg.evaluate(() => __app.state.plans[0].weeks[1][2].sessions[0].blocks.map(b => __app.state.exercises[b.exId].name));
const before = await names();
const pos = await pg.evaluate(() => { const g = [...document.querySelectorAll('#view .grip')]; g[g.length - 1].scrollIntoView({ block: 'center' }); const a = g[g.length - 1].getBoundingClientRect(), t = g[g.length - 3].getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2, ty: t.top + 2 }; });
await pg.mouse.move(pos.x, pos.y); await pg.mouse.down(); await pg.mouse.move(pos.x, (pos.y + pos.ty) / 2, { steps: 4 }); await pg.mouse.move(pos.x, pos.ty, { steps: 4 }); await pg.mouse.up(); await sleep(150);
const after = await names(), n = before.length;
ok(after[n - 3] === before[n - 1] && after[n - 1] === before[n - 2] && after[0] === before[0] && after.length === n, 'trascinamento: l\'ultimo esercizio spostato due posizioni più su e salvato');
ok((await pg.$('.sheet')) === null, 'trascinare non apre la scheda dell\'esercizio');
await shot('3-giorno');

// Sessione: elenco di esercizi, ognuno con il suo timer
await go('home');
await clickText('Avvia', '#view', true);
ok(!(await pg.$eval('#runner', e => e.hidden)) && (await pg.$eval('#player', e => e.hidden)), 'avvio: elenco della sessione, nessun timer partito da solo');
ok((await pg.$$('#runner .run-r')).length === before.length, 'elenco: un esercizio per riga');
await shot('4-sessione');
await clickText('Avvia', '#runner', true); // riscaldamento, 20 minuti a durata
ok((await txt('#p-clock')) === '20:00' && (await txt('#p-name')) === 'Riscaldamento', 'riscaldamento: timer suo, 20:00');
await adv(20 * 60000 + 500);
ok((await pg.$eval('#player', e => e.hidden)) && (await txt('.sheet')).includes('Esercizio completato'), 'allo scadere il timer si ferma e chiede la registrazione (non parte l\'esercizio dopo)');
ok((await pg.$eval('.sheet input', e => e.value)) === '20', 'minuti misurati precompilati');
await clickText('Salva', '.sheet');
ok((await pg.$$('#runner .run-r.done')).length === 1 && (await pg.$eval('#player', e => e.hidden)), 'tornato all\'elenco con l\'esercizio segnato come fatto');

// Esercizio a tempo (sloper 4 × 7"): preparazione → lavoro → recupero, kg nel timer
await clickText('Avvia', '#runner', true);
// dopo il trascinamento il secondo esercizio è quello spostato: cerco lo sloper per nome
if ((await txt('#p-name')) !== 'Sloper BM2000 7"') { await pg.click('#p-quit'); await clickText('Non fatto', '.sheet'); await pg.evaluate(() => [...document.querySelectorAll('#runner .run-r')].find(r => r.innerText.includes('Sloper BM2000')).querySelector('button').click()); await sleep(60); }
ok((await txt('#p-ph')) === 'PREPARATI' && (await txt('#p-name')) === 'Sloper BM2000 7"', 'sloper: preparazione');
await adv(10500);
ok((await txt('#p-ph')) === 'LAVORO' && (await txt('#p-round')) === 'Round 1 di 4' && (await txt('#p-kg')).startsWith('+4,5'), 'lavoro: round 1/4 con i kg');
await shot('5-timer');
await adv(7500);
ok((await txt('#p-ph')) === 'RECUPERO', 'hang finito → recupero');
const c0 = await txt('#p-clock'); await pg.click('#p-plus'); ok((await txt('#p-clock')) !== c0, '+30 s sul recupero');
await pg.click('#p-pause'); const c1 = await txt('#p-clock'); await adv(60000); ok((await txt('#p-clock')) === c1, 'pausa: il tempo non scorre'); await pg.click('#p-pause');
for (let i = 0; i < 20 && !(await pg.$eval('#player', e => e.hidden)); i++) await pg.click('#p-done');
ok((await txt('.sheet')).includes('Carico usato') && (await pg.$eval('.sheet label:nth-of-type(2) input', e => e.value)) === '+4,5 kg', 'fine esercizio: carico precompilato');
await clickText('Salva', '.sheet');

// Aggiungere un esercizio durante la sessione
const nBlocks = (await pg.$$('#runner .run-r')).length;
await clickText('+ Esercizio', '#runner'); await pg.type('.sheet input', 'Limit Moon'); await sleep(80);
await clickText('Limit MoonBoard', '.sheet', true);
ok((await pg.$$('#runner .run-r')).length === nBlocks + 1, 'esercizio aggiunto durante la sessione');
await pg.evaluate(() => { const r = [...document.querySelectorAll('#runner .run-r')]; r[r.length - 1].querySelector('button').click(); }); await sleep(60);
ok((await txt('#p-name')) === 'Limit MoonBoard' && (await txt('#p-round')) === 'MoonBoard', 'il nuovo esercizio parte con il suo timer e la sua superficie');
await adv(6 * 60000); await pg.click('#p-quit');
ok((await pg.$eval('.sheet select', e => e.value)) === 'moonboard', 'registrazione: superficie precompilata');
await pg.select('.sheet .cols label:nth-child(2) select', '7A+');
await pg.type('.sheet .cols + label input', '3');
await pg.type('.sheet label:last-of-type input', 'buone sensazioni');
await shot('6-registrazione');
await clickText('Salva', '.sheet');

// Ricarica a metà: la sessione si riprende con gli esercizi già fatti
await pg.reload();
ok((await txt('#view')).includes('Sessione in corso'), 'ricarica a metà → "Sessione in corso" in Home');
await clickText('Riprendi', '#view');
ok((await pg.$$('#runner .run-r.done')).length === 3, 'ripresa: i tre esercizi fatti restano segnati');
await clickText('Termina sessione', '#runner');
ok((await txt('.sheet')).includes('3 di ' + (nBlocks + 1) + ' esercizi fatti'), 'termina sessione: riepilogo');
await pg.type('.sheet textarea', 'Prova automatica');
await clickText('Salva nel diario');
let diary = await txt('#view');
ok(diary.includes('Prova automatica') && diary.includes('MoonBoard 7A+ · 3 blocchi') && diary.includes('Sloper BM2000 7": +4,5 kg') && diary.includes('buone sensazioni'), 'diario: carico, superficie, grado e nota dei singoli esercizi');
await shot('7-diario');
await go('home'); ok((await txt('#view')).includes('Fatta'), 'Home: sessione segnata come fatta');

// Crea sessione da Home su un giorno qualsiasi, aggiunge esercizi dal calendario
await clickText('Crea sessione', '#view');
await setVal('.sheet input[type=date]', '2026-12-25'); await pg.type('.sheet .cols label:nth-child(2) input', 'Natale al muro');
await clickText('Crea sessione', '.sheet');
ok(await pg.evaluate(() => location.hash === '#calendario-2026-12-25') && (await txt('#view')).includes('Natale al muro'), 'sessione creata su una data scelta e aperta nel calendario');
await clickText('+ Esercizio', '#view'); await clickText('+ Nuovo');
await pg.type('.sheet input', 'Circuito spray'); await clickText('Crea esercizio');
ok((await txt('#view')).includes('Circuito spray'), 'esercizio nuovo aggiunto alla sessione');
await shot('8-calendario-giorno');

// Registra sessione (manuale) da Home
await go('home'); await clickText('Registra sessione', '#view');
ok((await txt('.sheet')).includes('Registra sessione') && !(await txt('.sheet')).includes('Tipo'), 'registrazione manuale senza campo "tipo"');
await clickText('Salva', '.sheet');
ok(await pg.evaluate(() => __app.state.logs.length === 2), 'registrazione manuale salvata');

// Programmi: gestione da Altro, spostare la data di inizio sposta le sessioni nel calendario
await go('altro'); await clickText('Karma 8A+', '#view');
await setVal('.sheet input[type=date]', '2026-11-25'); await clickText('Salva', '.sheet');
ok(await pg.evaluate(() => __app.state.plans[0].startDate === '2026-11-23'), 'programma: la nuova data viene portata al lunedì');
await shot('9-altro');
await go('analisi'); ok((await txt('#view')).includes('Volume settimanale') && !(await txt('#view')).includes('tipo di sessione'), 'Analisi: grafici presenti, niente "tipo di sessione"');
await shot('10-analisi', true);

// Persistenza e migrazione di un backup v2 con due sessioni nello stesso giorno
await pg.reload();
ok(await pg.evaluate(() => __app.state.logs.length === 2 && __app.state.extras.length === 1 && __app.state.v === 3), 'i dati sopravvivono al ricaricamento');
const mig = await pg.evaluate(async () => {
  const mk = (id, ex) => ({ id, type: 'wall', period: 'base', blocks: [{ id: id + 'b', exId: ex, minutes: 5 }] });
  const old = { v: 2, plans: [{ id: 'p', title: 'Vecchio', startDate: '2026-11-23', weeks: [[{ sessions: [mk('s1', 'e1'), mk('s2', 'e2')] }, ...Array.from({ length: 6 }, () => ({ sessions: [] }))]] }],
    activePlan: 'p', exercises: { e1: { id: 'e1', name: 'A', prescription: '', slot: 'wall', interval: null, load: null }, e2: { id: 'e2', name: 'B', prescription: '', slot: 'strength', interval: null, load: null } },
    logs: [{ id: 'l', date: '2026-11-23', sid: 's2', title: 'x', minutes: 10 }], tests: [], extras: [], live: { sid: 's2', idx: 3, startedAt: 1 } };
  localStorage.setItem('allenamento.v1', JSON.stringify(old)); location.reload(); return true;
});
await sleep(500);
const m2 = await pg.evaluate(() => { const s = __app.state, d = s.plans[0].weeks[0][0]; return { n: d.sessions.length, blocks: d.sessions[0].blocks.length, log: s.logs[0].sid, live: s.live }; });
ok(m2.n === 1 && m2.blocks === 2 && m2.log === 's1' && m2.live.sid === 's1' && m2.live.done, 'backup v2 migrato: sessioni del giorno unite, diario e sessione in corso ricollegati');
ok(errors.length === 0, 'nessun errore in console' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log('E2E OK');
