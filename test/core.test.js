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
  assert.deepEqual(plan.weeks[0].map(d => d.sessions.length), [1, 0, 1, 1, 0, 1, 0]); // la seconda sessione di Blok si accoda alla prima
  assert.deepEqual(plan.weeks[0][0].sessions[0].blocks.map(b => b.minutes), [20, 7, 30, 4]);
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

test('validazione di un backup', () => {
  const r = imported();
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
  assert.equal(sched.length, 13); // 4 a settimana × 3 + 1 extra (quella senza esercizi non conta)
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
    { week: '2026-11-16', sessions: 3, minutes: 150, load: 780, rpe: 7, feel: 3, plannedMinutes: 180, plannedSessions: 5 },
    { week: '2026-11-23', sessions: 1, minutes: 30, load: 150, rpe: 5, feel: null, plannedMinutes: 135, plannedSessions: 4 },
  ]);
  // al 19 nov erano in programma 4 sessioni (lun, extra di martedì, mer, gio) e 3 hanno una registrazione
  const sum = C.summary(logs, sched, '2026-11-16', '2026-11-29', '2026-11-19');
  assert.deepEqual(sum, { sessions: 4, minutes: 180, rpe: 19 / 3, rpeN: 3, feel: 3, due: 4, dueDone: 3 });
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

test('libreria standard: voci valide, versioni e abbinamento dei nomi', () => {
  assert.ok(C.LIBRARY.length >= 48 && C.LIBRARY.length <= 55);
  assert.equal(new Set(C.LIBRARY.map(x => x.key)).size, C.LIBRARY.length);
  for (const x of C.LIBRARY) {
    assert.ok(C.SECTIONS[x.section], x.key);
    assert.ok(x.minutes > 0, x.key);
    if (x.interval) assert.deepEqual(C.normInterval(x.interval), x.interval, x.key); // già in forma normalizzata
  }
  assert.deepEqual(C.STD['max-hang'].interval, { rounds: 4, workSeconds: 7, restSeconds: 180, cues: [] });
  assert.deepEqual(C.STD.flash.interval, { rounds: 18, workSeconds: 45, restSeconds: 120, selfPaced: true, roundsPerSet: 3, setRestSeconds: 300, cues: [] });
  const v = C.stdVariant('limit');
  assert.deepEqual([v.std, v.base, v.name, v.slot, v.interval, v.minutes], ['limit', true, 'Limit bouldering', 'wall', null, 40]);
  C.stdVariant('max-hang').interval.rounds = 9;
  assert.equal(C.STD['max-hang'].interval.rounds, 4); // le versioni non toccano lo standard
  assert.equal(C.stdVariant('nonesiste'), null);
  const cases = { 'Limit Karma': 'limit', 'Limit MoonBoard': 'limit', 'Limit sloper/compressione': 'limit', 'Compressione su sloper': 'technique', 'Tallone su strapiombo': 'technique',
    'Open hand 20 mm 7"': 'max-hang', 'Half-crimp 20 mm 7"': 'max-hang', 'Sloper BM2000 7"': 'sloper-hang', 'Pinch block 7"': 'pinch-lift', 'TEST open hand 20 mm 7"': 'test',
    'Trazioni zavorrate': 'weighted-pullup', 'KB press 1 braccio': 'press', 'Croci isometriche': 'iso-fly', 'Croci ai cavi (compressione)': 'fly', 'Push-up zavorrati o dip': 'pushup',
    'Karma a Bleau': 'outdoor', 'Mobilità anche': 'hips', 'Riscaldamento': 'warmup-wall', 'Set tecnici al flash': 'flash', 'Technical Triples': 'flash', 'Leg raise alla sbarra': 'leg-raise', 'Croci agli anelli': 'fly', 'Pallof press': 'pallof', 'Qualcosa di mio': null };
  for (const [name, std] of Object.entries(cases)) assert.equal(C.matchStd(name), std, name);
  assert.equal(imported().exercises.find(e => /^Limit/.test(e.name)).std, 'limit');
});

