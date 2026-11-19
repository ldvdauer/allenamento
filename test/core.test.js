const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const fs = require('node:fs');
const FIXTURE = fs.readFileSync(require.resolve('./fixture.yaml'), 'utf8');

// Come fa l'app all'import: la prima sessione cade nella data indicata dal file.
const imported = () => { const r = C.importYaml(FIXTURE); r.plan.startDate = C.startForFirst(r.plan, r.firstSession); return r; };
const exMapOf = r => Object.fromEntries(r.exercises.map(e => [e.id, e]));
const weekMinutes = w => w.reduce((t, d) => t + d.sessions.reduce((a, s) => a + C.sessionMinutes(s), 0), 0);
const errorsOf = (text, opts) => { try { C.importYaml(text, opts); return []; } catch (e) { return e.errors || [e.message]; } };

test('import YAML: struttura del piano di esempio', () => {
  const { plan, exercises } = imported();
  assert.equal(plan.title, 'Piano di esempio');
  assert.equal(plan.startDate, '2026-11-16');
  assert.equal(plan.weeks.length, 3);
  const blocks = plan.weeks.flat().flatMap(d => d.sessions.flatMap(s => s.blocks));
  assert.equal(exercises.length, blocks.length); // ogni esercizio di ogni sessione è un'istanza privata
  assert.equal(new Set(blocks.map(b => b.exId)).size, blocks.length);
  assert.deepEqual(plan.weeks.map(weekMinutes), [95, 95, 95]);
  assert.deepEqual(plan.weeks[0].map(d => d.sessions.length), [1, 0, 1, 1, 0, 1, 0]);
  assert.deepEqual(plan.weeks[0][0].sessions[0].blocks.map(b => b.minutes), [7, 30, 4]);
});

test('import YAML: parametri del timer, carico, lati, superficie, nota', () => {
  const r = C.importYaml(`title: T
weeks: 2
days:
  - week: all
    day: Tuesday
    title: Dita
    exercises:
      - name: Sloper hang
        sets: 4
        work: 7s
        rest: 3min
        load: 82.5% sloper
        note: margine 2-3"
      - name: Pinch block
        sets: 6
        work: 7
        rest: 1'15"
        sides: L/R
        load: 75% pinch
      - name: Set tecnici al flash
        sets: 6
        rounds: 3
        work: done
        rest: 2min
        set_rest: 5min
      - name: Board
        surface: MoonBoard
      - test: half-crimp
`);
  const ex = exMapOf(r), s = r.plan.weeks[1][1].sessions[0], [a, b, c, d, t] = s.blocks.map(x => ex[x.exId]);
  assert.equal(s.title, 'Dita');
  assert.equal(r.plan.weeks[0][1].sessions.length, 1); // "all" = tutte le settimane
  assert.deepEqual(a.interval, { rounds: 4, workSeconds: 7, restSeconds: 180, cues: [] });
  assert.deepEqual(a.load, { ref: 'sl', mode: 'hang', pct: 82.5, test: false });
  assert.equal(s.blocks[0].note, 'margine 2-3"');
  assert.equal(s.blocks[0].minutes, C.intervalMinutes(a.interval)); // minuti calcolati dal timer se non scritti
  assert.equal(a.std, 'sloper-hang');
  assert.deepEqual(b.interval.cues, ['L', 'R']);
  assert.equal(b.interval.restSeconds, 75);
  assert.deepEqual(b.load, { ref: 'pinch', mode: 'lift', pct: 75, test: false });
  assert.deepEqual(c.interval, { rounds: 18, workSeconds: 45, restSeconds: 120, selfPaced: true, roundsPerSet: 3, setRestSeconds: 300, cues: [] });
  assert.equal(C.describe(c), '6 sets × 3 · rest 2\' / 5\' between sets');
  assert.equal(d.surface, 'moonboard');
  assert.equal(s.blocks[3].minutes, C.STD.board.minutes); // senza timer: minuti predefiniti dell'esercizio standard
  assert.equal(t.name, 'Test: Half-crimp');
  assert.equal(t.load.test, true);
  assert.equal(s.blocks[4].note, 'Increasing load');
});

