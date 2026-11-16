/* Interfaccia: viste, editor, player. Tutta la logica testabile sta in core.js, i grafici in charts.js. */
(function () {
  'use strict';
  const C = Core, KEY = 'allenamento.v1';
  const WD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const WD_FULL = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const MONTHS_FULL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const FEEL = [['', '—'], ['1', '1 · Distrutto'], ['2', '2 · Stanco'], ['3', '3 · Così così'], ['4', '4 · Bene'], ['5', '5 · Ottimo']];
  const wdIdx = iso => (C.fromISO(iso).getDay() + 6) % 7;
  const fmtDate = iso => { const d = C.fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const wdOf = iso => WD[wdIdx(iso)];
  const dec = v => String(v).replace('.', ',');
  const log = (area, msg, extra) => console.info(`[${area}] ${msg}`, extra === undefined ? '' : extra);

  /* ---------- Stato e persistenza ---------- */
  // Primo avvio: nessun piano precaricato, ogni utente importa o crea i propri.
  const fresh = () => migrate({ v: 6, plans: [], activePlan: null, exercises: {}, logs: [], tests: [] });
  /** I test da cui dipendono i kg degli esercizi (e il peso corporeo) devono esistere nella sezione Test. */
  function ensureTests(s) {
    const need = new Set(['bw'].concat(Object.values(s.exercises).filter(e => e.load).flatMap(e => C.refKeys(e.load.ref))));
    for (const t of C.TEST_TEMPLATES) if (need.has(t.key) && !s.testDefs.some(d => d.key === t.key)) s.testDefs.push({ ...t });
    s.testDefs.sort((a, b) => (b.key === 'bw') - (a.key === 'bw'));
  }
  /** Ogni esercizio di una sessione è un'istanza privata con i suoi parametri: niente è condiviso tra sessioni.
      Dal testo libero ereditato da un import resta solo ciò che non è un parametro, come nota del blocco. */
  /** I cue liberi non esistono più: resta solo l'alternanza SX/DX; il testo non parametrico passa nella nota del blocco. */
  function cuesToNote(e, b) {
    if (!e.interval) return;
    const { sided, note } = C.splitCues(e.interval.cues);
    e.interval.cues = sided ? ['SX', 'DX'] : [];
    if (note && !(b.note || '').toLowerCase().includes(note.toLowerCase())) b.note = [b.note, note].filter(Boolean).join(' · ').slice(0, 200);
  }
  function privatize(st, sess) {
    for (const b of sess.blocks) {
      const e = st.exercises[b.exId];
      if (!e) continue;
      const c = JSON.parse(JSON.stringify(e));
      c.id = C.uid();
      if (c.prescription && !b.note) { const n = C.leftoverNote(c.prescription); if (n) b.note = n; }
      delete c.prescription; delete c.base; delete c.minutes;
      cuesToNote(c, b);
      st.exercises[c.id] = c; b.exId = c.id;
    }
  }
  const allSessions = st => st.plans.flatMap(p => p.weeks.flatMap(w => w.flatMap(d => d.sessions))).concat(st.extras);
  /** Toglie gli esercizi che nessuna sessione usa più. */
  function prune(st) {
    const used = new Set(allSessions(st).flatMap(x => x.blocks.map(b => b.exId)));
    for (const id of Object.keys(st.exercises)) if (!used.has(id)) delete st.exercises[id];
  }
  function migrate(s) { // completa i campi mancanti di backup vecchi o parziali
    const fromV = s.v || 1;
    s.extras = Array.isArray(s.extras) ? s.extras : [];
    s.surfaces = Array.isArray(s.surfaces) && s.surfaces.length ? s.surfaces : C.DEFAULT_SURFACES.map(x => ({ ...x }));
    s.settings = Object.assign({ prep: 10, sound: true, gradeScale: 'font', lastBackup: null }, s.settings);
    s.settings.prog = Object.assign({ on: true, step: 2.5, rpe: 8 }, s.settings.prog);
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
    // v3: nei programmi un giorno ha una sola sessione (niente più "Muro" / "Fuori muro" separati)
    const moved = {};
    for (const p of s.plans) for (const w of p.weeks) for (const d of w) if (d.sessions.length > 1) {
      const first = d.sessions[0];
      for (const x of d.sessions.slice(1)) { first.blocks.push(...x.blocks); moved[x.id] = first.id; }
      d.sessions = [first];
    }
    for (const l of s.logs) if (moved[l.sid]) l.sid = moved[l.sid];
    if (s.live) s.live = { sid: moved[s.live.sid] || s.live.sid, startedAt: s.live.startedAt || Date.now(), done: s.live.done || {} }; // la v2 riprendeva per passo, ora per esercizio
    s.live = s.live || null;
    // v4: esercizi collegati alla libreria standard; test con parametri propri e senza elenco fisso
    for (const e of Object.values(s.exercises)) if (e.std === undefined) e.std = C.matchStd(e.name);
    if (!Array.isArray(s.testDefs)) s.testDefs = [];
    const refd = new Set(Object.values(s.exercises).filter(e => e.load).flatMap(e => C.refKeys(e.load.ref)));
    s.testDefs = s.testDefs.filter(d => d.mode !== undefined || d.key === 'bw' || refd.has(d.key) || s.tests.some(t => t.key === d.key)); // dei vecchi predefiniti restano solo quelli in uso
    for (const d of s.testDefs) if (d.mode === undefined) Object.assign(d, C.TEST_TEMPLATES.find(t => t.key === d.key) || { mode: 'value' });
    ensureTests(s);
    // v5: i parametri (serie, recuperi, %, cue) stanno nel blocco della sessione; spariscono le "versioni" condivise e le descrizioni testuali
    s.custom = Array.isArray(s.custom) ? s.custom : [];
    if (fromV < 5) for (const x of allSessions(s)) privatize(s, x);
    prune(s);
    // v6: un solo campo Nota (mostrato anche nel timer) + interruttore SX/DX al posto dei cue
    if (fromV === 5) for (const x of allSessions(s)) for (const b of x.blocks) if (s.exercises[b.exId]) cuesToNote(s.exercises[b.exId], b);
    s.v = 6;
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
    try { localStorage.setItem(KEY, JSON.stringify(S)); storeOk = true; scheduleCloud(); }
    catch (e) {
      console.warn('[store] scrittura fallita', e);
      if (storeOk) toast('Salvataggio non disponibile qui: fai un backup da Altro.');
      storeOk = false;
    }
  }
  let S = load();

  /* ---------- Backup automatico su un repository GitHub privato ----------
     Il token resta solo su questo dispositivo: non entra mai nei file di backup, né in quelli caricati né in quelli esportati. */
  const cloudOn = () => { const g = S.settings.gh; return !!(g && g.token && g.repo); };
  const backupText = () => JSON.stringify({ ...S, live: null, settings: { ...S.settings, lastBackup: C.todayISO(), gh: S.settings.gh ? { repo: S.settings.gh.repo } : null } });
  const b64 = text => { const u = new TextEncoder().encode(text); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); };
  const ghUrl = () => `https://api.github.com/repos/${S.settings.gh.repo}/contents/allenamento-backup.json`;
  const ghHeaders = accept => ({ Authorization: 'Bearer ' + S.settings.gh.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const ghError = r => new Error(r.status === 401 ? 'token non valido o scaduto' : r.status === 403 ? 'il token non ha il permesso di scrivere nel repository' : r.status === 404 ? 'repository non trovato (nome sbagliato o token senza accesso)' : 'GitHub ha risposto ' + r.status);
  let cloudTimer = null, cloudBusy = false, cloudAt = 0;
  /** Impronta dei dati (senza date di backup né collegamento): dice se c'è qualcosa di nuovo da caricare, anche dopo un riavvio. */
  function cloudSig() {
    const t = JSON.stringify({ ...S, live: null, settings: { ...S.settings, lastBackup: null, gh: null } });
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return t.length + ':' + h;
  }
  /** Carica il backup. `manual` mostra l'esito; in automatico gli errori finiscono in Home, senza interrompere. */
  async function cloudBackup(manual) {
    if (!cloudOn() || cloudBusy) return false;
    const g = S.settings.gh, text = backupText(), sig = cloudSig();
    if (!manual && !g.error && g.sig === sig) return true; // niente di nuovo da salvare
    cloudBusy = true;
    try {
      const get = await fetch(ghUrl(), { headers: ghHeaders(), cache: 'no-store' });
      if (!get.ok && get.status !== 404) throw ghError(get);
      const sha = get.ok ? (await get.json()).sha : undefined; // 404 = primo backup: il file ancora non esiste
      const put = await fetch(ghUrl(), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify({ message: 'Backup ' + new Date().toISOString().slice(0, 16).replace('T', ' '), content: b64(text), sha }) });
      if (!put.ok) throw ghError(put);
      g.sig = sig; cloudAt = Date.now(); g.error = null; S.settings.lastBackup = C.todayISO();
      log('backup', 'salvato su GitHub', { kb: Math.ceil(text.length / 1024) });
      if (manual) toast('Backup salvato su GitHub.');
      return true;
    } catch (e) {
      g.error = e instanceof TypeError ? 'rete non disponibile' : String(e.message || e);
      console.warn('[backup] GitHub: ' + g.error, e);
      if (manual) toast('Backup non riuscito: ' + g.error + '.');
      return false;
    } finally {
      cloudBusy = false;
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* già segnalato da save() */ }
      if (manual) render();
    }
  }
  /** Dopo ogni salvataggio: un backup al massimo ogni 5 minuti, 20 secondi dopo l'ultima modifica. */
  function scheduleCloud() {
    if (!S || !cloudOn()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => cloudBackup(false), Math.max(20000, 300000 - (Date.now() - cloudAt)));
  }
  // Quello che registri senza rete resta sul dispositivo; appena la rete torna (o riapri l'app) il backup riparte da solo.
  const cloudRetry = () => { if (cloudOn() && navigator.onLine !== false) { clearTimeout(cloudTimer); cloudTimer = setTimeout(() => cloudBackup(false).then(() => { if (!R && !P) render(); }), 3000); } };
  window.addEventListener('online', cloudRetry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloudRetry(); });
  async function cloudRestore() {
    try {
      const r = await fetch(ghUrl(), { headers: ghHeaders('application/vnd.github.raw+json'), cache: 'no-store' });
      if (!r.ok) throw ghError(r);
      const obj = JSON.parse(await r.text());
      if (!C.validState(obj)) throw new Error('il file su GitHub non è un backup valido');
      if (!await confirmDlg('Sostituire TUTTI i dati di questo dispositivo con il backup su GitHub?', 'Sostituisci')) return;
      const gh = S.settings.gh; // collegamento e token restano quelli di questo dispositivo
      S = migrate(obj); S.settings.gh = gh; calSel = calMonth = null; gh.sig = cloudSig(); save(); render(); toast('Backup ripristinato da GitHub.');
    } catch (e) { console.warn('[backup] ripristino fallito', e); toast('Ripristino non riuscito: ' + (e instanceof TypeError ? 'rete non disponibile' : e.message) + '.'); }
  }
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
  // Titolo per diario e sessione in corso: quello scelto, altrimenti i primi due esercizi che non sono riscaldamento.
  const autoTitle = s => s.title || s.blocks.map(b => S.exercises[b.exId]).filter(e => e && e.slot !== 'warmup').slice(0, 2).map(e => e.name).join(' · ') || 'Sessione';
  function findRef(sid) {
    const x = S.extras.find(e => e.id === sid);
    if (x) return { x };
    for (const p of S.plans) for (let w = 0; w < p.weeks.length; w++) for (let d = 0; d < p.weeks[w].length; d++) {
      const si = p.weeks[w][d].sessions.findIndex(s => s.id === sid);
      if (si >= 0) return { p, w, d, si };
    }
    return null;
  }
  /** Sessioni di una data: quelle di tutti i programmi importati più quelle create a mano. */
  function refsOn(iso) {
    const out = [];
    for (const p of S.plans) { const pos = C.locate(p, iso); if (pos) p.weeks[pos.w][pos.d].sessions.forEach((_, si) => out.push({ p, w: pos.w, d: pos.d, si })); }
    for (const x of S.extras) if (x.date === iso) out.push({ x });
    return out;
  }

  /* ---------- Elementi condivisi ---------- */
  // Coppie di test per lato (pinch, max lift) presenti nella sezione Test: negli elenchi compaiono come una voce sola.
  const pairsPresent = () => Object.keys(C.PAIRS).filter(k => C.refKeys(k).every(x => S.testDefs.some(t => t.key === x)));
  const inPair = (key, pairs) => pairs.some(k => C.refKeys(k).includes(key));
  /* Progressione: la proposta nasce dallo storico dell'esercizio (standard + test di riferimento), non dal programma. */
  const exKey = e => (e.std || e.name) + '|' + (e.load ? e.load.ref : '');
  function exLabel(e) {
    const base = e.std && C.STD[e.std] ? C.STD[e.std].name : e.name, d = e.load && !C.PAIRS[e.load.ref] ? S.testDefs.find(t => t.key === e.load.ref) : null;
    return d ? `${base} · ${d.name}` : base;
  }
  const kgText = (kg, mode) => (mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
  /** { text, why } con il carico proposto per la prossima volta, oppure null se non c'è storico o la progressione è spenta. */
  function proposal(ex) {
    const rule = S.settings.prog;
    if (!rule.on || (ex.load && ex.load.test)) return null;
    const last = C.lastRecord(S.logs, exKey(ex));
    if (!last) return null;
    const nx = last.kgs.map(k => ({ side: k.side, ...C.nextLoad(k.kg, last.rpe, rule, last.mode, maxes().bw) }));
    const fmt = a => a.map(k => (k.side ? k.side + ' ' : '') + kgText(k.kg, last.mode)).join(' · ');
    return { text: fmt(nx), why: `ultima volta ${fmt(last.kgs)}${last.rpe == null ? ', senza RPE' : ', RPE ' + dec(last.rpe)}` };
  }
  const propLine = ex => { const p = proposal(ex); return p ? h('div', { class: 'p' }, `Proposto: ${p.text} (${p.why})`) : null; };
  function loadHint(ex) {
    if (!ex.load || ex.load.pct == null) return '';
    const cues = ex.interval && ex.interval.cues.length ? ex.interval.cues : [''];
    const m = maxes(), out = [];
    for (const c of cues) {
      const kg = C.loadKg(ex.load, c, m);
      if (kg == null) return 'kg: mancano i massimali';
      const side = C.PAIRS[ex.load.ref] ? (/^\s*DX/i.test(c) ? 'DX ' : 'SX ') : '';
      const s = side + (ex.load.mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
      if (!out.includes(s)) out.push(s);
    }
    return out.join(' · ');
  }
  // Se la versione ha un nome suo ("Limit Karma"), accanto si legge l'esercizio standard da cui deriva ("Limit bouldering").
  const stdName = e => (e.std && C.STD[e.std] && C.STD[e.std].name !== e.name ? C.STD[e.std].name : '');
  const exLine = e => [stdName(e), C.describe(e), e.surface ? surfName(e.surface) : ''].filter(Boolean).join(' · ');
  function blockRow(b, onclick, drag) {
    const ex = S.exercises[b.exId];
    const grip = drag ? h('span', { class: 'grip', 'data-grip': '', role: 'img', 'aria-label': 'Trascina per riordinare', onclick: e => e.stopPropagation() }, '≡') : null;
    if (!ex) return h('div', { class: 'blk', 'data-id': b.id }, grip, h('span', { class: 'p' }, 'Esercizio rimosso'));
    const hint = loadHint(ex);
    return h('div', { class: 'blk', 'data-id': b.id, onclick, style: onclick ? 'cursor:pointer' : null }, grip,
      h('div', { class: 'grow' }, h('div', { class: 'n' }, ex.name), h('div', { class: 'p' }, exLine(ex)), hint ? h('div', { class: 'kg' }, hint) : null, propLine(ex), b.note ? h('div', { class: 'p' }, b.note) : null),
      h('div', { class: 'm' }, b.minutes + ' min'));
  }
  /** Riordino per trascinamento dalla maniglia: la riga segue il dito, l'ordine si salva al rilascio. */
  function enableDrag(list, s) {
    list.addEventListener('pointerdown', e => {
      const grip = e.target.closest('[data-grip]');
      if (!grip) return;
      const row = grip.closest('.blk');
      e.preventDefault();
      row.classList.add('drag');
      const move = ev => {
        const after = [...list.children].filter(x => x !== row).find(x => { const b = x.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        if (after) { if (row.nextSibling !== after) list.insertBefore(row, after); } else if (list.lastChild !== row) list.append(row);
      };
      // In ascolto sul documento: spostare la riga nel DOM fa perdere la cattura del puntatore alla maniglia.
      const up = () => {
        for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) document.removeEventListener(k, f);
        const order = [...list.children].map(x => x.dataset.id);
        s.blocks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        save(); render();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  }
  /** Aggiunge alla sessione un'istanza nuova dell'esercizio, a partire da un modello (standard, personale o test). */
  function addBlock(s, tpl) {
    const e = { id: C.uid(), ...JSON.parse(JSON.stringify(tpl)) }, minutes = C.intervalMinutes(e.interval) || e.minutes || 10;
    const note = e.note || '';
    delete e.base; delete e.minutes; delete e.prescription; delete e.note;
    S.exercises[e.id] = e;
    s.blocks.push({ id: C.uid(), exId: e.id, minutes, ...(note ? { note } : {}) });
  }
  /** Esercizio "test" per un test della sezione Test: a fine esercizio chiede il risultato, che aggiorna il massimale. */
  function testExercise(ref) {
    const two = !!C.PAIRS[ref], d = S.testDefs.find(t => t.key === (two ? ref + 'L' : ref));
    const interval = C.normInterval({ rounds: two ? 8 : 4, workSeconds: d.seconds || 45, restSeconds: two ? 90 : 180, selfPaced: !d.seconds, reps: d.reps || 0,
      cues: two ? ['SX', 'DX'] : [] });
    return { std: 'test', note: d.mode === 'value' ? 'Al massimo' : 'Carico crescente', name: 'Test: ' + (two ? C.PAIRS[ref] : d.name), slot: 'strength', location: 'off_wall', domain: 'finger_strength',
      intensity: 'max', risk: 'moderate', equipment: [], interval, load: { ref, mode: d.mode === 'lift' ? 'lift' : 'hang', pct: null, test: true }, surface: '' };
  }
  function pickTest(cb) {
    const pairs = pairsPresent();
    const items = S.testDefs.filter(t => t.key !== 'bw' && !inPair(t.key, pairs)).map(t => [t.key, t.name, C.testLabel(t)]).concat(pairs.map(k => [k, C.PAIRS[k], 'SX e DX']));
    if (!items.length) return toast('Crea prima un test in Analisi → Test e massimali.');
    const ov = openSheet('Aggiungi un test', [h('p', { class: 'sub' }, 'A fine esercizio registri il risultato, che aggiorna il massimale nella sezione Test.'),
      items.map(([k, name, sub]) => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => { ov.remove(); cb(testExercise(k)); } }, h('div', { class: 'grow' }, h('div', { class: 'n' }, name), h('div', { class: 'p' }, sub))))]);
  }
  function sessionCard(r, edit) {
    const s = sessOf(r), done = isDone(r);
    const list = h('div', {}, s.blocks.map((b, bi) => blockRow(b, edit ? () => blockSheet(r, bi) : null, edit)));
    if (edit) enableDrag(list, s);
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow big', style: 'font-size:17px' }, s.title || 'Sessione'),
        done ? h('span', { class: 'tag ok' }, 'Fatta') : null, h('span', { class: 'tag' }, C.sessionMinutes(s) + ' min')),
      list, s.blocks.length ? null : h('p', { class: 'sub' }, 'Nessun esercizio: aggiungili qui oppure durante la sessione.'),
      h('div', { class: 'btns' },
        btn(done ? 'Ripeti' : 'Avvia', () => startSession(r), 'pri'),
        edit ? [btn('+ Esercizio', () => pickExercise(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'), btn('+ Test', () => pickTest(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'),
          btn('Modifica', () => sessionSheet(r), 'sm')] : btn('Modifica', () => go('calendario-' + (r.x ? r.x.date : C.dateOf(r.p, r.w, r.d))), 'sm')));
  }
  const climbText = c => surfName(c.surface) + (c.top ? ' ' + fmtG(c.top) : '') + (c.sends != null ? ` · ${c.sends} ${c.sends === 1 ? 'blocco' : 'blocchi'}` : '');
  const logCard = l => h('div', { class: 'card tap', onclick: () => logSheet(l) },
    h('div', { class: 'row' }, h('div', { class: 'grow n', style: 'font-weight:600' }, l.title), h('span', { class: 'tag' }, (l.minutes || 0) + ' min')),
    h('div', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)}${l.rpe ? ' · RPE ' + dec(l.rpe) : ''}${l.feel ? ' · sensazione ' + l.feel + '/5' : ''}`),
    (l.climbs || []).length ? h('div', { class: 'sub', style: 'color:var(--tx)' }, l.climbs.map(climbText).join('  |  ')) : null,
    (l.loads || []).length ? h('div', { class: 'p', style: 'color:var(--ac);font-size:13px' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
    (l.blocks || []).some(b => b.note) ? h('div', { class: 'sub' }, l.blocks.filter(b => b.note).map(b => `${b.name}: ${b.note}`).join(' · ')) : null,
    l.notes ? h('div', { class: 'sub', style: 'margin-top:4px;color:var(--tx)' }, l.notes) : null);

  /* ---------- Home ---------- */
  function viewHome() {
    const t = C.todayISO(), refs = refsOn(t), out = [h('div', { class: 'sub', style: 'text-transform:capitalize' }, `${WD_FULL[wdIdx(t)]} ${fmtDate(t)}`), h('h1', {}, 'Home')];
    if (S.live) {
      const lr = findRef(S.live.sid);
      if (lr) out.push(h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('div', { class: 'n' }, 'Sessione in corso'), h('div', { class: 'sub' }, autoTitle(sessOf(lr))),
        h('div', { class: 'btns' }, btn('Riprendi', () => startSession(lr), 'pri'), btn('Scarta', () => { S.live = null; save(); render(); }))));
      else S.live = null;
    }
    const since = S.settings.lastBackup ? C.diffDays(t, S.settings.lastBackup) : null;
    if (cloudOn() && S.settings.gh.error) out.push(h('div', { class: 'card', style: 'border-color:var(--bad)' }, h('div', { class: 'sub' }, 'Backup automatico non riuscito: ' + S.settings.gh.error + '.'),
      h('div', { class: 'btns' }, btn('Riprova', () => cloudBackup(true), 'sm'), btn('Impostazioni', () => go('altro'), 'sm'))));
    else if (S.logs.length && (since == null || since >= 7))
      out.push(h('div', { class: 'card row' }, h('div', { class: 'grow sub' }, since == null ? 'I tuoi dati non hanno ancora un backup.' : `Ultimo backup ${since} giorni fa.`), btn('Salva backup', doBackup, 'sm')));
    refs.forEach(r => out.push(sessionCard(r, false)));
    if (!refs.length) out.push(h('div', { class: 'card' }, h('div', { class: 'big' }, 'Rest day'), h('p', { class: 'sub', style: 'margin-bottom:0' }, 'Nessuna sessione in programma oggi.')));
    out.push(h('div', { class: 'btns' }, btn('Crea sessione', () => newSessionSheet(t), 'pri'), btn('Registra sessione', () => logSheet(null))));
    return out;
  }

  /* ---------- Sessioni extra e calendario ---------- */
  function showDate(iso) { // dopo aver creato o spostato una sessione si apre quel giorno nel calendario, dove si aggiungono gli esercizi
    go('calendario-' + iso);
  }
  function newSessionSheet(dateDefault) {
    const date = h('input', { type: 'date', value: dateDefault }), title = h('input', { placeholder: 'Es. Board con amici' });
    const ov = openSheet('Crea sessione', [h('div', { class: 'cols' }, field('Data', date), field('Titolo (facoltativo)', title)),
      btn('Crea sessione', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Scegli una data valida.');
        S.extras.push({ id: C.uid(), date: iso, type: 'wall', period: 'base', title: title.value.trim().slice(0, 80), blocks: [] });
        save(); ov.remove(); showDate(iso);
      }, 'pri block')]);
  }
  function copyToDateSheet(r) {
    const s = sessOf(r), date = h('input', { type: 'date', value: C.todayISO() });
    const ov = openSheet('Copia su una data', [h('p', { class: 'sub' }, `"${autoTitle(s)}" viene copiata su un'altra data con gli stessi esercizi.`), field('Data', date),
      btn('Copia', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Scegli una data valida.');
        const copy = { ...C.cloneSession(s), date: iso, title: s.title || '' }; privatize(S, copy); S.extras.push(copy);
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
      const dots = refs.slice(0, 3).map(r => h('i', { class: isDone(r) ? 'ok' : '' }));
      // registrazioni di quel giorno non legate a una sessione in programma lì (diario manuale, sessione fatta in un altro giorno)
      if (dots.length < 3 && S.logs.some(l => l.date === iso && !ids.has(l.sid))) dots.push(h('i', { class: 'ok' }));
      const d = C.fromISO(iso);
      return h('button', { type: 'button', class: 'cal-d' + (iso.slice(0, 7) === calMonth.slice(0, 7) ? '' : ' out') + (iso === t ? ' today' : '') + (iso === calSel ? ' sel' : ''),
        'aria-label': `${WD_FULL[wdIdx(iso)]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}, ${refs.length} sessioni`, 'aria-pressed': iso === calSel ? 'true' : 'false',
        onclick: () => go('calendario-' + iso) }, d.getDate(), h('span', { class: 'dots' }, dots));
    };
    const refs = refsOn(calSel), logs = S.logs.filter(l => l.date === calSel);
    return [h('h1', {}, 'Calendario'),
      h('div', { class: 'week' }, btn('‹', () => shift(-1), 'sm'), h('div', { class: 't big', style: 'font-size:17px;text-transform:capitalize' }, `${MONTHS_FULL[first.getMonth()]} ${first.getFullYear()}`),
        btn('Oggi', () => { calMonth = t.slice(0, 7) + '-01'; go('calendario-' + t); }, 'sm'), btn('›', () => shift(1), 'sm')),
      h('div', { class: 'cal' }, ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => h('div', { class: 'wh' }, x)), cells.map(cell)),
      h('div', { class: 'cal-key sub' }, h('span', {}, h('i', {}), 'in programma'), h('span', {}, h('i', { class: 'ok' }), 'fatta')),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('h2', { class: 'grow', style: 'margin:0;text-transform:capitalize' }, `${WD_FULL[wdIdx(calSel)]} ${fmtDate(calSel)}`),
        btn('Crea sessione', () => newSessionSheet(calSel), 'sm pri')),
      refs.map(r => sessionCard(r, true)),
      refs.length ? null : h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'Nessuna sessione in programma.')),
      logs.length ? [h('h2', {}, 'Registrazioni'), h('div', { class: 'sub' }, 'Tocca per vedere o modificare.'), logs.map(logCard)] : null];
  }

  /* ---------- Programmi: insiemi di sessioni importati, visibili solo nel calendario ---------- */
  function planSheet(p) {
    const title = h('input', { value: p.title }), start = h('input', { type: 'date', value: p.startDate });
    const done = () => { save(); ov.remove(); render(); };
    const ov = openSheet('Programma', [field('Nome', title), field('Inizio (viene portato al lunedì di quella settimana)', start),
      h('p', { class: 'sub' }, `${p.weeks.length} settimane · fino a ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))}. Le sessioni si modificano dal calendario.`),
      btn('Salva', () => { p.title = title.value.trim().slice(0, 80) || p.title; if (C.validISO(start.value)) p.startDate = C.mondayOf(start.value); done(); }, 'pri block'),
      h('div', { class: 'btns' }, btn('Esporta .blokplan', () => exportSheet('Esporta programma', p.title.replace(/[^\w+-]+/g, '_') + '.blokplan', JSON.stringify(C.exportBlokplan(p, S.exercises))), 'sm'),
        btn('Elimina programma', async () => { if (await confirmDlg(`Eliminare "${p.title}"? Le sue sessioni spariscono dal calendario, le registrazioni restano.`, 'Elimina')) { S.plans = S.plans.filter(x => x !== p); done(); } }, 'sm danger'))]);
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
      S = migrate(obj); calSel = calMonth = null; save(); render(); toast('Backup ripristinato.'); log('import', 'backup ripristinato');
      return;
    }
    const r = C.importBlokplan(obj, {}); // lancia se non valido: lo stato non viene toccato
    const title = h('input', { value: r.plan.title }), start = h('input', { type: 'date', value: r.plan.startDate });
    const ov = openSheet('Importa programma', [h('p', { class: 'sub' }, `${r.plan.weeks.length} settimane. Scegli da quando parte: le sessioni compaiono nel calendario.`),
      field('Nome', title), field('Inizio (viene portato al lunedì di quella settimana)', start),
      btn('Importa', () => {
        const iso = C.validISO(start.value);
        if (!iso) return toast('Scegli una data valida.');
        r.plan.title = title.value.trim().slice(0, 80) || r.plan.title; r.plan.startDate = C.mondayOf(iso);
        for (const e of r.exercises) S.exercises[e.id] = e;
        ensureTests(S);
        S.plans.push(r.plan);
        for (const w of r.plan.weeks) for (const d of w) for (const x of d.sessions) privatize(S, x); // i parametri diventano di ogni sessione
        prune(S); save(); ov.remove();
        toast(`Importato ${r.plan.title}.`); log('import', 'programma importato', { title: r.plan.title, weeks: r.plan.weeks.length, nuoviEsercizi: r.exercises.length });
        go('calendario-' + r.plan.startDate);
      }, 'pri block')]);
  }

  function sessionSheet(r) {
    const s = sessOf(r), title = h('input', { value: s.title || '', placeholder: 'Sessione' }), date = r.x ? h('input', { type: 'date', value: r.x.date }) : null;
    const ov = openSheet('Sessione', [field('Titolo', title), r.x ? field('Data', date) : null,
      btn('Salva', () => {
        const iso = r.x ? C.validISO(date.value) : null, moved = iso && iso !== r.x.date;
        s.title = title.value.trim().slice(0, 80);
        if (iso) r.x.date = iso;
        save(); ov.remove();
        if (moved) showDate(iso); else render();
      }, 'pri block'),
      h('div', { class: 'btns' }, btn('Copia su una data…', () => { ov.remove(); copyToDateSheet(r); }, 'sm'),
        btn('Elimina sessione', async () => {
          if (!await confirmDlg('Eliminare questa sessione? Le sue registrazioni restano.', 'Elimina')) return;
          if (r.x) S.extras = S.extras.filter(e => e !== r.x); else r.p.weeks[r.w][r.d].sessions.splice(r.si, 1);
          save(); ov.remove(); render();
        }, 'sm danger'))]);
  }
  /** Parametri di un esercizio in questa sessione. Valgono solo qui: gli esercizi di base non hanno descrizioni né valori fissi. */
  function blockSheet(r, bi) {
    const s = sessOf(r), b = s.blocks[bi], e = S.exercises[b.exId];
    const close = () => { save(); ov.remove(); render(); };
    if (!e) { const ov0 = openSheet('Esercizio rimosso', btn('Togli dalla sessione', () => { s.blocks.splice(bi, 1); save(); ov0.remove(); render(); }, 'danger block')); return; }
    const iv = e.interval || {}, ld = e.load || {};
    const name = h('input', { value: e.name }), min = numInp(b.minutes), note = h('input', { value: b.note || '', placeholder: 'Facoltativa: si vede anche nel timer' });
    const sfSel = opts(surfOpts().concat([['+new', '＋ Aggiungi nuova…']]), e.surface || '', { onchange: () => sync() }), sfNew = h('input', { placeholder: 'Es. Spray wall' });
    const sfNewField = field('Nome della nuova superficie', sfNew);
    const mode = opts([['none', 'Solo durata'], ['timed', 'A tempo (countdown)'], ['reps', 'A ripetizioni (tocco "Fatto")']], !e.interval ? 'none' : iv.selfPaced ? 'reps' : 'timed', { onchange: () => sync() });
    const rounds = numInp(iv.rounds || 3), work = numInp(iv.workSeconds || 7), rest = numInp(iv.restSeconds == null ? 180 : iv.restSeconds);
    const reps = numInp(iv.reps), perSet = numInp(iv.roundsPerSet), setRest = numInp(iv.setRestSeconds);
    const sides = h('input', { type: 'checkbox', checked: (iv.cues || []).length > 0 });
    const pairs = pairsPresent();
    const refs = [['', 'Nessuno']].concat(S.testDefs.filter(t => t.key !== 'bw' && !inPair(t.key, pairs)).map(t => [t.key, t.name]), pairs.map(k => [k, C.PAIRS[k] + ' (SX/DX dal cue)']));
    const ref = opts(refs, ld.ref || ''), pct = numInp(ld.pct);
    const workF = field('Lavoro (s)', work), repsF = field('Ripetizioni', reps);
    const timer = h('div', {}, h('div', { class: 'cols3' }, field('Round', rounds), workF, repsF, field('Recupero (s)', rest)),
      h('div', { class: 'cols' }, field('Round per serie (facolt.)', perSet), field('Recupero tra serie (s)', setRest)),
      h('label', { class: 'f' }, 'Lati', h('div', { style: 'margin-top:8px;color:var(--tx)' }, sides, ' Alterna SX/DX (i round contano entrambi i lati: 6 round = 3 per lato)')));
    const sync = () => { timer.hidden = mode.value === 'none'; workF.hidden = mode.value !== 'timed'; repsF.hidden = mode.value !== 'reps'; sfNewField.hidden = sfSel.value !== '+new'; };
    const isTest = !!ld.test;
    const ov = openSheet(e.std && C.STD[e.std] ? C.STD[e.std].name : e.name, [h('p', { class: 'sub' }, 'Parametri di questo esercizio in questa sessione.'),
      h('div', { class: 'cols' }, field('Nome', name), field('Minuti previsti', min)), field('Timer', mode), timer,
      isTest ? null : h('div', { class: 'cols' }, field('Carico: test di riferimento', ref), field('% del massimale', pct)),
      e.slot === 'wall' || e.slot === 'warmup' || e.surface ? [field('Superficie di arrampicata', sfSel), sfNewField] : null,
      field('Nota', note),
      btn('Salva', () => {
        if (!name.value.trim()) return toast('Serve un nome.');
        let sf = sfSel.value;
        if (sf === '+new') { const nm = sfNew.value.trim().slice(0, 40); if (!nm) return toast('Scrivi il nome della nuova superficie.'); sf = addSurface(nm); }
        e.name = name.value.trim().slice(0, 80); e.surface = sf;
        e.interval = mode.value === 'none' ? null : C.normInterval({ rounds: Math.max(1, val(rounds) || 1), workSeconds: mode.value === 'timed' ? val(work) || 0 : 45, restSeconds: val(rest) || 0, selfPaced: mode.value === 'reps',
          reps: mode.value === 'reps' ? val(reps) || 0 : 0, roundsPerSet: val(perSet) || 0, setRestSeconds: val(setRest) || 0, cues: sides.checked ? ['SX', 'DX'] : [] });
        if (!isTest) { const d = S.testDefs.find(t => t.key === C.refKeys(ref.value)[0]); e.load = ref.value ? { ref: ref.value, mode: d && d.mode === 'hang' ? 'hang' : 'lift', pct: val(pct), test: false } : null; }
        const m = val(min); b.minutes = m == null ? C.intervalMinutes(e.interval) || b.minutes : Math.max(0, Math.round(m));
        b.note = note.value.trim().slice(0, 200);
        close();
      }, 'pri block'),
      h('div', { class: 'btns' }, btn('Sostituisci…', () => pickExercise(tpl => { s.blocks.splice(bi, 1); addBlock(s, tpl); s.blocks.splice(bi, 0, s.blocks.pop()); close(); }), 'sm'), btn('Rimuovi', () => { s.blocks.splice(bi, 1); close(); }, 'sm danger'))]);
    sync();
  }

  /* ---------- Esercizi: libreria standard + esercizi propri (solo nome e sezione; i parametri si impostano nella sessione) ---------- */
  const secHead = t => h('div', { class: 'sec' }, t);
  const customTpl = c => ({ std: null, custom: c.key, name: c.name, slot: c.slot, location: c.slot === 'wall' || c.slot === 'warmup' ? 'wall' : 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low', equipment: [], interval: null, load: null, surface: '' });
  function customSheet(onDone) {
    const name = h('input', { placeholder: 'Es. Circuito spray' }), slot = opts(C.SLOTS, 'wall');
    const ov = openSheet('Nuovo esercizio', [h('p', { class: 'sub' }, 'Entra nella tua libreria. Serie, tempi e carichi li imposti ogni volta nella sessione.'), h('div', { class: 'cols' }, field('Nome', name), field('Sezione', slot)),
      btn('Crea esercizio', () => {
        const n = name.value.trim().slice(0, 80);
        if (!n) return toast('Serve un nome.');
        const c = { key: 'c-' + C.uid().slice(0, 8), name: n, slot: slot.value };
        S.custom.push(c); save(); ov.remove();
        if (onDone) onDone(customTpl(c)); else render();
      }, 'pri block')]);
  }
  function pickExercise(cb) {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Cerca…', oninput: () => fill() });
    let ov;
    const row = (name, sub, tpl) => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => { ov.remove(); cb(tpl()); } }, h('div', { class: 'grow n' }, name), sub ? h('div', { class: 'm' }, sub) : null);
    const fill = () => {
      const t = q.value.trim().toLowerCase(), nodes = [], mine = S.custom.filter(c => !t || c.name.toLowerCase().includes(t));
      if (mine.length) nodes.push(secHead('I miei esercizi'), ...mine.map(c => row(c.name, '', () => customTpl(c))));
      for (const [sec, label] of Object.entries(C.SECTIONS)) {
        const items = C.LIBRARY.filter(x => x.section === sec && (!t || x.name.toLowerCase().includes(t)));
        if (items.length) nodes.push(secHead(label), ...items.map(x => row(x.name, '', () => C.stdVariant(x.key))));
      }
      list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'sub' }, 'Nessun esercizio con questo nome: crealo con "+ Nuovo".')]));
    };
    ov = openSheet('Scegli esercizio', [h('div', { class: 'row' }, h('div', { class: 'grow' }, q), btn('+ Nuovo', () => { ov.remove(); customSheet(cb); }, 'sm pri')), list]);
    fill();
  }
  function viewLibrary() {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Cerca…', oninput: () => fill() });
    const fill = () => {
      const t = q.value.trim().toLowerCase(), nodes = [], mine = S.custom.filter(c => !t || c.name.toLowerCase().includes(t));
      if (mine.length) nodes.push(secHead('I miei esercizi'), ...mine.map(c => h('div', { class: 'blk' }, h('div', { class: 'grow' }, h('div', { class: 'n' }, c.name), h('div', { class: 'p' }, C.SLOTS[c.slot])),
        btn('Elimina', async () => { if (await confirmDlg(`Eliminare "${c.name}" dalla libreria? Le sessioni che lo contengono non cambiano.`, 'Elimina')) { S.custom = S.custom.filter(x => x !== c); save(); render(); } }, 'sm danger'))));
      for (const [sec, label] of Object.entries(C.SECTIONS)) {
        const items = C.LIBRARY.filter(x => x.section === sec && (!t || x.name.toLowerCase().includes(t)));
        if (items.length) nodes.push(secHead(label), ...items.map(x => h('div', { class: 'blk' }, h('div', { class: 'grow n' }, x.name))));
      }
      list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'sub' }, 'Nessun risultato.')]));
    };
    fill();
    return [h('div', { class: 'row' }, btn('‹ Altro', () => { location.hash = 'altro'; }, 'sm'), btn('+ Nuovo', () => customSheet(null), 'sm pri right')),
      h('h1', { style: 'margin-top:10px' }, 'Esercizi'), h('div', { class: 'sub' }, 'Gli esercizi di base hanno solo un nome. Serie, tempi, ripetizioni e carichi sono parametri che imposti in ogni sessione.'),
      h('div', { style: 'margin-top:10px' }, q), h('div', { class: 'card' }, list)];
  }

  /* ---------- Registrazioni ---------- */
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
    const date = h('input', { type: 'date', value: l.date }), title = h('input', { value: l.title }), min = numInp(l.minutes);
    const rpe = numInp(l.rpe), feel = opts(FEEL, l.feel ? String(l.feel) : '');
    const notes = h('textarea', {}); notes.value = l.notes || '';
    const climbs = climbEditor(l.climbs || [], () => val(min));
    const ov = openSheet(isNew ? 'Registra sessione' : 'Modifica registrazione', [h('div', { class: 'cols' }, field('Data', date), field('Minuti', min)),
      field('Titolo', title),
      h('div', { class: 'cols' }, field('RPE (1-10)', rpe), field('Come ti sentivi', feel)),
      h('h2', {}, 'Arrampicata'), climbs.node, field('Note', notes),
      (l.loads || []).length ? h('div', { class: 'sub' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
      btn('Salva', () => {
        Object.assign(l, { date: C.validISO(date.value) || l.date, title: title.value.trim() || 'Sessione', minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe),
          feel: feel.value ? +feel.value : null, notes: notes.value.trim(), climbs: climbs.read() });
        if (isNew) S.logs.push(l);
        save(); ov.remove(); render();
      }, 'pri block'),
      isNew ? null : btn('Elimina', async () => { if (await confirmDlg('Eliminare questa registrazione?', 'Elimina')) { S.logs = S.logs.filter(x => x !== l); save(); ov.remove(); render(); } }, 'danger block')]);
  }
  /* ---------- Analisi ---------- */
  const anHead = cur => [h('h1', {}, 'Analisi'), seg([['analisi', 'Grafici'], ['progressi', 'Test e massimali']], cur, k => { location.hash = k; })];
  const chartCard = (title, sub, ...nodes) => h('div', { class: 'card' }, h('div', { class: 'ct' }, title), sub ? h('div', { class: 'sub' }, sub) : null, nodes);
  /** Sezione della libreria a cui appartiene un esercizio (per il tempo per categoria). */
  const exSection = e => (e.std === 'test' ? 'fingers' : e.std && C.STD[e.std] ? C.STD[e.std].section : ({ warmup: 'warmup', wall: 'wall', mobility: 'mobility' }[e.slot] || 'strength'));
  const hm = m => (m < 120 ? m + ' min' : dec(Math.round(m / 6) / 10) + ' h');
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
    const sched = S.plans.flatMap(p => C.scheduled(p, [])).concat(C.scheduled(null, S.extras)), wk = C.weeklyStats(S.logs, sched, from, to), sum = C.summary(S.logs, sched, from, to, t);
    const labels = wk.map(w => fmtDate(w.week)), long = wk.map(w => `${fmtDate(w.week)} – ${fmtDate(C.addDays(w.week, 6))}`);
    // Un solo filtro, sopra tutto quello che governa
    const out = [anHead('analisi'), seg([[4, '4 sett.'], [8, '8 sett.'], [12, '12 sett.'], [0, 'Tutto']], anWeeks, k => { anWeeks = k; render(); }),
      h('div', { class: 'sub' }, `${fmtDate(from)} – ${fmtDate(to)} · settimana in corso inclusa`),
      h('div', { class: 'tiles' },
        tile('Sessioni', sum.sessions, sum.due ? `${sum.due} in programma finora` : ''),
        tile('Tempo', sum.minutes < 120 ? sum.minutes + ' min' : dec((sum.minutes / 60).toFixed(1)) + ' h', sum.sessions ? `${Math.round(sum.minutes / sum.sessions)} min a sessione` : ''),
        tile('RPE medio', sum.rpe == null ? '—' : dec(sum.rpe.toFixed(1)), sum.rpeN ? `su ${sum.rpeN} ${sum.rpeN === 1 ? 'sessione' : 'sessioni'}` : 'nessun RPE registrato'),
        tile('Aderenza', sum.due ? Math.round(sum.dueDone / sum.due * 100) + '%' : '—', sum.due ? `${sum.dueDone} di ${sum.due} sessioni fatte` : 'niente in programma'))];
    if (!sum.sessions && !wk.some(w => w.plannedMinutes))
      return out.concat(h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'Nessun dato in questo periodo. I grafici si riempiono quando completi una sessione o ne registri una dalla Home.')));

    // Tempo per categoria: quota di arrampicata in evidenza, poi le sezioni ordinate (colore = gruppo)
    const cat = C.timeBySection(S.logs, from, to), grp = C.weeklyGroups(S.logs, from, to), SEC = { ...C.SECTIONS, strength: 'Forza generale', mobility: 'Mobilità', other: 'Altro' };
    if (cat.classified || cat.unclassified) {
      const pct = m => Math.round(m / cat.classified * 100) + '%'; // stessa base della cifra in evidenza: il tempo classificato
      const rows = cat.rows.map(r => ({ label: SEC[r.section], value: r.minutes, text: `${hm(r.minutes)} · ${pct(r.minutes)}`, cls: 'g-' + C.SECTION_GROUP[r.section] }));
      if (cat.unclassified) rows.push({ label: 'Non classificato', value: cat.unclassified, text: hm(cat.unclassified), cls: 'g-none' });
      out.push(chartCard('Tempo per categoria', cat.classified ? 'Dai minuti registrati per ogni esercizio.' : 'Servono sessioni fatte con il timer: solo lì i minuti sono per esercizio.',
        cat.wallShare == null ? null : [h('div', { class: 'hero', style: 'margin-top:4px' }, Math.round(cat.wallShare * 100) + '%', h('small', {}, 'sul muro')), h('div', { class: 'sub', style: 'margin-bottom:10px' }, `${hm(cat.wall)} su ${hm(cat.classified)} classificati`)],
        Charts.hbars(rows),
        cat.unclassified ? h('p', { class: 'sub', style: 'margin-bottom:0' }, 'Non classificato: sessioni registrate a mano, o tempo non attribuito a un esercizio. Resta fuori dalle percentuali.') : null));
    }
    if (wk.some(w => w.minutes || w.plannedMinutes)) out.push(chartCard('Volume settimanale', 'Minuti registrati per gruppo, confrontati con quelli in programma.',
      Charts.stacked({ labels, longLabels: long, unit: 'min', targets: wk.map(w => w.plannedMinutes), targetName: 'In programma', aria: 'Minuti di allenamento per settimana, divisi per gruppo',
        series: [['wall', C.GROUPS.wall], ['strength', C.GROUPS.strength], ['other', C.GROUPS.other], ['unclassified', 'Non classificato']].map(([k, name]) => ({ name, cls: k === 'unclassified' ? 'g-none' : 'g-' + k, values: grp.map(w => w[k]) })).filter(x => x.values.some(v => v > 0)) })));
    if (wk.some(w => w.load)) out.push(chartCard('Carico settimanale', 'Somma di minuti × RPE delle sessioni con RPE (unità arbitrarie).',
      Charts.columns({ labels, longLabels: long, values: wk.map(w => Math.round(w.load)), name: 'Carico', aria: 'Carico di allenamento sRPE per settimana' })));
    if (wk.some(w => w.rpe != null)) out.push(chartCard('Sforzo percepito', 'RPE medio delle sessioni della settimana (scala 1–10).',
      Charts.line({ labels, longLabels: long, values: wk.map(w => w.rpe), name: 'RPE medio', domain: { min: 0, max: 10, step: 5 }, height: 120, aria: 'RPE medio per settimana' })));
    if (wk.some(w => w.feel != null)) out.push(chartCard('Sensazione', 'Media di "come ti sentivi" (1 distrutto – 5 ottimo).',
      Charts.line({ labels, longLabels: long, values: wk.map(w => w.feel), name: 'Sensazione media', domain: { min: 1, max: 5, step: 2 }, height: 120, aria: 'Sensazione media per settimana' })));

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
    if (loads.length) out.push(chartCard('Carichi per esercizio', 'Un grafico per esercizio standard e test: le sospensioni a due mani in una serie, i sollevamenti divisi per lato SX/DX. Tocca una riga per il dettaglio.',
      loads.map(s => {
        const v = s.points.map(p => p.kg), last = v[v.length - 1];
        return h('div', { class: 'blk', style: 'cursor:pointer;align-items:center', onclick: () => openSheet(s.name, Charts.line({ labels: s.points.map(p => fmtDate(p.date)), values: v, name: 'Carico', unit: 'kg', colLabel: 'Data', aria: `Carico usato per ${s.name}` })) },
          h('div', { class: 'grow' }, h('div', { class: 'n' }, s.name), h('div', { class: 'p' }, `${v.length} ${v.length === 1 ? 'registrazione' : 'registrazioni'}`)),
          Charts.spark(v), h('div', { class: 'm', style: 'color:var(--tx);font-weight:600;min-width:58px;text-align:right' }, dec(last) + ' kg'));
      })));
    return out;
  }

  const MODES = [['hang', 'Zavorra aggiunta al peso corporeo'], ['lift', 'Carico sollevato'], ['value', 'Valore libero (secondi, kg…)']];
  const testUsed = key => Object.values(S.exercises).some(e => e.load && C.refKeys(e.load.ref).includes(key));
  function testDefSheet(def) {
    const isNew = !def; def = def || { key: 'c-' + C.uid().slice(0, 8), name: '', unit: 'kg', mode: 'hang', hands: 2 };
    const name = h('input', { value: def.name, placeholder: 'Half-crimp' }), unit = h('input', { value: def.unit }), mode = opts(MODES, def.mode || 'value');
    const edge = numInp(def.edge), secs = numInp(def.seconds), reps = numInp(def.reps), hands = opts([['2', 'Due mani'], ['1', 'Una mano']], String(def.hands || 2));
    const ov = openSheet(isNew ? 'Nuovo test' : 'Parametri del test', [field('Nome', name), h('div', { class: 'cols' }, field('Cosa misura', mode), field('Unità', unit)),
      h('div', { class: 'cols' }, field('Tacca (mm)', edge), field('Durata (secondi)', secs)), h('div', { class: 'cols' }, field('Ripetizioni (RM)', reps), field('Mani', hands)),
      h('p', { class: 'sub' }, 'Lascia vuoti i parametri che non servono. Tacca, secondi e ripetizioni compaiono accanto al nome.'),
      btn(isNew ? 'Crea test' : 'Salva', () => {
        if (!name.value.trim()) return toast('Serve un nome.');
        Object.assign(def, { name: name.value.trim().slice(0, 60), unit: unit.value.trim().slice(0, 8) || 'kg', mode: mode.value, edge: val(edge) || null, seconds: val(secs) || null, reps: val(reps) || null, hands: +hands.value });
        if (isNew) S.testDefs.push(def);
        save(); ov.remove(); render();
      }, 'pri block')]);
  }
  function testSheet(def) {
    const date = h('input', { type: 'date', value: C.todayISO() }), v = numInp(null);
    const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? 1 : -1));
    let ov;
    const again = () => { save(); ov.remove(); render(); };
    ov = openSheet(def.name, [C.testLabel(def) ? h('p', { class: 'sub' }, C.testLabel(def)) : null, h('div', { class: 'cols' }, field('Data', date), field(`Valore (${def.unit})`, v)),
      btn('Aggiungi risultato', () => { const n = val(v); if (n == null) return toast('Inserisci un numero.'); S.tests.push({ id: C.uid(), key: def.key, date: C.validISO(date.value) || C.todayISO(), value: n }); again(); }, 'pri block'),
      h('h2', {}, 'Storico'), hist.length ? hist.map(t => h('div', { class: 'blk' }, h('div', { class: 'grow' }, `${fmtDate(t.date)} ${t.date.slice(0, 4)}`), h('div', { class: 'n' }, dec(t.value) + ' ' + def.unit),
        btn('✕', () => { S.tests = S.tests.filter(x => x !== t); again(); }, 'sm'))) : h('p', { class: 'sub' }, 'Ancora nessun risultato.'),
      h('div', { class: 'btns' }, btn('Modifica parametri', () => { ov.remove(); testDefSheet(def); }, 'sm'),
        def.key === 'bw' ? null : btn('Elimina test', async () => {
          if (testUsed(def.key)) return toast('È usato da alcuni esercizi per calcolare i kg: toglilo prima da lì.');
          if (await confirmDlg(`Eliminare "${def.name}" e il suo storico?`, 'Elimina')) { S.testDefs = S.testDefs.filter(x => x !== def); S.tests = S.tests.filter(t => t.key !== def.key); again(); }
        }, 'sm danger'))]);
  }
  function viewProgress() {
    const missing = C.TEST_TEMPLATES.filter(t => !S.testDefs.some(d => d.key === t.key));
    return [anHead('progressi'), h('div', { class: 'sub' }, 'L\'ultimo risultato di ogni test è il massimale usato per calcolare i kg. Un test si può anche aggiungere a una sessione: a fine esercizio il risultato arriva qui.'),
      S.testDefs.map(def => {
        const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? -1 : 1)), last = hist[hist.length - 1];
        return h('div', { class: 'card tap row', onclick: () => testSheet(def) },
          h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, def.name), C.testLabel(def) ? h('div', { class: 'sub' }, C.testLabel(def)) : null,
            h('div', { class: 'big' }, last ? dec(last.value) + ' ' + def.unit : '—'),
            h('div', { class: 'sub' }, last ? `${fmtDate(last.date)} · ${hist.length} ${hist.length === 1 ? 'risultato' : 'risultati'}` : 'Tocca per aggiungere un risultato')),
          Charts.spark(hist.map(t => t.value)));
      }),
      h('h2', {}, 'Aggiungi un test'), h('div', { class: 'card' },
        missing.length ? [h('p', { class: 'sub', style: 'margin-top:0' }, 'Parti da un modello (poi cambi tacca, secondi e il resto) oppure creane uno da zero.'),
          h('div', { class: 'btns', style: 'margin-top:0' }, missing.map(t => btn(t.name, () => { S.testDefs.push({ ...t }); save(); render(); }, 'sm')))] : null,
        btn('Test personalizzato', () => testDefSheet(null), 'sm pri block'))];
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
  /** Backup su file: con il menu di condivisione di iOS finisce in File/iCloud Drive; dove non c'è, download o copia. */
  async function doBackup() {
    if (cloudOn()) return cloudBackup(true);
    const name = `allenamento-backup-${C.todayISO()}.json`, mark = () => { S.settings.lastBackup = C.todayISO(); save(); render(); };
    const text = backupText();
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Backup Allenamento' }); mark(); return toast('Backup salvato.'); }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // l'utente ha chiuso il menu: nessun backup fatto
      console.warn('[backup] condivisione non riuscita, ripiego sul file', e);
    }
    exportSheet('Backup', name, text); mark();
  }
  function cloudCard() {
    const g = S.settings.gh || {}, repo = h('input', { value: g.repo || '', placeholder: 'utente/nome-repository', autocapitalize: 'off', autocorrect: 'off' }), token = h('input', { type: 'password', value: g.token || '', placeholder: 'github_pat_…', autocomplete: 'off' });
    return h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Salva da solo i dati in un tuo repository GitHub privato, pochi secondi dopo ogni modifica. Serve un token "fine-grained" limitato a quel repository, con permesso Contents: Read and write. Il token resta solo su questo dispositivo.'),
      field('Repository privato', repo), field('Token', token),
      cloudOn() ? h('p', { class: 'sub' }, g.error ? 'Ultimo tentativo non riuscito: ' + g.error + '.' : S.settings.lastBackup ? `Attivo. Ultimo backup: ${fmtDate(S.settings.lastBackup)}.` : 'Attivo. Nessun backup ancora.') : null,
      h('div', { class: 'btns' }, btn('Salva e prova', () => {
        const r = repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
        if (!/^[\w.-]+\/[\w.-]+$/.test(r)) return toast('Scrivi il repository come utente/nome.');
        if (!token.value.trim()) return toast('Incolla il token.');
        S.settings.gh = { repo: r, token: token.value.trim(), error: null }; save(); cloudBackup(true);
      }, 'sm pri'),
        cloudOn() ? [btn('Ripristina da GitHub', cloudRestore, 'sm'), btn('Scollega', async () => { if (await confirmDlg('Scollegare GitHub? Il token viene cancellato da questo dispositivo, i backup già caricati restano nel repository.', 'Scollega')) { S.settings.gh = null; clearTimeout(cloudTimer); save(); render(); } }, 'sm danger')] : null));
  }
  function viewMore() {
    const pr = S.settings.prog, progOn = h('input', { type: 'checkbox', checked: pr.on }), progStep = numInp(pr.step), progRpe = numInp(pr.rpe);
    const prep = numInp(S.settings.prep), sound = h('input', { type: 'checkbox', checked: S.settings.sound, onchange: () => { S.settings.sound = sound.checked; save(); } });
    const sfNew = h('input', { class: 'inp', style: 'margin:0', placeholder: 'Nuova superficie' });
    return [h('h1', {}, 'Altro'),
      h('div', { class: 'card tap row', onclick: () => { location.hash = 'libreria'; } }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Libreria esercizi'), h('div', { class: 'sub' }, (C.LIBRARY.length + S.custom.length) + ' esercizi')), '›'),
      h('h2', {}, 'Programmi'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Un programma è un insieme di sessioni: lo importi, scegli da quando parte e lo ritrovi nel calendario.'),
        S.plans.map(p => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => planSheet(p) }, h('div', { class: 'grow' }, h('div', { class: 'n' }, p.title),
          h('div', { class: 'p' }, `${fmtDate(p.startDate)} – ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))} · ${p.weeks.length} settimane`)), h('div', { class: 'm' }, '›'))),
        h('div', { class: 'btns' }, fileBtn('Importa programma (.blokplan)'))),
      h('h2', {}, 'Superfici di arrampicata'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Si assegnano agli esercizi e alle registrazioni, per confrontare l\'avanzamento nei grafici. Tocca per rinominare.'),
        h('div', { class: 'btns', style: 'margin-top:0' }, S.surfaces.map(x => btn(x.name, () => surfaceSheet(x), 'sm'))),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, sfNew), btn('Aggiungi', () => { const n = sfNew.value.trim().slice(0, 40); if (!n) return toast('Scrivi un nome.'); addSurface(n); save(); render(); }, 'sm')),
        h('p', { class: 'sub', style: 'margin-bottom:0' }, `Scala dei gradi: ${C.GRADE_SCALES[S.settings.gradeScale] || 'Font'}. La scelta di altre scale arriverà qui.`)),
      h('h2', {}, 'Timer'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Preparazione prima di un hang (s)', prep), h('label', { class: 'f' }, 'Segnali acustici', h('div', { style: 'margin-top:12px' }, sound, ' attivi'))),
        btn('Salva', () => { S.settings.prep = Math.min(60, Math.max(0, Math.round(val(prep) || 0))); save(); toast('Salvato.'); }, 'sm')),
      h('h2', {}, 'Progressione dei carichi'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'A fine esercizio registri carico e RPE. La volta dopo l\'app propone il carico: più alto se l\'RPE era entro la soglia, più basso se era molto sopra, uguale negli altri casi.'),
        h('div', { class: 'cols3' }, h('label', { class: 'f' }, 'Proposte', h('div', { style: 'margin-top:12px' }, progOn, ' attive')), field('Aumento (%)', progStep), field('Soglia RPE', progRpe)),
        btn('Salva', () => { Object.assign(S.settings.prog, { on: progOn.checked, step: Math.min(20, Math.max(0.5, val(progStep) || 2.5)), rpe: Math.min(10, Math.max(1, val(progRpe) || 8)) }); save(); toast('Salvato.'); render(); }, 'sm')),
      h('h2', {}, 'Backup automatico'), cloudCard(),
      h('h2', {}, 'Dati'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, (cloudOn() ? 'Il backup automatico su GitHub è attivo. ' : 'I dati restano solo su questo dispositivo. "Salva backup" apre il menu di condivisione: scegli "Salva su File" per metterlo in iCloud Drive.') + (S.settings.lastBackup ? ` Ultimo backup: ${fmtDate(S.settings.lastBackup)}.` : ' Nessun backup finora.')),
        h('div', { class: 'btns' }, btn(cloudOn() ? 'Backup adesso' : 'Salva backup', doBackup, 'sm pri'), fileBtn('Ripristina / importa file'),
          btn('Azzera tutto', async () => { if (await confirmDlg('Cancellare programmi, sessioni, esercizi, registrazioni e test? L\'operazione non si può annullare: fai prima un backup.', 'Azzera')) { S = fresh(); calSel = calMonth = null; save(); render(); } }, 'sm danger')))];
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
  document.addEventListener('visibilitychange', () => { if (R && document.visibilityState === 'visible') { wake(); tick(); } });
  const mmss = s => { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s); };
  const isAuto = st => st.kind === 'rest' || (st.kind === 'work' && !st.selfPaced);

  // R: sessione in corso (elenco). P: timer dell'esercizio in corso. Lo stato `done` sta anche in S.live, così si può riprendere.
  let R = null;
  function startSession(r) {
    const s = sessOf(r), resumed = S.live && S.live.sid === s.id;
    audioInit(); wake();
    R = { r, s, startedAt: resumed ? S.live.startedAt : Date.now(), done: resumed ? S.live.done || {} : {} };
    S.live = { sid: s.id, startedAt: R.startedAt, done: R.done }; save();
    drawRunner();
    log('sessione', resumed ? 'ripresa' : 'avviata', { titolo: autoTitle(s), esercizi: s.blocks.length });
  }
  function closeRunner() { $('runner').hidden = true; R = null; try { if (wl) wl.release(); } catch (e) { /* già rilasciato */ } wl = null; }
  function drawRunner() {
    const { s, done } = R, nextB = s.blocks.find(b => !done[b.id] && S.exercises[b.exId]);
    const row = (b, i) => {
      const ex = S.exercises[b.exId], d = done[b.id], hint = ex ? loadHint(ex) : '';
      return h('div', { class: 'run-r' + (d ? ' done' : '') }, h('div', { class: 'st' }, d ? '✓' : i + 1),
        h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, ex ? ex.name : 'Esercizio rimosso'), ex ? h('div', { class: 'sub' }, exLine(ex)) : null,
          hint && !d ? h('div', { style: 'color:var(--ac);font-size:13px;font-weight:600' }, hint) : null, ex && !d ? propLine(ex) : null, d && d.minutes ? h('div', { class: 'sub' }, `fatto · ${d.minutes} min`) : null),
        ex ? btn(d ? 'Rifai' : 'Avvia', () => startBlock(b), 'sm' + (b === nextB ? ' pri' : '')) : null);
    };
    const quit = () => {
      const ov = openSheet('Uscire dalla sessione?', h('div', { class: 'btns' }, btn('Continua', () => ov.remove()),
        btn('Esci e riprendi dopo', () => { ov.remove(); closeRunner(); render(); }), btn('Abbandona', () => { ov.remove(); S.live = null; save(); closeRunner(); render(); }, 'danger')), true);
    };
    $('runner').hidden = false;
    $('runner').replaceChildren(h('div', { class: 'in' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'sub' }, 'Sessione in corso'), h('h1', {}, s.title || 'Sessione')), btn('Esci', quit, 'sm')),
      h('div', { class: 'card' }, s.blocks.map(row), s.blocks.length ? null : h('p', { class: 'sub', style: 'margin:0' }, 'Nessun esercizio: aggiungine uno per iniziare.')),
      h('div', { class: 'btns' }, btn('+ Esercizio', () => pickExercise(tpl => { addBlock(s, tpl); save(); drawRunner(); }), ''), btn('+ Test', () => pickTest(tpl => { addBlock(s, tpl); save(); drawRunner(); }), ''),
        btn('Termina sessione', finishSession, nextB ? '' : 'pri'))));
  }

  function startBlock(b) {
    const steps = C.buildSteps([b], S.exercises, S.settings.prep);
    if (!steps.length) return toast('Esercizio non disponibile.');
    audioInit();
    P = { b, steps, idx: null, ms: 0, paused: false };
    $('player').hidden = false;
    P.timer = setInterval(tick, 200);
    enter(0);
  }
  function track() { // tempo effettivo sull'esercizio, pause escluse
    if (P.idx == null) return;
    const now = Date.now();
    P.ms += Math.max(0, now - P.stepAt - P.stepPaused - (P.paused ? now - P.pauseAt : 0));
  }
  function enter(i) {
    track();
    P.idx = i; P.endAt = Date.now() + P.steps[i].seconds * 1000; P.lastBeep = null;
    P.stepAt = Date.now(); P.stepPaused = 0;
    if (P.paused) { P.remain = P.steps[i].seconds * 1000; P.pauseAt = Date.now(); }
    draw();
  }
  function next() { if (P.idx + 1 >= P.steps.length) endBlock(); else enter(P.idx + 1); }
  function remaining() { return ((P.paused ? P.remain : P.endAt - Date.now())) / 1000; }
  function tick() {
    if (!P || P.paused) return;
    const st = P.steps[P.idx], rem = Math.ceil(remaining());
    if (isAuto(st)) {
      if (rem <= 0) { beep(st.kind === 'rest' ? 1320 : 660, 0.5); return next(); }
      if (rem <= 3 && rem !== P.lastBeep) { P.lastBeep = rem; beep(880, 0.12); }
    } else if (st.kind === 'free' && st.seconds > 0) {
      // esercizio a durata: allo scadere il timer si ferma e si passa alla registrazione, non all'esercizio successivo
      if (rem <= 0) { beep(1320, 0.6); return endBlock(); }
      if (rem <= 3 && rem !== P.lastBeep) { P.lastBeep = rem; beep(880, 0.12); }
    }
    drawClock();
  }
  function drawClock() {
    const st = P.steps[P.idx], rem = remaining();
    $('p-clock').textContent = st.kind === 'work' && st.selfPaced ? mmss(st.seconds - rem) : mmss(Math.ceil(rem)); // a ripetizioni: tempo trascorso
  }
  function draw() {
    const st = P.steps[P.idx], nx = P.steps[P.idx + 1], ex = S.exercises[st.exId];
    const ph = st.prep ? 'prep' : st.kind;
    $('player').dataset.ph = ph;
    $('p-bar').style.width = (P.idx / P.steps.length * 100) + '%';
    $('p-ph').textContent = { prep: 'PREPARATI', work: st.selfPaced ? 'ESEGUI' : 'LAVORO', rest: 'RECUPERO', free: 'IN CORSO' }[ph];
    $('p-name').textContent = st.name;
    $('p-round').textContent = st.kind === 'free' ? (ex && ex.surface ? surfName(ex.surface) : '') : `Round ${st.round} di ${st.rounds}`;
    $('p-cue').textContent = [st.cue, P.b.note].filter(Boolean).join(' · ');
    const kg = ex && st.kind !== 'free' ? C.loadKg(ex.load, st.cue, maxes()) : null;
    $('p-kg').textContent = kg == null ? '' : (ex.load.mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
    $('p-next').textContent = nx ? 'Poi: ' + (nx.kind === 'rest' ? `recupero ${mmss(nx.seconds)}` : (nx.cue || `round ${nx.round}`)) : 'Ultimo passo dell\'esercizio';
    $('p-done').textContent = isAuto(st) ? 'Salta' : 'Fatto';
    $('p-done').className = 'btn ' + (isAuto(st) ? '' : 'pri');
    $('p-plus').disabled = st.kind === 'work';
    $('p-pause').textContent = P.paused ? 'Riprendi' : 'Pausa';
    drawClock();
  }
  /** Fine dell'esercizio: il timer si ferma e si apre la sua registrazione. */
  function endBlock() {
    track();
    const { b, ms } = P;
    clearInterval(P.timer); P = null; $('player').hidden = true;
    recordSheet(b, ms);
  }
  function recordSheet(b, ms) {
    const ex = S.exercises[b.exId], m = maxes(), isClimb = ex.slot === 'wall' || !!ex.surface;
    const min = numInp(Math.round(ms / 60000)), note = h('input', { placeholder: 'Facoltativa' });
    const isTest = !!(ex.load && ex.load.test), prop = proposal(ex), planned = loadHint(ex).replace('kg: mancano i massimali', '');
    // Carico e RPE per ogni esercizio di forza: sono lo storico da cui nasce la proposta della volta dopo.
    const load = !isTest && (ex.load || ex.slot === 'strength') ? h('input', { value: planned || (prop ? prop.text : ''), placeholder: 'es. 20 kg oppure SX 18 kg · DX 20 kg' }) : null;
    const rpe = load ? numInp(null, { placeholder: '1-10' }) : null;
    const tests = ex.load && ex.load.test ? C.refKeys(ex.load.ref).map(k => S.testDefs.find(t => t.key === k)).filter(Boolean)
      .map(def => ({ def, inp: numInp(null, { placeholder: m[def.key] == null ? '' : 'precedente: ' + dec(m[def.key]) }) })) : [];
    const sf = isClimb ? opts(surfOpts(), ex.surface || '') : null, gr = isClimb ? opts(gradeOpts(), '') : null, sends = isClimb ? numInp(null) : null;
    const put = rec => {
      const prev = R.done[b.id], date = C.todayISO();
      if (prev && prev.testIds) S.tests = S.tests.filter(t => !prev.testIds.includes(t.id)); // "Rifai": il nuovo risultato sostituisce il precedente
      rec.testIds = (rec.tests || []).map(t => { const id = C.uid(); S.tests.push({ id, key: t.key, date, value: t.value }); return id; });
      R.done[b.id] = rec; S.live.done = R.done; save(); ov.remove(); drawRunner();
    };
    const ov = openSheet(ex.name, [h('p', { class: 'sub' }, 'Esercizio completato: registra com\'è andato.'),
      field('Minuti', min),
      tests.length ? [tests.map(x => field(`Risultato: ${x.def.name} (${x.def.unit})`, x.inp)), h('p', { class: 'sub' }, 'Salvando, il risultato aggiorna subito il massimale nella sezione Test.')] : null,
      load ? h('div', { class: 'cols' }, field('Carico usato', load), field('RPE dell\'esercizio', rpe)) : null,
      load && prop && planned ? h('p', { class: 'sub' }, `Proposto: ${prop.text} (${prop.why}).`) : null,
      isClimb ? [h('div', { class: 'cols' }, field('Superficie', sf), field('Grado max chiuso', gr)), field('Blocchi chiusi', sends)] : null,
      field('Nota', note),
      btn('Salva', () => put({ name: ex.name, minutes: Math.max(0, Math.round(val(min) || 0)), note: note.value.trim().slice(0, 200), load: load ? load.value.trim() : '', sec: exSection(ex),
        key: exKey(ex), label: exLabel(ex), kgs: load ? C.parseLoads(load.value) : [], rpe: rpe ? val(rpe) : null, mode: ex.load ? ex.load.mode : 'lift',
        tests: tests.map(x => ({ key: x.def.key, value: val(x.inp) })).filter(x => x.value != null),
        climb: isClimb && sf.value ? { name: ex.name, surface: sf.value, top: gr.value || null, sends: val(sends) == null ? null : Math.max(0, Math.round(val(sends))), minutes: Math.max(0, Math.round(val(min) || 0)) } : null }), 'pri block'),
      btn('Fatto, senza registrare', () => put({ name: ex.name, minutes: Math.round(ms / 60000) }), 'block'),
      btn('Non fatto: torna all\'elenco', () => { ov.remove(); drawRunner(); }, 'block')]);
  }
  function finishSession() {
    const { r, s, done } = R, recs = s.blocks.map(b => done[b.id]).filter(Boolean);
    const min = numInp(Math.max(1, Math.round((Date.now() - R.startedAt) / 60000))), rpe = numInp(null), feel = opts(FEEL, ''), notes = h('textarea', {});
    let ov;
    const end = () => { S.live = null; save(); ov.remove(); closeRunner(); go('calendario-' + C.todayISO()); };
    ov = openSheet('Termina sessione', [h('p', { class: 'sub' }, `${recs.length} di ${s.blocks.length} esercizi fatti.`),
      h('div', { class: 'cols3' }, field('Minuti totali', min), field('RPE (1-10)', rpe), field('Sensazione', feel)), field('Note', notes),
      btn('Salva', () => {
        const date = C.todayISO();
        S.logs.push({ id: C.uid(), date, sid: s.id, type: s.type || 'wall', title: autoTitle(s), minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe), feel: feel.value ? +feel.value : null, notes: notes.value.trim(),
          loads: recs.filter(x => x.load).map(x => ({ name: x.name, kg: x.load })), climbs: recs.map(x => x.climb).filter(Boolean),
          blocks: recs.map(x => ({ name: x.name, minutes: x.minutes || 0, note: x.note || '', key: x.key, label: x.label, sec: x.sec, kgs: x.kgs && x.kgs.length ? x.kgs : undefined, rpe: x.rpe == null ? undefined : x.rpe, mode: x.mode })) });
        log('sessione', 'registrata', { esercizi: recs.length });
        end();
      }, 'pri block'), btn('Chiudi senza salvare', end, 'block')]);
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
    $('p-quit').onclick = () => endBlock();
  }

  /* ---------- Router ---------- */
  const VIEWS = { home: viewHome, calendario: viewCalendar, analisi: viewAnalytics, progressi: viewProgress, altro: viewMore, libreria: viewLibrary };
  function render() {
    const [name, ...args] = (location.hash.slice(1) || 'home').split('-');
    const fn = VIEWS[name] || viewHome;
    let nodes;
    try { nodes = fn(args); }
    catch (e) { console.error('[ui] errore nella vista ' + name, e); nodes = [h('h1', {}, 'Qualcosa è andato storto'), h('p', { class: 'sub' }, String(e.message || e)), btn('Torna alla Home', () => go('home'))]; }
    $('view').replaceChildren(...[nodes].flat(Infinity).filter(n => n != null && n !== false));
    const tab = { libreria: 'altro', progressi: 'analisi' }[name] || (VIEWS[name] ? name : 'home');
    for (const el of document.querySelectorAll('#tabs a')) el.classList.toggle('on', el.getAttribute('href') === '#' + tab);
  }
  let lastView = (location.hash.slice(1) || 'home').split('-')[0];
  window.addEventListener('hashchange', () => {
    for (const o of document.querySelectorAll('.overlay')) o.remove();
    const view = (location.hash.slice(1) || 'home').split('-')[0];
    if (view !== lastView || view !== 'calendario') window.scrollTo(0, 0); // nel calendario cambiare giorno non deve riportare in cima
    lastView = view;
    render();
  });
  wirePlayer();
  render();
  cloudRetry();
  window.__app = { get state() { return S; }, render, cloudBackup }; // utile per debug dalla console
})();
