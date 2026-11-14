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
  const mondayOf = iso => { const d = fromISO(iso); return addDays(iso, -((d.getDay() + 6) % 7)); };

  /* ---- Carichi ---- */
  const num = s => parseFloat(String(s).replace(',', '.'));
  /** Deduce massimale di riferimento e % da nome e prescrizione (formato usato nei piani di Leo). */
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
          sessions.push({ type: d.type, period: PERIODS[d.period] ? d.period : 'base', blocks: blocksOf(d.plannedBlocks) });
        if (d && d.secondType && DAY_TYPES[d.secondType])
          sessions.push({ type: d.secondType, period: PERIODS[d.secondPeriod] ? d.secondPeriod : 'base', blocks: blocksOf(d.secondPlannedBlocks) });
        return { sessions };
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
  const cloneDay = day => ({ sessions: day.sessions.map(s => ({ ...s, blocks: s.blocks.map(b => ({ ...b, id: uid() })) })) });
  const emptyWeek = () => Array.from({ length: 7 }, () => ({ sessions: [] }));
  function usage(plans, exId) {
    let n = 0;
    for (const p of plans) for (const w of p.weeks) for (const d of w) for (const s of d.sessions) for (const b of s.blocks) if (b.exId === exId) n++;
    return n;
  }
  /** Validazione minima di un backup completo. */
  function validState(s) {
    return !!s && typeof s === 'object' && Array.isArray(s.plans) && s.exercises && typeof s.exercises === 'object' &&
      Array.isArray(s.logs) && Array.isArray(s.tests) && s.plans.every(p => p && Array.isArray(p.weeks) && typeof p.startDate === 'string');
  }

  return {
    DAY_TYPES, PERIODS, SLOTS, DEFAULT_TESTS, uid, toISO, fromISO, todayISO, addDays, diffDays, appleToISO, isoToApple, mondayOf,
    inferLoad, loadKey, loadKg, latestMaxes, fmtKg, cycle, cueAt, intervalMinutes, buildSteps, normInterval,
    importBlokplan, exportBlokplan, locate, dateOf, sessionMinutes, cloneDay, emptyWeek, usage, validState,
  };
});