test('test: modelli con parametri propri, senza "zavorra max" nel nome', () => {
  assert.equal(new Set(C.TEST_TEMPLATES.map(t => t.key)).size, C.TEST_TEMPLATES.length);
  for (const t of C.TEST_TEMPLATES) assert.ok(!/zavorra max|· max|\d"/.test(t.name), t.name);
  assert.equal(C.testLabel(C.TEST_TEMPLATES.find(t => t.key === 'oh')), '20 mm · 7" · zavorra');
  assert.equal(C.testLabel(C.TEST_TEMPLATES.find(t => t.key === 'onearm')), '22 mm · una mano');
  assert.equal(C.testLabel({ name: 'x', unit: 'kg' }), '');
});

test('progressione e serie per esercizio standard: hang a due mani, lift per lato', () => {
  const rule = { step: 2.5, rpe: 8 };
  assert.deepEqual(C.nextLoad(10, 7, rule, 'hang', 70), { kg: 12, dir: 1 }); // (70+10)×1,025−70 = 12
  assert.deepEqual(C.nextLoad(10, 8.5, rule, 'hang', 70), { kg: 10, dir: 0 });
  assert.deepEqual(C.nextLoad(10, 9.5, rule, 'hang', 70), { kg: 8, dir: -1 });
  assert.deepEqual(C.nextLoad(40, 8, rule, 'lift', 70), { kg: 41, dir: 1 }); // sollevamento: % sul carico, il peso corporeo non c'entra
  assert.deepEqual(C.nextLoad(40, null, rule, 'lift'), { kg: 40, dir: 0 });
  assert.deepEqual(C.nextLoad(10, 7, rule, 'hang', null), { kg: 10.5, dir: 1 }); // senza peso corporeo: % sulla sola zavorra
  assert.equal(C.nextLoad(null, 7, rule, 'lift'), null);
  assert.deepEqual(C.refKeys('lift'), ['liftL', 'liftR']);
  assert.deepEqual(C.refKeys('oh'), ['oh']);
  assert.equal(C.loadKey({ ref: 'lift' }, 'DX · 90%'), 'liftR');
  assert.equal(C.loadKey({ ref: 'lift' }, 'SX'), 'liftL');
  assert.equal(C.loadKg({ ref: 'lift', mode: 'lift', pct: 90 }, 'DX', { liftL: 40, liftR: 50 }), 45);
  assert.equal(C.matchStd('Max lift 20 mm'), 'block-lift');
  assert.deepEqual(C.inferLoad('Max lift 20 mm', '3 × 7" · 90% max'), { ref: 'lift', mode: 'lift', pct: 90, test: false });
  assert.equal(C.STD['max-hang'].interval.cues.length, 0); // sospensioni: due mani, nessun lato
  assert.deepEqual(C.STD['block-lift'].interval.cues, ['SX', 'DX']);
  const logs = [
    { date: '2026-11-16', blocks: [{ name: 'Half-crimp 85%', key: 'max-hang|hc', label: 'Max hang · Half-crimp', kgs: [{ side: null, kg: 10 }], rpe: 7, mode: 'hang' },
      { name: 'Lift', key: 'block-lift|lift', label: 'Max lift', kgs: [{ side: 'SX', kg: 38 }, { side: 'DX', kg: 42 }], rpe: 8, mode: 'lift' }, { name: 'Riscaldamento', minutes: 20 }] },
    { date: '2026-11-23', blocks: [{ name: 'Half-crimp 90%', key: 'max-hang|hc', label: 'Max hang · Half-crimp', kgs: [{ side: null, kg: 12 }], rpe: 9, mode: 'hang' }] },
    { date: '2026-11-20', loads: [{ name: 'Open hand 20 mm 7"', kg: '+8 kg' }] },
  ];
  const ls = C.loadSeries(logs, '2026-11-01', '2026-11-30');
  assert.deepEqual(ls.map(x => [x.name, x.points.map(p => p.kg)]), [['Max hang · Half-crimp', [10, 12]], ['Max lift DX', [42]], ['Max lift SX', [38]], ['Open hand 20 mm 7"', [8]]]);
  assert.deepEqual([C.lastRecord(logs, 'max-hang|hc').date, C.lastRecord(logs, 'max-hang|hc').rpe], ['2026-11-23', 9]);
  assert.equal(C.lastRecord(logs, 'max-hang|oh').kgs[0].kg, 8); // log vecchio ricondotto allo standard dal nome
  assert.equal(C.lastRecord(logs, 'nessuno'), null);
});

test('parametri → riga descrittiva; dalle prescrizioni importate resta solo la nota', () => {
  assert.equal(C.describe({ interval: { rounds: 4, workSeconds: 7, restSeconds: 180, cues: [] }, load: { ref: 'hc', pct: 87.5 } }), '4 × 7" · rec. 3\' · 87,5%');
  assert.equal(C.describe({ interval: { rounds: 3, workSeconds: 45, restSeconds: 90, selfPaced: true, reps: 8, cues: [] } }), '3 × 8 rip. · rec. 1\'30"');
  assert.equal(C.describe({ interval: { rounds: 18, workSeconds: 60, restSeconds: 120, selfPaced: true, roundsPerSet: 3, setRestSeconds: 300, cues: [] } }), '6 serie × 3 · rec. 2\' / 5\' tra le serie');
  assert.equal(C.describe({ interval: { rounds: 2, workSeconds: 30, restSeconds: 45, selfPaced: true, cues: [] } }), '2 round · rec. 45"');
  assert.equal(C.describe({ interval: null, load: null }), '');
  assert.equal(C.leftoverNote('4 × 7" · 85% max · margine 2-3"'), 'margine 2-3"');
  assert.equal(C.leftoverNote('2 × 6-8 · rec. 2\''), '');
  assert.equal(C.leftoverNote('3 × 7" per mano · 75% max'), '');
  assert.equal(C.leftoverNote('6 blocchi × 3 rip. · rec. 2\' / 5\' tra blocchi'), '');
  assert.equal(C.leftoverNote('3 serie per lato · singolo movimento'), 'singolo movimento');
  assert.equal(C.leftoverNote('≥ 3 tentativi per problema · stop quando cala la qualità'), '≥ 3 tentativi per problema · stop quando cala la qualità');
  assert.equal(C.leftoverNote('TEST · Carico crescente'), 'Carico crescente');
  assert.equal(C.leftoverNote(''), '');
  // export: senza testo libero la riga del file nasce dai parametri e dalla nota del blocco
  const ex = { e1: { id: 'e1', name: 'Max hang', slot: 'strength', location: 'off_wall', domain: 'x', intensity: 'max', risk: 'low', interval: { rounds: 4, workSeconds: 7, restSeconds: 180, cues: [] }, load: { ref: 'hc', pct: 85 } } };
  const plan = { title: 'P', startDate: '2026-11-16', weeks: [[{ sessions: [{ id: 's', type: 'wall', period: 'base', blocks: [{ id: 'b', exId: 'e1', minutes: 10, note: 'margine 2"' }] }] }, ...Array.from({ length: 6 }, () => ({ sessions: [] }))]] };
  assert.equal(C.exportBlokplan(plan, ex).weeks[0][0].plannedBlocks[0].block.prescription, '4 × 7" · rec. 3\' · 85% · margine 2"');
});

test('cue importati → interruttore SX/DX + nota', () => {
  assert.deepEqual(C.splitCues(['SX · 75% max', 'DX · 75% max']), { sided: true, note: '' });
  assert.deepEqual(C.splitCues(['SX · carico crescente', 'DX · carico crescente']), { sided: true, note: 'carico crescente' });
  assert.deepEqual(C.splitCues(['Lato SX', 'Lato DX']), { sided: true, note: '' });
  assert.deepEqual(C.splitCues(['Lato Karma', 'Lato opposto']), { sided: true, note: 'Lato Karma → Lato opposto' });
  assert.deepEqual(C.splitCues(['85% max']), { sided: false, note: '' });
  assert.deepEqual(C.splitCues(['6-8 rip. per braccio']), { sided: false, note: '6-8 rip. per braccio' });
  assert.deepEqual(C.splitCues(['Lettura (flash)', 'Piedi e tecnica', 'Lentezza e controllo']), { sided: false, note: 'Lettura (flash) → Piedi e tecnica → Lentezza e controllo' });
  assert.deepEqual(C.splitCues(['Tieni in compressione']), { sided: false, note: 'Tieni in compressione' });
  assert.deepEqual(C.splitCues([]), { sided: false, note: '' });
  assert.deepEqual(C.splitCues(undefined), { sided: false, note: '' });
});

test('tempo per categoria: sezioni, quota di arrampicata, gruppi settimanali', () => {
  const logs = [
    { date: '2026-11-16', minutes: 100, blocks: [{ name: 'Riscaldamento', sec: 'warmup', minutes: 20 }, { name: 'Half-crimp', key: 'max-hang|hc', minutes: 10 }, { name: 'Limit Karma', key: 'limit|', minutes: 50 }, { name: 'Nordic curl', minutes: 5 }] },
    { date: '2026-11-18', minutes: 60 }, // registrata a mano: nessun esercizio
    { date: '2026-11-24', minutes: 30, blocks: [{ name: 'Test: Half-crimp', key: 'test|hc', minutes: 10 }, { name: 'Volume', key: 'volume|', minutes: 30 }] },
    { date: '2026-10-01', minutes: 500, blocks: [{ name: 'Volume', key: 'volume|', minutes: 500 }] },
  ];
  assert.equal(C.blockSection({ name: 'Qualcosa di mio' }), 'other');
  assert.equal(C.blockSection({ name: 'x', sec: 'core' }), 'core');
  const t = C.timeBySection(logs, '2026-11-16', '2026-11-29');
  assert.deepEqual(t.rows, [{ section: 'wall', minutes: 80 }, { section: 'fingers', minutes: 20 }, { section: 'warmup', minutes: 20 }, { section: 'strength', minutes: 5 }]);
  assert.deepEqual([t.classified, t.unclassified, t.wall, t.wallShare], [125, 15 + 60, 80, 0.64]); // 15 min della prima sessione non attribuiti a un esercizio
  assert.equal(C.timeBySection([], '2026-11-16', '2026-11-29').wallShare, null);
  assert.deepEqual(C.weeklyGroups(logs, '2026-11-16', '2026-11-29'), [
    { week: '2026-11-16', wall: 50, strength: 15, other: 20, unclassified: 75 },
    { week: '2026-11-23', wall: 30, strength: 10, other: 0, unclassified: 0 }]); // se gli esercizi superano il totale, il non classificato resta 0
});
