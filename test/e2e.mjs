// Smoke test end-to-end in Chrome headless (viewport iPhone). Uso: node test/e2e.mjs
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const url = 'file://' + fileURLToPath(new URL('../dist/index.html', import.meta.url));
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
const shot = n => pg.screenshot({ path: `shots/${n}.png` });

// Data fissata a mercoledì 25 nov 2026 (settimana 2 del piano) per provare "Oggi" in modo deterministico.
await pg.evaluateOnNewDocument(() => { const RD = Date, t0 = new RD(2026, 10, 25, 9, 0, 0).getTime(), s = RD.now();
  window.__adv = 0;
  class D extends RD { constructor(...a) { if (a.length) super(...a); else super(t0 + (RD.now() - s) + window.__adv); } static now() { return t0 + (RD.now() - s) + window.__adv; } }
  window.Date = D; });
await pg.goto(url);
ok((await txt('#view')).includes('Karma 8A+ · settimana 2 di 18'), 'Oggi: piano precaricato, settimana 2');
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
await pg.type('.sheet textarea', 'Prova automatica'); await shot('6-fine-sessione');
await clickText('Salva nel diario');
ok((await txt('#view')).includes('Muro · Forza · Karma 8A+ S2') && (await txt('#view')).includes('Prova automatica'), 'diario: sessione registrata con note');
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
// Import: round trip tramite export, file non valido
const r = await pg.evaluate(async () => {
  const s = __app.state, before = s.plans.length, json = JSON.stringify(Core.exportBlokplan(s.plans[0], s.exercises));
  const inp = document.createElement('input'); // usa lo stesso percorso del pulsante "Importa"
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
ok(r.after === r.before + 1 && r.ex === 101 && /Importato/.test(r.toast), 'import .blokplan: nuovo piano, libreria riusata');
await go('altro'); await shot('10-altro');
// Persistenza
await pg.reload(); const st = await pg.evaluate(() => ({ p: __app.state.plans.length, l: __app.state.logs.length, t: __app.state.tests.length }));
ok(st.p === 2 && st.l === 1 && st.t === 5, 'i dati sopravvivono al ricaricamento');
ok(errors.length === 0, 'nessun errore in console' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log('E2E OK');
