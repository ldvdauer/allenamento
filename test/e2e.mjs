// Smoke test end-to-end in Chrome headless (viewport iPhone).
// Uso: node test/e2e.mjs  — richiede private/Karma-8A+.blokplan (piano personale, non versionato).
import { existsSync } from 'node:fs';
const PLAN = fileURLToPath(new URL('../private/Karma-8A+.blokplan', import.meta.url));
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const url = 'file://' + fileURLToPath(new URL('../dist/index.html', import.meta.url));
if (!existsSync(PLAN)) { console.log('E2E saltato: manca ' + PLAN); process.exit(0); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ok = (c, msg) => { if (!c) throw new Error('FALLITO: ' + msg); console.log('ok  ' + msg); };
const txt = sel => pg.$eval(sel, e => e.innerText);
const clickText = async (t, root = 'body') => {
  const done = await pg.evaluate((t, root) => { const all = [...document.querySelectorAll(root + ' button, ' + root + ' .tap, ' + root + ' .blk')]; const e = all.reverse().find(x => x.innerText.trim().startsWith(t) && x.offsetParent); if (e) e.click(); return !!e; }, t, root);
  if (!done) throw new Error('pulsante non trovato: ' + t);
};
const go = async h => { await pg.evaluate(h => { location.hash = h; }, h); await new Promise(r => setTimeout(r, 80)); };
const shot = (n, fullPage) => (process.env.SHOTS ? pg.screenshot({ path: `${process.env.SHOTS}/${n}.png`, fullPage: !!fullPage }) : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = fn => pg.evaluate(fn);
const clickDay = async label => { await pg.evaluate(l => [...document.querySelectorAll('.cal-d')].find(x => x.getAttribute('aria-label').startsWith(l)).click(), label); await sleep(120); };

// Data fissata a mercoledì 25 nov 2026 (settimana 2 del piano) per provare "Oggi" in modo deterministico.
await pg.evaluateOnNewDocument(() => { const RD = Date, t0 = new RD(2026, 10, 25, 9, 0, 0).getTime(), s = RD.now();
  window.__adv = 0;
  class D extends RD { constructor(...a) { if (a.length) super(...a); else super(t0 + (RD.now() - s) + window.__adv); } static now() { return t0 + (RD.now() - s) + window.__adv; } }
  window.Date = D; });
await pg.goto(url);
ok((await txt('#view')).includes('Benvenuto') && (await pg.evaluate(() => __app.state.plans.length)) === 0, 'primo avvio: nessun piano precaricato');
await (await pg.$('#view input[type=file]')).uploadFile(PLAN); await new Promise(r => setTimeout(r, 400));
ok((await txt('#toast')).includes('Importato Karma 8A+'), 'import del piano da file');
ok((await txt('#view')).includes('Karma 8A+ · settimana 2 di 18'), 'Oggi: piano importato, settimana 2');
ok((await txt('#view')).includes('Sloper BM2000 7"'), 'Oggi: sessione del mercoledì');
ok((await txt('#view')).includes('kg: mancano i massimali'), 'senza massimali il carico non viene inventato');
await shot('1-oggi');

// Massimali → kg
await go('progressi');
for (const [name, v] of [['Peso corporeo', '70'], ['Sloper BM2000', '20'], ['Pinch block 7" SX', '20'], ['Pinch block 7" DX', '24'], ['Flessione polso', '22,5']]) {
  await clickText(name, '#view');
  await pg.type('.sheet .cols label:nth-child(2) input', v);
  await clickText('Aggiungi risultato');
}
await shot('2-progressi');
await go('oggi');
const today = await txt('#view');
ok(today.includes('+4,5 kg'), 'sloper 82,5%: (70+20)×0,825−70 = 4,25 → +4,5 kg');
ok(today.includes('SX 15 kg · DX 18 kg'), 'pinch 75%: SX 15 kg · DX 18 kg');
ok(today.includes('20,5 kg'), 'polso 90% di 22,5 (virgola decimale) = 20,25 → 20,5 kg');
await shot('3-oggi-kg');

// Player: sessione principale del giorno
await pg.evaluate(() => [...document.querySelectorAll('#view button')].find(b => b.innerText === 'Avvia').click());
ok(!(await pg.$eval('#player', e => e.hidden)), 'player aperto');
ok((await txt('#p-ph')) === 'A TEMPO LIBERO' && (await txt('#p-clock')) === '20:00', 'riscaldamento: blocco a durata, 20:00');
await pg.click('#p-done');
ok((await txt('#p-ph')) === 'PREPARATI' && (await txt('#p-name')).startsWith('Sloper'), 'preparazione prima del primo hang');
await pg.evaluate(() => { window.__adv += 10500; }); await new Promise(r => setTimeout(r, 450));
ok((await txt('#p-ph')) === 'LAVORO' && (await txt('#p-round')) === 'Round 1 di 4', 'countdown → lavoro, round 1/4');
ok((await txt('#p-kg')).startsWith('+4,5'), 'kg mostrati nel player');
await shot('4-player-lavoro');
await pg.evaluate(() => { window.__adv += 7500; }); await new Promise(r => setTimeout(r, 450));
ok((await txt('#p-ph')) === 'RECUPERO', 'hang finito → recupero automatico');
const before = await txt('#p-clock'); await pg.click('#p-plus');
ok((await txt('#p-clock')) !== before, '+30 s sul recupero');
await pg.click('#p-pause'); const c1 = await txt('#p-clock'); await pg.evaluate(() => { window.__adv += 60000; }); await new Promise(r => setTimeout(r, 450));
ok((await txt('#p-clock')) === c1, 'pausa: il tempo non scorre'); await pg.click('#p-pause');
await shot('5-player-recupero');
// Sospensione lunga (telefono bloccato 10 minuti): il player non si rompe e avanza
await pg.evaluate(() => { window.__adv += 600000; }); await new Promise(r => setTimeout(r, 450));
ok((await txt('#p-ph')) === 'LAVORO', 'dopo una sospensione lunga riparte dal passo successivo');
// Ricarica a metà: la sessione è ripristinabile
await pg.reload(); ok((await txt('#view')).includes('Sessione interrotta'), 'ricarica a metà sessione → "Riprendi"');
await clickText('Riprendi', '#view');
ok((await txt('#p-round')).startsWith('Round 2'), 'ripresa dal round giusto');
// Salta tutto fino alla fine
for (let i = 0; i < 80 && !(await pg.$eval('#player', e => e.hidden)); i++) await pg.click('#p-done');
ok((await txt('.sheet')).includes('Sessione completata'), 'fine sessione → modulo diario');
ok((await txt('.sheet')).includes('Carichi usati'), 'carichi precompilati nel modulo');
// blocco di arrampicata della sessione: superficie scelta a mano, grado massimo e blocchi chiusi
await pg.evaluate(() => { const c = document.querySelector('.sheet .climb'); c.querySelectorAll('select')[0].value = 'gym'; c.querySelectorAll('select')[1].value = '7A'; c.querySelectorAll('input')[0].value = '5'; });
await pg.type('.sheet textarea', 'Prova automatica'); await shot('6-fine-sessione', true);
await clickText('Salva nel diario');
ok((await txt('#view')).includes('Muro · Forza · Karma 8A+ S2') && (await txt('#view')).includes('Prova automatica'), 'diario: sessione registrata con note');
ok((await txt('#view')).includes('Indoor (palestra) 7A · 5 blocchi'), 'diario: superficie, grado massimo e blocchi chiusi');
await shot('7-diario');
await go('oggi'); ok((await txt('#view')).includes('Fatta'), 'Oggi: sessione segnata come fatta');

// Editor
await go('piano'); ok((await txt('#view')).includes('Settimana 2 / 18'), 'Piano: settimana corrente'); await shot('8-piano');
await go('giorno-1-2');
await clickText('Riscaldamento', '#view'); await clickText('Modifica solo qui');
await pg.$eval('.sheet input', e => { e.value = 'Riscaldamento variante'; }); await clickText('Salva');
ok((await txt('#view')).includes('Riscaldamento variante'), 'editor: variante "solo qui"');
const n1 = await pg.evaluate(() => Object.keys(__app.state.exercises).length); ok(n1 === 100, 'la variante è un nuovo esercizio (100)');
await clickText('+ Esercizio', '#view'); await clickText('+ Nuovo');
await pg.type('.sheet input', 'Hang a una mano 22 mm');
await pg.select('.sheet .cols select:nth-of-type(1)', 'strength');
await pg.evaluate(() => { const s = [...document.querySelectorAll('.sheet select')].find(x => [...x.options].some(o => o.value === 'timed')); s.value = 'timed'; s.dispatchEvent(new Event('change')); });
await clickText('Crea esercizio');
ok((await txt('#view')).includes('Hang a una mano 22 mm'), 'editor: nuovo esercizio creato e aggiunto al giorno');
await shot('9-giorno');

// Sessione creata per oggi, fuori dal piano
await go('oggi');
await clickText('+ Nuova sessione', '#view');
await pg.type('.sheet input[placeholder^="Es. Board"]', 'Board con amici');
await clickText('Crea sessione');
ok((await txt('#view')).includes('Board con amici') && (await txt('#view')).includes('Extra'), 'Oggi: sessione extra creata per oggi');
await clickText('+ Esercizio', '#view');
await pg.type('.sheet input.inp', 'Limit MoonBoard');
await clickText('Limit MoonBoard', '.sheet');
ok((await txt('#view')).includes('· MoonBoard'), 'superficie dedotta dal nome dell\'esercizio');
await clickText('Avvia', '#view'); // l'ultimo "Avvia" è quello della sessione extra
ok((await txt('#p-round')) === 'MoonBoard', 'player: mostra la superficie del blocco');
await pg.evaluate(() => { window.__adv += 12 * 60000; }); await pg.click('#p-done');
const pre = await pg.evaluate(() => { const c = document.querySelector('.sheet .climb'); return { surface: c.querySelectorAll('select')[0].value, minutes: c.querySelectorAll('input')[1].value }; });
ok(pre.surface === 'moonboard' && pre.minutes === '12', 'fine sessione: superficie precompilata e minuti misurati dal player');
await pg.evaluate(() => { const c = document.querySelector('.sheet .climb'); c.querySelectorAll('select')[1].value = '7A+'; c.querySelectorAll('input')[0].value = '3'; });
await clickText('Salva nel diario');
ok((await txt('#view')).includes('MoonBoard 7A+ · 3 blocchi'), 'diario: logbook per superficie dalla sessione extra');
const lg = await state(() => __app.state.logs[__app.state.logs.length - 1]);
ok(lg.title === 'Board con amici' && lg.sid && lg.climbs[0].minutes === 12 && lg.climbs[0].top === '7A+', 'registrazione collegata alla sessione extra');

// Calendario: qualsiasi giorno
await go('calendario');
ok(/novembre 2026/i.test(await txt('#view')) && (await txt('#view')).includes('Board con amici'), 'Calendario: mese corrente con le sessioni di oggi');
const dots = await pg.evaluate(() => [...[...document.querySelectorAll('.cal-d')].find(x => x.getAttribute('aria-label').startsWith('mercoledì 25 novembre')).querySelectorAll('.dots i')].map(i => i.className).join());
ok(dots === 'ok,,ok', 'Calendario: pallini fatta / in programma / extra fatta');
await clickDay('sabato 28 novembre');
ok((await state(() => location.hash)) === '#calendario-2026-11-28' && (await txt('#view')).includes('Limit Karma'), 'Calendario: giorno futuro con le sessioni del piano');
await shot('11-calendario', true);
await clickText('‹', '#view');
ok(/ottobre 2026/i.test(await txt('#view')), 'Calendario: mese precedente');
await clickDay('martedì 20 ottobre');
await clickText('+ Nuova sessione', '#view');
ok((await pg.$eval('.sheet input[type=date]', e => e.value)) === '2026-10-20', 'nuova sessione: data del giorno selezionato');
await clickText('Crea sessione'); await sleep(120);
ok((await state(() => __app.state.extras.filter(x => x.date === '2026-10-20').length)) === 1 && (await txt('#view')).includes('Extra'), 'sessione creata su un giorno fuori dal piano');
await clickText('Sessione…', '#view'); await clickText('Copia su una data…');
await pg.$eval('.sheet input[type=date]', e => { e.value = '2026-02-30'; }); await clickText('Copia');
ok((await txt('#toast')).includes('data valida'), 'copia su una data: data non valida rifiutata');
await pg.$eval('.sheet input[type=date]', e => { e.value = '2026-11-30'; }); await clickText('Copia');
const ex2 = await state(() => __app.state.extras.map(x => x.date + ' ' + x.id));
ok(ex2.length === 3 && ex2.some(x => x.startsWith('2026-11-30')) && new Set(ex2.map(x => x.split(' ')[1])).size === 3, 'copia su una data: nuova sessione extra con id proprio');

// Duplicare una settimana non deve spostare né duplicare lo stato "fatta"
await go('piano'); await clickText('Gestisci', '#view'); await clickText('Duplica la settimana 2');
const dup = await state(() => { const s = __app.state, p = s.plans[0], ids = new Set(s.logs.map(l => l.sid)); const done = w => p.weeks[w].flatMap(d => d.sessions).filter(x => ids.has(x.id)).length; return { n: p.weeks.length, w2: done(1), w3: done(2) }; });
ok(dup.n === 19 && dup.w2 === 1 && dup.w3 === 0, 'settimana duplicata: lo stato "fatta" resta sull\'originale');

// Analisi: dati di esempio su più settimane
await state(() => {
  const s = __app.state, L = (date, type, minutes, rpe, feel, climbs, loads) => s.logs.push({ id: 'demo-' + date, date, type, title: 'Demo', minutes, rpe, feel, notes: '', climbs: climbs || [], loads: loads || [] });
  const c = (surface, minutes, top, sends) => ({ name: '', surface, minutes, top, sends });
  L('2026-10-28', 'wall', 70, 7, 3, [c('kilter', 40, '6C+', 6)], [{ name: 'Open hand 20 mm 7"', kg: '+8 kg' }]);
  L('2026-11-04', 'wall', 80, 8, 4, [c('moonboard', 35, '6C+', 4), c('gym', 20, '7A', 2)], [{ name: 'Open hand 20 mm 7"', kg: '+9 kg' }]);
  L('2026-11-07', 'strength', 30, 5, 4);
  L('2026-11-11', 'wall', 75, 8, 3, [c('moonboard', 40, '7A', 5)], [{ name: 'Open hand 20 mm 7"', kg: '+10 kg' }, { name: 'Pinch block 7"', kg: 'SX 14 kg · DX 16 kg' }]);
  L('2026-11-14', 'skills', 90, 6, 5, [c('kilter', 60, '7A', 9)]);
  L('2026-11-18', 'wall', 78, 9, 2, [c('moonboard', 45, '7A+', 3)], [{ name: 'Open hand 20 mm 7"', kg: '+11,5 kg' }, { name: 'Pinch block 7"', kg: 'SX 15 kg · DX 17 kg' }]);
  L('2026-11-21', 'wall', 120, 7, 5, [c('outdoor', 120, '7B', 2)]);
});
await go('analisi');
const tiles = await state(() => [...document.querySelectorAll('.tile .v')].map(x => x.textContent));
ok(tiles[0] === '9' && tiles[2] === '7,1' && tiles[3] === '13%', 'Analisi: sessioni, RPE medio e aderenza (2 fatte su 15 in programma)');
const an = await txt('#view');
ok(['Volume settimanale', 'Carico settimanale', 'Sforzo percepito', 'Sensazione', 'Tempo per tipo di sessione', 'Superfici di arrampicata', 'Grado massimo chiuso per superficie', 'Carichi usati'].every(x => an.includes(x)), 'Analisi: tutte le sezioni presenti');
const viz = await state(() => ({ charts: document.querySelectorAll('.viz svg').length, tables: document.querySelectorAll('.viz-table').length,
  panels: [...document.querySelectorAll('.sm-t')].map(x => x.textContent).join(), row: [...document.querySelectorAll('.tbl tr')].map(r => r.innerText.replace(/\s+/g, ' ')).find(r => r.startsWith('MoonBoard')) }));
ok(viz.charts === 8 && viz.tables === 8, 'Analisi: 8 grafici, ognuno con la sua tabella');
ok(viz.panels === 'MoonBoard,Kilter Board,Indoor (palestra),Outdoor (roccia)', 'Analisi: un pannello di gradi per superficie, in ordine stabile');
ok(viz.row === 'MoonBoard 4 15 7A+', 'Analisi: riepilogo MoonBoard (4 sessioni, 15 blocchi, max 7A+)');
const tip = await state(() => { const h = document.querySelectorAll('.viz')[0].querySelectorAll('.hit'); h[h.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true })); return document.querySelectorAll('.viz')[0].querySelector('.viz-tip').innerText.replace(/\s+/g, ' '); });
ok(/23 nov – 29 nov \d+ min fatti \d+ min in programma/.test(tip), 'Analisi: tooltip al tocco con fatto e in programma');
await state(() => document.querySelectorAll('.viz')[2].querySelector('.hit').focus());
const k1 = await state(() => document.querySelectorAll('.viz')[2].querySelector('.viz-tip').innerText); await pg.keyboard.press('ArrowLeft');
const k2 = await state(() => document.querySelectorAll('.viz')[2].querySelector('.viz-tip').innerText);
ok(k1.includes('16 nov – 22 nov') && k1.includes('8 rpe medio') && k2.includes('9 nov – 15 nov') && k2.includes('7 rpe medio'), 'Analisi: grafico a linea navigabile da tastiera (focus + frecce)');
await shot('12-analisi', true);
await clickText('Open hand 20 mm 7"', '#view');
ok((await state(() => document.querySelectorAll('.sheet .viz svg').length)) === 1 && (await txt('.sheet')).includes('11,5 kg'), 'Analisi: dettaglio del carico di un esercizio');
await shot('13-carico'); await clickText('Chiudi');
await clickText('4 sett.', '#view');
ok((await state(() => document.querySelector('.tile .v').textContent)) === '8', 'Analisi: il filtro del periodo aggiorna tutto');
await go('progressi'); ok((await txt('#view')).includes('Test e massimali') && (await txt('#view')).includes('Peso corporeo'), 'Analisi → Test e massimali');

