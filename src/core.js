/* Logica pura dell'app (nessun DOM): modello dati, programmi in YAML, passi del player, carichi.
   Funziona sia nel browser (window.Core) sia in Node (module.exports) per i test. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./vendor/js-yaml.min.js'));
  else root.Core = factory(() => root.jsyaml);
})(typeof self !== 'undefined' ? self : this, function (YAML_LIB) {
  'use strict';

  const DAY_TYPES = { wall: 'Wall', strength: 'Off the wall', skills: 'Technique', activeRest: 'Active rest', setting: 'Setting', rest: 'Rest' };
  const PERIODS = { base: 'Base', strength: 'Strength', power: 'Power', powerEndurance: 'Power endurance', endurance: 'Endurance', performance: 'Performance', deload: 'Deload' };
  const SLOTS = { warmup: 'Warm-up', strength: 'Strength', wall: 'On the wall', mobility: 'Mobility' };
  // Massimali/test predefiniti. `mode: hang` = zavorra aggiunta al peso corporeo, `lift` = carico sollevato.
  /* Test: ogni test ha i suoi parametri. `mode`: hang = zavorra aggiunta al peso corporeo, lift = carico sollevato,
     value = valore libero (secondi, kg di peso corporeo…). L'ultimo risultato è il massimale usato per calcolare i kg. */
  const TEST_TEMPLATES = [
    { key: 'bw', name: 'Body weight', unit: 'kg', mode: 'value' },
    { key: 'oh', name: 'Open hand', unit: 'kg', mode: 'hang', edge: 20, seconds: 7, hands: 2 },
    { key: 'hc', name: 'Half-crimp', unit: 'kg', mode: 'hang', edge: 20, seconds: 7, hands: 2 },
    { key: 'sl', name: 'Sloper', unit: 'kg', mode: 'hang', seconds: 7, hands: 2 },
    { key: 'pinchL', name: 'Pinch block L', unit: 'kg', mode: 'lift', seconds: 7, hands: 1 },
    { key: 'pinchR', name: 'Pinch block R', unit: 'kg', mode: 'lift', seconds: 7, hands: 1 },
    { key: 'liftL', name: 'Max lift L', unit: 'kg', mode: 'lift', edge: 20, seconds: 7, hands: 1 },
    { key: 'liftR', name: 'Max lift R', unit: 'kg', mode: 'lift', edge: 20, seconds: 7, hands: 1 },
    { key: 'wrist', name: 'Wrist curl', unit: 'kg', mode: 'lift', reps: 6 },
    { key: 'pull', name: 'Weighted pull-up', unit: 'kg', mode: 'hang', reps: 2 },
    { key: 'onearm', name: 'One-arm hang', unit: 's', mode: 'value', edge: 22, hands: 1 },
  ];
  /** Parametri di un test in una riga: "20 mm · 7" · zavorra". */
  const testLabel = d => [d.edge ? d.edge + ' mm' : '', d.seconds ? d.seconds + '"' : '', d.reps ? d.reps + 'RM' : '', d.hands === 1 ? 'one hand' : '',
    d.mode === 'hang' ? 'added weight' : d.mode === 'lift' ? 'load lifted' : ''].filter(Boolean).join(' · ');

  /* Libreria standard: ogni esercizio del calendario è una versione personalizzata di uno di questi.
     Riga: chiave | sezione | nome | minuti | timer. Timer: "t:round/lavoro/recupero" a tempo, "r:round/rip/recupero" a ripetizioni,
     "+serie/recuperoSerie" per le serie raggruppate, "=cue~cue" per i cue a rotazione; vuoto = solo durata. */
  const SECTIONS = { warmup: 'Warm-up', fingers: 'Fingers', pull: 'Pulling', strength: 'General strength and antagonists', core: 'Core', wall: 'On the wall', mobility: 'Mobility and recovery', mental: 'Mental' };
  const LIBRARY = `warmup-general|warmup|General warm-up|15|
warmup-wall|warmup|Wall warm-up|20|
warmup-fingers|warmup|Finger activation|6|t:5/7/60
warmup-shoulders|warmup|Shoulder activation with band|5|r:2/15/45
max-hang|fingers|Max hang|13|t:4/7/180
repeaters|fingers|Repeaters 7/3|14|t:24/7/3+6/180
min-edge|fingers|Minimum edge|13|t:4/7/180
one-arm-hang|fingers|One-arm hang|14|t:6/7/120=L~R
sloper-hang|fingers|Sloper hang|13|t:4/7/180
pinch-lift|fingers|Pinch block|8|t:6/7/75=L~R
block-lift|fingers|Max lift|13|t:6/7/120=L~R
density-hang|fingers|Long hangs|9|t:4/30/120
wrist-curl|fingers|Wrist curl|7|r:3/6/120
finger-ext|fingers|Finger extensors|4|r:2/15/45
weighted-pullup|pull|Weighted pull-ups|9|r:3/4/180
pullup|pull|Pull-ups|7|r:3/6/120
one-arm-pull|pull|One-arm pull-up (progression)|14|r:6/2/150=L~R
lockoff|pull|Lock-offs|9|t:6/7/90=L~R
row|pull|Rows|6|r:3/8/90
campus|pull|Campus board|12|r:5/1/150
pushup|strength|Push-ups or dips|7|r:3/8/120
press|strength|Overhead press|7|r:3/6/120=L~R
ext-rot|strength|External rotations|4|r:2/12/60
fly|strength|Flys (compression)|6|r:3/8/90
iso-fly|strength|Isometric flys|4|t:3/10/60
nordic|strength|Nordic curl|7|r:3/5/120
deadlift|strength|Deadlift|10|r:3/5/180
squat|strength|Squat or pistol|7|r:3/6/120
hollow|core|Hollow body hold|4|t:3/25/60
ab-wheel|core|Ab wheel|6|r:3/6/90
pallof|core|Pallof press|7|r:6/10/45=L~R
leg-raise|core|Hanging leg raise|6|r:3/8/90
front-lever|core|Front lever (progression)|9|t:4/6/120
plank|core|Plank|5|t:3/40/60
limit|wall|Limit bouldering|40|
project|wall|Project|45|
board|wall|Board benchmark|40|
flash|wall|Flash set|60|r:18/0/120+3/300
volume|wall|Volume|40|
technique|wall|Technique: isolated move|8|r:6/1/60=L~R
four-by-four|wall|4x4|25|r:16/1/30+4/240
circuit|wall|Endurance circuits|30|
outdoor|wall|Rock|120|
activation|wall|Activation session|30|
hips|mobility|Hip mobility|10|
shoulders|mobility|Shoulder mobility|8|
stretch|mobility|General stretching|10|
butterfly|mobility|Butterfly stretch|5|
side-split|mobility|Side split|5|
frog|mobility|Frog stretch|5|
biceps-stretch|mobility|Biceps stretch|5|
cooldown|mobility|Cool-down|10|
visualize|mental|Project visualisation|5|
review|mental|Attempt review|10|`.split('\n').map(line => {
    const [key, section, name, minutes, timer] = line.split('|');
    let interval = null;
    if (timer) {
      const [main, cues] = timer.split('='), [base, set] = main.split('+'), [rounds, x, rest] = base.slice(2).split('/').map(Number), reps = base[0] === 'r';
      interval = { rounds, workSeconds: reps ? 45 : x, restSeconds: rest, cues: cues ? cues.split('~') : [] };
      if (reps) { interval.selfPaced = true; if (x) interval.reps = x; }
      if (set) { const [per, sr] = set.split('/').map(Number); interval.roundsPerSet = per; interval.setRestSeconds = sr; }
    }
    return { key, section, name, minutes: +minutes, interval };
  });
  const STD = Object.fromEntries(LIBRARY.map(x => [x.key, x]));
  const SECTION_SLOT = { warmup: 'warmup', wall: 'wall', mobility: 'mobility', mental: 'mobility' };
  /** Nuova versione di un esercizio standard, con i valori predefiniti (senza id). `base` resta vero finché non la personalizzi. */
  function stdVariant(key) {
    const d = STD[key];
    if (!d) return null;
    const slot = SECTION_SLOT[d.section] || 'strength';
    return { std: key, base: true, name: d.name, prescription: '', slot, location: slot === 'wall' || slot === 'warmup' ? 'wall' : 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low',
      equipment: [], interval: d.interval ? JSON.parse(JSON.stringify(d.interval)) : null, load: null, surface: '', minutes: d.minutes };
  }
  // Riconduce un nome libero (es. da un programma importato) all'esercizio standard. L'ordine conta: le regole più specifiche prima.
  const STD_RULES = [[/^test\b/i, 'test'], [/limit|progett|\bproject/i, 'limit'], [/flash|\btriples?\b|triplett/i, 'flash'], [/pallof/i, 'pallof'], [/tallone|ristabilimento|compressione su|tecnic|movimento isolato|techni|isolated move|heel hook|mantle/i, 'technique'],
    [/a bleau|roccia|outdoor|\brock\b/i, 'outdoor'], [/attivazione dita|finger activation/i, 'warmup-fingers'], [/attivazione|activation/i, 'activation'], [/riscaldamento|warm.?up/i, 'warmup-wall'], [/open hand|half.?crimp|max hang/i, 'max-hang'], [/repeater/i, 'repeaters'],
    [/sloper/i, 'sloper-hang'], [/pinch/i, 'pinch-lift'], [/\blift\b/i, 'block-lift'], [/polso|wrist/i, 'wrist-curl'], [/trazion\w* zavorr|weighted pull/i, 'weighted-pullup'], [/trazion|pull.?up/i, 'pullup'], [/bloccagg|lock.?off/i, 'lockoff'],
    [/campus/i, 'campus'], [/\bpress\b/i, 'press'], [/extrarot|external rot/i, 'ext-rot'], [/croci isometr|isometric fl/i, 'iso-fly'], [/croci|\bfl(y|ys|ies)\b/i, 'fly'], [/nordic/i, 'nordic'], [/hollow/i, 'hollow'], [/ab wheel/i, 'ab-wheel'], [/leg.?raise/i, 'leg-raise'],
    [/pallof/i, 'pallof'], [/push.?up|\bdip/i, 'pushup'], [/plank/i, 'plank'], [/front lever/i, 'front-lever'], [/mobilit.* anche|hip mobility/i, 'hips'], [/mobilit.* spall|shoulder mobility/i, 'shoulders'], [/butterfly|farfalla/i, 'butterfly'], [/side.?split|spaccata laterale|straddle/i, 'side-split'], [/\bfrog\b|\brana\b/i, 'frog'], [/(biceps|bicipit).*(stretch|allungament)|(stretch|allungament).*(biceps|bicipit)/i, 'biceps-stretch'], [/mobilit|stretch/i, 'stretch'],
    [/board|benchmark/i, 'board'], [/volume/i, 'volume'], [/4 ?x ?4/i, 'four-by-four'], [/circuit/i, 'circuit']];
  /* Nomi italiani delle versioni precedenti → nome attuale: servono per aggiornare i dati salvati e per riconoscere i programmi scritti in italiano. */
  const LEGACY_NAMES = {"Peso corporeo": "Body weight", "Pinch block SX": "Pinch block L", "Pinch block DX": "Pinch block R", "Max lift SX": "Max lift L", "Max lift DX": "Max lift R", "Trazione zavorrata": "Weighted pull-up", "Indoor (palestra)": "Indoor (gym)", "Outdoor (roccia)": "Outdoor (rock)", "Riscaldamento generale": "General warm-up", "Riscaldamento sul muro": "Wall warm-up", "Attivazione dita": "Finger activation", "Attivazione spalle con elastico": "Shoulder activation with band", "Tacca minima": "Minimum edge", "Sospensione a un braccio": "One-arm hang", "Sospensione su sloper": "Sloper hang", "Sospensioni lunghe": "Long hangs", "Flessione polso": "Wrist curl", "Estensori delle dita": "Finger extensors", "Trazioni zavorrate": "Weighted pull-ups", "Trazioni": "Pull-ups", "Trazione a un braccio (progressione)": "One-arm pull-up (progression)", "Bloccaggi": "Lock-offs", "Rematore": "Rows", "Push-up o dip": "Push-ups or dips", "Press sopra la testa": "Overhead press", "Extrarotazioni": "External rotations", "Croci (compressione)": "Flys (compression)", "Croci isometriche": "Isometric flys", "Stacco": "Deadlift", "Squat o pistol": "Squat or pistol", "Leg raise alla sbarra": "Hanging leg raise", "Front lever (progressione)": "Front lever (progression)", "Progetto": "Project", "Set al flash": "Flash set", "Tecnica: movimento isolato": "Technique: isolated move", "Circuiti di resistenza": "Endurance circuits", "Roccia": "Rock", "Sessione di attivazione": "Activation session", "Mobilità anche": "Hip mobility", "Mobilità spalle": "Shoulder mobility", "Stretching generale": "General stretching", "Defaticamento": "Cool-down", "Visualizzazione del progetto": "Project visualisation", "Analisi dei tentativi": "Attempt review"};
  const EXACT = Object.fromEntries(LIBRARY.map(x => [x.name.toLowerCase(), x.key]));
  for (const [old, now] of Object.entries(LEGACY_NAMES)) if (EXACT[now.toLowerCase()]) EXACT[old.toLowerCase()] = EXACT[now.toLowerCase()];
  /** Prima il nome esatto di un esercizio standard (anche nella vecchia versione italiana), poi le regole. */
  const matchStd = name => { const n = String(name || '').trim(); if (EXACT[n.toLowerCase()]) return EXACT[n.toLowerCase()]; const r = STD_RULES.find(([re]) => re.test(n)); return r ? r[1] : null; };

  // Scala dei gradi boulder. I dati salvano l'etichetta Font; `fmtGrade` è l'unico punto in cui si sceglie la scala mostrata.
  const GRADES = ['4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'];
  const GRADE_SCALES = { font: 'Font' };
  const gradeIdx = g => (g == null ? -1 : GRADES.indexOf(g));
  const fmtGrade = (g, scale) => (g == null ? '' : scale && scale !== 'font' ? g : g); // altre scale: da aggiungere qui
  // Superfici di arrampicata predefinite; l'utente può aggiungerne altre.
  const DEFAULT_SURFACES = [
    { key: 'moonboard', name: 'MoonBoard' }, { key: 'kilter', name: 'Kilter Board' }, { key: 'tension', name: 'Tension Board' },
    { key: 'gym', name: 'Indoor (gym)' }, { key: 'outdoor', name: 'Outdoor (rock)' },
  ];
  /** Superficie deducibile dal nome dell'esercizio (solo i casi ovvi), altrimenti stringa vuota. */
  function inferSurface(name) {
    const n = name || '';
    if (/moon\s?board/i.test(n)) return 'moonboard';
    if (/kilter/i.test(n)) return 'kilter';
    if (/tension/i.test(n)) return 'tension';
    if (/outdoor|roccia|falesia|\brock\b|\bcrag\b/i.test(n)) return 'outdoor';
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
    else if (/\blift\b/i.test(n)) { ref = 'lift'; mode = 'lift'; }
    else if (/polso|wrist/i.test(n)) { ref = 'wrist'; mode = 'lift'; }
    if (!ref) return null;
    const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(prescription || '');
    return { ref, mode, pct: m ? num(m[1]) : null, test: /^TEST/i.test(n) };
  }
  // Riferimenti "a coppia": un test per mano (SX/DX). Le sospensioni alla trave sono a due mani, i sollevamenti da terra per lato.
  const PAIRS = { pinch: 'Pinch block', lift: 'Max lift' };
  const refKeys = ref => (PAIRS[ref] ? [ref + 'L', ref + 'R'] : [ref]);
  /** Chiave del massimale per un cue (per le coppie dipende dal lato SX/DX). */
  function loadKey(load, cue) {
    if (!load) return null;
    if (!PAIRS[load.ref]) return load.ref;
    return load.ref + (/^\s*(DX|R\b|right)/i.test(cue || '') ? 'R' : 'L');
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
  const fmtKg = kg => (kg > 0 ? '+' : '') + kg + ' kg';

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

  /* ---- Parametri di un esercizio in una sessione → riga leggibile ---- */
  const fmtRest = s => (s >= 60 ? Math.floor(s / 60) + "'" + (s % 60 ? String(s % 60).padStart(2, '0') + '"' : '') : s + '"');
  /** "4 × 7" · rec. 3' · 85%" a partire dai parametri (timer e carico), mai da un testo libero. */
  function describe(e) {
    const iv = e.interval, out = [];
    if (iv && iv.rounds) {
      const sets = iv.roundsPerSet && iv.rounds % iv.roundsPerSet === 0 ? iv.rounds / iv.roundsPerSet : 0;
      const unit = iv.selfPaced ? (iv.reps ? iv.reps + ' reps' : '') : iv.workSeconds + '"';
      const count = sets ? `${sets} sets × ${iv.roundsPerSet}` : String(iv.rounds);
      out.push(unit ? `${count} × ${unit}` : sets ? count : `${count} round`);
      if (iv.restSeconds) out.push('rest ' + fmtRest(iv.restSeconds) + (sets && iv.setRestSeconds ? ' / ' + fmtRest(iv.setRestSeconds) + ' between sets' : ''));
    }
    if (e.load && e.load.pct != null) out.push(e.load.pct + '%');
    return out.join(' · ');
  }
  /** Di una prescrizione testuale importata tiene solo ciò che non è un parametro (serie, recuperi, %): diventa la nota del blocco. */
  const leftoverNote = text => String(text || '').split(' · ').map(x => x.trim())
    .filter(x => x && !/^\d+\s*(×|x|blocchi|serie|problems|sets)\b/i.test(x) && !/^\d+ (×|x) /i.test(x) && !/\brec\.|^rest \d/i.test(x) && !/\d\s*%/.test(x) && !/^test$/i.test(x)).join(' · ');

  /** Dai cue per round (formato Blok) ricava le due cose che servono: se l'esercizio alterna SX/DX, e il testo
      che non è un parametro, da mettere nella nota. I cue liberi non esistono più come campo a parte. */
  function splitCues(cues) {
    const list = (cues || []).map(c => String(c).trim()).filter(Boolean);
    const sided = list.length > 0 && list.length % 2 === 0 && list.every((c, i) => (i % 2 ? /^(DX|R|right|lato dx|lato opposto|lato b|side b)\b/i : /^(SX|L|left|lato sx|lato karma|lato a|side a)\b/i).test(c) || /^(lato|side)\b/i.test(c));
    const rest = [...new Set(list.map(c => leftoverNote(c.replace(/^(SX|DX|L|R|left|right)\b\s*·?\s*/i, '').replace(/^(lato|side) (sx|dx|a|b)$/i, ''))).filter(Boolean))];
    return { sided, note: rest.join(' → ') };
  }

  /* ---- Valori letti da file ---- */
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


  /* ---- Piano ---- */
  /** Posizione di una data nel piano: { w, d } oppure null se fuori dal piano. */
  function locate(plan, iso) {
    const n = diffDays(iso, plan.startDate);
    if (n < 0 || n >= plan.weeks.length * 7) return null;
    return { w: Math.floor(n / 7), d: n % 7 };
  }
  const dateOf = (plan, w, d) => addDays(plan.startDate, w * 7 + d);
  /** Giorni tra l'inizio del programma e la sua prima sessione (i programmi spesso aprono con un giorno di riposo). */
  const firstOffset = plan => { for (let i = 0; i < plan.weeks.length * 7; i++) if (plan.weeks[Math.floor(i / 7)][i % 7].sessions.length) return i; return 0; };
  /** Data della prima sessione, e l'inizio che la fa cadere su `iso`. L'inizio può essere un giorno qualsiasi:
      le sessioni tengono il loro ordine e gli intervalli tra loro, i giorni della settimana si spostano con la data. */
  const firstSessionDate = plan => addDays(plan.startDate, firstOffset(plan));
  const startForFirst = (plan, iso) => addDays(iso, -firstOffset(plan));

  /* ---- Programmi in YAML ----
     Un file di testo che una persona può rileggere e correggere: una voce per giornata, settimane come intervalli ("1-3"),
     parametri espliciti per ogni esercizio. Nel modello interno ogni esercizio di una sessione resta un'istanza privata. */
  const YAML_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  // Nomi leggibili dei test nel file → chiavi interne (vale anche la chiave interna stessa).
  const YAML_REFS = { 'open-hand': 'oh', 'half-crimp': 'hc', sloper: 'sl', pinch: 'pinch', lift: 'lift', wrist: 'wrist', 'pull-up': 'pull', 'one-arm': 'onearm' };
  const yamlRefName = ref => Object.keys(YAML_REFS).find(k => YAML_REFS[k] === ref) || ref;
  const PROGRAMME_FIELDS = ['title', 'weeks', 'first_session', 'days', 'sessions']; // "sessions": nome dei file scritti prima di "days"
  const DAY_FIELDS = ['week', 'day', 'title', 'exercises'];
  const EXERCISE_FIELDS = ['name', 'test', 'minutes', 'sets', 'rounds', 'work', 'reps', 'rest', 'set_rest', 'sides', 'load', 'surface', 'note'];

  /** "7s", "45 s", "3min", "3 min", "1min30s", "2'", "1'30\"", oppure un numero (secondi). Restituisce i secondi o null. */
  function parseDuration(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim().toLowerCase();
    let m = /^(\d+)\s*(?:min|m|')\s*(?:(\d+)\s*(?:s|sec|")?)?$/.exec(t);
    if (m) return +m[1] * 60 + (m[2] ? +m[2] : 0);
    m = /^(\d+)\s*(?:s|sec|")?$/.exec(t);
    return m ? +m[1] : null;
  }
  const fmtDuration = s => (s < 60 ? s + 's' : Math.floor(s / 60) + 'min' + (s % 60 ? (s % 60) + 's' : ''));
  /** "1-3", "1,3", "1-2,4", 2, "all" → [1, 2, 3]. Restituisce null se non valido o fuori da 1..weeks. */
  function parseWeeks(v, weeks) {
    if (v === 'all') return Array.from({ length: weeks }, (_, i) => i + 1);
    const parts = typeof v === 'number' ? [String(v)] : typeof v === 'string' ? v.split(',').map(x => x.trim()) : null;
    if (!parts) return null;
    const out = new Set();
    for (const p of parts) {
      const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(p);
      if (!m) return null;
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > weeks || a > b) return null;
      for (let w = a; w <= b; w++) out.add(w);
    }
    return [...out].sort((x, y) => x - y);
  }
  /** [1, 2, 3, 5] → "1-3,5"; una settimana sola resta un numero. */
  function fmtWeeks(list) {
    if (list.length === 1) return list[0];
    const runs = [];
    for (const w of list) { const r = runs[runs.length - 1]; if (r && w === r[1] + 1) r[1] = w; else runs.push([w, w]); }
    return runs.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',');
  }
  /** Esercizio "test": a fine esercizio chiede il risultato, che aggiorna il massimale. `defs`: definizioni dei test (per secondi e ripetizioni). */
  function testExercise(ref, defs) {
    const two = !!PAIRS[ref], key = two ? ref + 'L' : ref;
    const d = (defs || []).find(t => t.key === key) || TEST_TEMPLATES.find(t => t.key === key);
    if (!d) return null;
    const interval = normInterval({ rounds: two ? 8 : 4, workSeconds: d.seconds || 45, restSeconds: two ? 90 : 180, selfPaced: !d.seconds, reps: d.reps || 0, cues: two ? ['L', 'R'] : [] });
    return { std: 'test', note: d.mode === 'value' ? 'All out' : 'Increasing load', name: 'Test: ' + (two ? PAIRS[ref] : d.name), slot: 'strength', location: 'off_wall', domain: 'finger_strength',
      intensity: 'max', risk: 'moderate', equipment: [], interval, load: { ref, mode: d.mode === 'lift' ? 'lift' : 'hang', pct: null, test: true }, surface: '' };
  }
  const refMode = (ref, defs) => { const d = (defs || []).concat(TEST_TEMPLATES).find(t => t.key === (PAIRS[ref] ? ref + 'L' : ref)); return d && d.mode === 'lift' ? 'lift' : 'hang'; };

  /** Legge un programma YAML. `opts`: { surfaces: [{key, name}], testDefs }.
      Restituisce { plan, exercises, firstSession } oppure lancia un Error con `errors` (tutti gli errori trovati, non solo il primo). */
  function importYaml(text, opts) {
    opts = opts || {};
    const yaml = YAML_LIB();
    let doc;
    try { doc = yaml.load(String(text), { schema: yaml.CORE_SCHEMA }); }
    catch (e) {
      const at = e.mark ? `line ${e.mark.line + 1}: ` : '';
      throw Object.assign(new Error('The file is not valid YAML.'), { errors: [at + (e.reason || e.message)] });
    }
    const errors = [], err = (where, msg) => errors.push(where ? `${where}: ${msg}` : msg);
    const fail = () => Object.assign(new Error(errors.length === 1 ? errors[0] : `The programme has ${errors.length} errors.`), { errors });
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const unknown = (o, allowed, where) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) err(where, `unknown field "${k}"`); };
    if (!isObj(doc)) { err('', 'the file must start with "title:", "weeks:" and "days:"'); throw fail(); }
    if (Array.isArray(doc.weeks) && doc.weeks.length && doc.isForSelf !== undefined) { err('', 'Blok Sessions plans are no longer supported: use the YAML format described in the guide'); throw fail(); }
    unknown(doc, PROGRAMME_FIELDS, '');
    const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim().slice(0, 80) : (err('title', 'required'), 'Programme');
    const nWeeks = Number.isInteger(doc.weeks) && doc.weeks >= 1 && doc.weeks <= 52 ? doc.weeks : (err('weeks', 'must be a whole number from 1 to 52'), 0);
    let firstSession = null;
    if (doc.first_session !== undefined) { firstSession = typeof doc.first_session === 'string' ? validISO(doc.first_session) : null; if (!firstSession) err('first_session', 'must be a date like 2026-11-18'); }
    if (doc.days !== undefined && doc.sessions !== undefined) err('', 'use either days or sessions (the old name), not both');
    const dayList = doc.days !== undefined ? doc.days : doc.sessions;
    if (!Array.isArray(dayList) || !dayList.length) err('days', 'required: a list of training days');
    const surfaces = opts.surfaces || DEFAULT_SURFACES;
    const weeks = Array.from({ length: nWeeks }, () => Array.from({ length: 7 }, () => ({ sessions: [] })));
    const taken = new Map(), exercises = [];
    (Array.isArray(dayList) ? dayList : []).forEach((s, si) => {
      const label = isObj(s) && s.day ? `day ${si + 1} (week ${s.week}, ${s.day})` : `day ${si + 1}`;
      if (!isObj(s)) return err(label, 'must be a block with week, day and exercises');
      unknown(s, DAY_FIELDS, label);
      const ws = nWeeks ? parseWeeks(s.week, nWeeks) : null;
      if (!ws && nWeeks) err(label, `week: "${s.week}" is not valid (examples: 2, "1-3", "1,3", all; weeks go from 1 to ${nWeeks})`);
      const day = YAML_DAYS.indexOf(String(s.day).toLowerCase().slice(0, 3));
      if (day < 0) err(label, `day: "${s.day}" is not valid (mon, tue, wed, thu, fri, sat, sun)`);
      if (s.title !== undefined && typeof s.title !== 'string') err(label, 'title must be text');
      if (!Array.isArray(s.exercises) || !s.exercises.length) return err(label, 'exercises: required, at least one');
      const items = s.exercises.map((x, xi) => yamlExercise(x, `${label}, exercise ${xi + 1}${isObj(x) && (x.name || x.test) ? ` "${x.name || x.test}"` : ''}`));
      if (!ws || day < 0) return;
      for (const w of ws) {
        const k = (w - 1) * 7 + day;
        if (taken.has(k)) { err(label, `week ${w}, ${YAML_DAYS[day]} is already described (${taken.get(k)}): put all the exercises of a day together`); continue; }
        taken.set(k, label);
        if (items.some(x => !x)) continue;
        const blocks = items.map(({ e, minutes, note }) => {
          const c = JSON.parse(JSON.stringify(e)); c.id = uid(); exercises.push(c);
          return Object.assign({ id: uid(), exId: c.id, minutes }, note ? { note } : {});
        });
        weeks[w - 1][day].sessions.push(Object.assign({ id: uid(), type: 'wall', period: 'base', blocks }, s.title ? { title: String(s.title).slice(0, 80) } : {}));
      }
    });
    if (errors.length) throw fail();
    return { plan: { id: uid(), title, startDate: todayISO(), weeks }, exercises, firstSession };

    function yamlExercise(x, where) {
      if (!isObj(x)) { err(where, 'must be a block with name (or test) and its parameters'); return null; }
      const n0 = errors.length;
      unknown(x, EXERCISE_FIELDS, where);
      let e;
      if (x.test !== undefined) {
        if (x.name !== undefined) err(where, 'use either name or test, not both');
        if (x.load !== undefined) err(where, 'a test has no load: the result becomes the new max');
        const ref = YAML_REFS[x.test] || x.test;
        e = typeof ref === 'string' ? testExercise(ref, opts.testDefs) : null;
        if (!e) { err(where, `test: "${x.test}" is not a known test (${Object.keys(YAML_REFS).join(', ')})`); return null; }
      } else {
        if (typeof x.name !== 'string' || !x.name.trim()) { err(where, 'name: required'); return null; }
        const name = x.name.trim().slice(0, 80), std = matchStd(name), v = std && std !== 'test' ? stdVariant(std) : null;
        e = { std, name, slot: v ? v.slot : 'strength', location: v ? v.location : 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low', equipment: [], interval: null, load: null, surface: inferSurface(name) };
      }
      // Timer: sets (round in tutto, i due lati contano entrambi) × rounds per set, lavoro a tempo o a ripetizioni.
      const has = k => x[k] !== undefined, posInt = k => (Number.isInteger(x[k]) && x[k] > 0 ? x[k] : (err(where, `${k}: must be a whole number greater than 0`), null));
      const dur = k => { const s = parseDuration(x[k]); if (s == null) err(where, `${k}: "${x[k]}" is not a duration (examples: 7s, 3min, 1min30s)`); return s; };
      if (['sets', 'rounds', 'work', 'reps', 'rest', 'set_rest', 'sides'].some(has)) {
        if (!has('sets')) err(where, 'sets: required when the exercise has a timer (work, reps, rest…)');
        if (has('work') === has('reps')) err(where, has('work') ? 'use either work (timed) or reps (counted), not both' : 'give work (a time like 7s, or done) or reps (e.g. 6)');
        if (has('set_rest') && !has('rounds')) err(where, 'set_rest needs rounds (rounds per set)');
        if (has('sides') && x.sides !== 'L/R') err(where, 'sides: the only value is L/R');
        if (has('sides') && has('rounds')) err(where, 'sides and rounds cannot be combined');
        const sets = has('sets') ? posInt('sets') : null, per = has('rounds') ? posInt('rounds') : null;
        const untilDone = x.work === 'done', work = has('work') && !untilDone ? dur('work') : 45, reps = has('reps') ? posInt('reps') : null, rest = has('rest') ? dur('rest') : 0;
        const setRest = has('set_rest') ? dur('set_rest') : null;
        if (errors.length === n0) {
          e.interval = normInterval({ rounds: sets * (per || 1), workSeconds: work, restSeconds: rest, selfPaced: !!reps || untilDone, reps: reps || 0,
            roundsPerSet: per || 0, setRestSeconds: setRest || 0, cues: has('sides') ? ['L', 'R'] : [] });
        }
      }
      if (has('load')) {
        const m = /^\s*(?:(\d+(?:\.\d+)?)\s*%\s*)?([a-z-]+)\s*$/i.exec(String(x.load)), ref = m ? YAML_REFS[m[2].toLowerCase()] || m[2] : null;
        if (!m || !ref || !(PAIRS[ref] || TEST_TEMPLATES.some(t => t.key === ref) || (opts.testDefs || []).some(t => t.key === ref)))
          err(where, `load: "${x.load}" should look like "82.5% sloper" (tests: ${Object.keys(YAML_REFS).join(', ')})`);
        else e.load = { ref, mode: refMode(ref, opts.testDefs), pct: m[1] ? +m[1] : null, test: false };
      }
      if (has('surface')) {
        const sf = surfaces.find(s => s.key === x.surface || s.name.toLowerCase() === String(x.surface).toLowerCase());
        if (!sf) err(where, `surface: "${x.surface}" is not one of your surfaces (${surfaces.map(s => s.key).join(', ')})`); else e.surface = sf.key;
      }
      let minutes = null;
      if (e.interval) { if (has('minutes')) err(where, 'minutes: remove it, with a timer the minutes are calculated'); else minutes = intervalMinutes(e.interval); }
      else if (has('minutes')) minutes = posInt('minutes');
      else if (e.std && STD[e.std] && STD[e.std].minutes) minutes = STD[e.std].minutes;
      else err(where, 'minutes: required for an exercise without a timer');
      if (has('note') && typeof x.note !== 'string' && typeof x.note !== 'number') err(where, 'note must be text');
      const note = (has('note') ? String(x.note).trim() : e.note || '').slice(0, 200); // la nota predefinita del test vale solo se il file non ne dà una
      delete e.note;
      return errors.length === n0 ? { e, minutes, note } : null;
    }
  }

  /** Programma → testo YAML. Le giornate identiche in più settimane (stesso giorno) diventano una sola voce con "week: 1-3". */
  function exportYaml(plan, exMap) {
    const yaml = YAML_LIB();
    const item = b => {
      const e = exMap[b.exId];
      if (!e) return null;
      const o = {}, iv = e.interval;
      if (e.load && e.load.test) o.test = yamlRefName(e.load.ref); else o.name = e.name;
      if (!(iv && iv.rounds)) o.minutes = b.minutes || 1; // con un timer i minuti si calcolano
      if (iv && iv.rounds) {
        const sided = iv.cues && iv.cues.length === 2 && iv.cues[0] === 'L' && iv.cues[1] === 'R';
        if (iv.roundsPerSet && iv.rounds % iv.roundsPerSet === 0 && !sided) { o.sets = iv.rounds / iv.roundsPerSet; o.rounds = iv.roundsPerSet; } else o.sets = iv.rounds;
        // A ripetizioni o "fino a Fatto" il lavoro non ha durata: i minuti del blocco sono già scritti a parte.
        if (iv.selfPaced) { if (iv.reps) o.reps = iv.reps; else o.work = 'done'; } else o.work = fmtDuration(iv.workSeconds);
        if (iv.restSeconds) o.rest = fmtDuration(iv.restSeconds);
        if (o.rounds && iv.setRestSeconds) o.set_rest = fmtDuration(iv.setRestSeconds);
        if (sided) o.sides = 'L/R';
      }
      if (e.load && !e.load.test) o.load = (e.load.pct != null ? e.load.pct + '% ' : '') + yamlRefName(e.load.ref);
      if (e.surface) o.surface = e.surface;
      if (b.note) o.note = b.note;
      return o;
    };
    const groups = [];
    plan.weeks.forEach((wk, w) => wk.forEach((d, day) => d.sessions.forEach(s => {
      const body = Object.assign(s.title ? { title: s.title } : {}, { exercises: s.blocks.map(item).filter(Boolean) });
      const key = day + '|' + JSON.stringify(body), g = groups.find(x => x.key === key);
      if (g) g.weeks.push(w + 1); else groups.push({ key, day, weeks: [w + 1], body });
    })));
    groups.sort((a, b) => a.weeks[0] - b.weeks[0] || a.day - b.day);
    const doc = { title: plan.title, weeks: plan.weeks.length, first_session: firstSessionDate(plan),
      days: groups.map(g => Object.assign({ week: fmtWeeks(g.weeks), day: YAML_DAYS[g.day] }, g.body)) };
    return '# Allenamento programme. Format: https://github.com/ldvdauer/allenamento/blob/main/GUIDE.md#programme-files\n' +
      yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' }).replace(/\n  - week:/g, '\n\n  - week:');
  }
  const sessionMinutes = s => s.blocks.reduce((t, b) => t + (b.minutes || 0), 0);
  // Le copie hanno id nuovi: una sessione copiata non eredita lo stato "fatta" dell'originale.
  const cloneSession = s => ({ ...s, id: uid(), blocks: s.blocks.map(b => ({ ...b, id: uid() })) });
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
  /** "SX 15 kg · DX 18 kg" → [{side:'SX',kg:15},{side:'DX',kg:18}]; "+4,5 kg" → [{side:null,kg:4.5}]. */
  const normSide = x => (/^(DX|R)$/i.test(x) ? 'R' : 'L'); // i dati vecchi usavano SX/DX
  function parseLoads(text) {
    const out = [];
    for (const part of String(text == null ? '' : text).split(/[·;/]/)) {
      const m = /[+-]?\d+(?:[.,]\d+)?/.exec(part);
      if (!m) continue;
      const side = /\b(SX|DX|L|R)\b/i.exec(part);
      out.push({ side: side ? normSide(side[1]) : null, kg: num(m[0]) });
    }
    return out;
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  /** Esercizi registrati in un log con carichi numerici: { key, label, kgs:[{side,kg}], rpe, mode }.
      `key` identifica esercizio standard + test di riferimento, così versioni diverse dello stesso esercizio stanno insieme.
      I log vecchi (solo testo) vengono ricondotti allo standard dal nome. */
  function recordsOf(l) {
    if ((l.blocks || []).some(b => b.kgs)) return l.blocks.filter(b => b.kgs && b.kgs.length).map(b => ({ key: b.key || b.name, label: b.label || b.name, kgs: b.kgs, rpe: b.rpe == null ? null : b.rpe, mode: b.mode || 'lift' }));
    return (l.loads || []).map(x => { const ld = inferLoad(x.name, ''); return { key: (matchStd(x.name) || x.name) + '|' + (ld ? ld.ref : ''), label: x.name, kgs: parseLoads(x.kg), rpe: null, mode: ld ? ld.mode : 'lift' }; }).filter(r => r.kgs.length);
  }
  /** Carichi registrati: una serie per esercizio standard + test (e per lato SX/DX nei sollevamenti). */
  function loadSeries(logs, from, to) {
    const m = new Map();
    for (const l of [...(logs || [])].sort(byDate)) {
      if (l.date < from || l.date > to) continue;
      for (const r of recordsOf(l)) for (const p of r.kgs) {
        const k = r.key + '|' + (p.side || '');
        if (!m.has(k)) m.set(k, { name: '', points: [] });
        const o = m.get(k); o.name = r.label + (p.side ? ' ' + p.side : ''); o.points.push({ date: l.date, kg: p.kg });
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Ultima registrazione di un esercizio (per chiave), o null. */
  function lastRecord(logs, key) {
    let best = null;
    for (const l of logs || []) for (const r of recordsOf(l)) if (r.key === key && (!best || l.date >= best.date)) best = { ...r, date: l.date };
    return best;
  }
  /** Progressione: dal carico e dall'RPE dell'ultima volta propone il prossimo, arrotondato a 0,5 kg.
      RPE ≤ soglia → +step %; RPE ≥ soglia + 1,5 → −step %; altrimenti (o senza RPE) stesso carico.
      Per la zavorra la percentuale si applica al carico totale (peso corporeo + zavorra). */
  function nextLoad(kg, rpe, rule, mode, bw) {
    if (kg == null || isNaN(kg)) return null;
    const dir = rpe == null ? 0 : rpe <= rule.rpe ? 1 : rpe >= rule.rpe + 1.5 ? -1 : 0;
    const base = mode === 'hang' && bw != null && !isNaN(bw) ? bw : 0;
    return { kg: Math.round(((base + kg) * (1 + dir * rule.step / 100) - base) * 2) / 2, dir };
  }
  /* Tempo per categoria: le categorie sono le sezioni della libreria; i gruppi servono al grafico nel tempo. */
  const GROUPS = { wall: 'On the wall', strength: 'Strength', other: 'Mobility and other' };
  const SECTION_GROUP = { wall: 'wall', fingers: 'strength', pull: 'strength', strength: 'strength', core: 'strength', warmup: 'other', mobility: 'other', mental: 'other', other: 'other' };
  /** Sezione di un esercizio registrato: quella salvata, altrimenti ricavata dallo standard o dal nome. */
  function blockSection(b) {
    if (b.sec && SECTION_GROUP[b.sec]) return b.sec;
    const k = String(b.key || '').split('|')[0], std = STD[k] ? k : k === 'test' ? 'test' : matchStd(b.name);
    return std === 'test' ? 'fingers' : STD[std] ? STD[std].section : 'other';
  }
  /** Minuti di un log divisi per sezione. Ciò che non è attribuito a un esercizio (sessioni registrate a mano, o
      tempo oltre la somma degli esercizi) resta in `unclassified`. */
  function logSections(l) {
    const out = {}; let sum = 0;
    for (const b of l.blocks || []) { const m = b.minutes || 0; if (!m) continue; const sec = blockSection(b); out[sec] = (out[sec] || 0) + m; sum += m; }
    return { sections: out, unclassified: Math.max(0, (l.minutes || 0) - sum) };
  }
  /** Tempo per categoria nel periodo: righe ordinate, quota di arrampicata sul tempo classificato, non classificato. */
  function timeBySection(logs, from, to) {
    const m = {}; let un = 0;
    for (const l of logs || []) {
      if (l.date < from || l.date > to) continue;
      const r = logSections(l);
      for (const k in r.sections) m[k] = (m[k] || 0) + r.sections[k];
      un += r.unclassified;
    }
    const rows = Object.entries(m).map(([section, minutes]) => ({ section, minutes })).sort((a, b) => b.minutes - a.minutes || a.section.localeCompare(b.section));
    const classified = rows.reduce((t, r) => t + r.minutes, 0), wall = rows.filter(r => SECTION_GROUP[r.section] === 'wall').reduce((t, r) => t + r.minutes, 0);
    return { rows, classified, unclassified: un, wall, wallShare: classified ? wall / classified : null };
  }
  /** Minuti per settimana divisi nei tre gruppi (più il non classificato). */
  function weeklyGroups(logs, from, to) {
    const start = mondayOf(from), acc = [];
    for (let d = start; d <= to; d = addDays(d, 7)) acc.push({ week: d, wall: 0, strength: 0, other: 0, unclassified: 0 });
    for (const l of logs || []) {
      const i = acc.length && l.date >= start && l.date <= addDays(acc[acc.length - 1].week, 6) ? Math.floor(diffDays(l.date, start) / 7) : -1;
      if (i < 0) continue;
      const r = logSections(l);
      for (const k in r.sections) acc[i][SECTION_GROUP[k]] += r.sections[k];
      acc[i].unclassified += r.unclassified;
    }
    return acc;
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
    GROUPS, SECTION_GROUP, blockSection, timeBySection, weeklyGroups, describe, leftoverNote, splitCues, fmtRest, PAIRS, refKeys, LEGACY_NAMES, normSide, firstOffset, firstSessionDate, startForFirst, recordsOf, lastRecord, nextLoad, TEST_TEMPLATES, testLabel, SECTIONS, LIBRARY, STD, stdVariant, matchStd,
    DAY_TYPES, PERIODS, SLOTS, GRADES, GRADE_SCALES, gradeIdx, fmtGrade, DEFAULT_SURFACES, inferSurface, validISO, uid, toISO, fromISO, todayISO, addDays, diffDays, mondayOf,
    inferLoad, loadKey, loadKg, latestMaxes, fmtKg, cycle, cueAt, intervalMinutes, buildSteps, normInterval,
    importYaml, exportYaml, parseDuration, parseWeeks, fmtWeeks, testExercise, YAML_REFS, locate, dateOf, sessionMinutes, cloneSession, validState,
    niceRange, scheduled, weeklyStats, summary, parseLoads, loadSeries, surfaceStats, weeklyTopGrades,
  };
});
