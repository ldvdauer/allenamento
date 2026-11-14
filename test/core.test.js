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

test('sessioni: id stabili, copie con id nuovi, superficie dedotta dal nome', () => {
  const { plan, exercises } = imported();
  const all = plan.weeks.flatMap(w => w.flatMap(d => d.sessions));
  assert.equal(new Set(all.map(s => s.id)).size, all.length);
  const copy = C.cloneSession(all[0]);
  assert.notEqual(copy.id, all[0].id);
  assert.deepEqual(copy.blocks.map(b => b.exId), all[0].blocks.map(b => b.exId));
  assert.equal(exercises.find(e => e.name === 'Limit MoonBoard').surface, 'moonboard');
  assert.equal(exercises.find(e => e.name === 'Press').surface, '');
  assert.equal(C.inferSurface('Volume Kilter Board'), 'kilter');
  assert.equal(C.inferSurface('Tension 40°'), 'tension');
  assert.equal(C.inferSurface('Blocchi su roccia'), 'outdoor');
});

test('date: validISO rifiuta formati e date inesistenti', () => {
  assert.equal(C.validISO('2026-11-14'), '2026-11-14');
  for (const bad of ['2026-02-30', '2026-13-01', '14/11/2026', '', null, undefined]) assert.equal(C.validISO(bad), null);
});

test('assi: estremi e passi puliti', () => {
  assert.deepEqual(C.niceRange(0, 413), { min: 0, max: 600, step: 200 });
  assert.deepEqual(C.niceRange(0, 10), { min: 0, max: 10, step: 5 });
  assert.deepEqual(C.niceRange(12.5, 18), { min: 12, max: 18, step: 2 });
  assert.deepEqual(C.niceRange(15, 15), { min: 14, max: 16, step: 1 }); // un solo valore
  assert.deepEqual(C.niceRange(0, 0), { min: 0, max: 1, step: 0.5 });
  const r = C.niceRange(-10, 4.5);
  assert.ok(r.min <= -10 && r.max >= 4.5);
});

test('analisi: settimane, carico sRPE e aderenza al piano', () => {
  const { plan } = imported();
  const extras = [{ id: 'x1', date: '2026-11-17', type: 'wall', period: 'base', blocks: [{ id: 'b', exId: 'e', minutes: 45 }] },
    { id: 'x2', date: '2026-11-18', type: 'wall', period: 'base', blocks: [] }];
  const sched = C.scheduled(plan, extras);
  assert.equal(sched.length, 16); // 5 a settimana × 3 + 1 extra (quella senza esercizi non conta)
  const mon = plan.weeks[0][0].sessions[0], wed = plan.weeks[0][2].sessions[0];
  const logs = [
    { date: '2026-11-16', sid: mon.id, type: 'wall', minutes: 60, rpe: 8, feel: 4 },
    { date: '2026-11-19', sid: wed.id, type: 'skills', minutes: 50, rpe: 6, feel: 2 }, // fatta il giorno dopo: conta lo stesso
    { date: '2026-11-17', sid: 'x1', type: 'wall', minutes: 40, rpe: null, feel: null },
    { date: '2026-11-24', type: 'nonesiste', minutes: 30, rpe: 5, feel: null }, // registrazione manuale
    { date: '2026-11-10', type: 'wall', minutes: 99, rpe: 9 }, // prima del periodo
    { date: '2026-12-01', type: 'wall', minutes: 99, rpe: 9 }, // dopo il periodo
  ];
  const wk = C.weeklyStats(logs, sched, '2026-11-16', '2026-11-29');
  assert.deepEqual(wk, [
    { week: '2026-11-16', sessions: 3, minutes: 150, load: 780, rpe: 7, feel: 3, plannedMinutes: 180, plannedSessions: 6 },
    { week: '2026-11-23', sessions: 1, minutes: 30, load: 150, rpe: 5, feel: null, plannedMinutes: 135, plannedSessions: 5 },
  ]);
  // al 19 nov erano in programma 5 sessioni (lun ×2, extra di martedì, mer, gio) e 3 hanno una registrazione
  const sum = C.summary(logs, sched, '2026-11-16', '2026-11-29', '2026-11-19');
  assert.deepEqual(sum, { sessions: 4, minutes: 180, rpe: 19 / 3, rpeN: 3, feel: 3, due: 5, dueDone: 3 });
  assert.deepEqual(C.minutesByType(logs, '2026-11-16', '2026-11-29'), [
    { type: 'wall', minutes: 100, sessions: 2 }, { type: 'skills', minutes: 50, sessions: 1 }, { type: 'other', minutes: 30, sessions: 1 }]);
  assert.deepEqual(C.weeklyStats([], [], '2026-11-20', '2026-11-10'), []);
  assert.deepEqual(C.summary([], [], '2026-11-16', '2026-11-29', '2026-11-19'), { sessions: 0, minutes: 0, rpe: null, rpeN: 0, feel: null, due: 0, dueDone: 0 });
});

