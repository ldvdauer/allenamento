/* Interfaccia: viste, editor, player. Tutta la logica testabile sta in core.js, i grafici in charts.js. */
(function () {
  'use strict';
  const C = Core, KEY = 'allenamento.v1';
  const WD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const WD_FULL = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const MONTHS_FULL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const TYPES = Object.entries(C.DAY_TYPES).filter(([k]) => k !== 'rest');
  const LOG_TYPES = TYPES.concat([['other', 'Altro']]);
  const FEEL = [['', '—'], ['1', '1 · Distrutto'], ['2', '2 · Stanco'], ['3', '3 · Così così'], ['4', '4 · Bene'], ['5', '5 · Ottimo']];
  const wdIdx = iso => (C.fromISO(iso).getDay() + 6) % 7;
  const fmtDate = iso => { const d = C.fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const wdOf = iso => WD[wdIdx(iso)];
  const dec = v => String(v).replace('.', ',');
  const log = (area, msg, extra) => console.info(`[${area}] ${msg}`, extra === undefined ? '' : extra);

  /* ---------- Stato e persistenza ---------- */
  // Primo avvio: nessun piano precaricato, ogni utente importa o crea i propri.
  const fresh = () => migrate({ v: 2, plans: [], activePlan: null, exercises: {}, logs: [], tests: [] });
  function migrate(s) { // completa i campi mancanti di backup vecchi o parziali
    s.extras = Array.isArray(s.extras) ? s.extras : [];
    s.surfaces = Array.isArray(s.surfaces) && s.surfaces.length ? s.surfaces : C.DEFAULT_SURFACES.map(x => ({ ...x }));
    s.testDefs = Array.isArray(s.testDefs) && s.testDefs.length ? s.testDefs : C.DEFAULT_TESTS.map(t => ({ ...t }));
    s.settings = Object.assign({ prep: 10, sound: true, gradeScale: 'font' }, s.settings);
    if (!s.plans.some(p => p.id === s.activePlan)) s.activePlan = s.plans[0] ? s.plans[0].id : null;
    for (const p of s.plans) for (const w of p.weeks) for (const d of w) for (const x of d.sessions) if (!x.id) x.id = C.uid();
    for (const e of Object.values(s.exercises)) if (e.surface === undefined) e.surface = C.inferSurface(e.name);
    // La v1 puntava alle sessioni per posizione (piano, settimana, giorno, indice): si passa all'id della sessione.
    const at = l => { const p = s.plans.find(x => x.id === l.planId); return p && p.weeks[l.w] && p.weeks[l.w][l.d] ? p.weeks[l.w][l.d].sessions[l.si] : null; };
    for (const l of s.logs) {
      const x = !l.sid && l.planId ? at(l) : null;
      if (x) l.sid = x.id;
      if (!l.type) l.type = x ? x.type : 'other';
    }
    if (s.live && !s.live.sid) { const x = s.live.planId ? at(s.live) : null; s.live = x ? { sid: x.id, idx: s.live.idx || 0, startedAt: s.live.startedAt || Date.now() } : null; }
    s.live = s.live || null;
    s.v = 2;
    return s;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (C.validState(s)) return migrate(s); log('store', 'dati salvati non validi, riparto da zero'); }
    } catch (e) { console.warn('[store] lettura fallita', e); }
    return fresh();
  }
  let storeOk = true;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storeOk = true; }
    catch (e) {
      console.warn('[store] scrittura fallita', e);
      if (storeOk) toast('Salvataggio non disponibile qui: fai un backup da Altro.');
      storeOk = false;
    }
  }
  let S = load();
  const plan = () => S.plans.find(p => p.id === S.activePlan) || null;
  const maxes = () => C.latestMaxes(S.tests);
  const surfName = k => (S.surfaces.find(x => x.key === k) || { name: k }).name;
  const surfOpts = () => [['', '—']].concat(S.surfaces.map(x => [x.key, x.name]));
  const fmtG = g => C.fmtGrade(g, S.settings.gradeScale);
  const gradeOpts = () => [['', '—']].concat(C.GRADES.map(g => [g, fmtG(g)]));
  function addSurface(name) {
    const hit = S.surfaces.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.key;
    const x = { key: 's-' + C.uid().slice(0, 8), name };
    S.surfaces.push(x);
    return x.key;
  }

  /* ---------- DOM ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'checked' || k === 'disabled') el[k] = !!v;
      else if (k !== 'value') el.setAttribute(k, v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    if (attrs && attrs.value != null) el.value = attrs.value; // dopo i figli: serve ai <select>
    return el;
  }
  const $ = id => document.getElementById(id);
  const btn = (label, onclick, cls) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick }, label);
  const field = (label, input) => h('label', { class: 'f' }, label, input);
  // `map`: oggetto o lista di coppie [valore, etichetta]. La lista serve quando l'ordine conta: le chiavi numeriche di un oggetto vengono riordinate.
  const opts = (map, value, extra) => h('select', { value, ...(extra || {}) }, (Array.isArray(map) ? map : Object.entries(map)).map(([k, v]) => h('option', { value: k }, v)));
  // testo + inputmode decimale: i campi number perdono la virgola su alcune tastiere
  const numInp = (value, extra) => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value == null ? '' : dec(value), ...(extra || {}) });
  const val = el => { const n = parseFloat(String(el.value).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const seg = (items, cur, onpick) => h('div', { class: 'seg' }, items.map(([k, label]) =>
    h('button', { type: 'button', class: k === cur ? 'on' : '', 'aria-pressed': k === cur ? 'true' : 'false', onclick: () => onpick(k) }, label)));

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function openSheet(title, body, mid) {
    const ov = h('div', { class: 'overlay' + (mid ? ' mid' : ''), onclick: e => { if (e.target === ov) ov.remove(); } },
      h('div', { class: 'sheet' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, title), mid ? null : btn('Chiudi', () => ov.remove(), 'sm')), body));
    document.body.append(ov);
    return ov;
  }
  // I dialoghi nativi (confirm/alert) non sono affidabili in una PWA: conferma costruita in pagina.
  function confirmDlg(msg, okLabel) {
    return new Promise(res => {
      const ov = openSheet('Conferma', [h('p', {}, msg), h('div', { class: 'btns' },
        btn('Annulla', () => { ov.remove(); res(false); }), btn(okLabel || 'Conferma', () => { ov.remove(); res(true); }, 'danger'))], true);
    });
  }
  function download(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.warn('[export] download non riuscito', e); toast('Download non disponibile: usa Copia.'); }
  }
  function exportSheet(title, name, text) {
    const ta = h('textarea', { readonly: '', class: 'inp', style: 'min-height:140px;font-size:12px' }); ta.value = text;
    openSheet(title, [h('p', { class: 'sub' }, name + ' · ' + Math.ceil(text.length / 1024) + ' KB'), ta, h('div', { class: 'btns' },
      btn('Scarica file', () => download(name, text), 'pri'),
      btn('Copia', async () => { try { await navigator.clipboard.writeText(text); toast('Copiato.'); } catch (e) { ta.select(); toast('Seleziona e copia manualmente.'); } }))]);
  }
  const go = hash => { if (location.hash.slice(1) === hash) render(); else location.hash = hash; };

  /* ---------- Riferimenti alle sessioni ----------
     Una sessione sta in un piano ({p, w, d, si}) oppure è "extra", legata a una data del calendario ({x}).
     Diario e player la riconoscono dal suo id, quindi spostare o copiare settimane non sposta lo stato "fatta". */
  const sessOf = r => (r.x ? r.x : r.p.weeks[r.w][r.d].sessions[r.si]);
  const isDone = r => { const id = sessOf(r).id; return S.logs.some(l => l.sid === id); };
  const sessTitle = s => `${C.DAY_TYPES[s.type]} · ${C.PERIODS[s.period]}`;
  const refTitle = r => (r.x ? r.x.title || sessTitle(r.x) : `${sessTitle(sessOf(r))} · ${r.p.title} S${r.w + 1}`);
  function findRef(sid) {
    const x = S.extras.find(e => e.id === sid);
    if (x) return { x };
    for (const p of S.plans) for (let w = 0; w < p.weeks.length; w++) for (let d = 0; d < p.weeks[w].length; d++) {
      const si = p.weeks[w][d].sessions.findIndex(s => s.id === sid);
      if (si >= 0) return { p, w, d, si };
    }
    return null;
  }
  /** Sessioni di una data: quelle del piano attivo più le extra. */
  function refsOn(iso) {
    const out = [], p = plan(), pos = p ? C.locate(p, iso) : null;
    if (pos) p.weeks[pos.w][pos.d].sessions.forEach((_, si) => out.push({ p, w: pos.w, d: pos.d, si }));
    for (const x of S.extras) if (x.date === iso) out.push({ x });
    return out;
  }

  /* ---------- Elementi condivisi ---------- */
  function loadHint(ex) {
    if (!ex.load || ex.load.pct == null) return '';
    const cues = ex.interval && ex.interval.cues.length ? ex.interval.cues : [''];
    const m = maxes(), out = [];
    for (const c of cues) {
      const kg = C.loadKg(ex.load, c, m);
      if (kg == null) return 'kg: mancano i massimali';
      const side = ex.load.ref === 'pinch' ? (/^\s*DX/i.test(c) ? 'DX ' : 'SX ') : '';
      const s = side + (ex.load.mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
      if (!out.includes(s)) out.push(s);
    }
    return out.join(' · ');
  }
  const exLine = e => [e.prescription, e.surface ? surfName(e.surface) : ''].filter(Boolean).join(' · ');
  function blockRow(b, onclick) {
    const ex = S.exercises[b.exId];
    if (!ex) return h('div', { class: 'blk' }, h('span', { class: 'p' }, 'Esercizio rimosso'));
    const hint = loadHint(ex);
    return h('div', { class: 'blk', onclick, style: onclick ? 'cursor:pointer' : null },
      h('div', { class: 'grow' }, h('div', { class: 'n' }, ex.name), h('div', { class: 'p' }, exLine(ex)), hint ? h('div', { class: 'kg' }, hint) : null),
      h('div', { class: 'm' }, b.minutes + ' min'));
  }
  function sessionCard(r, edit) {
    const s = sessOf(r), done = isDone(r), named = r.x && r.x.title;
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow big', style: 'font-size:17px' }, named ? r.x.title : sessTitle(s)),
        r.x ? h('span', { class: 'tag ac' }, 'Extra') : null, done ? h('span', { class: 'tag ok' }, 'Fatta') : null, h('span', { class: 'tag' }, C.sessionMinutes(s) + ' min')),
      named ? h('div', { class: 'sub' }, sessTitle(s)) : null,
      s.blocks.map((b, bi) => blockRow(b, edit ? () => blockSheet(r, bi) : null)),
      s.blocks.length ? null : h('p', { class: 'sub' }, edit ? 'Nessun esercizio: aggiungine uno.' : 'Nessun esercizio.'),
      h('div', { class: 'btns' },
        btn(done ? 'Ripeti' : 'Avvia', () => startSession(r, 0), 'pri'),
        edit ? [btn('+ Esercizio', () => pickExercise(id => { s.blocks.push({ id: C.uid(), exId: id, minutes: C.intervalMinutes(S.exercises[id].interval) || 10 }); save(); render(); }), 'sm'),
          btn('Sessione…', () => sessionSheet(r), 'sm')] : null));
  }
  const climbText = c => surfName(c.surface) + (c.top ? ' ' + fmtG(c.top) : '') + (c.sends != null ? ` · ${c.sends} ${c.sends === 1 ? 'blocco' : 'blocchi'}` : '');
  const logCard = l => h('div', { class: 'card tap', onclick: () => logSheet(l) },
    h('div', { class: 'row' }, h('div', { class: 'grow n', style: 'font-weight:600' }, l.title), h('span', { class: 'tag' }, (l.minutes || 0) + ' min')),
    h('div', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)}${l.rpe ? ' · RPE ' + dec(l.rpe) : ''}${l.feel ? ' · sensazione ' + l.feel + '/5' : ''}`),
    (l.climbs || []).length ? h('div', { class: 'sub', style: 'color:var(--tx)' }, l.climbs.map(climbText).join('  |  ')) : null,
    (l.loads || []).length ? h('div', { class: 'p', style: 'color:var(--ac);font-size:13px' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
    l.notes ? h('div', { class: 'sub', style: 'margin-top:4px;color:var(--tx)' }, l.notes) : null);

  /* ---------- Oggi ---------- */
  let curWeek = null;
  function viewToday() {
    const p = plan(), t = C.todayISO(), out = [h('div', { class: 'sub' }, `${wdOf(t)} ${fmtDate(t)}`), h('h1', {}, 'Oggi')];
    if (S.live) {
      const lr = findRef(S.live.sid);
      if (lr) out.push(h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('div', { class: 'n' }, 'Sessione interrotta'), h('div', { class: 'sub' }, refTitle(lr)),
        h('div', { class: 'btns' }, btn('Riprendi', () => startSession(lr, S.live.idx), 'pri'), btn('Scarta', () => { S.live = null; save(); render(); }))));
      else S.live = null;
    }
    const pos = p ? C.locate(p, t) : null, refs = refsOn(t);
    if (!p) out.push(h('div', { class: 'card' }, h('div', { class: 'big' }, 'Benvenuto'),
      h('p', { class: 'sub' }, 'Non c\'è ancora nessun piano. Importa un file .blokplan esportato da Blok Sessions, creane uno da zero, oppure aggiungi una sessione solo per oggi.'),
      h('div', { class: 'btns' }, fileBtn('Importa .blokplan'), btn('Crea un piano', () => { location.hash = 'piano'; planSheet(); }, 'sm pri'))));
    else {
      out.push(h('div', { class: 'sub' }, p.title + (pos ? ` · settimana ${pos.w + 1} di ${p.weeks.length}` : '')));
      if (!pos) {
        const before = C.diffDays(t, p.startDate) < 0;
        out.push(h('div', { class: 'card' }, h('p', {}, before ? `Il piano inizia ${wdOf(p.startDate)} ${fmtDate(p.startDate)} (tra ${-C.diffDays(t, p.startDate)} giorni).` : 'Il piano è concluso.'),
          btn(before ? 'Apri il primo giorno' : 'Apri il piano', () => { location.hash = before ? 'giorno-0-0' : 'piano'; }, 'sm')));
      } else if (!refs.length) out.push(h('div', { class: 'card' }, h('div', { class: 'big' }, 'Recupero'), h('p', { class: 'sub' }, 'Nessuna sessione in programma.')));
    }
    refs.forEach(r => out.push(sessionCard(r, !!r.x))); // le sessioni extra si modificano qui, quelle del piano dal piano
    out.push(h('div', { class: 'btns' }, btn('+ Nuova sessione', () => newSessionSheet(t), 'sm' + (refs.length ? '' : ' pri')),
      pos ? btn('Modifica il giorno', () => { location.hash = `giorno-${pos.w}-${pos.d}`; }, 'sm') : null));
    const mon = C.mondayOf(t), wk = S.logs.filter(l => l.date >= mon && l.date <= C.addDays(mon, 6));
    out.push(h('h2', {}, 'Questa settimana'), h('div', { class: 'card row' },
      h('div', { class: 'grow' }, h('div', { class: 'big' }, wk.length), h('div', { class: 'sub' }, 'sessioni')),
      h('div', { class: 'grow' }, h('div', { class: 'big' }, wk.reduce((a, l) => a + (l.minutes || 0), 0)), h('div', { class: 'sub' }, 'minuti'))));
    return out;
  }

  /* ---------- Sessioni extra e calendario ---------- */
  function showDate(iso) { // dopo aver creato o spostato una sessione: resta su Oggi se è oggi, altrimenti apre il giorno nel calendario
    const onToday = (location.hash.slice(1) || 'oggi') === 'oggi';
    go(onToday && iso === C.todayISO() ? 'oggi' : 'calendario-' + iso);
  }
  function newSessionSheet(dateDefault) {
    const p = plan(), pos = p ? C.locate(p, dateDefault) : null;
    const guess = pos ? (p.weeks[pos.w].flatMap(d => d.sessions)[0] || {}).period || 'base' : 'base';
    const date = h('input', { type: 'date', value: dateDefault }), ty = opts(TYPES, 'wall'), pe = opts(C.PERIODS, guess), title = h('input', { placeholder: 'Es. Board con amici' });
    const ov = openSheet('Nuova sessione', [h('div', { class: 'cols' }, field('Data', date), field('Tipo', ty)),
      h('div', { class: 'cols' }, field('Periodo', pe), field('Titolo (facoltativo)', title)),
      h('p', { class: 'sub' }, 'Resta legata alla data scelta e non modifica il piano. Dopo averla creata aggiungi gli esercizi.'),
      btn('Crea sessione', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Scegli una data valida.');
        S.extras.push({ id: C.uid(), date: iso, type: ty.value, period: pe.value, title: title.value.trim().slice(0, 80), blocks: [] });
        save(); ov.remove(); showDate(iso);
      }, 'pri block')]);
  }
  function copyToDateSheet(r) {
    const s = sessOf(r), date = h('input', { type: 'date', value: C.todayISO() });
    const ov = openSheet('Copia su una data', [h('p', { class: 'sub' }, `"${r.x && r.x.title ? r.x.title : sessTitle(s)}" viene copiata come sessione extra, con gli stessi esercizi.`), field('Data', date),
      btn('Copia', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Scegli una data valida.');
        S.extras.push({ ...C.cloneSession(s), date: iso, title: r.x ? r.x.title || '' : '' });
        save(); ov.remove(); toast(`Copiata su ${wdOf(iso)} ${fmtDate(iso)}.`); render();
      }, 'pri block')]);
  }
  let calMonth = null, calSel = null;
  function viewCalendar(args) {
    const t = C.todayISO(), fromHash = C.validISO(args.join('-'));
    if (fromHash && fromHash !== calSel) { calSel = fromHash; calMonth = fromHash.slice(0, 7) + '-01'; }
    if (!calSel) calSel = t;
    if (!calMonth) calMonth = calSel.slice(0, 7) + '-01';
    const first = C.fromISO(calMonth), lastDay = C.toISO(new Date(first.getFullYear(), first.getMonth() + 1, 0, 12));
    const shift = n => { calMonth = C.toISO(new Date(first.getFullYear(), first.getMonth() + n, 1, 12)); render(); };
    const cells = [];
    for (let iso = C.mondayOf(calMonth); !(cells.length % 7 === 0 && iso > lastDay); iso = C.addDays(iso, 1)) cells.push(iso);
    const cell = iso => {
      const refs = refsOn(iso), ids = new Set(refs.map(r => sessOf(r).id));
      const dots = refs.slice(0, 3).map(r => h('i', { class: isDone(r) ? 'ok' : r.x ? 'ex' : '' }));
      // registrazioni di quel giorno non legate a una sessione in programma lì (diario manuale, sessione fatta in un altro giorno)
      if (dots.length < 3 && S.logs.some(l => l.date === iso && !ids.has(l.sid))) dots.push(h('i', { class: 'ok' }));
      const d = C.fromISO(iso);
      return h('button', { type: 'button', class: 'cal-d' + (iso.slice(0, 7) === calMonth.slice(0, 7) ? '' : ' out') + (iso === t ? ' today' : '') + (iso === calSel ? ' sel' : ''),
        'aria-label': `${WD_FULL[wdIdx(iso)]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}, ${refs.length} sessioni`, 'aria-pressed': iso === calSel ? 'true' : 'false',
        onclick: () => go('calendario-' + iso) }, d.getDate(), h('span', { class: 'dots' }, dots));
    };
    const refs = refsOn(calSel), planRef = refs.find(r => !r.x), logs = S.logs.filter(l => l.date === calSel);
    return [h('h1', {}, 'Calendario'),
      h('div', { class: 'week' }, btn('‹', () => shift(-1), 'sm'), h('div', { class: 't big', style: 'font-size:17px;text-transform:capitalize' }, `${MONTHS_FULL[first.getMonth()]} ${first.getFullYear()}`),
        btn('Oggi', () => { calMonth = t.slice(0, 7) + '-01'; go('calendario-' + t); }, 'sm'), btn('›', () => shift(1), 'sm')),
      h('div', { class: 'cal' }, ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => h('div', { class: 'wh' }, x)), cells.map(cell)),
      h('div', { class: 'cal-key sub' }, h('span', {}, h('i', {}), 'in programma'), h('span', {}, h('i', { class: 'ex' }), 'extra'), h('span', {}, h('i', { class: 'ok' }), 'fatta')),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('h2', { class: 'grow', style: 'margin:0;text-transform:capitalize' }, `${WD_FULL[wdIdx(calSel)]} ${fmtDate(calSel)}`),
        btn('+ Nuova sessione', () => newSessionSheet(calSel), 'sm pri')),
      refs.map(r => sessionCard(r, !!r.x)),
      refs.length ? null : h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'Nessuna sessione in programma.')),
      planRef ? h('div', { class: 'btns' }, btn('Modifica nel piano', () => { location.hash = `giorno-${planRef.w}-${planRef.d}`; }, 'sm')) : null,
      logs.length ? [h('h2', {}, 'Registrate in questa data'), logs.map(logCard)] : null];
  }

  /* ---------- Piano ---------- */
  function viewPlan() {
    const p = plan(), out = [h('h1', {}, 'Piano')];
    out.push(h('div', { class: 'row' },
      S.plans.length ? h('select', { class: 'inp grow', style: 'margin:0', value: S.activePlan, onchange: e => { S.activePlan = e.target.value; curWeek = null; save(); render(); } },
        S.plans.map(x => h('option', { value: x.id }, x.title))) : h('div', { class: 'grow sub' }, 'Nessun piano'),
      btn('Gestisci', planSheet, 'sm')));
    if (!p) return out;
    if (curWeek == null || curWeek >= p.weeks.length) { const pos = C.locate(p, C.todayISO()); curWeek = pos ? pos.w : 0; }
    const w = curWeek, week = p.weeks[w], t = C.todayISO();
    const periods = [...new Set(week.flatMap(d => d.sessions.map(s => C.PERIODS[s.period])))].join(', ');
    const tot = week.reduce((a, d) => a + d.sessions.reduce((x, s) => x + C.sessionMinutes(s), 0), 0);
    const prev = btn('‹', () => { curWeek--; render(); }, 'sm'), next = btn('›', () => { curWeek++; render(); }, 'sm');
    prev.disabled = w === 0; next.disabled = w === p.weeks.length - 1;
    out.push(h('div', { class: 'week' }, prev,
      h('div', { class: 't' }, h('div', { class: 'big', style: 'font-size:17px' }, `Settimana ${w + 1} / ${p.weeks.length}`),
        h('div', { class: 'sub' }, `${fmtDate(C.dateOf(p, w, 0))} – ${fmtDate(C.dateOf(p, w, 6))} · ${tot} min${periods ? ' · ' + periods : ''}`)), next));
    week.forEach((day, d) => {
      const iso = C.dateOf(p, w, d);
      out.push(h('div', { class: 'card tap day row' + (iso === t ? ' today' : ''), onclick: () => { location.hash = `giorno-${w}-${d}`; } },
        h('div', { class: 'wd' }, WD[d], h('div', { style: 'font-weight:400;text-transform:none' }, fmtDate(iso))),
        h('div', { class: 'grow' }, day.sessions.length ? day.sessions.map((s, si) => h('div', { style: 'margin:2px 0' },
          h('div', { class: 'n', style: 'font-weight:600' }, C.DAY_TYPES[s.type], ' ', h('span', { class: 'sub' }, C.sessionMinutes(s) + ' min'), isDone({ p, w, d, si }) ? h('span', { class: 'tag ok', style: 'margin-left:6px' }, '✓') : null),
          h('div', { class: 'sub', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, s.blocks.map(b => (S.exercises[b.exId] || {}).name).filter(Boolean).join(' · ')))) : h('div', { class: 'sub' }, 'Recupero'))));
    });
    return out;
  }

  function planSheet() {
    const p = plan(), body = [];
    let ov;
    const done = () => { save(); ov.remove(); render(); };
    if (p) {
      const title = h('input', { value: p.title }), start = h('input', { type: 'date', value: p.startDate });
      const target = h('select', {}, p.weeks.map((_, i) => i === curWeek ? null : h('option', { value: i }, 'Settimana ' + (i + 1))));
      body.push(field('Nome', title), field('Inizio (viene portato al lunedì)', start),
        btn('Salva nome e data', () => { p.title = title.value.trim() || p.title; if (C.validISO(start.value)) p.startDate = C.mondayOf(start.value); done(); }, 'pri block'),
        h('h2', {}, `Settimane (${p.weeks.length})`),
        h('div', { class: 'btns' }, btn('+ Aggiungi in fondo', () => { p.weeks.push(C.emptyWeek()); done(); }, 'sm'),
          btn('Duplica la settimana ' + (curWeek + 1), () => { p.weeks.splice(curWeek + 1, 0, p.weeks[curWeek].map(C.cloneDay)); done(); }, 'sm'),
          btn('Elimina la settimana ' + (curWeek + 1), async () => { if (p.weeks.length > 1 && await confirmDlg(`Eliminare la settimana ${curWeek + 1}? Le successive scalano di una.`, 'Elimina')) { p.weeks.splice(curWeek, 1); done(); } }, 'sm danger')),
        p.weeks.length > 1 ? h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'sub' }, `Copia la ${curWeek + 1} su`), h('div', { class: 'grow' }, target),
          btn('Copia', async () => { const i = +target.value; if (await confirmDlg(`Sovrascrivere la settimana ${i + 1} con la ${curWeek + 1}?`, 'Sovrascrivi')) { p.weeks[i] = p.weeks[curWeek].map(C.cloneDay); done(); } }, 'sm')) : null,
        h('h2', {}, 'File'),
        h('div', { class: 'btns' }, btn('Esporta .blokplan', () => {
          if (p.weeks.some(w => w.some(d => d.sessions.length > 2))) toast('Nota: Blok accetta 2 sessioni al giorno, le altre non vengono esportate.');
          exportSheet('Esporta piano', p.title.replace(/[^\w+-]+/g, '_') + '.blokplan', JSON.stringify(C.exportBlokplan(p, S.exercises)));
        }, 'sm'),
          btn('Elimina piano', async () => { if (await confirmDlg(`Eliminare "${p.title}"? Il diario resta.`, 'Elimina')) { S.plans = S.plans.filter(x => x !== p); S.activePlan = S.plans[0] ? S.plans[0].id : null; curWeek = null; done(); } }, 'sm danger')));
    }
    const nTitle = h('input', { placeholder: 'Blocco di forza' }), nWeeks = numInp(4);
    body.push(h('h2', {}, 'Nuovo piano'), h('div', { class: 'cols' }, field('Nome', nTitle), field('Settimane', nWeeks)),
      h('div', { class: 'btns' }, btn('Crea', () => {
        const n = Math.min(52, Math.max(1, Math.round(val(nWeeks) || 4)));
        const np = { id: C.uid(), title: nTitle.value.trim() || 'Nuovo piano', startDate: C.mondayOf(C.todayISO()), weeks: Array.from({ length: n }, C.emptyWeek) };
        S.plans.push(np); S.activePlan = np.id; curWeek = 0; done();
      }, 'sm pri'), fileBtn('Importa .blokplan', () => ov.remove())));
    ov = openSheet('Gestisci piani', body);
  }

  function fileBtn(label, after) {
    const inp = h('input', { type: 'file', accept: '.blokplan,.json,application/json', hidden: '', onchange: async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      try { await importText(await f.text()); if (after) after(); }
      catch (e) { console.warn('[import] fallito', e); toast(e instanceof SyntaxError ? 'Il file non è JSON valido.' : e.message); }
    } });
    return h('span', {}, inp, btn(label, () => inp.click(), 'sm'));
  }
  async function importText(text) {
    const obj = JSON.parse(text);
    if (C.validState(obj)) { // backup completo
      if (!await confirmDlg('Questo è un backup completo: sostituire TUTTI i dati attuali?', 'Sostituisci')) return;
      S = migrate(obj); curWeek = null; calSel = calMonth = null; save(); render(); toast('Backup ripristinato.'); log('import', 'backup ripristinato');
      return;
    }
    const r = C.importBlokplan(obj, S.exercises); // lancia se non valido: lo stato non viene toccato
    for (const e of r.exercises) S.exercises[e.id] = e;
    S.plans.push(r.plan); S.activePlan = r.plan.id; curWeek = null; save(); render();
    toast(`Importato ${r.plan.title}.`); log('import', 'piano importato', { title: r.plan.title, weeks: r.plan.weeks.length, nuoviEsercizi: r.exercises.length });
  }

  function viewDay(w, d) {
    const p = plan();
    if (!p || !p.weeks[w] || !p.weeks[w][d]) return [h('p', {}, 'Giorno non trovato.'), btn('Al piano', () => { location.hash = 'piano'; })];
    curWeek = w;
    const day = p.weeks[w][d], iso = C.dateOf(p, w, d);
    return [h('div', { class: 'row' }, btn('‹ Piano', () => { location.hash = 'piano'; }, 'sm'), h('div', { class: 'sub right' }, `Settimana ${w + 1}`)),
      h('h1', { style: 'margin-top:10px;text-transform:capitalize' }, `${wdOf(iso)} ${fmtDate(iso)}`), h('div', { class: 'sub' }, 'Tocca un esercizio per modificarlo.'),
      day.sessions.map((_, si) => sessionCard({ p, w, d, si }, true)),
      day.sessions.length ? null : h('div', { class: 'card' }, h('div', { class: 'big' }, 'Recupero')),
      h('div', { class: 'btns' }, btn('+ Sessione', () => { day.sessions.push({ id: C.uid(), type: 'wall', period: (day.sessions[0] || {}).period || 'base', blocks: [] }); save(); render(); }, 'sm'),
        btn('Copia su un altro giorno…', () => copyDaySheet(p, w, d), 'sm'))];
  }
  function copyDaySheet(p, w, d) {
    const wk = h('select', { value: w }, p.weeks.map((_, i) => h('option', { value: i }, 'Settimana ' + (i + 1))));
    const dd = h('select', { value: (d + 1) % 7 }, WD.map((n, i) => h('option', { value: i }, n)));
    const ov = openSheet('Copia giorno', [h('div', { class: 'cols' }, field('Settimana', wk), field('Giorno', dd)),
      btn('Sovrascrivi il giorno scelto', () => { p.weeks[+wk.value][+dd.value] = C.cloneDay(p.weeks[w][d]); save(); ov.remove(); toast('Giorno copiato.'); render(); }, 'pri block')]);
  }
  function sessionSheet(r) {
    const s = sessOf(r), ty = opts(TYPES, s.type), pe = opts(C.PERIODS, s.period);
    const title = r.x ? h('input', { value: r.x.title || '' }) : null, date = r.x ? h('input', { type: 'date', value: r.x.date }) : null;
    const close = () => { save(); ov.remove(); render(); };
    const ov = openSheet('Sessione', [h('div', { class: 'cols' }, field('Tipo', ty), field('Periodo', pe)),
      r.x ? h('div', { class: 'cols' }, field('Data', date), field('Titolo', title)) : null,
      btn('Salva', () => {
        s.type = ty.value; s.period = pe.value;
        if (!r.x) return close();
        const iso = C.validISO(date.value), moved = iso && iso !== r.x.date;
        r.x.title = title.value.trim().slice(0, 80);
        if (iso) r.x.date = iso;
        save(); ov.remove();
        if (moved) showDate(iso); else render();
      }, 'pri block'),
      h('div', { class: 'btns' }, !r.x && r.si > 0 ? btn('Sposta prima', () => { const list = r.p.weeks[r.w][r.d].sessions; list.splice(r.si - 1, 0, list.splice(r.si, 1)[0]); close(); }, 'sm') : null,
        btn('Copia su una data…', () => { ov.remove(); copyToDateSheet(r); }, 'sm'),
        btn('Elimina sessione', async () => {
          if (!await confirmDlg('Eliminare questa sessione? Le registrazioni nel diario restano.', 'Elimina')) return;
          if (r.x) S.extras = S.extras.filter(e => e !== r.x); else r.p.weeks[r.w][r.d].sessions.splice(r.si, 1);
          close();
        }, 'sm danger'))]);
  }
  const exUsage = id => C.usage(S.plans, id) + S.extras.reduce((a, x) => a + x.blocks.filter(y => y.exId === id).length, 0);
  function blockSheet(r, bi) {
    const s = sessOf(r), b = s.blocks[bi], ex = S.exercises[b.exId], n = exUsage(b.exId);
    const min = numInp(b.minutes);
    const close = () => { save(); ov.remove(); render(); };
    const move = k => { s.blocks.splice(bi + k, 0, s.blocks.splice(bi, 1)[0]); close(); };
    const up = btn('↑ Su', () => move(-1), 'sm'), down = btn('↓ Giù', () => move(1), 'sm');
    up.disabled = bi === 0; down.disabled = bi === s.blocks.length - 1;
    const ov = openSheet(ex ? ex.name : 'Esercizio', [ex ? h('p', { class: 'sub' }, exLine(ex)) : null,
      field('Minuti previsti', min), btn('Salva minuti', () => { b.minutes = Math.max(0, Math.round(val(min) || 0)); close(); }, 'pri block'),
      h('div', { class: 'btns' }, up, down, btn('Sostituisci…', () => pickExercise(id => { b.exId = id; close(); }), 'sm'), btn('Rimuovi', () => { s.blocks.splice(bi, 1); close(); }, 'sm danger')),
      ex ? h('div', { class: 'btns' }, btn(`Modifica esercizio (${n} ${n === 1 ? 'uso' : 'usi'})`, () => { ov.remove(); exerciseSheet(ex.id); }, 'sm'),
        n > 1 ? btn('Modifica solo qui', () => { const c = JSON.parse(JSON.stringify(ex)); c.id = C.uid(); S.exercises[c.id] = c; b.exId = c.id; save(); ov.remove(); exerciseSheet(c.id); }, 'sm') : null) : null]);
  }

  /* ---------- Esercizi ---------- */
  function pickExercise(cb) {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Cerca…', oninput: () => fill() });
    let ov;
    const fill = () => {
      const t = q.value.trim().toLowerCase();
      const items = Object.values(S.exercises).filter(e => !t || (e.name + ' ' + exLine(e)).toLowerCase().includes(t))
        .sort((a, b) => a.name.localeCompare(b.name) || a.prescription.localeCompare(b.prescription)).slice(0, 80);
      list.replaceChildren(...items.map(e => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => { ov.remove(); cb(e.id); } },
        h('div', { class: 'grow' }, h('div', { class: 'n' }, e.name), h('div', { class: 'p' }, exLine(e))), h('span', { class: 'tag' }, C.SLOTS[e.slot]))));
      if (!items.length) list.append(h('p', { class: 'sub' }, 'Nessun esercizio: creane uno con "+ Nuovo".'));
    };
    ov = openSheet('Scegli esercizio', [h('div', { class: 'row' }, h('div', { class: 'grow' }, q), btn('+ Nuovo', () => { ov.remove(); exerciseSheet(null, cb); }, 'sm pri')), list]);
    fill();
  }

  function exerciseSheet(id, onCreate) {
    const isNew = !id, e = isNew ? { id: C.uid(), name: '', prescription: '', slot: 'wall', location: 'wall', domain: 'other', intensity: 'moderate', risk: 'low', equipment: [], interval: null, load: null, surface: '' } : S.exercises[id];
    const iv = e.interval || {}, ld = e.load || {};
    const name = h('input', { value: e.name, placeholder: 'Limit MoonBoard' }), pres = h('input', { value: e.prescription, placeholder: '≥ 3 tentativi per problema' });
    const slot = opts(C.SLOTS, e.slot);
    const sfSel = opts(surfOpts().concat([['+new', '＋ Aggiungi nuova…']]), e.surface || '', { onchange: () => sync() }), sfNew = h('input', { placeholder: 'Es. Spray wall' });
    const sfNewField = field('Nome della nuova superficie', sfNew);
    const mode = opts([['none', 'Solo durata (nessun timer)'], ['timed', 'A tempo (countdown)'], ['reps', 'A ripetizioni (tocco "Fatto")']], !e.interval ? 'none' : iv.selfPaced ? 'reps' : 'timed', { onchange: () => sync() });
    const rounds = numInp(iv.rounds || 3), work = numInp(iv.workSeconds || 7), rest = numInp(iv.restSeconds == null ? 180 : iv.restSeconds);
    const reps = numInp(iv.reps), perSet = numInp(iv.roundsPerSet), setRest = numInp(iv.setRestSeconds);
    const cues = h('textarea', { placeholder: 'Un cue per riga, ripetuti a rotazione\nSX · 75% max\nDX · 75% max' }); cues.value = (iv.cues || []).join('\n');
    const refs = [['', 'Nessuno'], ['oh', 'Open hand'], ['hc', 'Half-crimp'], ['sl', 'Sloper'], ['pinch', 'Pinch (SX/DX dal cue)'], ['wrist', 'Polso 6RM']]
      .concat(S.testDefs.filter(t => !C.DEFAULT_TESTS.some(x => x.key === t.key)).map(t => [t.key, t.name]));
    const ref = opts(refs, ld.ref || ''), pct = numInp(ld.pct);
    const lmode = opts({ hang: 'Zavorra su peso corporeo', lift: 'Carico sollevato' }, ld.mode || 'hang'), isTest = h('input', { type: 'checkbox', checked: ld.test });
    const timer = h('div', {}, h('div', { class: 'cols3' }, field('Round', rounds), field('Lavoro (s)', work), field('Recupero (s)', rest)),
      h('div', { class: 'cols3' }, field('Rip. (facolt.)', reps), field('Round per serie', perSet), field('Rec. serie (s)', setRest)), field('Cue', cues));
    const sync = () => { timer.hidden = mode.value === 'none'; sfNewField.hidden = sfSel.value !== '+new'; };
    let ov;
    const body = [field('Nome', name), field('Prescrizione', pres),
      h('div', { class: 'cols' }, field('Sezione', slot), field('Superficie di arrampicata', sfSel)), sfNewField, field('Timer', mode), timer,
      h('h2', {}, 'Carico in kg'), h('div', { class: 'cols' }, field('Massimale di riferimento', ref), field('% del massimale', pct)),
      h('div', { class: 'cols' }, field('Tipo di carico', lmode), h('label', { class: 'f' }, 'Blocco di test', h('div', { style: 'margin-top:12px' }, isTest, ' registra il risultato a fine sessione'))),
      btn(isNew ? 'Crea esercizio' : 'Salva', () => {
        if (!name.value.trim()) return toast('Serve un nome.');
        let sf = sfSel.value;
        if (sf === '+new') {
          const nm = sfNew.value.trim().slice(0, 40);
          if (!nm) return toast('Scrivi il nome della nuova superficie.');
          sf = addSurface(nm);
        }
        e.name = name.value.trim().slice(0, 200); e.prescription = pres.value.trim().slice(0, 200); e.slot = slot.value; e.surface = sf;
        e.location = e.slot === 'wall' || e.slot === 'warmup' ? 'wall' : 'off_wall';
        e.interval = mode.value === 'none' ? null : C.normInterval({ rounds: Math.max(1, val(rounds) || 1), workSeconds: val(work) || 0, restSeconds: val(rest) || 0, selfPaced: mode.value === 'reps',
          reps: val(reps) || 0, roundsPerSet: val(perSet) || 0, setRestSeconds: val(setRest) || 0, cues: cues.value.split('\n').map(s => s.trim()).filter(Boolean) });
        e.load = ref.value ? { ref: ref.value, mode: lmode.value, pct: val(pct), test: isTest.checked } : null;
        S.exercises[e.id] = e; save(); ov.remove(); render();
        if (isNew && onCreate) onCreate(e.id);
      }, 'pri block')];
    if (!isNew) {
      const n = exUsage(e.id);
      body.push(h('div', { class: 'btns' }, btn(n ? `In uso in ${n} blocchi` : 'Elimina dalla libreria', async () => {
        if (n) return toast('Rimuovilo prima dalle sessioni che lo usano.');
        if (await confirmDlg(`Eliminare "${e.name}" dalla libreria?`, 'Elimina')) { delete S.exercises[e.id]; save(); ov.remove(); render(); }
      }, 'sm danger')));
    }
    ov = openSheet(isNew ? 'Nuovo esercizio' : 'Modifica esercizio', body);
    sync();
  }

  function viewLibrary() {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Cerca per nome o superficie…', oninput: () => fill() });
    const fill = () => {
      const t = q.value.trim().toLowerCase();
      const items = Object.values(S.exercises).filter(e => !t || (e.name + ' ' + exLine(e)).toLowerCase().includes(t))
        .sort((a, b) => a.name.localeCompare(b.name) || a.prescription.localeCompare(b.prescription));
      list.replaceChildren(...items.map(e => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => exerciseSheet(e.id) },
        h('div', { class: 'grow' }, h('div', { class: 'n' }, e.name), h('div', { class: 'p' }, exLine(e))), h('div', { class: 'm' }, exUsage(e.id) + ' usi'))));
      if (!items.length) list.append(h('p', { class: 'sub' }, 'Nessun esercizio.'));
    };
    fill();
    return [h('div', { class: 'row' }, btn('‹ Altro', () => { location.hash = 'altro'; }, 'sm'), btn('+ Nuovo', () => exerciseSheet(null), 'sm pri right')),
      h('h1', { style: 'margin-top:10px' }, 'Esercizi'), h('div', { class: 'sub' }, Object.keys(S.exercises).length + ' in libreria'), h('div', { style: 'margin-top:10px' }, q), h('div', { class: 'card' }, list)];
  }

  /* ---------- Diario ---------- */
  /** Righe "superficie · grado massimo chiuso · blocchi chiusi · minuti": un primo logbook per superficie. */
  function climbEditor(rows, defaultMinutes) {
    const box = h('div', {}), items = [];
    const add = c => {
      const sf = opts(surfOpts(), c.surface || ''), gr = opts(gradeOpts(), c.top || ''), sends = numInp(c.sends), min = numInp(c.minutes);
      items.push({ c, sf, gr, sends, min });
      box.append(h('div', { class: 'climb' }, c.name ? h('div', { class: 'n' }, c.name) : null,
        h('div', { class: 'cols' }, field('Superficie', sf), field('Grado max chiuso', gr)), h('div', { class: 'cols' }, field('Blocchi chiusi', sends), field('Minuti', min))));
    };
    rows.forEach(add);
    return { node: h('div', {}, box, btn('+ Superficie', () => add({ minutes: items.length ? null : defaultMinutes() }), 'sm')),
      read: () => items.filter(i => i.sf.value).map(i => ({ name: i.c.name || '', surface: i.sf.value, top: i.gr.value || null,
        sends: val(i.sends) == null ? null : Math.max(0, Math.round(val(i.sends))), minutes: Math.max(0, Math.round(val(i.min) || 0)) })) };
  }
  function logSheet(l) {
    const isNew = !l; l = l || { id: C.uid(), date: C.todayISO(), type: 'wall', title: 'Sessione libera', minutes: 60, rpe: null, feel: null, notes: '', loads: [], climbs: [] };
    const date = h('input', { type: 'date', value: l.date }), title = h('input', { value: l.title }), min = numInp(l.minutes), ty = opts(LOG_TYPES, l.type || 'other');
    const rpe = numInp(l.rpe), feel = opts(FEEL, l.feel ? String(l.feel) : '');
    const notes = h('textarea', {}); notes.value = l.notes || '';
    const climbs = climbEditor(l.climbs || [], () => val(min));
    const ov = openSheet(isNew ? 'Registra sessione' : 'Modifica registrazione', [h('div', { class: 'cols' }, field('Data', date), field('Minuti', min)),
      h('div', { class: 'cols' }, field('Titolo', title), field('Tipo', ty)),
      h('div', { class: 'cols' }, field('RPE (1-10)', rpe), field('Come ti sentivi', feel)),
      h('h2', {}, 'Arrampicata'), climbs.node, field('Note', notes),
      (l.loads || []).length ? h('div', { class: 'sub' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
      btn('Salva', () => {
        Object.assign(l, { date: C.validISO(date.value) || l.date, title: title.value.trim() || 'Sessione', type: ty.value, minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe),
          feel: feel.value ? +feel.value : null, notes: notes.value.trim(), climbs: climbs.read() });
        if (isNew) S.logs.push(l);
        save(); ov.remove(); render();
      }, 'pri block'),
      isNew ? null : btn('Elimina', async () => { if (await confirmDlg('Eliminare questa registrazione?', 'Elimina')) { S.logs = S.logs.filter(x => x !== l); save(); ov.remove(); render(); } }, 'danger block')]);
  }
  function viewDiary() {
    const logs = [...S.logs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return [h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Diario'), btn('+ Registra', () => logSheet(null), 'sm pri')),
      h('div', { class: 'sub' }, `${logs.length} sessioni · ${logs.reduce((a, l) => a + (l.minutes || 0), 0)} minuti`),
      logs.length ? null : h('div', { class: 'card' }, h('p', { class: 'sub' }, 'Le sessioni completate con il player finiscono qui, con RPE, note, carichi e gradi per superficie.')),
      logs.map(logCard)];
  }

  /* ---------- Analisi ---------- */
  const anHead = cur => [h('h1', {}, 'Analisi'), seg([['analisi', 'Grafici'], ['progressi', 'Test e massimali']], cur, k => { location.hash = k; })];
  const chartCard = (title, sub, ...nodes) => h('div', { class: 'card' }, h('div', { class: 'ct' }, title), sub ? h('div', { class: 'sub' }, sub) : null, nodes);
  const tile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), h('div', { class: 's' }, sub || ' '));
  let anWeeks = 8;
  function viewAnalytics() {
    const t = C.todayISO(), mon = C.mondayOf(t), to = C.addDays(mon, 6);
    let from = C.addDays(mon, -7 * ((anWeeks || 1) - 1));
    if (!anWeeks) { // "Tutto": dalla prima registrazione, al massimo due anni
      const cap = C.addDays(mon, -7 * 103);
      from = C.mondayOf(S.logs.reduce((m, l) => (l.date < m ? l.date : m), t));
      if (from < cap) from = cap;
    }
    const sched = C.scheduled(plan(), S.extras), wk = C.weeklyStats(S.logs, sched, from, to), sum = C.summary(S.logs, sched, from, to, t);
    const labels = wk.map(w => fmtDate(w.week)), long = wk.map(w => `${fmtDate(w.week)} – ${fmtDate(C.addDays(w.week, 6))}`);
    // Un solo filtro, sopra tutto quello che governa
    const out = [anHead('analisi'), seg([[4, '4 sett.'], [8, '8 sett.'], [12, '12 sett.'], [0, 'Tutto']], anWeeks, k => { anWeeks = k; render(); }),
      h('div', { class: 'sub' }, `${fmtDate(from)} – ${fmtDate(to)} · settimana in corso inclusa`),
      h('div', { class: 'tiles' },
        tile('Sessioni', sum.sessions, sum.due ? `${sum.due} in programma finora` : ''),
        tile('Tempo', sum.minutes < 120 ? sum.minutes + ' min' : dec((sum.minutes / 60).toFixed(1)) + ' h', sum.sessions ? `${Math.round(sum.minutes / sum.sessions)} min a sessione` : ''),
        tile('RPE medio', sum.rpe == null ? '—' : dec(sum.rpe.toFixed(1)), sum.rpeN ? `su ${sum.rpeN} ${sum.rpeN === 1 ? 'sessione' : 'sessioni'}` : 'nessun RPE registrato'),
        tile('Aderenza al piano', sum.due ? Math.round(sum.dueDone / sum.due * 100) + '%' : '—', sum.due ? `${sum.dueDone} di ${sum.due} sessioni fatte` : 'niente in programma'))];
    if (!sum.sessions && !wk.some(w => w.plannedMinutes))
      return out.concat(h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'Nessun dato in questo periodo. I grafici si riempiono quando completi una sessione con il player o la registri nel Diario.')));

    if (wk.some(w => w.minutes || w.plannedMinutes)) out.push(chartCard('Volume settimanale', 'Minuti registrati nel diario, confrontati con quelli in programma.',
      Charts.columns({ labels, longLabels: long, values: wk.map(w => w.minutes), targets: wk.map(w => w.plannedMinutes), unit: 'min', name: 'Fatti', targetName: 'In programma', aria: 'Minuti di allenamento per settimana' })));
    if (wk.some(w => w.load)) out.push(chartCard('Carico settimanale', 'Somma di minuti × RPE delle sessioni con RPE (unità arbitrarie).',
      Charts.columns({ labels, longLabels: long, values: wk.map(w => Math.round(w.load)), name: 'Carico', aria: 'Carico di allenamento sRPE per settimana' })));
    if (wk.some(w => w.rpe != null)) out.push(chartCard('Sforzo percepito', 'RPE medio delle sessioni della settimana (scala 1–10).',
      Charts.line({ labels, longLabels: long, values: wk.map(w => w.rpe), name: 'RPE medio', domain: { min: 0, max: 10, step: 5 }, height: 120, aria: 'RPE medio per settimana' })));
    if (wk.some(w => w.feel != null)) out.push(chartCard('Sensazione', 'Media di "come ti sentivi" (1 distrutto – 5 ottimo).',
      Charts.line({ labels, longLabels: long, values: wk.map(w => w.feel), name: 'Sensazione media', domain: { min: 1, max: 5, step: 2 }, height: 120, aria: 'Sensazione media per settimana' })));

    const types = C.minutesByType(S.logs, from, to);
    if (types.length) out.push(chartCard('Tempo per tipo di sessione', null,
      Charts.hbars(types.map(x => ({ label: x.type === 'other' ? 'Altro' : C.DAY_TYPES[x.type], value: x.minutes, text: `${x.minutes} min · ${sum.minutes ? Math.round(x.minutes / sum.minutes * 100) : 0}%` })))));

    // Superfici: tempo, blocchi chiusi e grado massimo; poi un pannello per superficie, tutti sulla stessa scala di gradi
    const surf = C.surfaceStats(S.logs, from, to);
    if (surf.length) {
      const table = h('table', { class: 'tbl' }, h('tr', {}, ['Superficie', 'Sessioni', 'Blocchi chiusi', 'Grado max'].map(x => h('th', {}, x))),
        surf.map(x => h('tr', {}, h('td', {}, surfName(x.surface)), h('td', {}, x.sessions), h('td', {}, x.sends), h('td', {}, x.top ? fmtG(x.top) : '—'))));
      out.push(chartCard('Superfici di arrampicata', 'Minuti passati su ogni superficie nel periodo.',
        Charts.hbars(surf.map(x => ({ label: surfName(x.surface), value: x.minutes, text: x.minutes + ' min' }))), table));
      const tg = C.weeklyTopGrades(S.logs, from, to);
      const keys = S.surfaces.map(x => x.key).filter(k => tg.series[k]).concat(Object.keys(tg.series).filter(k => !S.surfaces.some(x => x.key === k)));
      if (keys.length) {
        const all = keys.flatMap(k => tg.series[k].filter(v => v != null));
        const lo = Math.max(0, Math.min(...all) - 1), hi = Math.min(C.GRADES.length - 1, Math.max(...all) + 1), step = Math.max(1, Math.ceil((hi - lo) / 4));
        const domain = { min: lo, max: lo + step * Math.ceil((hi - lo) / step), step }, fmt = v => (C.GRADES[Math.round(v)] ? fmtG(C.GRADES[Math.round(v)]) : '');
        out.push(chartCard('Grado massimo chiuso per superficie', 'Il blocco più duro chiuso ogni settimana. I pannelli usano la stessa scala, così si confrontano a colpo d\'occhio.',
          keys.map(k => [h('div', { class: 'sm-t' }, surfName(k)),
            Charts.line({ labels, longLabels: long, values: tg.series[k], name: 'Grado max', domain, fmt, height: 112, aria: `Grado massimo chiuso per settimana su ${surfName(k)}` })])));
      }
    }

    const loads = C.loadSeries(S.logs, from, to);
    if (loads.length) out.push(chartCard('Carichi usati', 'Dai carichi registrati a fine sessione. Tocca una riga per il grafico completo.',
      loads.map(s => {
        const v = s.points.map(p => p.kg), last = v[v.length - 1];
        return h('div', { class: 'blk', style: 'cursor:pointer;align-items:center', onclick: () => openSheet(s.name, Charts.line({ labels: s.points.map(p => fmtDate(p.date)), values: v, name: 'Carico', unit: 'kg', colLabel: 'Data', aria: `Carico usato per ${s.name}` })) },
          h('div', { class: 'grow' }, h('div', { class: 'n' }, s.name), h('div', { class: 'p' }, `${v.length} ${v.length === 1 ? 'registrazione' : 'registrazioni'}`)),
          Charts.spark(v), h('div', { class: 'm', style: 'color:var(--tx);font-weight:600;min-width:58px;text-align:right' }, dec(last) + ' kg'));
      })));
    return out;
  }

  function testSheet(def) {
    const date = h('input', { type: 'date', value: C.todayISO() }), v = numInp(null);
    const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? 1 : -1));
    let ov;
    const again = () => { save(); ov.remove(); render(); };
    ov = openSheet(def.name, [h('div', { class: 'cols' }, field('Data', date), field(`Valore (${def.unit})`, v)),
      btn('Aggiungi risultato', () => { const n = val(v); if (n == null) return toast('Inserisci un numero.'); S.tests.push({ id: C.uid(), key: def.key, date: C.validISO(date.value) || C.todayISO(), value: n }); again(); }, 'pri block'),
      h('h2', {}, 'Storico'), hist.length ? hist.map(t => h('div', { class: 'blk' }, h('div', { class: 'grow' }, `${fmtDate(t.date)} ${t.date.slice(0, 4)}`), h('div', { class: 'n' }, dec(t.value) + ' ' + def.unit),
        btn('✕', () => { S.tests = S.tests.filter(x => x !== t); again(); }, 'sm'))) : h('p', { class: 'sub' }, 'Ancora nessun risultato.'),
      C.DEFAULT_TESTS.some(x => x.key === def.key) ? null : btn('Elimina questo test', async () => { if (await confirmDlg(`Eliminare "${def.name}" e il suo storico?`, 'Elimina')) { S.testDefs = S.testDefs.filter(x => x !== def); S.tests = S.tests.filter(t => t.key !== def.key); again(); } }, 'danger block')]);
  }
  function viewProgress() {
    const name = h('input', { placeholder: 'Hang a una mano 22 mm' }), unit = h('input', { placeholder: 's', value: 'kg' });
    return [anHead('progressi'), h('div', { class: 'sub' }, 'L\'ultimo valore di ogni test è il massimale usato per calcolare i kg nel piano e nel player.'),
      S.testDefs.map(def => {
        const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? -1 : 1)), last = hist[hist.length - 1];
        return h('div', { class: 'card tap row', onclick: () => testSheet(def) },
          h('div', { class: 'grow' }, h('div', { class: 'sub' }, def.name), h('div', { class: 'big' }, last ? dec(last.value) + ' ' + def.unit : '—'),
            h('div', { class: 'sub' }, last ? `${fmtDate(last.date)} · ${hist.length} ${hist.length === 1 ? 'risultato' : 'risultati'}` : 'Tocca per aggiungere')),
          Charts.spark(hist.map(t => t.value)));
      }),
      h('h2', {}, 'Nuovo test'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Nome', name), field('Unità', unit)),
        btn('Aggiungi test', () => { if (!name.value.trim()) return toast('Serve un nome.'); S.testDefs.push({ key: 'c-' + C.uid().slice(0, 8), name: name.value.trim(), unit: unit.value.trim() || 'kg' }); save(); render(); }, 'sm'))];
  }

  /* ---------- Altro ---------- */
  function surfaceSheet(x) {
    const name = h('input', { value: x.name });
    const used = Object.values(S.exercises).some(e => e.surface === x.key) || S.logs.some(l => (l.climbs || []).some(c => c.surface === x.key));
    const ov = openSheet('Superficie', [field('Nome', name),
      btn('Salva', () => { const n = name.value.trim().slice(0, 40); if (!n) return toast('Serve un nome.'); x.name = n; save(); ov.remove(); render(); }, 'pri block'),
      btn(used ? 'In uso: non eliminabile' : 'Elimina', async () => {
        if (used) return toast('È usata da esercizi o registrazioni: puoi rinominarla.');
        if (await confirmDlg(`Eliminare la superficie "${x.name}"?`, 'Elimina')) { S.surfaces = S.surfaces.filter(s => s !== x); save(); ov.remove(); render(); }
      }, 'danger block')]);
  }
  function viewMore() {
    const prep = numInp(S.settings.prep), sound = h('input', { type: 'checkbox', checked: S.settings.sound, onchange: () => { S.settings.sound = sound.checked; save(); } });
    const sfNew = h('input', { class: 'inp', style: 'margin:0', placeholder: 'Nuova superficie' });
    return [h('h1', {}, 'Altro'),
      h('div', { class: 'card tap row', onclick: () => { location.hash = 'libreria'; } }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Libreria esercizi'), h('div', { class: 'sub' }, Object.keys(S.exercises).length + ' esercizi')), '›'),
      h('h2', {}, 'Superfici di arrampicata'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Si assegnano agli esercizi e alle registrazioni, per confrontare l\'avanzamento nei grafici. Tocca per rinominare.'),
        h('div', { class: 'btns', style: 'margin-top:0' }, S.surfaces.map(x => btn(x.name, () => surfaceSheet(x), 'sm'))),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, sfNew), btn('Aggiungi', () => { const n = sfNew.value.trim().slice(0, 40); if (!n) return toast('Scrivi un nome.'); addSurface(n); save(); render(); }, 'sm')),
        h('p', { class: 'sub', style: 'margin-bottom:0' }, `Scala dei gradi: ${C.GRADE_SCALES[S.settings.gradeScale] || 'Font'}. La scelta di altre scale arriverà qui.`)),
      h('h2', {}, 'Player'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Preparazione prima di un hang (s)', prep), h('label', { class: 'f' }, 'Segnali acustici', h('div', { style: 'margin-top:12px' }, sound, ' attivi'))),
        btn('Salva', () => { S.settings.prep = Math.min(60, Math.max(0, Math.round(val(prep) || 0))); save(); toast('Salvato.'); }, 'sm')),
      h('h2', {}, 'Dati'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'I dati restano solo su questo dispositivo. Fai un backup ogni tanto.'),
        h('div', { class: 'btns' }, btn('Backup completo', () => exportSheet('Backup', `allenamento-backup-${C.todayISO()}.json`, JSON.stringify(S)), 'sm pri'), fileBtn('Ripristina / importa file'),
          btn('Azzera tutto', async () => { if (await confirmDlg('Cancellare piani, esercizi, diario e test? L\'operazione non si può annullare: fai prima un backup.', 'Azzera')) { S = fresh(); curWeek = null; calSel = calMonth = null; save(); render(); } }, 'sm danger')))];
  }

  /* ---------- Player ---------- */
  let P = null, ac = null, wl = null;
  function audioInit() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) { ac = null; } }
  function beep(freq, dur) {
    if (!S.settings.sound || !ac) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.frequency.value = freq; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* audio non disponibile: il player continua senza suoni */ }
  }
  async function wake() { try { if (navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); } catch (e) { wl = null; } }
  document.addEventListener('visibilitychange', () => { if (P && document.visibilityState === 'visible') { wake(); tick(); } });
  const mmss = s => { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s); };
  const isAuto = st => st.kind === 'rest' || (st.kind === 'work' && !st.selfPaced);

  function startSession(r, idx) {
    const s = sessOf(r), steps = C.buildSteps(s.blocks, S.exercises, S.settings.prep);
    if (!steps.length) return toast('Questa sessione non ha esercizi.');
    audioInit(); wake();
    const resumed = S.live && S.live.sid === s.id;
    // acc: millisecondi passati in ogni blocco (pause escluse), per sapere quanto tempo è andato su ogni superficie
    P = { steps, r, s, startedAt: resumed ? S.live.startedAt : Date.now(), acc: resumed && S.live.acc ? { ...S.live.acc } : {}, paused: false, idx: null };
    S.live = { sid: s.id, idx: 0, startedAt: P.startedAt, acc: P.acc };
    $('player').hidden = false;
    P.timer = setInterval(tick, 200);
    enter(Math.min(idx || 0, steps.length - 1));
    log('player', 'sessione avviata', { sessione: refTitle(r), passi: steps.length });
  }
  function track() { // attribuisce al blocco corrente il tempo dall'ultimo cambio di passo
    if (P.idx == null) return;
    const now = Date.now(), b = P.steps[P.idx].block;
    P.acc[b] = (P.acc[b] || 0) + Math.max(0, now - P.stepAt - P.stepPaused - (P.paused ? now - P.pauseAt : 0));
  }
  function enter(i) {
    track();
    P.idx = i; P.endAt = Date.now() + P.steps[i].seconds * 1000; P.lastBeep = null; P.freeDone = false;
    P.stepAt = Date.now(); P.stepPaused = 0;
    if (P.paused) { P.remain = P.steps[i].seconds * 1000; P.pauseAt = Date.now(); }
    S.live.idx = i; S.live.acc = P.acc; save(); draw();
  }
  function next() { if (P.idx + 1 >= P.steps.length) finish(); else enter(P.idx + 1); }
  function remaining() { return ((P.paused ? P.remain : P.endAt - Date.now())) / 1000; }
  function tick() {
    if (!P || P.paused) return;
    const st = P.steps[P.idx], rem = Math.ceil(remaining());
    if (isAuto(st)) {
      if (rem <= 0) { beep(st.kind === 'rest' ? 1320 : 660, 0.5); return next(); }
      if (rem <= 3 && rem !== P.lastBeep) { P.lastBeep = rem; beep(880, 0.12); }
    } else if (st.kind === 'free' && st.seconds > 0 && rem <= 0 && !P.freeDone) { P.freeDone = true; beep(660, 0.5); }
    drawClock();
  }
  function drawClock() {
    const st = P.steps[P.idx], rem = remaining();
    let txt;
    if (isAuto(st)) txt = mmss(Math.ceil(rem));
    else if (st.kind === 'work') txt = mmss(st.seconds - rem); // a ripetizioni: tempo trascorso
    else txt = rem >= 0 ? mmss(Math.ceil(rem)) : '+' + mmss(-rem);
    $('p-clock').textContent = txt;
  }
  function draw() {
    const st = P.steps[P.idx], nx = P.steps[P.idx + 1], ex = S.exercises[st.exId];
    const ph = st.prep ? 'prep' : st.kind;
    $('player').dataset.ph = ph;
    $('p-bar').style.width = (P.idx / P.steps.length * 100) + '%';
    $('p-ph').textContent = { prep: 'PREPARATI', work: st.selfPaced ? 'ESEGUI' : 'LAVORO', rest: 'RECUPERO', free: 'A TEMPO LIBERO' }[ph];
    $('p-name').textContent = st.kind === 'rest' && st.afterBlock && nx ? 'Prossimo: ' + nx.name : st.name;
    $('p-round').textContent = st.kind === 'free' ? (ex && ex.surface ? surfName(ex.surface) : '') : `Round ${st.round} di ${st.rounds}`;
    $('p-cue').textContent = st.kind === 'rest' && st.afterBlock ? (nx ? nx.cue : '') : st.cue;
    const src = st.kind === 'rest' && st.afterBlock && nx ? { ex: S.exercises[nx.exId], cue: nx.cue } : { ex, cue: st.cue };
    const kg = src.ex && st.kind !== 'free' ? C.loadKg(src.ex.load, src.cue, maxes()) : null;
    $('p-kg').textContent = kg == null ? '' : (src.ex.load.mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
    $('p-next').textContent = nx ? 'Poi: ' + (nx.kind === 'rest' ? `recupero ${mmss(nx.seconds)}` : nx.name + (nx.cue && nx.kind !== 'free' ? ' · ' + nx.cue : '')) : 'Ultimo passo';
    $('p-done').textContent = isAuto(st) ? 'Salta' : 'Fatto';
    $('p-done').className = 'btn ' + (isAuto(st) ? '' : 'pri');
    $('p-plus').disabled = st.kind !== 'rest';
    $('p-pause').textContent = P.paused ? 'Riprendi' : 'Pausa';
    drawClock();
  }
  function closePlayer() { clearInterval(P.timer); try { if (wl) wl.release(); } catch (e) { /* già rilasciato */ } wl = null; $('player').hidden = true; }
  function finish() {
    track();
    const { r, s, acc } = P, minutes = Math.max(1, Math.round((Date.now() - P.startedAt) / 60000));
    closePlayer(); P = null; beep(1320, 0.8);
    const m = maxes(), loadRows = [], testRows = [], climbRows = [], seen = new Set();
    s.blocks.forEach((b, bi) => {
      const ex = S.exercises[b.exId];
      if (!ex) return;
      // blocchi di arrampicata: superficie (modificabile), grado massimo chiuso, blocchi chiusi, minuti misurati dal player
      if (ex.slot === 'wall' || ex.surface) climbRows.push({ name: ex.name, surface: ex.surface || '', minutes: Math.round((acc[bi] || 0) / 60000) });
      if (!ex.load) return;
      if (ex.load.test) {
        const keys = ex.load.ref === 'pinch' ? ['pinchL', 'pinchR'] : [ex.load.ref];
        for (const k of keys) if (!seen.has(k)) { seen.add(k); const def = S.testDefs.find(t => t.key === k); if (def) testRows.push({ def, inp: numInp(null, { placeholder: m[k] == null ? '' : 'precedente: ' + dec(m[k]) }) }); }
      } else loadRows.push({ name: ex.name, inp: h('input', { value: loadHint(ex).replace('kg: mancano i massimali', '') }) });
    });
    const min = numInp(minutes), rpe = numInp(null), notes = h('textarea', {}), feel = opts(FEEL, ''), climbs = climbEditor(climbRows, () => val(min));
    let ov;
    const end = () => { S.live = null; save(); ov.remove(); go('diario'); };
    ov = openSheet('Sessione completata', [h('div', { class: 'cols3' }, field('Minuti', min), field('RPE (1-10)', rpe), field('Sensazione', feel)),
      testRows.length ? [h('h2', {}, 'Risultati dei test'), h('p', { class: 'sub' }, 'Diventano i nuovi massimali per il calcolo dei kg.'), testRows.map(x => field(`${x.def.name} (${x.def.unit})`, x.inp))] : null,
      loadRows.length ? [h('h2', {}, 'Carichi usati'), loadRows.map(x => field(x.name, x.inp))] : null,
      h('h2', {}, 'Arrampicata'), h('p', { class: 'sub' }, 'Per ogni superficie: il blocco più duro chiuso e quanti ne hai chiusi. Le righe senza superficie non vengono salvate.'), climbs.node,
      field('Note', notes),
      btn('Salva nel diario', () => {
        const date = C.todayISO();
        for (const x of testRows) { const n = val(x.inp); if (n != null) S.tests.push({ id: C.uid(), key: x.def.key, date, value: n }); }
        S.logs.push({ id: C.uid(), date, sid: s.id, type: s.type, period: s.period, title: refTitle(r), minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe), feel: feel.value ? +feel.value : null,
          notes: notes.value.trim(), loads: loadRows.map(x => ({ name: x.name, kg: x.inp.value.trim() })).filter(x => x.kg), climbs: climbs.read() });
        log('player', 'sessione salvata', { minuti: minutes });
        end();
      }, 'pri block'), btn('Non salvare', end, 'block')]);
  }
  function wirePlayer() {
    $('p-done').onclick = () => next();
    $('p-back').onclick = () => enter(Math.max(0, P.idx - 1));
    $('p-plus').onclick = () => { if (P.paused) P.remain += 30000; else P.endAt += 30000; P.lastBeep = null; drawClock(); };
    $('p-pause').onclick = () => {
      if (P.paused) { P.endAt = Date.now() + P.remain; P.stepPaused += Date.now() - P.pauseAt; P.paused = false; audioInit(); }
      else { P.remain = P.endAt - Date.now(); P.pauseAt = Date.now(); P.paused = true; }
      draw();
    };
    $('p-quit').onclick = () => {
      const was = P.paused; if (!was) $('p-pause').onclick();
      const ov = openSheet('Uscire dalla sessione?', h('div', { class: 'btns' },
        btn('Continua', () => { ov.remove(); if (!was) $('p-pause').onclick(); }), btn('Termina e registra', () => { ov.remove(); finish(); }, 'pri'),
        btn('Esci (riprendi dopo)', () => { ov.remove(); track(); S.live.acc = P.acc; save(); closePlayer(); P = null; render(); }),
        btn('Abbandona', () => { ov.remove(); closePlayer(); P = null; S.live = null; save(); render(); }, 'danger')), true);
      ov.style.zIndex = 50;
    };
  }

  /* ---------- Router ---------- */
  const VIEWS = { oggi: viewToday, calendario: viewCalendar, piano: viewPlan, giorno: a => viewDay(+a[0], +a[1]), diario: viewDiary, analisi: viewAnalytics, progressi: viewProgress, altro: viewMore, libreria: viewLibrary };
  function render() {
    const [name, ...args] = (location.hash.slice(1) || 'oggi').split('-');
    const fn = VIEWS[name] || viewToday;
    let nodes;
    try { nodes = fn(args); }
    catch (e) { console.error('[ui] errore nella vista ' + name, e); nodes = [h('h1', {}, 'Qualcosa è andato storto'), h('p', { class: 'sub' }, String(e.message || e)), btn('Torna a Oggi', () => go('oggi'))]; }
    $('view').replaceChildren(...[nodes].flat(Infinity).filter(n => n != null && n !== false));
    const tab = { giorno: 'piano', libreria: 'altro', progressi: 'analisi' }[name] || (VIEWS[name] ? name : 'oggi');
    for (const el of document.querySelectorAll('#tabs a')) el.classList.toggle('on', el.getAttribute('href') === '#' + tab);
  }
  let lastView = (location.hash.slice(1) || 'oggi').split('-')[0];
  window.addEventListener('hashchange', () => {
    for (const o of document.querySelectorAll('.overlay')) o.remove();
    const view = (location.hash.slice(1) || 'oggi').split('-')[0];
    if (view !== lastView || view !== 'calendario') window.scrollTo(0, 0); // nel calendario cambiare giorno non deve riportare in cima
    lastView = view;
    render();
  });
  wirePlayer();
  render();
  window.__app = { get state() { return S; }, render }; // utile per debug dalla console
})();
