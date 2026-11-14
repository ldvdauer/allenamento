/* Logica pura dell'app (nessun DOM): modello dati, import/export .blokplan, passi del player, carichi.
   Funziona sia nel browser (window.Core) sia in Node (module.exports) per i test. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_TYPES = { wall: 'Muro', strength: 'Fuori muro', skills: 'Tecnica', activeRest: 'Riposo attivo', setting: 'Tracciatura', rest: 'Recupero' };
  const PERIODS = { base: 'Base', strength: 'Forza', power: 'Potenza', powerEndurance: 'Resistenza alla potenza', endurance: 'Resistenza', performance: 'Prestazione', deload: 'Scarico' };
  const SLOTS = { warmup: 'Riscaldamento', strength: 'Forza', wall: 'Sul muro', mobility: 'Mobilità' };
  const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
  // Massimali/test predefiniti. `mode: hang` = zavorra aggiunta al peso corporeo, `lift` = carico sollevato.
  const DEFAULT_TESTS = [
    { key: 'bw', name: 'Peso corporeo', unit: 'kg' },
    { key: 'oh', name: 'Open hand 20 mm 7" · zavorra max', unit: 'kg' },
    { key: 'hc', name: 'Half-crimp 20 mm 7" · zavorra max', unit: 'kg' },
    { key: 'sl', name: 'Sloper BM2000 7" · zavorra max', unit: 'kg' },
    { key: 'pinchL', name: 'Pinch block 7" SX · max', unit: 'kg' },
    { key: 'pinchR', name: 'Pinch block 7" DX · max', unit: 'kg' },
    { key: 'wrist', name: 'Flessione polso 6RM', unit: 'kg' },
  ];

  // Scala dei gradi boulder. I dati salvano l'etichetta Font; `fmtGrade` è l'unico punto in cui si sceglie la scala mostrata.
  const GRADES = ['4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'];
  const GRADE_SCALES = { font: 'Font' };
  const gradeIdx = g => (g == null ? -1 : GRADES.indexOf(g));
  const fmtGrade = (g, scale) => (g == null ? '' : scale && scale !== 'font' ? g : g); // altre scale: da aggiungere qui
  // Superfici di arrampicata predefinite; l'utente può aggiungerne altre.
  const DEFAULT_SURFACES = [
    { key: 'moonboard', name: 'MoonBoard' }, { key: 'kilter', name: 'Kilter Board' }, { key: 'tension', name: 'Tension Board' },
    { key: 'gym', name: 'Indoor (palestra)' }, { key: 'outdoor', name: 'Outdoor (roccia)' },
  ];
  /** Superficie deducibile dal nome dell'esercizio (solo i casi ovvi), altrimenti stringa vuota. */
  function inferSurface(name) {
    const n = name || '';
    if (/moon\s?board/i.test(n)) return 'moonboard';
    if (/kilter/i.test(n)) return 'kilter';
    if (/tension/i.test(n)) return 'tension';
    if (/outdoor|roccia|falesia/i.test(n)) return 'outdoor';
    return '';
  }

  const uid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });

  /* ---- Date (stringhe ISO locali YYYY-MM-DD: niente fusi orari nei dati) ---- */
  const pad = n => String(n).padStart(2, '0');
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const todayISO = () => toISO(new Date());
  const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const diffDays = (a, b) => Math.round((fromISO(a) - fromISO(b)) / 864e5);
  const appleToISO = sec => toISO(new Date(APPLE_EPOCH_MS + sec * 1000));
  const isoToApple = iso => Math.round((fromISO(iso).getTime() - APPLE_EPOCH_MS) / 1000);
  /** Data ISO valida e normalizzata, oppure null. */
  const validISO = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') && toISO(fromISO(s)) === s ? s : null); // rifiuta anche date inesistenti (30 febbraio)
  const mondayOf = iso => { const d = fromISO(iso); return addDays(iso, -((d.getDay() + 6) % 7)); };

  /* ---- Carichi ---- */
  const num = s => parseFloat(String(s).replace(',', '.'));
  /** Deduce massimale di riferimento e % da nome e prescrizione (convenzione: "Open hand … · 85% max"). */
  function inferLoad(name, prescription) {
    const n = name || '';
    let ref = null, mode = 'hang';
    if (/open hand/i.test(n)) ref = 'oh';
    else if (/half.?crimp/i.test(n)) ref = 'hc';
    else if (/sloper bm/i.test(n)) ref = 'sl';
    else if (/pinch/i.test(n)) { ref = 'pinch'; mode = 'lift'; }
    else if (/polso/i.test(n)) { ref = 'wrist'; mode = 'lift'; }
    if (!ref) return null;
    const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(prescription || '');
    return { ref, mode, pct: m ? num(m[1]) : null, test: /^TEST/i.test(n) };
  }
  /** Chiave del massimale per un cue (il pinch dipende dal lato SX/DX). */
  function loadKey(load, cue) {
    if (!load) return null;
    if (load.ref !== 'pinch') return load.ref;
    return /^\s*DX/i.test(cue || '') ? 'pinchR' : 'pinchL';
  }
  /** Carico in kg arrotondato a 0,5: zavorra (può essere negativa = scarico) o carico sollevato. */
  function loadKg(load, cue, maxes) {
    if (!load || load.pct == null) return null;
    const max = maxes[loadKey(load, cue)];
    if (max == null || isNaN(max)) return null;
    if (load.mode === 'lift') return Math.round(max * load.pct / 100 * 2) / 2;
    if (maxes.bw == null || isNaN(maxes.bw)) return null;
    return Math.round(((maxes.bw + max) * load.pct / 100 - maxes.bw) * 2) / 2;
  }
  /** Ultimo valore registrato per ogni test = massimale corrente. */
  function latestMaxes(tests) {
    const out = {}, when = {};
    for (const t of tests || []) {
      if (!(t.key in when) || t.date >= when[t.key]) { when[t.key] = t.date; out[t.key] = t.value; }
    }
    return out;
  }
  const fmtKg = kg => (kg > 0 ? '+' : '') + String(kg).replace('.', ',') + ' kg';

  /* ---- Timer ---- */
  const cycle = a => { // periodo minimo di un array ripetuto
    for (let k = 1; k <= a.length; k++) if (a.length % k === 0 && a.every((v, i) => v === a[i % k])) return a.slice(0, k);
    return a;
  };
  const cueAt = (iv, i) => (iv && iv.cues && iv.cues.length ? iv.cues[i % iv.cues.length] : '');
  const restAfter = (iv, r) => (iv.roundsPerSet && iv.setRestSeconds && (r + 1) % iv.roundsPerSet === 0 ? iv.setRestSeconds : iv.restSeconds || 0);
  function intervalMinutes(iv) {
    if (!iv) return 0;
    let s = iv.rounds * iv.workSeconds;
    for (let r = 0; r < iv.rounds - 1; r++) s += restAfter(iv, r);
    return Math.ceil(s / 60);
  }
  /** Sequenza lineare di passi per il player. `blocks`: [{exId, minutes}], `exMap`: id → esercizio. */
  function buildSteps(blocks, exMap, prepSeconds) {
    const steps = [];
    const prep = prepSeconds == null ? 10 : prepSeconds;
    blocks.forEach((b, bi) => {
      const ex = exMap[b.exId];
      if (!ex) return;
      const base = { block: bi, exId: ex.id, name: ex.name };
      const iv = ex.interval;
      if (!iv || !iv.rounds) {
        steps.push({ ...base, kind: 'free', seconds: (b.minutes || 0) * 60, cue: ex.prescription || '', round: 1, rounds: 1 });
        return;
      }
      for (let r = 0; r < iv.rounds; r++) {
        const timed = !iv.selfPaced;
        const prev = steps[steps.length - 1];
        if (timed && prep > 0 && (!prev || prev.kind !== 'rest'))
          steps.push({ ...base, kind: 'rest', prep: true, seconds: prep, cue: cueAt(iv, r), round: r + 1, rounds: iv.rounds });
        steps.push({ ...base, kind: 'work', selfPaced: !!iv.selfPaced, seconds: iv.workSeconds || 0, reps: iv.reps || null, cue: cueAt(iv, r), round: r + 1, rounds: iv.rounds });
        const last = r === iv.rounds - 1;
        const rest = last ? iv.restSeconds || 0 : restAfter(iv, r);
        const hasNext = !last || blocks.slice(bi + 1).some(x => exMap[x.exId]);
        if (rest > 0 && hasNext)
          steps.push({ ...base, kind: 'rest', seconds: rest, cue: last ? '' : cueAt(iv, r + 1), round: r + 1, rounds: iv.rounds, afterBlock: last });
      }
    });
    return steps;
  }

  /* ---- Import / export .blokplan ---- */
  const str = (v, d) => (typeof v === 'string' ? v.slice(0, 200) : d);
  const int = v => (Number.isFinite(+v) && +v >= 0 ? Math.round(+v) : 0);
  function normInterval(iv) {
    if (!iv || typeof iv !== 'object' || !int(iv.rounds)) return null;
    const out = { rounds: int(iv.rounds), workSeconds: int(iv.workSeconds), restSeconds: int(iv.restSeconds) };
    if (iv.selfPaced) out.selfPaced = true;
    if (int(iv.reps)) out.reps = int(iv.reps);
    if (int(iv.roundsPerSet)) { out.roundsPerSet = int(iv.roundsPerSet); out.setRestSeconds = int(iv.setRestSeconds); }
    out.cues = Array.isArray(iv.cues) ? cycle(iv.cues.map(c => str(c, ''))) : [];
    return out;
  }
  function normExercise(b) {
    const name = str(b.name, 'Esercizio');
    const prescription = str(b.prescription, str(b.summary, ''));
    return {
      name, prescription,
      slot: SLOTS[b.slot] ? b.slot : 'strength',
      location: b.location === 'wall' ? 'wall' : 'off_wall',
      domain: str(b.domain, 'other'), intensity: str(b.intensity, 'moderate'), risk: str(b.risk, 'low'),
      equipment: Array.isArray(b.equipment) ? b.equipment.map(e => str(e, '')).filter(Boolean) : [],
      interval: normInterval(b.interval),
      load: inferLoad(name, prescription),
      surface: inferSurface(name),
    };
  }
  /** Converte un .blokplan in { plan, exercises }. Lancia Error se il file non è valido.
      Gli esercizi identici vengono deduplicati; `existing` (id → esercizio) permette di riusare la libreria. */
  function importBlokplan(obj, existing) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.weeks) || !obj.weeks.length) throw new Error('Il file non è un piano Blok Sessions valido.');
    const byKey = new Map(), exercises = [];
    const keyOf = e => JSON.stringify([e.name, e.prescription, e.slot, e.location, e.interval]);
    for (const e of Object.values(existing || {})) byKey.set(keyOf(e), e.id);
    const blocksOf = list => (Array.isArray(list) ? list : []).filter(pb => pb && pb.block).map(pb => {
      const e = normExercise(pb.block), k = keyOf(e);
      if (!byKey.has(k)) { e.id = uid(); byKey.set(k, e.id); exercises.push(e); }
      return { id: uid(), exId: byKey.get(k), minutes: int(pb.selectedDurationMinutes || pb.block.defaultMinutes) };
    });
    const weeks = obj.weeks.map(w => {
      if (!Array.isArray(w)) throw new Error('Settimana non valida nel file.');
      const days = w.slice(0, 7).map(d => {
        const sessions = [];
        if (d && DAY_TYPES[d.type] && d.type !== 'rest')
          sessions.push({ id: uid(), type: d.type, period: PERIODS[d.period] ? d.period : 'base', blocks: blocksOf(d.plannedBlocks) });
        if (d && d.secondType && DAY_TYPES[d.secondType])
          sessions.push({ id: uid(), type: d.secondType, period: PERIODS[d.secondPeriod] ? d.secondPeriod : 'base', blocks: blocksOf(d.secondPlannedBlocks) });
        // Un giorno = una sessione: la seconda sessione di Blok (es. il conditioning) si accoda alla prima.
        return { sessions: sessions.length > 1 ? [{ ...sessions[0], blocks: sessions.flatMap(x => x.blocks) }] : sessions };
      });
      while (days.length < 7) days.push({ sessions: [] });
      return days;
    });
    const startDate = Number.isFinite(obj.startDate) ? mondayOf(appleToISO(obj.startDate)) : mondayOf(todayISO());
    return { plan: { id: uid(), title: str(obj.title, 'Piano importato'), startDate, weeks }, exercises };
  }
  function exportBlokplan(plan, exMap) {
    const allPeriods = Object.keys(PERIODS);
    const pb = b => {
      const e = exMap[b.exId];
      if (!e) return null;
      const block = {
        id: 'custom-' + e.id.toUpperCase(), sourceName: 'Climber', name: e.name, slot: e.slot, location: e.location,
        domain: e.domain, goals: [], equipment: e.equipment || [], durations: [b.minutes], defaultMinutes: b.minutes,
        intensity: e.intensity, risk: e.risk, periodTags: allPeriods, summary: e.prescription, prescription: e.prescription,
        source: 'Custom', reviewNeeded: false,
      };
      if (e.interval) {
        const iv = { ...e.interval };
        iv.cues = iv.cues && iv.cues.length ? Array.from({ length: Math.min(iv.rounds, 20) }, (_, i) => cueAt(e.interval, i)) : [];
        block.interval = iv;
      }
      return { id: uid().toUpperCase(), selectedDurationMinutes: b.minutes, block };
    };
    const weeks = plan.weeks.map(w => w.map(d => {
      const [a, b] = d.sessions; // Blok supporta al massimo due sessioni al giorno
      if (!a) return { type: 'rest' };
      const out = { type: a.type, period: a.period, plannedBlocks: a.blocks.map(pb).filter(Boolean) };
      if (b) Object.assign(out, { secondType: b.type, secondPeriod: b.period, secondPlannedBlocks: b.blocks.map(pb).filter(Boolean) });
      return out;
    }));
    return { title: plan.title, isForSelf: true, athleteName: 'Climber', startDate: isoToApple(plan.startDate), weeks };
  }

  /* ---- Piano ---- */
  /** Posizione di una data nel piano: { w, d } oppure null se fuori dal piano. */
  function locate(plan, iso) {
    const n = diffDays(iso, plan.startDate);
    if (n < 0 || n >= plan.weeks.length * 7) return null;
    return { w: Math.floor(n / 7), d: n % 7 };
  }
  const dateOf = (plan, w, d) => addDays(plan.startDate, w * 7 + d);
  const sessionMinutes = s => s.blocks.reduce((t, b) => t + (b.minutes || 0), 0);
  // Le copie hanno id nuovi: una sessione copiata non eredita lo stato "fatta" dell'originale.
  const cloneSession = s => ({ ...s, id: uid(), blocks: s.blocks.map(b => ({ ...b, id: uid() })) });
  const cloneDay = day => ({ sessions: day.sessions.map(cloneSession) });
  const emptyWeek = () => Array.from({ length: 7 }, () => ({ sessions: [] }));
  function usage(plans, exId) {
    let n = 0;
    for (const p of plans) for (const w of p.weeks) for (const d of w) for (const s of d.sessions) for (const b of s.blocks) if (b.exId === exId) n++;
    return n;
  }
  /** Validazione minima di un backup completo. */
  function validState(s) {
    return !!s && typeof s === 'object' && Array.isArray(s.plans) && s.exercises && typeof s.exercises === 'object' &&
      Array.isArray(s.logs) && Array.isArray(s.tests) && s.plans.every(p => p && typeof p.startDate === 'string' && Array.isArray(p.weeks) &&
        p.weeks.every(w => Array.isArray(w) && w.every(d => d && Array.isArray(d.sessions) && d.sessions.every(x => x && Array.isArray(x.blocks)))));
  }

  /* ---- Analisi: aggregazioni pure sul diario ---- */
  /** Estremi "puliti" per un asse: { min, max, step } con passi 1 / 2 / 2,5 / 5 × 10^n. */
  function niceRange(lo, hi, n) {
    n = n || 3;
    if (!(hi > lo)) { hi = lo + 1; lo = lo >= 0 && lo < 1 ? 0 : lo - 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw - 1e-12) * mag;
    return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
  }
  /** Sessioni in programma: piano attivo + sessioni extra legate a una data (quelle senza esercizi non contano). */
  function scheduled(plan, extras) {
    const out = [];
    if (plan) plan.weeks.forEach((wk, w) => wk.forEach((day, d) => day.sessions.forEach(s => {
      if (s.blocks.length) out.push({ sid: s.id, date: dateOf(plan, w, d), minutes: sessionMinutes(s), type: s.type });
    })));
    for (const x of extras || []) if (x.blocks.length) out.push({ sid: x.id, date: x.date, minutes: sessionMinutes(x), type: x.type });
    return out;
  }
  /** Statistiche per settimana (lun–dom) dalla settimana di `from` a quella di `to`. `load` = carico sRPE (minuti × RPE). */
  function weeklyStats(logs, sched, from, to) {
    const start = mondayOf(from), acc = [];
    for (let m = start; m <= to; m = addDays(m, 7)) acc.push({ week: m, sessions: 0, minutes: 0, load: 0, rpeSum: 0, rpeN: 0, feelSum: 0, feelN: 0, plannedMinutes: 0, plannedSessions: 0 });
    const at = iso => (iso >= start ? acc[Math.floor(diffDays(iso, start) / 7)] : undefined);
    for (const l of logs || []) {
      const w = at(l.date);
      if (!w) continue;
      w.sessions++; w.minutes += l.minutes || 0;
      if (l.rpe != null) { w.rpeSum += l.rpe; w.rpeN++; w.load += (l.minutes || 0) * l.rpe; }
      if (l.feel != null) { w.feelSum += l.feel; w.feelN++; }
    }
    for (const s of sched || []) { const w = at(s.date); if (w) { w.plannedMinutes += s.minutes; w.plannedSessions++; } }
    return acc.map(w => ({ week: w.week, sessions: w.sessions, minutes: w.minutes, load: w.load, rpe: w.rpeN ? w.rpeSum / w.rpeN : null,
      feel: w.feelN ? w.feelSum / w.feelN : null, plannedMinutes: w.plannedMinutes, plannedSessions: w.plannedSessions }));
  }
  /** Totali del periodo e aderenza: sessioni in programma fino a oggi che hanno una registrazione nel diario. */
  function summary(logs, sched, from, to, today) {
    const inR = (logs || []).filter(l => l.date >= from && l.date <= to);
    const done = new Set((logs || []).map(l => l.sid).filter(Boolean));
    const until = to < today ? to : today;
    const due = (sched || []).filter(s => s.date >= from && s.date <= until);
    const avg = k => { const a = inR.filter(l => l[k] != null); return a.length ? a.reduce((t, l) => t + l[k], 0) / a.length : null; };
    return { sessions: inR.length, minutes: inR.reduce((t, l) => t + (l.minutes || 0), 0), rpe: avg('rpe'), rpeN: inR.filter(l => l.rpe != null).length, feel: avg('feel'),
      due: due.length, dueDone: due.filter(s => done.has(s.sid)).length };
  }
  /** Minuti e sessioni per tipo di sessione, dal più grande. */
  function minutesByType(logs, from, to) {
    const m = new Map();
    for (const l of logs || []) {
      if (l.date < from || l.date > to) continue;
      const k = DAY_TYPES[l.type] ? l.type : 'other', o = m.get(k) || { type: k, minutes: 0, sessions: 0 };
      o.minutes += l.minutes || 0; o.sessions++; m.set(k, o);
    }
    return [...m.values()].sort((a, b) => b.minutes - a.minutes || a.type.localeCompare(b.type));
  }
  /** "SX 15 kg · DX 18 kg" → [{side:'SX',kg:15},{side:'DX',kg:18}]; "+4,5 kg" → [{side:null,kg:4.5}]. */
  function parseLoads(text) {
    const out = [];
    for (const part of String(text == null ? '' : text).split(/[·;/]/)) {
      const m = /[+-]?\d+(?:[.,]\d+)?/.exec(part);
      if (!m) continue;
      const side = /\b(SX|DX)\b/i.exec(part);
      out.push({ side: side ? side[1].toUpperCase() : null, kg: num(m[0]) });
    }
    return out;
  }
  /** Carichi registrati nel diario: una serie per esercizio (e per lato), in ordine di data. */
  function loadSeries(logs, from, to) {
    const m = new Map();
    for (const l of [...(logs || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
      if (l.date < from || l.date > to) continue;
      for (const x of l.loads || []) for (const p of parseLoads(x.kg)) {
        const name = x.name + (p.side ? ' ' + p.side : '');
        if (!m.has(name)) m.set(name, []);
        m.get(name).push({ date: l.date, kg: p.kg });
      }
    }
    return [...m.entries()].map(([name, points]) => ({ name, points })).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Per superficie: minuti, sessioni, blocchi chiusi e grado massimo chiuso nel periodo. */
  function surfaceStats(logs, from, to) {
    const m = new Map();
    for (const l of logs || []) {
      if (l.date < from || l.date > to) continue;
      const seen = new Set();
      for (const c of l.climbs || []) {
        if (!c.surface) continue;
        const o = m.get(c.surface) || { surface: c.surface, minutes: 0, sessions: 0, sends: 0, top: -1 };
        o.minutes += c.minutes || 0; o.sends += c.sends || 0; o.top = Math.max(o.top, gradeIdx(c.top));
        if (!seen.has(c.surface)) { seen.add(c.surface); o.sessions++; }
        m.set(c.surface, o);
      }
    }
    return [...m.values()].map(o => ({ ...o, top: o.top >= 0 ? GRADES[o.top] : null })).sort((a, b) => b.minutes - a.minutes || a.surface.localeCompare(b.surface));
  }
  /** Grado massimo chiuso per settimana: { weeks, series: { superficie: [indice nella scala | null] } }. */
  function weeklyTopGrades(logs, from, to) {
    const start = mondayOf(from), weeks = [], series = {};
    for (let w = start; w <= to; w = addDays(w, 7)) weeks.push(w);
    for (const l of logs || []) {
      if (l.date < start) continue;
      const i = Math.floor(diffDays(l.date, start) / 7);
      if (i >= weeks.length) continue;
      for (const c of l.climbs || []) {
        const g = gradeIdx(c.top);
        if (!c.surface || g < 0) continue;
        const s = series[c.surface] || (series[c.surface] = weeks.map(() => null));
        s[i] = s[i] == null ? g : Math.max(s[i], g);
      }
    }
    return { weeks, series };
  }

  return {
    DAY_TYPES, PERIODS, SLOTS, DEFAULT_TESTS, GRADES, GRADE_SCALES, gradeIdx, fmtGrade, DEFAULT_SURFACES, inferSurface, validISO, uid, toISO, fromISO, todayISO, addDays, diffDays, appleToISO, isoToApple, mondayOf,
    inferLoad, loadKey, loadKg, latestMaxes, fmtKg, cycle, cueAt, intervalMinutes, buildSteps, normInterval,
    importBlokplan, exportBlokplan, locate, dateOf, sessionMinutes, cloneSession, cloneDay, emptyWeek, usage, validState,
    niceRange, scheduled, weeklyStats, summary, minutesByType, parseLoads, loadSeries, surfaceStats, weeklyTopGrades,
  };
});