test('import YAML: tutti gli errori, con il punto esatto, e nessun risultato parziale', () => {
  const errs = errorsOf(`title: Prova
weeks: 3
days:
  - week: 1-4
    day: tue
    exercises:
      - name: Sloper hang
        sets: 4
        work: 7 secondi
        load: 80% slopr
  - week: 2
    day: lun
    exercises:
      - name: Board
        minutez: 30
  - week: 2
    day: wed
    exercises:
      - test: pinch
        load: 70% pinch
  - week: 2
    day: wed
    exercises:
      - name: Custom
`);
  const has = re => assert.ok(errs.some(e => re.test(e)), re + ' in\n' + errs.join('\n'));
  has(/day 1 .*week: "1-4" is not valid/);
  has(/exercise 1 "Sloper hang": work: "7 secondi" is not a duration/);
  has(/load: "80% slopr" should look like/);
  has(/day: "lun" is not valid/);
  has(/"Board": unknown field "minutez"/);
  has(/a test has no load/);
  has(/week 2, wed is already described/);
  has(/"Custom": minutes: required/);
  assert.equal(errs.length, 8);
  assert.match(errorsOf('title: x\nweeks: 1\ndays:\n  - week: 1\n    day: mon\n    exercises:\n      - name: X\n        minutes: 60\n        sets: 2\n        work: 7s')[0], /minutes: remove it, with a timer the minutes are calculated/);
  assert.match(errorsOf('title: x\nweeks: 2\ndays:\n  - week: 1\n   day: mon')[0], /^line \d+: /);
  for (const bad of ['', 'ciao', '[]', 'title: x', '{"title":"x","isForSelf":true,"weeks":[[]]}'])
    assert.ok(errorsOf(bad).length > 0, JSON.stringify(bad));
  assert.match(errorsOf('{"title":"x","isForSelf":true,"weeks":[[]]}')[0], /Blok Sessions plans are no longer supported/);
  assert.match(errorsOf('title: x\nweeks: 1\ndays:\n  - week: 1\n    day: mon\n    exercises:\n      - name: X\n        sets: 2\n        work: 7s\n        reps: 3')[0], /either work .* or reps/);
});

test('YAML: durate e settimane', () => {
  for (const [v, s] of [['7s', 7], ['45 s', 45], ['3min', 180], ['3 min', 180], ['1min30s', 90], ['1m30', 90], ["2'", 120], ['1\'30"', 90], [90, 90], ['7"', 7]]) assert.equal(C.parseDuration(v), s, v);
  for (const v of ['7 secondi', '-3', 'abc', 1.5, null]) assert.equal(C.parseDuration(v), null, String(v));
  assert.deepEqual(C.parseWeeks('1-2,4', 4), [1, 2, 4]);
  assert.deepEqual(C.parseWeeks(3, 4), [3]);
  assert.deepEqual(C.parseWeeks('all', 3), [1, 2, 3]);
  for (const v of ['0', '5', '3-1', 'x', '1-5']) assert.equal(C.parseWeeks(v, 4), null, v);
  assert.equal(C.fmtWeeks([1, 2, 3, 5]), '1-3,5');
  assert.equal(C.fmtWeeks([2]), 2);
});

test('YAML: export → import senza perdite, sessioni uguali raggruppate', () => {
  const a = imported(), text = C.exportYaml(a.plan, exMapOf(a));
  assert.match(text, /\ndays:\n/);
  assert.match(text, /\n  - week: 1-3\n    day: wed\n/); // la stessa giornata in tre settimane si scrive una volta
  assert.match(text, /first_session: "2026-11-16"/);
  const b = C.importYaml(text), shape = (r, m) => r.plan.weeks.map(w => w.map(d => d.sessions.map(s => [s.title || '', s.blocks.map(x => {
    const e = m[x.exId]; return [C.exName(e), e.std, x.minutes, x.note || '', e.interval, e.load, e.surface || ''];
  })])));
  assert.deepEqual(shape(b, exMapOf(b)), shape(a, exMapOf(a)));
  assert.equal(b.firstSession, '2026-11-16');
});