test('analisi: carichi per esercizio e lato', () => {
  assert.deepEqual(C.parseLoads('SX 15 kg · DX 18,5 kg'), [{ side: 'SX', kg: 15 }, { side: 'DX', kg: 18.5 }]);
  assert.deepEqual(C.parseLoads('-10 kg'), [{ side: null, kg: -10 }]);
  assert.deepEqual(C.parseLoads('a sensazione'), []);
  assert.deepEqual(C.parseLoads(null), []);
  const logs = [
    { date: '2026-11-23', loads: [{ name: 'Pinch', kg: 'SX 15 kg · DX 18 kg' }] },
    { date: '2026-11-16', loads: [{ name: 'Pinch', kg: 'SX 14 kg · DX 17,5 kg' }, { name: 'Open hand', kg: '+4,5 kg' }] },
    { date: '2026-11-30', loads: [{ name: 'Open hand', kg: '+9 kg' }] }, // fuori periodo
    { date: '2026-11-20' },
  ];
  assert.deepEqual(C.loadSeries(logs, '2026-11-16', '2026-11-29'), [
    { name: 'Open hand', points: [{ date: '2026-11-16', kg: 4.5 }] },
    { name: 'Pinch DX', points: [{ date: '2026-11-16', kg: 17.5 }, { date: '2026-11-23', kg: 18 }] },
    { name: 'Pinch SX', points: [{ date: '2026-11-16', kg: 14 }, { date: '2026-11-23', kg: 15 }] },
  ]);
});

test('analisi: superfici, blocchi chiusi e grado massimo per settimana', () => {
  const logs = [
    { date: '2026-11-16', climbs: [{ surface: 'moonboard', minutes: 30, top: '7A', sends: 4 }, { surface: 'moonboard', minutes: 10, top: '7A+', sends: 1 }, { surface: 'gym', minutes: 20, top: null, sends: null }] },
    { date: '2026-11-25', climbs: [{ surface: 'moonboard', minutes: 40, top: '6C+', sends: 6 }, { surface: '', minutes: 5, top: '8A' }] },
    { date: '2026-11-02', climbs: [{ surface: 'kilter', minutes: 60, top: '7B', sends: 2 }] }, // fuori periodo
    { date: '2026-11-18' },
  ];
  assert.deepEqual(C.surfaceStats(logs, '2026-11-16', '2026-11-29'), [
    { surface: 'moonboard', minutes: 80, sessions: 2, sends: 11, top: '7A+' },
    { surface: 'gym', minutes: 20, sessions: 1, sends: 0, top: null },
  ]);
  const tg = C.weeklyTopGrades(logs, '2026-11-16', '2026-11-29');
  assert.deepEqual(tg.weeks, ['2026-11-16', '2026-11-23']);
  assert.deepEqual(tg.series, { moonboard: [C.gradeIdx('7A+'), C.gradeIdx('6C+')] });
  assert.equal(C.GRADES[C.gradeIdx('7C+')], '7C+');
  assert.equal(C.gradeIdx('V10'), -1);
  assert.equal(C.gradeIdx(null), -1);
  assert.equal(C.fmtGrade('7A+', 'font'), '7A+');
});

test('backup: la validazione rifiuta strutture incomplete', () => {
  const { plan } = imported();
  const ok = { plans: [plan], exercises: {}, logs: [], tests: [] };
  assert.equal(C.validState(ok), true);
  assert.equal(C.validState({ ...ok, plans: [{ ...plan, weeks: [[{ sessions: 'no' }]] }] }), false);
  assert.equal(C.validState({ ...ok, plans: [{ ...plan, weeks: [[{ sessions: [{ type: 'wall' }] }]] }] }), false);
  assert.equal(C.validState({ ...ok, logs: null }), false);
});
