const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const Seed = require('./fixture.js');

const imported = () => C.importBlokplan(Seed.blokplan());
const exMapOf = r => Object.fromEntries(r.exercises.map(e => [e.id, e]));
const weekMinutes = w => w.reduce((t, d) => t + d.sessions.reduce((a, s) => a + C.sessionMinutes(s), 0), 0);

test('import: struttura del piano di esempio', () => {
  const { plan, exercises } = imported();
  assert.equal(plan.title, 'Piano di esempio');
  assert.equal(plan.startDate, '2026-11-16');
  assert.equal(plan.weeks.length, 3);
  assert.equal(exercises.length, 7); // 4 esercizi comuni + 3 varianti di hang (85/90/70%)
  assert.deepEqual(plan.weeks.map(weekMinutes), [135, 135, 135]);
  assert.deepEqual(plan.weeks[0].map(d => d.sessions.length), [2, 0, 1, 1, 0, 1, 0]);
  assert.equal(plan.weeks[2][0].sessions[0].period, 'deload');
});

test('import: file non valido → errore, nessun risultato parziale', () => {
  for (const bad of [null, {}, { weeks: [] }, { weeks: ['x'] }, 'ciao'])
    assert.throws(() => C.importBlokplan(bad), /valid/);
});

test('import: riusa gli esercizi già in libreria', () => {
  const first = imported();
  const again = C.importBlokplan(Seed.blokplan(), exMapOf(first));
  assert.equal(again.exercises.length, 0);
});

test('export → import: round trip senza perdite', () => {
  const a = imported();
  const b = C.importBlokplan(C.exportBlokplan(a.plan, exMapOf(a)), exMapOf(a));
  assert.equal(b.exercises.length, 0);
  assert.equal(b.plan.startDate, a.plan.startDate);
  const shape = p => p.weeks.map(w => w.map(d => d.sessions.map(s => [s.type, s.period, s.blocks.map(x => [x.exId, x.minutes])])));
  assert.deepEqual(shape(b.plan), shape(a.plan));
});

test('date: epoca Apple e posizione nel piano', () => {
  assert.equal(C.appleToISO(C.isoToApple('2026-11-16')), '2026-11-16');
  assert.equal(C.mondayOf('2026-11-14'), '2026-11-09');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  const { plan } = imported();
  assert.equal(C.locate(plan, '2026-11-15'), null);
  assert.deepEqual(C.locate(plan, '2026-11-16'), { w: 0, d: 0 });
  assert.deepEqual(C.locate(plan, '2026-11-25'), { w: 1, d: 2 });
  assert.equal(C.locate(plan, '2026-12-07'), null);
  assert.equal(C.dateOf(plan, 2, 6), '2026-12-06');
});

test('carichi: formula del foglio Google', () => {
  const maxes = { bw: 70, oh: 30, pinchL: 20, pinchR: 24, wrist: 22 };
  const oh = C.inferLoad('Open hand 20 mm 7"', '4 × 7" · 85% max · margine 2-3"');
  assert.deepEqual(oh, { ref: 'oh', mode: 'hang', pct: 85, test: false });
  assert.equal(C.loadKg(oh, '85% max', maxes), 15); // (70+30)*0.85-70
  const sl = C.inferLoad('Sloper BM2000 7"', '4 × 7" · 82,5% max');
  assert.equal(sl.pct, 82.5);
  assert.equal(C.loadKg(sl, '', maxes), null); // massimale sloper mancante
  const pinch = C.inferLoad('Pinch block 7"', '3 × 7" per mano · 75% max');
  assert.equal(C.loadKg(pinch, 'SX · 75% max', maxes), 15);
  assert.equal(C.loadKg(pinch, 'DX · 75% max', maxes), 18);
  const low = C.loadKg({ ref: 'oh', mode: 'hang', pct: 60 }, '', maxes);
  assert.equal(low, -10); // sotto il peso corporeo: scarico
  assert.equal(C.fmtKg(low), '-10 kg');
  assert.equal(C.fmtKg(12.5), '+12,5 kg');
  assert.equal(C.inferLoad('TEST open hand 20 mm 7"', 'TEST · Carico crescente').test, true);
  assert.equal(C.inferLoad('Nordic curl', '2 × 4'), null);
  assert.equal(C.loadKg(oh, '', { oh: 30 }), null); // senza peso corporeo
});

test('massimali: vale l\'ultimo test per data', () => {
  const m = C.latestMaxes([{ key: 'oh', date: '2026-11-16', value: 30 }, { key: 'oh', date: '2026-12-07', value: 32 }, { key: 'bw', date: '2026-11-01', value: 70 }]);
  assert.deepEqual(m, { oh: 32, bw: 70 });
});

test('player: passi per hang a tempo, ripetizioni e serie raggruppate', () => {
  const ex = {
    hang: { id: 'hang', name: 'Hang', interval: { rounds: 3, workSeconds: 7, restSeconds: 180, cues: ['85% max'] } },
    reps: { id: 'reps', name: 'Press', interval: { rounds: 2, workSeconds: 45, restSeconds: 120, selfPaced: true, reps: 6, cues: ['SX', 'DX'] } },
    free: { id: 'free', name: 'Limit', prescription: 'qualità', interval: null },
    sets: { id: 'sets', name: 'Set', interval: { rounds: 6, workSeconds: 60, restSeconds: 120, selfPaced: true, roundsPerSet: 3, setRestSeconds: 300, cues: ['a', 'b', 'c'] } },
  };
  const s = C.buildSteps([{ exId: 'free', minutes: 20 }, { exId: 'hang', minutes: 10 }, { exId: 'reps', minutes: 4 }], ex, 10);
  assert.deepEqual(s.map(x => x.kind + (x.prep ? '*' : '')), ['free', 'rest*', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'work']);
  assert.equal(s[0].seconds, 1200);
  assert.equal(s[1].seconds, 10);
  assert.equal(s[7].afterBlock, true); // recupero prima dell'esercizio successivo
  assert.equal(s[8].cue, 'SX');
  assert.equal(s[10].cue, 'DX');
  assert.equal(s[10].selfPaced, true);
  // l'ultimo passo della sessione non è un recupero
  assert.equal(s[s.length - 1].kind, 'work');
  const g = C.buildSteps([{ exId: 'sets', minutes: 30 }], ex, 10);
  assert.deepEqual(g.filter(x => x.kind === 'rest').map(x => x.seconds), [120, 120, 300, 120, 120]);
  assert.equal(C.buildSteps([{ exId: 'manca', minutes: 5 }], ex).length, 0);
  assert.equal(C.intervalMinutes(ex.hang.interval), 7); // 21" + 360" → 7 min
});

test('utilità piano: copia giorno, conteggio uso, validazione backup', () => {
  const r = imported();
  const copy = C.cloneDay(r.plan.weeks[0][0]);
  assert.notEqual(copy.sessions[0].blocks[0].id, r.plan.weeks[0][0].sessions[0].blocks[0].id);
  assert.equal(copy.sessions[0].blocks[0].exId, r.plan.weeks[0][0].sessions[0].blocks[0].exId);
  const warmup = r.plan.weeks[0][0].sessions[0].blocks[0].exId;
  assert.equal(C.usage([r.plan], warmup), 6); // 2 volte a settimana per 3 settimane
  assert.equal(C.validState({ plans: [r.plan], exercises: {}, logs: [], tests: [] }), true);
  assert.equal(C.validState({ plans: [{}], exercises: {}, logs: [], tests: [] }), false);
  assert.equal(C.validState(null), false);
});