test('date: posizione nel piano, prima sessione in un giorno qualsiasi', () => {
  assert.equal(C.mondayOf('2026-11-14'), '2026-11-09');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  const { plan } = imported();
  assert.equal(C.locate(plan, '2026-11-15'), null);
  assert.deepEqual(C.locate(plan, '2026-11-16'), { w: 0, d: 0 });
  assert.deepEqual(C.locate(plan, '2026-11-25'), { w: 1, d: 2 });
  assert.equal(C.locate(plan, '2026-12-07'), null);
  assert.equal(C.dateOf(plan, 2, 6), '2026-12-06');
  const rest = { startDate: '2026-11-16', weeks: [[{ sessions: [] }, { sessions: [{ blocks: [] }] }, ...Array.from({ length: 5 }, () => ({ sessions: [] }))]] };
  assert.equal(C.firstSessionDate(rest), '2026-11-17');
  assert.equal(C.startForFirst(rest, '2026-11-18'), '2026-11-17'); // prima sessione mercoledì 18
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
  assert.equal(C.fmtKg(12.5), '+12.5 kg');
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
    reps: { id: 'reps', name: 'Press', interval: { rounds: 2, workSeconds: 45, restSeconds: 120, selfPaced: true, reps: 6, cues: ['L', 'R'] } },
    free: { id: 'free', name: 'Limit', prescription: 'qualità', interval: null },
    sets: { id: 'sets', name: 'Set', interval: { rounds: 6, workSeconds: 60, restSeconds: 120, selfPaced: true, roundsPerSet: 3, setRestSeconds: 300, cues: ['a', 'b', 'c'] } },
  };
  const s = C.buildSteps([{ exId: 'free', minutes: 20 }, { exId: 'hang', minutes: 10 }, { exId: 'reps', minutes: 4 }], ex, 10);
  assert.deepEqual(s.map(x => x.kind + (x.prep ? '*' : '')), ['free', 'rest*', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'work']);
  assert.equal(s[0].seconds, 1200);
  assert.equal(s[1].seconds, 10);
  assert.equal(s[7].afterBlock, true); // recupero prima dell'esercizio successivo
  assert.equal(s[8].cue, 'L');
  assert.equal(s[10].cue, 'R');
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
  assert.equal(exercises.find(e => e.std === 'limit').surface, 'moonboard');
  assert.equal(exercises.find(e => e.std === 'press').surface, '');
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
    { week: '2026-11-16', sessions: 3, minutes: 150, load: 780, rpe: 7, feel: 3, plannedMinutes: 140, plannedSessions: 5 },
    { week: '2026-11-23', sessions: 1, minutes: 30, load: 150, rpe: 5, feel: null, plannedMinutes: 95, plannedSessions: 4 },
  ]);
  // al 19 nov erano in programma 4 sessioni (lun, extra di martedì, mer, gio) e 3 hanno una registrazione
  const sum = C.summary(logs, sched, '2026-11-16', '2026-11-29', '2026-11-19');
  assert.deepEqual(sum, { sessions: 4, minutes: 180, rpe: 19 / 3, rpeN: 3, feel: 3, due: 4, dueDone: 3 });
  assert.deepEqual(C.weeklyStats([], [], '2026-11-20', '2026-11-10'), []);
  assert.deepEqual(C.summary([], [], '2026-11-16', '2026-11-29', '2026-11-19'), { sessions: 0, minutes: 0, rpe: null, rpeN: 0, feel: null, due: 0, dueDone: 0 });
});

test('analisi: carichi per esercizio e lato', () => {
  assert.deepEqual(C.parseLoads('SX 15 kg · DX 18,5 kg'), [{ side: 'L', kg: 15 }, { side: 'R', kg: 18.5 }]);
  assert.deepEqual(C.parseLoads('L 15 kg · R 18.5 kg'), [{ side: 'L', kg: 15 }, { side: 'R', kg: 18.5 }]);
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
    { name: 'Pinch L', points: [{ date: '2026-11-16', kg: 14 }, { date: '2026-11-23', kg: 15 }] },
    { name: 'Pinch R', points: [{ date: '2026-11-16', kg: 17.5 }, { date: '2026-11-23', kg: 18 }] },
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
    'Karma a Bleau': 'outdoor', 'Mobilità anche': 'hips', 'Riscaldamento': null, 'Falesia: vie di resistenza': 'outdoor-routes', 'Lead outdoor': 'outdoor-routes', 'Set tecnici al flash': 'flash', 'Technical Triples': 'flash', 'Leg raise alla sbarra': 'leg-raise', 'Croci agli anelli': 'fly', 'Pallof press': 'pallof', 'Qualcosa di mio': null };
  for (const [name, std] of Object.entries(cases)) assert.equal(C.matchStd(name), std, name);
  assert.equal(imported().exercises.find(e => /^Limit/.test(e.name)).std, 'limit');
});

