/* Interfaccia: viste, editor, player. Tutta la logica testabile sta in core.js. */
(function () {
  'use strict';
  const C = Core, KEY = 'allenamento.v1';
  const WD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const fmtDate = iso => { const d = C.fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const wdOf = iso => WD[(C.fromISO(iso).getDay() + 6) % 7];
  const log = (area, msg, extra) => console.info(`[${area}] ${msg}`, extra === undefined ? '' : extra);

  /* ---------- Stato e persistenza ---------- */
  function fresh() {
    const r = C.importBlokplan(Seed.blokplan());
    return migrate({ v: 1, plans: [r.plan], activePlan: r.plan.id, exercises: Object.fromEntries(r.exercises.map(e => [e.id, e])), logs: [], tests: [] });
  }
  function migrate(s) { // completa i campi mancanti di backup vecchi o parziali
    s.v = 1;
    s.testDefs = Array.isArray(s.testDefs) && s.testDefs.length ? s.testDefs : C.DEFAULT_TESTS.map(t => ({ ...t }));
    s.settings = Object.assign({ prep: 10, sound: true }, s.settings);
    if (!s.plans.some(p => p.id === s.activePlan)) s.activePlan = s.plans[0] ? s.plans[0].id : null;
    s.live = s.live || null;
    return s;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (C.validState(s)) return migrate(s); log('store', 'dati salvati non validi, riparto dal piano precaricato'); }
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
  const opts = (map, value, extra) => h('select', { value, ...(extra || {}) }, Object.entries(map).map(([k, v]) => h('option', { value: k }, v)));
  const numInp = (value, extra) => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value == null ? '' : String(value).replace('.', ','), ...(extra || {}) }); // testo + virgola: i campi number perdono la virgola su alcune tastiere
  const val = el => { const n = parseFloat(String(el.value).replace(',', '.')); return Number.isFinite(n) ? n : null; };

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

  /* ---------- Elementi condivisi ---------- */
  function loadHint(ex) {
    if (!ex.load || ex.load.pct == null) return '';
    const cues = ex.interval && ex.interval.cues.length ? ex.interval.cues : [''];
    const m = maxes(), out = [];
    for (const c of cues) {
      const kg = C.loadKg(ex.load, c, m);
      if (kg == null) return 'kg: mancano i massimali';
      const side = ex.load.ref === 'pinch' ? (/^\s*DX/i.test(c) ? 'DX ' : 'SX ') : '';
      const s = side + (ex.load.mode === 'hang' ? C.fmtKg(kg) : String(kg).replace('.', ',') + ' kg');
      if (!out.includes(s)) out.push(s);
    }
    return out.join(' · ');
  }
  const isDone = (p, w, d, si) => S.logs.some(l => l.planId === p.id && l.w === w && l.d === d && l.si === si);
  const sessTitle = s => `${C.DAY_TYPES[s.type]} · ${C.PERIODS[s.period]}`;
  function blockRow(b, onclick) {
    const ex = S.exercises[b.exId];
    if (!ex) return h('div', { class: 'blk' }, h('span', { class: 'p' }, 'Esercizio rimosso'));
    const hint = loadHint(ex);
    return h('div', { class: 'blk', onclick, style: onclick ? 'cursor:pointer' : null },
      h('div', { class: 'grow' }, h('div', { class: 'n' }, ex.name), h('div', { class: 'p' }, ex.prescription), hint ? h('div', { class: 'kg' }, hint) : null),
      h('div', { class: 'm' }, b.minutes + ' min'));
  }
  function sessionCard(p, w, d, si, edit) {
    const s = p.weeks[w][d].sessions[si], done = isDone(p, w, d, si);
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow big', style: 'font-size:17px' }, sessTitle(s)),
        done ? h('span', { class: 'tag ok' }, 'Fatta') : null, h('span', { class: 'tag' }, C.sessionMinutes(s) + ' min')),
      s.blocks.map((b, bi) => blockRow(b, edit ? () => blockSheet(p, w, d, si, bi) : null)),
      s.blocks.length ? null : h('p', { class: 'sub' }, 'Nessun esercizio.'),
      h('div', { class: 'btns' },
        btn(done ? 'Ripeti' : 'Avvia', () => startSession(p, w, d, si, 0), 'pri'),
        edit ? [btn('+ Esercizio', () => pickExercise(id => { s.blocks.push({ id: C.uid(), exId: id, minutes: C.intervalMinutes(S.exercises[id].interval) || 10 }); save(); render(); }), 'sm'),
          btn('Sessione…', () => sessionSheet(p, w, d, si), 'sm')] : null));
  }

  /* ---------- Viste ---------- */
  let curWeek = null;
  function viewToday() {
    const p = plan(), t = C.todayISO(), out = [h('div', { class: 'sub' }, `${wdOf(t)} ${fmtDate(t)}`), h('h1', {}, 'Oggi')];
    if (S.live) {
      const lp = S.plans.find(x => x.id === S.live.planId);
      if (lp && lp.weeks[S.live.w] && lp.weeks[S.live.w][S.live.d].sessions[S.live.si])
        out.push(h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('div', { class: 'n' }, 'Sessione interrotta'),
          h('div', { class: 'btns' }, btn('Riprendi', () => startSession(lp, S.live.w, S.live.d, S.live.si, S.live.idx), 'pri'), btn('Scarta', () => { S.live = null; save(); render(); }))));
      else S.live = null;
    }
    if (!p) return out.concat(h('div', { class: 'card' }, h('p', {}, 'Nessun piano attivo.'), btn('Vai ai piani', () => { location.hash = 'piano'; }, 'pri')));
    const pos = C.locate(p, t);
    out.push(h('div', { class: 'sub' }, p.title + (pos ? ` · settimana ${pos.w + 1} di ${p.weeks.length}` : '')));
    if (!pos) {
      const before = C.diffDays(t, p.startDate) < 0;
      out.push(h('div', { class: 'card' }, h('p', {}, before ? `Il piano inizia ${wdOf(p.startDate)} ${fmtDate(p.startDate)} (tra ${-C.diffDays(t, p.startDate)} giorni).` : 'Il piano è concluso.'),
        btn(before ? 'Apri il primo giorno' : 'Apri il piano', () => { location.hash = before ? 'giorno-0-0' : 'piano'; }, 'pri')));
    } else {
      const day = p.weeks[pos.w][pos.d];
      if (!day.sessions.length) out.push(h('div', { class: 'card' }, h('div', { class: 'big' }, 'Recupero'), h('p', { class: 'sub' }, 'Nessuna sessione in programma.')));
      day.sessions.forEach((_, si) => out.push(sessionCard(p, pos.w, pos.d, si, false)));
      out.push(btn('Modifica il giorno', () => { location.hash = `giorno-${pos.w}-${pos.d}`; }, 'sm'));
    }
    const mon = C.mondayOf(t), wk = S.logs.filter(l => l.date >= mon && l.date <= C.addDays(mon, 6));
    out.push(h('h2', {}, 'Questa settimana'), h('div', { class: 'card row' },
      h('div', { class: 'grow' }, h('div', { class: 'big' }, wk.length), h('div', { class: 'sub' }, 'sessioni')),
      h('div', { class: 'grow' }, h('div', { class: 'big' }, wk.reduce((a, l) => a + (l.minutes || 0), 0)), h('div', { class: 'sub' }, 'minuti'))));
    return out;
  }

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
    out.push(h('div', { class: 'week' }, btn('‹', () => { curWeek--; render(); }, 'sm' + (w === 0 ? ' ' : '')),
      h('div', { class: 't' }, h('div', { class: 'big', style: 'font-size:17px' }, `Settimana ${w + 1} / ${p.weeks.length}`),
        h('div', { class: 'sub' }, `${fmtDate(C.dateOf(p, w, 0))} – ${fmtDate(C.dateOf(p, w, 6))} · ${tot} min${periods ? ' · ' + periods : ''}`)),
      btn('›', () => { curWeek++; render(); }, 'sm')));
    out[out.length - 1].firstChild.disabled = w === 0;
    out[out.length - 1].lastChild.disabled = w === p.weeks.length - 1;
    week.forEach((day, d) => {
      const iso = C.dateOf(p, w, d);
      out.push(h('div', { class: 'card tap day row' + (iso === t ? ' today' : ''), onclick: () => { location.hash = `giorno-${w}-${d}`; } },
        h('div', { class: 'wd' }, WD[d], h('div', { style: 'font-weight:400;text-transform:none' }, fmtDate(iso))),
        h('div', { class: 'grow' }, day.sessions.length ? day.sessions.map((s, si) => h('div', { style: 'margin:2px 0' },
          h('div', { class: 'n', style: 'font-weight:600' }, C.DAY_TYPES[s.type], ' ', h('span', { class: 'sub' }, C.sessionMinutes(s) + ' min'), isDone(p, w, d, si) ? h('span', { class: 'tag ok', style: 'margin-left:6px' }, '✓') : null),
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
        btn('Salva nome e data', () => { p.title = title.value.trim() || p.title; if (start.value) p.startDate = C.mondayOf(start.value); done(); }, 'pri block'),
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
    const nTitle = h('input', { placeholder: 'Blocco di forza' }), nWeeks = numInp(4, { min: 1, max: 52 });
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
      S = migrate(obj); curWeek = null; save(); render(); toast('Backup ripristinato.'); log('import', 'backup ripristinato');
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
      day.sessions.map((_, si) => sessionCard(p, w, d, si, true)),
      day.sessions.length ? null : h('div', { class: 'card' }, h('div', { class: 'big' }, 'Recupero')),
      h('div', { class: 'btns' }, btn('+ Sessione', () => { day.sessions.push({ type: 'wall', period: (day.sessions[0] || {}).period || 'base', blocks: [] }); save(); render(); }, 'sm'),
        btn('Copia su un altro giorno…', () => copyDaySheet(p, w, d), 'sm'))];
  }
  function copyDaySheet(p, w, d) {
    const wk = h('select', { value: w }, p.weeks.map((_, i) => h('option', { value: i }, 'Settimana ' + (i + 1))));
    const dd = h('select', { value: (d + 1) % 7 }, WD.map((n, i) => h('option', { value: i }, n)));
    const ov = openSheet('Copia giorno', [h('div', { class: 'cols' }, field('Settimana', wk), field('Giorno', dd)),
      btn('Sovrascrivi il giorno scelto', () => { p.weeks[+wk.value][+dd.value] = C.cloneDay(p.weeks[w][d]); save(); ov.remove(); toast('Giorno copiato.'); render(); }, 'pri block')]);
  }
  function sessionSheet(p, w, d, si) {
    const day = p.weeks[w][d], s = day.sessions[si];
    const ty = opts(Object.fromEntries(Object.entries(C.DAY_TYPES).filter(([k]) => k !== 'rest')), s.type), pe = opts(C.PERIODS, s.period);
    const ov = openSheet('Sessione', [h('div', { class: 'cols' }, field('Tipo', ty), field('Periodo', pe)),
      btn('Salva', () => { s.type = ty.value; s.period = pe.value; save(); ov.remove(); render(); }, 'pri block'),
      h('div', { class: 'btns' }, si > 0 ? btn('Sposta prima', () => { day.sessions.splice(si - 1, 0, day.sessions.splice(si, 1)[0]); save(); ov.remove(); render(); }, 'sm') : null,
        btn('Elimina sessione', async () => { if (await confirmDlg('Eliminare questa sessione dal giorno?', 'Elimina')) { day.sessions.splice(si, 1); save(); ov.remove(); render(); } }, 'sm danger'))]);
  }
  function blockSheet(p, w, d, si, bi) {
    const s = p.weeks[w][d].sessions[si], b = s.blocks[bi], ex = S.exercises[b.exId], n = C.usage(S.plans, b.exId);
    const min = numInp(b.minutes, { min: 0 });
    const close = () => { save(); ov.remove(); render(); };
    const move = k => { s.blocks.splice(bi + k, 0, s.blocks.splice(bi, 1)[0]); close(); };
    const ov = openSheet(ex ? ex.name : 'Esercizio', [ex ? h('p', { class: 'sub' }, ex.prescription) : null,
      field('Minuti previsti', min), btn('Salva minuti', () => { b.minutes = Math.max(0, Math.round(val(min) || 0)); close(); }, 'pri block'),
      h('div', { class: 'btns' }, btn('↑ Su', () => move(-1), 'sm' + (bi === 0 ? ' ' : '')), btn('↓ Giù', () => move(1), 'sm'),
        btn('Sostituisci…', () => pickExercise(id => { b.exId = id; close(); }), 'sm'), btn('Rimuovi', () => { s.blocks.splice(bi, 1); close(); }, 'sm danger')),
      ex ? h('div', { class: 'btns' }, btn(`Modifica esercizio (${n} ${n === 1 ? 'uso' : 'usi'})`, () => { ov.remove(); exerciseSheet(ex.id); }, 'sm'),
        n > 1 ? btn('Modifica solo qui', () => { const c = JSON.parse(JSON.stringify(ex)); c.id = C.uid(); S.exercises[c.id] = c; b.exId = c.id; save(); ov.remove(); exerciseSheet(c.id); }, 'sm') : null) : null]);
    const mv = ov.querySelectorAll('.btns')[0].children;
    mv[0].disabled = bi === 0; mv[1].disabled = bi === s.blocks.length - 1;
  }

  function pickExercise(cb) {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Cerca…', oninput: () => fill() });
    let ov;
    const fill = () => {
      const t = q.value.trim().toLowerCase();
      const items = Object.values(S.exercises).filter(e => !t || (e.name + ' ' + e.prescription).toLowerCase().includes(t))
        .sort((a, b) => a.name.localeCompare(b.name) || a.prescription.localeCompare(b.prescription)).slice(0, 80);
      list.replaceChildren(...items.map(e => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => { ov.remove(); cb(e.id); } },
        h('div', { class: 'grow' }, h('div', { class: 'n' }, e.name), h('div', { class: 'p' }, e.prescription)), h('span', { class: 'tag' }, C.SLOTS[e.slot]))));
      if (!items.length) list.append(h('p', { class: 'sub' }, 'Nessun risultato.'));
    };
    ov = openSheet('Scegli esercizio', [h('div', { class: 'row' }, h('div', { class: 'grow' }, q), btn('+ Nuovo', () => { ov.remove(); exerciseSheet(null, cb); }, 'sm pri')), list]);
    fill();
  }

  function exerciseSheet(id, onCreate) {
    const isNew = !id, e = isNew ? { id: C.uid(), name: '', prescription: '', slot: 'strength', location: 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low', equipment: [], interval: null, load: null } : S.exercises[id];
    const iv = e.interval || {}, ld = e.load || {};
    const name = h('input', { value: e.name, placeholder: 'Open hand 20 mm 7"' }), pres = h('input', { value: e.prescription, placeholder: '4 × 7" · 85% max' });
    const slot = opts(C.SLOTS, e.slot);
    const mode = opts({ none: 'Solo durata (nessun timer)', timed: 'A tempo (countdown)', reps: 'A ripetizioni (tocco "Fatto")' }, !e.interval ? 'none' : iv.selfPaced ? 'reps' : 'timed', { onchange: () => sync() });
    const rounds = numInp(iv.rounds || 3, { min: 1 }), work = numInp(iv.workSeconds || 7, { min: 0 }), rest = numInp(iv.restSeconds == null ? 180 : iv.restSeconds, { min: 0 });
    const reps = numInp(iv.reps), perSet = numInp(iv.roundsPerSet), setRest = numInp(iv.setRestSeconds);
    const cues = h('textarea', { placeholder: 'Un cue per riga, ripetuti a rotazione\nSX · 75% max\nDX · 75% max' }); cues.value = (iv.cues || []).join('\n');
    const refs = { '': 'Nessuno', oh: 'Open hand', hc: 'Half-crimp', sl: 'Sloper', pinch: 'Pinch (SX/DX dal cue)', wrist: 'Polso 6RM' };
    for (const t of S.testDefs) if (!C.DEFAULT_TESTS.some(x => x.key === t.key)) refs[t.key] = t.name;
    const ref = opts(refs, ld.ref || ''), pct = numInp(ld.pct, { min: 0 });
    const lmode = opts({ hang: 'Zavorra su peso corporeo', lift: 'Carico sollevato' }, ld.mode || 'hang'), isTest = h('input', { type: 'checkbox', checked: ld.test });
    const timer = h('div', {}, h('div', { class: 'cols3' }, field('Round', rounds), field('Lavoro (s)', work), field('Recupero (s)', rest)),
      h('div', { class: 'cols3' }, field('Rip. (facolt.)', reps), field('Round per serie', perSet), field('Rec. serie (s)', setRest)), field('Cue', cues));
    const sync = () => { timer.hidden = mode.value === 'none'; };
    let ov;
    const body = [field('Nome', name), field('Prescrizione', pres), h('div', { class: 'cols' }, field('Sezione', slot), field('Timer', mode)), timer,
      h('h2', {}, 'Carico in kg'), h('div', { class: 'cols' }, field('Massimale di riferimento', ref), field('% del massimale', pct)),
      h('div', { class: 'cols' }, field('Tipo di carico', lmode), h('label', { class: 'f' }, 'Blocco di test', h('div', { style: 'margin-top:12px' }, isTest, ' registra il risultato a fine sessione'))),
      btn(isNew ? 'Crea esercizio' : 'Salva', () => {
        if (!name.value.trim()) return toast('Serve un nome.');
        e.name = name.value.trim().slice(0, 200); e.prescription = pres.value.trim().slice(0, 200); e.slot = slot.value;
        e.interval = mode.value === 'none' ? null : C.normInterval({ rounds: Math.max(1, val(rounds) || 1), workSeconds: val(work) || 0, restSeconds: val(rest) || 0, selfPaced: mode.value === 'reps',
          reps: val(reps) || 0, roundsPerSet: val(perSet) || 0, setRestSeconds: val(setRest) || 0, cues: cues.value.split('\n').map(s => s.trim()).filter(Boolean) });
        e.load = ref.value ? { ref: ref.value, mode: lmode.value, pct: val(pct), test: isTest.checked } : null;
        S.exercises[e.id] = e; save(); ov.remove(); render();
        if (isNew && onCreate) onCreate(e.id);
      }, 'pri block')];
    if (!isNew) {
      const n = C.usage(S.plans, e.id);
      body.push(h('div', { class: 'btns' }, btn(n ? `In uso in ${n} blocchi` : 'Elimina dalla libreria', async () => {
        if (n) return toast('Rimuovilo prima dai giorni che lo usano.');
        if (await confirmDlg(`Eliminare "${e.name}" dalla libreria?`, 'Elimina')) { delete S.exercises[e.id]; save(); ov.remove(); render(); }
      }, 'sm danger')));
    }
    ov = openSheet(isNew ? 'Nuovo esercizio' : 'Modifica esercizio', body);
    sync();
  }

  function viewLibrary() {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Cerca…', oninput: () => fill() });
    const fill = () => {
      const t = q.value.trim().toLowerCase();
      list.replaceChildren(...Object.values(S.exercises).filter(e => !t || (e.name + ' ' + e.prescription).toLowerCase().includes(t))
        .sort((a, b) => a.name.localeCompare(b.name) || a.prescription.localeCompare(b.prescription))
        .map(e => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => exerciseSheet(e.id) },
          h('div', { class: 'grow' }, h('div', { class: 'n' }, e.name), h('div', { class: 'p' }, e.prescription)), h('div', { class: 'm' }, C.usage(S.plans, e.id) + ' usi'))));
    };
    fill();
    return [h('div', { class: 'row' }, btn('‹ Altro', () => { location.hash = 'altro'; }, 'sm'), btn('+ Nuovo', () => exerciseSheet(null), 'sm pri right')),
      h('h1', { style: 'margin-top:10px' }, 'Esercizi'), h('div', { class: 'sub' }, Object.keys(S.exercises).length + ' in libreria'), h('div', { style: 'margin-top:10px' }, q), h('div', { class: 'card' }, list)];
  }

  function logSheet(l) {
    const isNew = !l; l = l || { id: C.uid(), date: C.todayISO(), title: 'Sessione libera', minutes: 60, rpe: null, feel: null, notes: '', loads: [] };
    const date = h('input', { type: 'date', value: l.date }), title = h('input', { value: l.title }), min = numInp(l.minutes, { min: 0 });
    const rpe = numInp(l.rpe, { min: 1, max: 10 }), feel = opts({ '': '—', 1: '1 · Distrutto', 2: '2 · Stanco', 3: '3 · Così così', 4: '4 · Bene', 5: '5 · Ottimo' }, l.feel || '');
    const notes = h('textarea', {}); notes.value = l.notes || '';
    const ov = openSheet(isNew ? 'Registra sessione' : 'Modifica registrazione', [h('div', { class: 'cols' }, field('Data', date), field('Minuti', min)), field('Titolo', title),
      h('div', { class: 'cols' }, field('RPE (1-10)', rpe), field('Come ti sentivi', feel)), field('Note', notes),
      (l.loads || []).length ? h('div', { class: 'sub' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
      btn('Salva', () => {
        Object.assign(l, { date: date.value || l.date, title: title.value.trim() || 'Sessione', minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe), feel: feel.value ? +feel.value : null, notes: notes.value.trim() });
        if (isNew) S.logs.push(l);
        save(); ov.remove(); render();
      }, 'pri block'),
      isNew ? null : btn('Elimina', async () => { if (await confirmDlg('Eliminare questa registrazione?', 'Elimina')) { S.logs = S.logs.filter(x => x !== l); save(); ov.remove(); render(); } }, 'danger block')]);
  }
  function viewDiary() {
    const logs = [...S.logs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return [h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Diario'), btn('+ Registra', () => logSheet(null), 'sm pri')),
      h('div', { class: 'sub' }, `${logs.length} sessioni · ${logs.reduce((a, l) => a + (l.minutes || 0), 0)} minuti`),
      logs.length ? null : h('div', { class: 'card' }, h('p', { class: 'sub' }, 'Le sessioni completate con il player finiscono qui, con RPE, note e carichi.')),
      logs.map(l => h('div', { class: 'card tap', onclick: () => logSheet(l) },
        h('div', { class: 'row' }, h('div', { class: 'grow n', style: 'font-weight:600' }, l.title), h('span', { class: 'tag' }, (l.minutes || 0) + ' min')),
        h('div', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)}${l.rpe ? ' · RPE ' + l.rpe : ''}${l.feel ? ' · sensazione ' + l.feel + '/5' : ''}`),
        (l.loads || []).length ? h('div', { class: 'p', style: 'color:var(--ac);font-size:13px' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
        l.notes ? h('div', { class: 'sub', style: 'margin-top:4px;color:var(--tx)' }, l.notes) : null))];
  }

  function spark(vals) {
    if (vals.length < 2) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
    const pts = vals.map((v, i) => [4 + i * 102 / (vals.length - 1), 30 - (v - lo) / sp * 26]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', '0 0 110 34');
    svg.innerHTML = `<polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/><circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="3"/>`;
    return svg;
  }
  function testSheet(def) {
    const date = h('input', { type: 'date', value: C.todayISO() }), v = numInp(null);
    const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? 1 : -1));
    let ov;
    const again = () => { save(); ov.remove(); render(); };
    ov = openSheet(def.name, [h('div', { class: 'cols' }, field('Data', date), field(`Valore (${def.unit})`, v)),
      btn('Aggiungi risultato', () => { const n = val(v); if (n == null) return toast('Inserisci un numero.'); S.tests.push({ id: C.uid(), key: def.key, date: date.value || C.todayISO(), value: n }); again(); }, 'pri block'),
      h('h2', {}, 'Storico'), hist.length ? hist.map(t => h('div', { class: 'blk' }, h('div', { class: 'grow' }, `${fmtDate(t.date)} ${t.date.slice(0, 4)}`), h('div', { class: 'n' }, String(t.value).replace('.', ',') + ' ' + def.unit),
        btn('✕', () => { S.tests = S.tests.filter(x => x !== t); again(); }, 'sm'))) : h('p', { class: 'sub' }, 'Ancora nessun risultato.'),
      C.DEFAULT_TESTS.some(x => x.key === def.key) ? null : btn('Elimina questo test', async () => { if (await confirmDlg(`Eliminare "${def.name}" e il suo storico?`, 'Elimina')) { S.testDefs = S.testDefs.filter(x => x !== def); S.tests = S.tests.filter(t => t.key !== def.key); again(); } }, 'danger block')]);
  }
  function viewProgress() {
    const name = h('input', { placeholder: 'Hang a una mano 22 mm' }), unit = h('input', { placeholder: 's', value: 'kg' });
    return [h('h1', {}, 'Progressi'), h('div', { class: 'sub' }, 'L\'ultimo valore di ogni test è il massimale usato per calcolare i kg nel piano e nel player.'),
      S.testDefs.map(def => {
        const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? -1 : 1)), last = hist[hist.length - 1];
        return h('div', { class: 'card tap row', onclick: () => testSheet(def) },
          h('div', { class: 'grow' }, h('div', { class: 'sub' }, def.name), h('div', { class: 'big' }, last ? String(last.value).replace('.', ',') + ' ' + def.unit : '—'),
            h('div', { class: 'sub' }, last ? `${fmtDate(last.date)} · ${hist.length} ${hist.length === 1 ? 'risultato' : 'risultati'}` : 'Tocca per aggiungere')),
          spark(hist.map(t => t.value)));
      }),
      h('h2', {}, 'Nuovo test'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Nome', name), field('Unità', unit)),
        btn('Aggiungi test', () => { if (!name.value.trim()) return toast('Serve un nome.'); S.testDefs.push({ key: 'c-' + C.uid().slice(0, 8), name: name.value.trim(), unit: unit.value.trim() || 'kg' }); save(); render(); }, 'sm'))];
  }

  function viewMore() {
    const prep = numInp(S.settings.prep, { min: 0, max: 60 }), sound = h('input', { type: 'checkbox', checked: S.settings.sound, onchange: () => { S.settings.sound = sound.checked; save(); } });
    return [h('h1', {}, 'Altro'),
      h('div', { class: 'card tap row', onclick: () => { location.hash = 'libreria'; } }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Libreria esercizi'), h('div', { class: 'sub' }, Object.keys(S.exercises).length + ' esercizi')), '›'),
      h('h2', {}, 'Player'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Preparazione prima di un hang (s)', prep), h('label', { class: 'f' }, 'Segnali acustici', h('div', { style: 'margin-top:12px' }, sound, ' attivi'))),
        btn('Salva', () => { S.settings.prep = Math.min(60, Math.max(0, Math.round(val(prep) || 0))); save(); toast('Salvato.'); }, 'sm')),
      h('h2', {}, 'Dati'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'I dati restano solo su questo dispositivo. Fai un backup ogni tanto.'),
        h('div', { class: 'btns' }, btn('Backup completo', () => exportSheet('Backup', `allenamento-backup-${C.todayISO()}.json`, JSON.stringify(S)), 'sm pri'), fileBtn('Ripristina / importa file'),
          btn('Azzera tutto', async () => { if (await confirmDlg('Cancellare piani, diario e test e ripartire dal piano Karma precaricato?', 'Azzera')) { S = fresh(); curWeek = null; save(); render(); } }, 'sm danger')))];
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

  function startSession(p, w, d, si, idx) {
    const s = p.weeks[w][d].sessions[si], steps = C.buildSteps(s.blocks, S.exercises, S.settings.prep);
    if (!steps.length) return toast('Questa sessione non ha esercizi.');
    audioInit(); wake();
    const resumed = S.live && S.live.planId === p.id && S.live.w === w && S.live.d === d && S.live.si === si;
    P = { steps, p, w, d, si, s, startedAt: resumed ? S.live.startedAt : Date.now(), paused: false };
    S.live = { planId: p.id, w, d, si, idx: 0, startedAt: P.startedAt };
    $('player').hidden = false;
    P.timer = setInterval(tick, 200);
    enter(Math.min(idx || 0, steps.length - 1));
    log('player', 'sessione avviata', { piano: p.title, settimana: w + 1, giorno: d + 1, passi: steps.length });
  }
  function enter(i) {
    P.idx = i; P.endAt = Date.now() + P.steps[i].seconds * 1000; P.lastBeep = null; P.freeDone = false;
    if (P.paused) P.remain = P.steps[i].seconds * 1000;
    S.live.idx = i; save(); draw();
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
    $('p-round').textContent = st.kind === 'free' ? '' : `Round ${st.round} di ${st.rounds}` + (st.reps && st.kind === 'work' ? '' : '');
    $('p-cue').textContent = st.kind === 'rest' && st.afterBlock ? (nx ? nx.cue : '') : st.cue;
    const src = st.kind === 'rest' && st.afterBlock && nx ? { ex: S.exercises[nx.exId], cue: nx.cue } : { ex, cue: st.cue };
    const kg = src.ex && st.kind !== 'free' ? C.loadKg(src.ex.load, src.cue, maxes()) : null;
    $('p-kg').textContent = kg == null ? '' : (src.ex.load.mode === 'hang' ? C.fmtKg(kg) : String(kg).replace('.', ',') + ' kg');
    $('p-next').textContent = nx ? 'Poi: ' + (nx.kind === 'rest' ? `recupero ${mmss(nx.seconds)}` : nx.name + (nx.cue && nx.kind !== 'free' ? ' · ' + nx.cue : '')) : 'Ultimo passo';
    $('p-done').textContent = isAuto(st) ? 'Salta' : 'Fatto';
    $('p-done').className = 'btn ' + (isAuto(st) ? '' : 'pri');
    $('p-plus').disabled = st.kind !== 'rest';
    $('p-pause').textContent = P.paused ? 'Riprendi' : 'Pausa';
    drawClock();
  }
  function closePlayer() { clearInterval(P.timer); try { if (wl) wl.release(); } catch (e) { /* già rilasciato */ } wl = null; $('player').hidden = true; }
  function finish() {
    const { p, w, d, si, s } = P, minutes = Math.max(1, Math.round((Date.now() - P.startedAt) / 60000));
    closePlayer(); P = null; beep(1320, 0.8);
    const m = maxes(), loadRows = [], testRows = [], seen = new Set();
    for (const b of s.blocks) {
      const ex = S.exercises[b.exId];
      if (!ex || !ex.load) continue;
      if (ex.load.test) {
        const keys = ex.load.ref === 'pinch' ? ['pinchL', 'pinchR'] : [ex.load.ref];
        for (const k of keys) if (!seen.has(k)) { seen.add(k); const def = S.testDefs.find(t => t.key === k); if (def) testRows.push({ def, inp: numInp(null, { placeholder: m[k] == null ? '' : 'precedente: ' + m[k] }) }); }
      } else loadRows.push({ name: ex.name, inp: h('input', { value: loadHint(ex).replace('kg: mancano i massimali', '') }) });
    }
    const min = numInp(minutes, { min: 0 }), rpe = numInp(null, { min: 1, max: 10 }), notes = h('textarea', {});
    const feel = opts({ '': '—', 1: '1 · Distrutto', 2: '2 · Stanco', 3: '3 · Così così', 4: '4 · Bene', 5: '5 · Ottimo' }, '');
    let ov;
    const end = () => { S.live = null; save(); ov.remove(); location.hash = 'diario'; render(); };
    ov = openSheet('Sessione completata', [h('div', { class: 'cols3' }, field('Minuti', min), field('RPE (1-10)', rpe), field('Sensazione', feel)),
      testRows.length ? [h('h2', {}, 'Risultati dei test'), h('p', { class: 'sub' }, 'Diventano i nuovi massimali per il calcolo dei kg.'), testRows.map(r => field(`${r.def.name} (${r.def.unit})`, r.inp))] : null,
      loadRows.length ? [h('h2', {}, 'Carichi usati'), loadRows.map(r => field(r.name, r.inp))] : null,
      field('Note', notes),
      btn('Salva nel diario', () => {
        const date = C.todayISO();
        for (const r of testRows) { const n = val(r.inp); if (n != null) S.tests.push({ id: C.uid(), key: r.def.key, date, value: n }); }
        S.logs.push({ id: C.uid(), date, planId: p.id, w, d, si, title: `${sessTitle(s)} · ${p.title} S${w + 1}`, minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe), feel: feel.value ? +feel.value : null,
          notes: notes.value.trim(), loads: loadRows.map(r => ({ name: r.name, kg: r.inp.value.trim() })).filter(x => x.kg) });
        log('player', 'sessione salvata', { minuti: minutes });
        end();
      }, 'pri block'), btn('Non salvare', end, 'block')]);
  }
  function wirePlayer() {
    $('p-done').onclick = () => next();
    $('p-back').onclick = () => enter(Math.max(0, P.idx - 1));
    $('p-plus').onclick = () => { if (P.paused) P.remain += 30000; else P.endAt += 30000; P.lastBeep = null; drawClock(); };
    $('p-pause').onclick = () => {
      if (P.paused) { P.endAt = Date.now() + P.remain; P.paused = false; audioInit(); } else { P.remain = P.endAt - Date.now(); P.paused = true; }
      draw();
    };
    $('p-quit').onclick = async () => {
      const was = P.paused; if (!was) $('p-pause').onclick();
      const ov = openSheet('Uscire dalla sessione?', h('div', { class: 'btns' },
        btn('Continua', () => { ov.remove(); if (!was) $('p-pause').onclick(); }), btn('Termina e registra', () => { ov.remove(); finish(); }, 'pri'),
        btn('Esci (riprendi dopo)', () => { ov.remove(); closePlayer(); P = null; render(); }), btn('Abbandona', () => { ov.remove(); closePlayer(); P = null; S.live = null; save(); render(); }, 'danger')), true);
      ov.style.zIndex = 50;
    };
  }

  /* ---------- Router ---------- */
  const VIEWS = { oggi: viewToday, piano: viewPlan, giorno: viewDay, diario: viewDiary, progressi: viewProgress, altro: viewMore, libreria: viewLibrary };
  function render() {
    const [name, a, b] = (location.hash.slice(1) || 'oggi').split('-');
    const fn = VIEWS[name] || viewToday;
    let nodes;
    try { nodes = fn(+a, +b); }
    catch (e) { console.error('[ui] errore nella vista ' + name, e); nodes = [h('h1', {}, 'Qualcosa è andato storto'), h('p', { class: 'sub' }, String(e.message || e)), btn('Torna a Oggi', () => { location.hash = 'oggi'; render(); })]; }
    $('view').replaceChildren(...[nodes].flat(Infinity).filter(n => n != null && n !== false));
    const tab = { giorno: 'piano', libreria: 'altro' }[name] || (VIEWS[name] ? name : 'oggi');
    for (const el of document.querySelectorAll('#tabs a')) el.classList.toggle('on', el.getAttribute('href') === '#' + tab);
  }
  window.addEventListener('hashchange', () => { for (const o of document.querySelectorAll('.overlay')) o.remove(); window.scrollTo(0, 0); render(); });
  wirePlayer();
  render();
  window.__app = { get state() { return S; }, render }; // utile per debug dalla console
})();