// Esercizio con una superficie nuova
await go('libreria'); await clickText('+ Nuovo', '#view');
await pg.type('.sheet input', 'Volume spray wall');
await pg.evaluate(() => { const s = [...document.querySelectorAll('.sheet select')].find(x => [...x.options].some(o => o.value === '+new')); s.value = '+new'; s.dispatchEvent(new Event('change')); });
await pg.type('.sheet input[placeholder^="Es. Spray"]', 'Spray wall'); await clickText('Crea esercizio');
const sf = await state(() => { const s = __app.state, e = Object.values(s.exercises).find(x => x.name === 'Volume spray wall'); return { n: s.surfaces.length, name: (s.surfaces.find(x => x.key === e.surface) || {}).name }; });
ok(sf.n === 6 && sf.name === 'Spray wall' && /Volume spray wall\s+Spray wall/.test(await txt('#view')), 'esercizio con superficie personalizzata');
// Import: round trip tramite export, file non valido
const r = await pg.evaluate(async () => {
  const s = __app.state, before = s.plans.length, json = JSON.stringify(Core.exportBlokplan(s.plans[0], s.exercises));
  location.hash = 'piano'; await new Promise(r => setTimeout(r, 100));
  [...document.querySelectorAll('#view button')].find(b => b.innerText === 'Gestisci').click();
  const fi = document.querySelector('.sheet input[type=file]');
  const put = async text => { const dt = new DataTransfer(); dt.items.add(new File([text], 'x.blokplan')); fi.files = dt.files; fi.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 300)); };
  await put('{"weeks":"no"}'); const bad = document.getElementById('toast').textContent, afterBad = __app.state.plans.length;
  await put('non json'); const bad2 = document.getElementById('toast').textContent;
  await put(json);
  return { before, afterBad, bad, bad2, after: __app.state.plans.length, ex: Object.keys(__app.state.exercises).length, toast: document.getElementById('toast').textContent };
});
ok(r.afterBad === r.before && /valido/.test(r.bad) && /JSON/.test(r.bad2), 'import: file non validi rifiutati senza toccare i dati');
ok(r.after === r.before + 1 && r.ex === 102 && /Importato/.test(r.toast), 'import .blokplan: nuovo piano, libreria riusata');
await go('altro'); await shot('10-altro');
// Persistenza
await pg.reload(); const st = await pg.evaluate(() => ({ p: __app.state.plans.length, l: __app.state.logs.length, t: __app.state.tests.length, x: __app.state.extras.length, s: __app.state.surfaces.length }));
ok(st.p === 2 && st.l === 9 && st.t === 5 && st.x === 3 && st.s === 6, 'i dati sopravvivono al ricaricamento');
// Un backup della versione 1 (log legati alla posizione nel piano, niente id di sessione) viene migrato
const mig = await pg.evaluate(async () => {
  const p = JSON.parse(JSON.stringify(__app.state.plans[0])); for (const w of p.weeks) for (const d of w) for (const x of d.sessions) delete x.id;
  const ex = JSON.parse(JSON.stringify(__app.state.exercises)); for (const e of Object.values(ex)) delete e.surface;
  const v1 = { v: 1, plans: [p], activePlan: p.id, exercises: ex, tests: [], logs: [{ id: 'old', date: '2026-11-23', planId: p.id, w: 1, d: 0, si: 0, title: 'Vecchia', minutes: 60 }], live: { planId: p.id, w: 1, d: 2, si: 0, idx: 3, startedAt: 1 } };
  location.hash = 'altro'; await new Promise(r => setTimeout(r, 100));
  const fi = document.querySelector('#view input[type=file]'), dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(v1)], 'backup.json')); fi.files = dt.files; fi.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.overlay button')].find(b => b.innerText === 'Sostituisci').click(); await new Promise(r => setTimeout(r, 300));
  const s = __app.state, l = s.logs[0], sess = s.plans[0].weeks[1][0].sessions[0];
  return { sid: l.sid === sess.id, type: l.type, live: !!(s.live && s.live.sid === s.plans[0].weeks[1][2].sessions[0].id), surf: Object.values(s.exercises).find(e => e.name === 'Limit MoonBoard').surface, extras: Array.isArray(s.extras) };
});
ok(mig.sid && mig.type === 'wall' && mig.live && mig.surf === 'moonboard' && mig.extras, 'backup v1 migrato: log e sessione interrotta collegati per id, superfici dedotte');
ok(errors.length === 0, 'nessun errore in console' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log('E2E OK');