test('test: modelli con parametri propri, senza "zavorra max" nel nome', () => {
  assert.equal(new Set(C.TEST_TEMPLATES.map(t => t.key)).size, C.TEST_TEMPLATES.length);
  for (const t of C.TEST_TEMPLATES) assert.ok(!/zavorra max|· max|\d"/.test(t.name), t.name);
  assert.equal(C.testLabel(C.TEST_TEMPLATES.find(t => t.key === 'oh')), '20 mm · 7" · added weight');
  assert.equal(C.testLabel(C.TEST_TEMPLATES.find(t => t.key === 'onearm')), '22 mm · one hand');
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
  assert.equal(C.loadKey({ ref: 'lift' }, 'R · 90%'), 'liftR');
  assert.equal(C.loadKey({ ref: 'lift' }, 'L'), 'liftL');
  assert.equal(C.loadKg({ ref: 'lift', mode: 'lift', pct: 90 }, 'DX', { liftL: 40, liftR: 50 }), 45);
  assert.equal(C.matchStd('Max lift 20 mm'), 'block-lift');
  assert.deepEqual(C.inferLoad('Max lift 20 mm', '3 × 7" · 90% max'), { ref: 'lift', mode: 'lift', pct: 90, test: false });
  assert.equal(C.STD['max-hang'].interval.cues.length, 0); // sospensioni: due mani, nessun lato
  assert.deepEqual(C.STD['block-lift'].interval.cues, ['L', 'R']);
  const logs = [
    { date: '2026-11-16', blocks: [{ name: 'Half-crimp 85%', key: 'max-hang|hc', label: 'Max hang · Half-crimp', kgs: [{ side: null, kg: 10 }], rpe: 7, mode: 'hang' },
      { name: 'Lift', key: 'block-lift|lift', label: 'Max lift', kgs: [{ side: 'L', kg: 38 }, { side: 'R', kg: 42 }], rpe: 8, mode: 'lift' }, { name: 'Riscaldamento', minutes: 20 }] },
    { date: '2026-11-23', blocks: [{ name: 'Half-crimp 90%', key: 'max-hang|hc', label: 'Max hang · Half-crimp', kgs: [{ side: null, kg: 12 }], rpe: 9, mode: 'hang' }] },
    { date: '2026-11-20', loads: [{ name: 'Open hand 20 mm 7"', kg: '+8 kg' }] },
  ];
  const ls = C.loadSeries(logs, '2026-11-01', '2026-11-30');
  assert.deepEqual(ls.map(x => [x.name, x.points.map(p => p.kg)]), [['Max hang · Half-crimp', [10, 12]], ['Max lift L', [38]], ['Max lift R', [42]], ['Open hand 20 mm 7"', [8]]]);
  assert.deepEqual([C.lastRecord(logs, 'max-hang|hc').date, C.lastRecord(logs, 'max-hang|hc').rpe], ['2026-11-23', 9]);
  assert.equal(C.lastRecord(logs, 'max-hang|oh').kgs[0].kg, 8); // log vecchio ricondotto allo standard dal nome
  assert.equal(C.lastRecord(logs, 'nessuno'), null);
});

test('parametri → riga descrittiva; dalle prescrizioni importate resta solo la nota', () => {
  assert.equal(C.describe({ interval: { rounds: 4, workSeconds: 7, restSeconds: 180, cues: [] }, load: { ref: 'hc', pct: 87.5 } }), '4 × 7" · rest 3\' · 87.5%');
  assert.equal(C.describe({ interval: { rounds: 3, workSeconds: 45, restSeconds: 90, selfPaced: true, reps: 8, cues: [] } }), '3 × 8 reps · rest 1\'30"');
  assert.equal(C.describe({ interval: { rounds: 18, workSeconds: 60, restSeconds: 120, selfPaced: true, roundsPerSet: 3, setRestSeconds: 300, cues: [] } }), '6 sets × 3 · rest 2\' / 5\' between sets');
  assert.equal(C.describe({ interval: { rounds: 2, workSeconds: 30, restSeconds: 45, selfPaced: true, cues: [] } }), '2 round · rest 45"');
  assert.equal(C.describe({ interval: null, load: null }), '');
  assert.equal(C.leftoverNote('4 × 7" · 85% max · margine 2-3"'), 'margine 2-3"');
  assert.equal(C.leftoverNote('2 × 6-8 · rec. 2\''), '');
  assert.equal(C.leftoverNote('6 sets × 3 · rest 2\' / 5\' between sets · slow feet'), 'slow feet');
  assert.equal(C.leftoverNote('3 × 7" per mano · 75% max'), '');
  assert.equal(C.leftoverNote('6 blocchi × 3 rip. · rec. 2\' / 5\' tra blocchi'), '');
  assert.equal(C.leftoverNote('3 serie per lato · singolo movimento'), 'singolo movimento');
  assert.equal(C.leftoverNote('≥ 3 tentativi per problema · stop quando cala la qualità'), '≥ 3 tentativi per problema · stop quando cala la qualità');
  assert.equal(C.leftoverNote('TEST · Carico crescente'), 'Carico crescente');
  assert.equal(C.leftoverNote(''), '');
});

test('cue importati → interruttore SX/DX + nota', () => {
  assert.deepEqual(C.splitCues(['SX · 75% max', 'DX · 75% max']), { sided: true, note: '' });
  assert.deepEqual(C.splitCues(['SX · carico crescente', 'DX · carico crescente']), { sided: true, note: 'carico crescente' });
  assert.deepEqual(C.splitCues(['Lato SX', 'Lato DX']), { sided: true, note: '' });
  assert.deepEqual(C.splitCues(['L · 75% max', 'R · 75% max']), { sided: true, note: '' });
  assert.deepEqual(C.splitCues(['Left', 'Right']), { sided: true, note: '' });
  assert.deepEqual(C.splitCues(['Lato Karma', 'Lato opposto']), { sided: true, note: 'Lato Karma → Lato opposto' });
  assert.deepEqual(C.splitCues(['85% max']), { sided: false, note: '' });
  assert.deepEqual(C.splitCues(['6-8 rip. per braccio']), { sided: false, note: '6-8 rip. per braccio' });
  assert.deepEqual(C.splitCues(['Lettura (flash)', 'Piedi e tecnica', 'Lentezza e controllo']), { sided: false, note: 'Lettura (flash) → Piedi e tecnica → Lentezza e controllo' });
  assert.deepEqual(C.splitCues(['Tieni in compressione']), { sided: false, note: 'Tieni in compressione' });
  assert.deepEqual(C.splitCues([]), { sided: false, note: '' });
  assert.deepEqual(C.splitCues(undefined), { sided: false, note: '' });
});

test('categorie per qualità: libreria, tempo per categoria, volume settimanale', () => {
  // Il riscaldamento non è una categoria e non ha esercizi generici in libreria
  assert.equal(C.SECTIONS.warmup, undefined);
  assert.equal(C.STD['warmup-wall'], undefined);
  assert.deepEqual(Object.keys(C.SECTIONS), ['fingers', 'strength', 'powerEndurance', 'endurance', 'technique', 'conditioning', 'mobility', 'other']);
  for (const [k, sec] of [['max-hang', 'fingers'], ['pinch-lift', 'fingers'], ['warmup-fingers', 'fingers'], ['wrist-curl', 'conditioning'], ['weighted-pullup', 'conditioning'], ['ab-wheel', 'conditioning'],
    ['limit', 'strength'], ['campus', 'strength'], ['outdoor', 'strength'], ['flash', 'powerEndurance'], ['volume', 'powerEndurance'], ['four-by-four', 'powerEndurance'],
    ['circuit', 'endurance'], ['outdoor-routes', 'endurance'], ['technique', 'technique'], ['butterfly', 'mobility'], ['visualize', 'other']])
    assert.equal(C.STD[k].section, sec, k);
  // Sul muro (superficie, gradi) solo le categorie di arrampicata
  assert.equal(C.stdVariant('volume').slot, 'wall');
  assert.equal(C.stdVariant('max-hang').slot, 'strength');
  assert.equal(C.stdVariant('stretch').slot, 'mobility');
  const logs = [
    { date: '2026-11-16', minutes: 100, blocks: [{ name: 'Half-crimp', key: 'max-hang|hc', minutes: 10 }, { name: 'Limit Karma', key: 'limit|', minutes: 50 }, { name: 'Nordic curl', minutes: 5 }, { name: 'Mio', sec: 'mobility', minutes: 20 }] },
    { date: '2026-11-18', minutes: 60 }, // registrata a mano: nessun esercizio
    { date: '2026-11-24', minutes: 30, blocks: [{ name: 'Test: Half-crimp', key: 'test|hc', minutes: 10 }, { name: 'Volume', key: 'volume|', minutes: 30 }] },
    { date: '2026-10-01', minutes: 500, blocks: [{ name: 'Volume', key: 'volume|', minutes: 500 }] },
  ];
  assert.equal(C.blockSection({ name: 'Qualcosa di mio' }), 'other');
  assert.equal(C.blockSection({ name: 'x', sec: 'core' }), 'other'); // vecchia sezione non migrata: non classificabile qui
  const t = C.timeBySection(logs, '2026-11-16', '2026-11-29');
  // ordine fisso delle categorie, non per minuti
  assert.deepEqual(t.rows, [{ section: 'fingers', minutes: 20 }, { section: 'strength', minutes: 50 }, { section: 'powerEndurance', minutes: 30 }, { section: 'conditioning', minutes: 5 }, { section: 'mobility', minutes: 20 }]);
  assert.deepEqual([t.classified, t.unclassified], [125, 15 + 60]);
  const w = C.weeklyGroups(logs, '2026-11-16', '2026-11-29');
  assert.deepEqual([w[0].fingers, w[0].strength, w[0].conditioning, w[0].mobility, w[0].unclassified], [10, 50, 5, 20, 75]);
  assert.deepEqual([w[1].fingers, w[1].powerEndurance, w[1].unclassified], [10, 30, 0]); // se gli esercizi superano il totale, il non classificato resta 0
});


test('nomi: la libreria è in inglese, i nomi italiani delle versioni precedenti restano riconosciuti', () => {
  assert.equal(C.STD['wrist-curl'].name, 'Wrist curl');
  assert.equal(C.LEGACY_NAMES['Flessione polso'], 'Wrist curl');
  assert.equal(C.matchStd('Flessione polso'), 'wrist-curl');
  assert.equal(C.matchStd('Finger activation'), 'warmup-fingers'); // nome esatto prima delle regole
  assert.equal(C.matchStd('Attivazione dita'), 'warmup-fingers');
  for (const x of C.LIBRARY) assert.equal(C.matchStd(x.name), x.key, x.name);
  for (const [old, now] of Object.entries(C.LEGACY_NAMES)) assert.notEqual(old, now);
  assert.equal(C.normSide('DX'), 'R');
  assert.equal(C.normSide('sx'), 'L');
});

test('guida: l\'esempio del formato nella guida si importa senza errori', () => {
  const guide = fs.readFileSync(require.resolve('../GUIDE.md'), 'utf8');
  const example = guide.split('```yaml\n')[1].split('```')[0];
  const r = C.importYaml(example);
  assert.equal(r.firstSession, '2026-11-18');
  assert.equal(r.plan.weeks.flat().filter(d => d.sessions.length).length, 3); // week: 1-3, un giorno
});

test('programma nel repository: Karma - Fase 1.yaml è valido', () => {
  const r = C.importYaml(fs.readFileSync(require.resolve('../Karma - Fase 1.yaml'), 'utf8'));
  assert.equal(r.plan.weeks.length, 4);
});

test('libreria: esercizi di stretching e riconoscimento dei nomi', () => {
  for (const [n, k] of [['Butterfly passivo', 'butterfly'], ['Side split', 'side-split'], ['Spaccata laterale', 'side-split'], ['Frog', 'frog'], ['Biceps stretch', 'biceps-stretch'],
    ['Allungamento bicipiti', 'biceps-stretch'], ['Attivazione dita open hand 20 mm', 'warmup-fingers'], ['Attivazione', 'activation'], ['Mobilità generale', 'stretch']])
    assert.equal(C.matchStd(n), k, n);
  for (const k of ['butterfly', 'side-split', 'frog', 'biceps-stretch']) assert.equal(C.STD[k].section, 'mobility');
  assert.equal(C.matchStd('Biceps curl'), null);
});

test('YAML: "sessions" (nome precedente) resta valido, ma non insieme a "days"', () => {
  const body = '\n  - week: 1\n    day: mon\n    exercises:\n      - name: Board\n';
  assert.equal(C.importYaml('title: x\nweeks: 1\nsessions:' + body).plan.weeks[0][0].sessions.length, 1);
  assert.match(errorsOf('title: x\nweeks: 1\ndays:' + body + 'sessions:' + body)[0], /either days or sessions/);
});

test('nomi: un esercizio standard si mostra con il nome della libreria', () => {
  assert.equal(C.exName({ std: 'wrist-curl', name: 'Flessione polso (manubri)' }), 'Wrist curl');
  assert.equal(C.exName({ std: null, name: 'Circuito spray' }), 'Circuito spray');
  assert.equal(C.exName({ std: 'test', name: 'Test: Open hand' }), 'Test: Open hand');
  const r = C.importYaml('title: x\nweeks: 1\ndays:\n  - week: 1\n    day: mon\n    exercises:\n      - name: Flessione polso (manubri)\n        sets: 3\n        reps: 6\n');
  assert.match(C.exportYaml(r.plan, Object.fromEntries(r.exercises.map(e => [e.id, e]))), /name: Wrist curl\n/);
});

test('presa: grip, edge e hands negli esercizi Fingers, testo e YAML', () => {
  const r = C.importYaml('title: x\nweeks: 1\ndays:\n  - week: 1\n    day: mon\n    exercises:\n      - name: Max hang\n        sets: 4\n        work: 7s\n        rest: 3min\n        grip: F3 open\n        edge: 20\n      - name: One-arm hang\n        sets: 6\n        work: 7s\n        rest: 2min\n        sides: L/R\n        grip: half crimp\n        edge: 22\n        hands: 1\n');
  const [a, b] = r.exercises;
  assert.deepEqual(a.grip, { type: 'f3-open', edge: 20 });
  assert.equal(C.gripText(a), '20 mm · Open hand 3 fingers');
  assert.equal(C.gripText(b), '22 mm · Half crimp · one hand');
  for (const [v, k] of [['Half crimp', 'half-crimp'], ['half-crimp', 'half-crimp'], ['F3 half crimp', 'f3-half'], ['open', 'open'], ['2 fingers front', 'f2-front'], ['boh', null]]) assert.equal(C.gripKey(v), k, v);
  const text = C.exportYaml(r.plan, Object.fromEntries(r.exercises.map(e => [e.id, e])));
  assert.match(text, /grip: Open hand 3 fingers\n {8}edge: 20\n/);
  assert.match(text, /grip: Half crimp\n {8}edge: 22\n {8}hands: 1\n/);
  assert.deepEqual(C.importYaml(text).exercises.map(e => e.grip), [a.grip, b.grip]);
  const bad = t => { try { C.importYaml('title: x\nweeks: 1\ndays:\n  - week: 1\n    day: mon\n    exercises:\n' + t); return []; } catch (e) { return e.errors; } };
  assert.match(bad('      - name: Pull-ups\n        sets: 3\n        reps: 6\n        grip: half crimp\n')[0], /only for Fingers exercises/);
  assert.match(bad('      - name: Max hang\n        sets: 3\n        work: 7s\n        grip: boh\n')[0], /grip: "boh" is not known/);
  assert.match(bad('      - name: Max hang\n        sets: 3\n        work: 7s\n        edge: 300\n')[0], /edge depth in mm/);
});

test('analisi: serie completate, massimali e gradi per periodo', () => {
  const logs = [
    { date: '2026-11-02', blocks: [{ sets: { done: 3, of: 4 } }], climbs: [{ surface: 'moon', top: '7A' }] },
    { date: '2026-11-20', blocks: [{ sets: { done: 4, of: 4 } }, { load: 10 }], climbs: [{ surface: 'moon', top: '7B' }, { surface: 'moon', top: '7A+' }, { surface: 'gym', top: '?' }] },
  ];
  assert.deepEqual(C.setsCompletion(logs, '2026-11-15', '2026-11-30'), { done: 4, of: 4, share: 1 });
  assert.equal(C.setsCompletion([], '2026-11-01', '2026-11-30').share, null, 'nessuna serie → nessuna percentuale');
  const g = C.gradeProgress(logs, '2026-11-15', '2026-11-30', '2026-11-01');
  assert.equal(g.length, 1, 'gradi non riconosciuti ignorati');
  assert.equal(C.GRADES[g[0].top], '7B'); assert.equal(C.GRADES[g[0].prev], '7A');
  const tests = [{ key: 'oh', date: '2026-10-01', value: 20 }, { key: 'oh', date: '2026-11-20', value: 25 }, { key: 'pinch', date: '2026-11-18', value: 30 }, { key: 'oh', date: '2026-12-10', value: 99 }];
  const p = Object.fromEntries(C.testProgress(tests, '2026-11-15', '2026-11-30').map(r => [r.key, r]));
  assert.equal(p.oh.latest, 25, 'valori dopo la fine del periodo esclusi'); assert.equal(p.oh.delta, 5); assert.equal(p.oh.points.length, 2);
  assert.equal(p.pinch.delta, null, 'un solo valore → nessuna variazione');
  const d = C.dailyGroups([], '2026-11-01', '2026-11-03');
  assert.deepEqual(d.map(x => x.date), ['2026-11-01', '2026-11-02', '2026-11-03']);
});

test('viaggi: pulizia di dati rotti, date approssimative, fasi e gruppi', () => {
  const t = C.cleanTrips([null, 'x', { name: '', from: '2027-02-30', to: 'boh', status: 'boh', projects: [null, { grade: 'Z', status: 'sent', sentOn: 'ieri', style: 'x' }], checklist: [{ text: '  ' }, { text: 'Pads', done: 1 }] }]);
  assert.equal(t.length, 1, 'voci non oggetto scartate');
  assert.deepEqual([t[0].name, t[0].from, t[0].to, t[0].status], ['Trip', '', '', 'idea'], 'data inesistente e stato sconosciuto ripuliti');
  assert.deepEqual([t[0].projects.length, t[0].projects[0].grade, t[0].projects[0].style, t[0].projects[0].sentOn], [1, '', 'boulder', ''], 'progetto con grado e data non validi');
  assert.equal(t[0].notes, 'Checklist:\n[x] Pads', 'checklist tolta: le voci passano nelle note, vuote scartate');
  assert.equal(C.cleanTrips([{ notes: 'Gîte', checklist: [{ text: 'Pads' }] }])[0].notes, 'Gîte\n\nChecklist:\n[ ] Pads', 'in fondo alle note esistenti');
  assert.equal('checklist' in t[0], false);
  assert.deepEqual(C.cleanTrips([{ status: 'possible' }, { status: 'dropped' }, { status: 'confirmed' }]).map(x => x.status), ['idea', 'idea', 'confirmed'], 'stati tolti: Possible e Dropped diventano Idea');
  assert.equal(C.cleanTrips([{ from: '2027-03', to: '2027-02' }])[0].to, '', 'fine prima dell\'inizio: resta solo l\'inizio');
  assert.deepEqual(C.cleanTrips(undefined), [], 'backup precedente ai viaggi');
  assert.equal(C.tripLast('2028-02'), '2028-02-29', 'un mese copre fino all\'ultimo giorno (anno bisestile)');
  const mk = (name, status, from, to) => C.cleanTrips([{ name, status, from, to }])[0];
  const today = '2026-11-25';
  const font = mk('Font', 'confirmed', '2027-03-14', '2027-03-28'), now = mk('Now', 'confirmed', '2026-11', ''), old = mk('Old', 'confirmed', '2026-10-01', '2026-10-05');
  const idea = mk('Idea', 'idea', '', ''), done = mk('Done', 'done', '2026-09', ''), maybe = mk('Maybe', 'idea', '2027-06', '');
  assert.equal(C.daysTo(font, today), 109); assert.equal(C.daysTo(now, today), 0, 'mese in corso: il viaggio è in corso');
  assert.equal(C.daysTo(old, today), null); assert.equal(C.daysTo(idea, today), null);
  assert.equal(C.nextTrip([font, now, old, maybe], today).name, 'Now', 'prossimo: quello in corso prima di quelli futuri');
  assert.equal(C.nextTrip([font, maybe], today).name, 'Font', 'il più vicino');
  assert.equal(C.nextTrip([maybe, idea, done], today).name, 'Maybe', 'anche i possibili; mai idee o conclusi');
  const soon = mk('Soon', 'idea', '2027-01-10', ''), same = mk('Same', 'idea', '2027-03-14', '');
  assert.equal(C.nextTrip([font, soon], today).name, 'Soon', 'un possibile più vicino passa davanti al confermato');
  assert.equal(C.nextTrip([same, font], today).name, 'Font', 'a parità di data, il confermato');
  assert.equal(C.nextTrip([idea, old], today), null);
  const g = C.groupTrips([idea, done, font, old, maybe, now], today);
  assert.deepEqual(g.upcoming.map(x => x.name), ['Now', 'Font']);
  assert.deepEqual(g.ideas.map(x => x.name), ['Maybe', 'Idea'], 'idee datate prima, senza date in fondo');
  assert.deepEqual(g.archive.map(x => x.name), ['Old', 'Done'], 'confermato già finito in archivio, dal più recente');
  assert.deepEqual(C.tripProgress(C.cleanTrips([{ projects: [{ status: 'sent', sentOn: '2027-03-20' }, {}] }])[0]), { sent: 1, total: 2 });
});

test('countdown: anello che si riempie da quando il viaggio è confermato, giorno corrente durante il viaggio', () => {
  const mk = (from, to, since) => C.cleanTrips([{ status: 'confirmed', from, to, since }], '2026-11-25')[0];
  const f = C.tripCountdown(mk('2027-03-14', '2027-03-28', '2026-09-25'), '2026-11-25');
  assert.equal(f.days, 109); assert.equal(f.now, false); assert.ok(Math.abs(f.fill - (1 - 109 / 170)) < 1e-9);
  assert.equal(C.tripCountdown(mk('2027-03-14', '', ''), '2026-11-25').fill, 0, 'confermato oggi: anello vuoto');
  assert.equal(mk('2027-03-14', '', '').since, '2026-11-25', 'senza data di conferma vale da oggi');
  const m = C.tripCountdown(mk('2027-03', '', '2026-11-25'), '2026-11-25');
  assert.equal(m.approx, true); assert.equal(m.days, 96, 'solo il mese: si conta dal primo del mese');
  const n = C.tripCountdown(mk('2026-11-20', '2026-11-29', '2026-10-01'), '2026-11-25');
  assert.deepEqual([n.now, n.day, n.length, n.fill], [true, 6, 10, 0.6]);
  assert.equal(C.tripCountdown(mk('2026-10-01', '2026-10-05', ''), '2026-11-25'), null, 'viaggio finito');
  assert.equal(C.tripCountdown(C.cleanTrips([{ status: 'idea' }])[0], '2026-11-25'), null, 'senza date');
});
