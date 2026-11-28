// Bug del 24 nov con i dati reali (private/backup-2026-11-24.json, non versionato): eliminare il programma in corso
// non deve far sparire la giornata registrata; un'eliminazione fatta con la versione vecchia si recupera dal backup.
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const BK = fileURLToPath(new URL('../private/backup-2026-11-24.json', import.meta.url)), YAML = fileURLToPath(new URL('../Karma - Fase 1.yaml', import.meta.url));
if (!existsSync(BK)) { console.log('E2E reale saltato: manca ' + BK); process.exit(0); }
const bk = readFileSync(BK, 'utf8');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ok = (c, msg) => { if (!c) throw new Error('FALLITO: ' + msg); console.log('ok  ' + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(setup) {
  const pg = await b.newPage(); await pg.setViewport({ width: 390, height: 844 });
  pg.on('pageerror', e => { throw new Error('pageerror ' + e.message); });
  await pg.evaluateOnNewDocument(() => { const RD = Date, t0 = new RD(2026, 10, 24, 21, 0, 0).getTime(), s = RD.now();
    class D extends RD { constructor(...a) { if (a.length) super(...a); else super(t0 + (RD.now() - s)); } static now() { return t0 + (RD.now() - s); } } window.Date = D; });
  const url = 'file://' + fileURLToPath(new URL('../dist/index.html', import.meta.url));
  await pg.goto(url); await sleep(200);
  // dati reali caricati una volta sola, poi si riapre l'app (come all'avvio sul telefono)
  await pg.evaluate(bk => localStorage.setItem('allenamento.v1', bk), bk);
  if (setup) await pg.evaluate(setup);
  await sleep(300); await pg.reload(); await sleep(400);
  return pg;
}
const go = (pg, h) => pg.evaluate(h => { location.hash = h; }, h).then(() => sleep(200));
const view = pg => pg.$eval('#view', e => e.innerText);
const logs = pg => pg.evaluate(() => JSON.stringify(__app.state.logs.map(l => ({ id: l.id, date: l.date, blocks: l.blocks.map(x => [x.name, x.minutes, x.kgs, x.sets]) }))));
const clickBtn = (pg, t, root = 'body') => pg.evaluate((t, root) => { const all = [...document.querySelectorAll(root + ' button, ' + root + ' .blk')].filter(x => x.innerText.trim().startsWith(t)); all[all.length - 1].click(); }, t, root).then(() => sleep(200));
const homeDone = async pg => { await go(pg, 'home'); const v = await view(pg); return !v.includes('Rest day') && v.includes('Test: Open hand') && v.includes('✓ 3 min') && v.includes('L +16 kg'); };
const logs0 = JSON.stringify(JSON.parse(bk).logs.map(l => ({ id: l.id, date: l.date, blocks: l.blocks.map(x => [x.name, x.minutes, x.kgs, x.sets]) })));

// 1) Versione nuova: elimino "Karma - Fase 1" dalla pagina Programmes
let pg = await page();
ok(await homeDone(pg), 'prima: Home con la giornata del 24 registrata');
const v19 = await pg.evaluate(() => { const ex = Object.values(__app.state.exercises); return { dips: ex.filter(e => e.std === 'dip').map(e => Core.exName(e)), or: ex.filter(e => / or /i.test(Core.exName(e))).length, par: ex.filter(e => /[()]/.test(Core.exName(e))).map(e => Core.exName(e)), sf: __app.state.surfaces.map(x => x.name).join('|') }; });
ok(v19.dips.length === 4 && v19.dips.every(n => n === 'Dips') && v19.or === 0 && !v19.par.length && v19.sf === 'MoonBoard|Kilter Board|Tension Board|Gym|Rock|Kilter HW|Indoor-Lead|Outdoor-Lead', 'migrazioni v19-v20: niente parentesi; "Push-ups or dips" del programma → Dips, nessun nome "A or B" (' + JSON.stringify(v19) + ')');
await go(pg, 'programmes'); await clickBtn(pg, 'Karma - Fase 1', '#view'); await clickBtn(pg, 'Delete programme', '.sheet');
await pg.waitForFunction(() => [...document.querySelectorAll('.overlay')].some(o => /^Confirm/.test(o.innerText.trim())));
const msg = await pg.evaluate(() => [...document.querySelectorAll('.overlay')].find(o => /^Confirm/.test(o.innerText.trim())).innerText);
await pg.evaluate(() => [...[...document.querySelectorAll('.overlay')].find(o => /^Confirm/.test(o.innerText.trim())).querySelectorAll('button')].find(x => x.innerText.trim() === 'Delete').click()); await sleep(200);
ok(!(await pg.evaluate(() => __app.state.plans.some(p => /Karma/.test(p.title)))), 'programma eliminato');
ok(msg.includes('The day you already logged stays in the calendar'), 'conferma chiara: dice quante giornate registrate restano (' + msg.replace(/\n+/g, ' ') + ')');
ok(await logs(pg) === logs0 && await homeDone(pg), 'dopo l\'eliminazione: log identici, la giornata di oggi resta in Home con i dati');
await sleep(1200); // Chrome scrive localStorage in modo asincrono: un reload immediato può leggere il valore precedente
await pg.reload(); await sleep(400);
await go(pg, 'home'); await sleep(200); // dopo il riavvio la Home si ridisegna
{ const hd = await homeDone(pg), pl = await pg.evaluate(() => __app.state.plans.map(p => p.title).join()), v = await view(pg);
  ok(hd && !/Karma/.test(pl), 'anche dopo il riavvio; il programma non c\'è più (' + hd + ' ' + pl + ' ' + v.slice(0, 160).replace(/\n/g, ' | ') + ')'); }
// reimport del programma dal 23 nov: le registrazioni tornano sulle sue giornate (se gli esercizi coincidono)
await go(pg, 'programmes'); await (await pg.$('#view input[type=file]')).uploadFile(YAML); await sleep(400);
await pg.evaluate(() => { document.querySelector('.sheet input[type=date]').value = '2026-11-23'; }); await clickBtn(pg, 'Import', '.sheet'); await sleep(200);
const after = await pg.evaluate(() => { const st = __app.state, sd = Core.sessionDates(st); return { kept: st.extras.filter(x => x.kept).map(x => x.date), orphans: st.logs.filter(l => !(sd.get(l.sid) && sd.get(l.sid).date === l.date)).length }; });
await go(pg, 'home'); const hv = await view(pg);
console.log('    reimport:', JSON.stringify(after), '· card in Home:', (hv.match(/Done|Training/g) || []).length);
ok(after.orphans === 0 && await logs(pg) === logs0 && await homeDone(pg) && (hv.match(/Overhead press/g) || []).length === 1, 'reimportato: nessuna registrazione persa, una sola giornata oggi (quella registrata), il programma riparte da domani');
await go(pg, 'calendar-2026-11-25'); ok(!(await view(pg)).includes('Rest day'), 'domani: la giornata del programma reimportato');
await pg.close();

// 2) Eliminazione fatta con la versione vecchia (log senza giornata): recupero da "Restore / import file" → "Add what is missing"
pg = await page(() => { const s = JSON.parse(localStorage.getItem('allenamento.v1')); s.plans = s.plans.filter(p => !/Karma/.test(p.title)); s.logs = s.logs.filter(l => l.date !== '2026-11-24'); localStorage.setItem('allenamento.v1', JSON.stringify(s)); });
await go(pg, 'home'); ok((await view(pg)).includes('Rest day'), 'situazione del bug: Home vuota, log di oggi spariti');
await go(pg, 'more'); await (await pg.$('#view input[type=file]')).uploadFile(BK); await sleep(400);
const sh = await pg.evaluate(() => document.querySelector('.sheet').innerText);
ok(sh.includes('1 logged day that is not in the app (24 Nov)') && sh.includes('Add what is missing') && sh.includes('Replace all data'), 'backup: prima scelta aggiungere ciò che manca (' + sh.replace(/\n+/g, ' ').slice(0, 140) + ')');
await clickBtn(pg, 'Add what is missing', '.sheet');
ok(await logs(pg) === logs0 && await homeDone(pg), 'recuperato: log di oggi di nuovo in Home con i dati, nient\'altro cambiato');
const tests = await pg.evaluate(() => __app.state.tests.filter(t => t.date === '2026-11-24').length);
ok(tests === JSON.parse(bk).tests.filter(t => t.date === '2026-11-24').length, 'anche i test di oggi (' + tests + ')');
await pg.close();
await b.close();
console.log('E2E REALE OK');
