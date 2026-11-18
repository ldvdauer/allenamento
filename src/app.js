/* Interfaccia: viste, editor, player. Tutta la logica testabile sta in core.js, i grafici in charts.js. */
(function () {
  'use strict';
  const C = Core, KEY = 'allenamento.v1';
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WD_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const FEEL = [['', '—'], ['1', '1 · Wrecked'], ['2', '2 · Tired'], ['3', '3 · So-so'], ['4', '4 · Good'], ['5', '5 · Great']];
  const wdIdx = iso => (C.fromISO(iso).getDay() + 6) % 7;
  const fmtDate = iso => { const d = C.fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const wdOf = iso => WD[wdIdx(iso)];
  const dec = v => String(v);
  const log = (area, msg, extra) => console.info(`[${area}] ${msg}`, extra === undefined ? '' : extra);

  /* ---------- Stato e persistenza ---------- */
  // Primo avvio: nessun piano precaricato, ogni utente importa o crea i propri.
  const fresh = () => migrate({ v: 8, plans: [], activePlan: null, exercises: {}, logs: [], tests: [] });
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
    e.interval.cues = sided ? ['L', 'R'] : [];
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
    s.notes = Array.isArray(s.notes) ? s.notes : [];
    if (fromV < 5) for (const x of allSessions(s)) privatize(s, x);
    prune(s);
    // v6: un solo campo Nota (mostrato anche nel timer) + interruttore SX/DX al posto dei cue
    if (fromV === 5) for (const x of allSessions(s)) for (const b of x.blocks) if (s.exercises[b.exId]) cuesToNote(s.exercises[b.exId], b);
    // v7: interfaccia in inglese. Si rinominano solo i nomi predefiniti rimasti uguali all'originale italiano e i lati SX/DX → L/R;
    // titoli, note ed esercizi scritti dall'utente non si toccano.
    if (fromV < 7) {
      const en = n => C.LEGACY_NAMES[n] || n, parts = n => String(n).split(' · ').map(en).join(' · ');
      for (const e of Object.values(s.exercises)) {
        if (typeof e.name === 'string') e.name = e.name.startsWith('Test: ') ? 'Test: ' + en(e.name.slice(6)) : en(e.name);
        if (e.interval && Array.isArray(e.interval.cues)) e.interval.cues = e.interval.cues.map(c => (/^(SX|DX)$/.test(c) ? C.normSide(c) : c));
      }
      for (const d of s.testDefs) d.name = en(d.name);
      for (const x of s.surfaces) x.name = en(x.name);
      for (const l of s.logs) for (const b of l.blocks || []) {
        if (typeof b.name === 'string') b.name = b.name.startsWith('Test: ') ? 'Test: ' + en(b.name.slice(6)) : en(b.name);
        if (typeof b.label === 'string') b.label = parts(b.label);
        for (const k of b.kgs || []) if (k.side) k.side = C.normSide(k.side);
      }
    }
    // v8: con un timer i minuti previsti si calcolano dai parametri, non si scrivono a mano.
    if (fromV < 8) {
      const fix = list => { for (const x of list) for (const b of x.blocks || []) { const e = s.exercises[b.exId]; if (e && e.interval && e.interval.rounds) b.minutes = C.intervalMinutes(e.interval); } };
      for (const p of s.plans) for (const w of p.weeks) for (const d of w) fix(d.sessions);
      fix(s.extras);
    }
    s.v = 8;
    return s;
  }
  let rescued = false;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        try { const s = JSON.parse(raw); if (C.validState(s)) return migrate(s); console.warn('[store] saved data is invalid'); }
        catch (e) { console.warn('[store] saved data cannot be read', e); }
        // Mai sovrascrivere dati che non si riescono a leggere: si mette da parte una copia prima di ripartire da zero.
        try { localStorage.setItem(KEY + '.rescue-' + Date.now(), raw); rescued = true; } catch (e) { console.warn('[store] rescue copy failed', e); }
      }
    } catch (e) { console.warn('[store] read failed', e); }
    return fresh();
  }
  let storeOk = true;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storeOk = true; scheduleCloud(); }
    catch (e) {
      console.warn('[store] write failed', e);
      if (storeOk) toast('Saving is not available here: make a backup from More.');
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
  const ghError = r => new Error(r.status === 401 ? 'token invalid or expired' : r.status === 403 ? 'the token is not allowed to write to the repository' : r.status === 404 ? 'repository not found (wrong name, or token without access)' : 'GitHub answered ' + r.status);
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
      log('backup', 'saved to GitHub', { kb: Math.ceil(text.length / 1024) });
      if (manual) toast('Backup saved to GitHub.');
      return true;
    } catch (e) {
      g.error = e instanceof TypeError ? 'no network' : String(e.message || e);
      console.warn('[backup] GitHub: ' + g.error, e);
      if (manual) toast('Backup failed: ' + g.error + '.');
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
      if (!C.validState(obj)) throw new Error('the file on GitHub is not a valid backup');
      if (!await confirmDlg('Replace ALL data on this device with the backup on GitHub?', 'Replace')) return;
      const gh = S.settings.gh; // collegamento e token restano quelli di questo dispositivo
      S = migrate(obj); S.settings.gh = gh; calSel = calMonth = null; gh.sig = cloudSig(); save(); render(); toast('Backup restored from GitHub.');
    } catch (e) { console.warn('[backup] restore failed', e); toast('Restore failed: ' + (e instanceof TypeError ? 'no network' : e.message) + '.'); }
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
      h('div', { class: 'sheet' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, title), mid ? null : btn('Close', () => ov.remove(), 'sm')), body));
    document.body.append(ov);
    return ov;
  }
  // I dialoghi nativi (confirm/alert) non sono affidabili in una PWA: conferma costruita in pagina.
  function confirmDlg(msg, okLabel) {
    return new Promise(res => {
      const ov = openSheet('Confirm', [h('p', {}, msg), h('div', { class: 'btns' },
        btn('Cancel', () => { ov.remove(); res(false); }), btn(okLabel || 'Confirm', () => { ov.remove(); res(true); }, 'danger'))], true);
    });
  }
  function download(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.warn('[export] download failed', e); toast('Download not available: use Copy.'); }
  }
  function exportSheet(title, name, text) {
    const ta = h('textarea', { readonly: '', class: 'inp', style: 'min-height:140px;font-size:12px' }); ta.value = text;
    openSheet(title, [h('p', { class: 'sub' }, name + ' · ' + Math.ceil(text.length / 1024) + ' KB'), ta, h('div', { class: 'btns' },
      btn('Download file', () => download(name, text), 'pri'),
      btn('Copy', async () => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { ta.select(); toast('Select and copy manually.'); } }))]);
  }
  const go = hash => { if (location.hash.slice(1) === hash) render(); else location.hash = hash; };

  /* ---------- Riferimenti alle sessioni ----------
     Una sessione sta in un piano ({p, w, d, si}) oppure è "extra", legata a una data del calendario ({x}).
     Diario e player la riconoscono dal suo id, quindi spostare o copiare settimane non sposta lo stato "fatta". */
  const sessOf = r => (r.x ? r.x : r.p.weeks[r.w][r.d].sessions[r.si]);
  const isDone = r => { const id = sessOf(r).id; return S.logs.some(l => l.sid === id); };
  // Titolo per diario e sessione in corso: quello scelto, altrimenti i primi due esercizi che non sono riscaldamento.
  const autoTitle = s => s.title || s.blocks.map(b => S.exercises[b.exId]).filter(e => e && e.slot !== 'warmup').slice(0, 2).map(e => e.name).join(' · ') || 'Session';
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
    return { text: fmt(nx), why: `last time ${fmt(last.kgs)}${last.rpe == null ? ', no RPE' : ', RPE ' + dec(last.rpe)}` };
  }
  const propLine = ex => { const p = proposal(ex); return p ? h('div', { class: 'p' }, `Suggested: ${p.text} (${p.why})`) : null; };
  function loadHint(ex) {
    if (!ex.load || ex.load.pct == null) return '';
    const cues = ex.interval && ex.interval.cues.length ? ex.interval.cues : [''];
    const m = maxes(), out = [];
    for (const c of cues) {
      const kg = C.loadKg(ex.load, c, m);
      if (kg == null) return 'kg: maxes missing';
      const side = C.PAIRS[ex.load.ref] ? (/^\s*(DX|R\b)/i.test(c) ? 'R ' : 'L ') : '';
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
    const grip = drag ? h('span', { class: 'grip', 'data-grip': '', role: 'img', 'aria-label': 'Drag to reorder', onclick: e => e.stopPropagation() }, '≡') : null;
    if (!ex) return h('div', { class: 'blk', 'data-id': b.id }, grip, h('span', { class: 'p' }, 'Exercise removed'));
    const hint = loadHint(ex);
    return h('div', { class: 'blk', 'data-id': b.id, onclick, style: onclick ? 'cursor:pointer' : null }, grip,
      h('div', { class: 'grow' }, h('div', { class: 'n' }, ex.name), h('div', { class: 'p' }, exLine(ex)), hint ? h('div', { class: 'kg' }, hint) : null, propLine(ex), b.note ? h('div', { class: 'p note' }, b.note) : null),
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
  const testExercise = ref => C.testExercise(ref, S.testDefs);

  function pickTest(cb) {
    const pairs = pairsPresent();
    const items = S.testDefs.filter(t => t.key !== 'bw' && !inPair(t.key, pairs)).map(t => [t.key, t.name, C.testLabel(t)]).concat(pairs.map(k => [k, C.PAIRS[k], 'L and R']));
    if (!items.length) return toast('Create a test first in Analytics → Tests and maxes.');
    const ov = openSheet('Add a test', [h('p', { class: 'sub' }, 'When the exercise ends you log the result, which updates the max in the Tests section.'),
      items.map(([k, name, sub]) => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => { ov.remove(); cb(testExercise(k)); } }, h('div', { class: 'grow' }, h('div', { class: 'n' }, name), h('div', { class: 'p' }, sub))))]);
  }
  function sessionCard(r, edit) {
    const s = sessOf(r), done = isDone(r);
    const list = h('div', {}, s.blocks.map((b, bi) => blockRow(b, edit ? () => blockSheet(r, bi) : null, edit)));
    if (edit) enableDrag(list, s);
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow big', style: 'font-size:17px' }, s.title || 'Session'),
        done ? h('span', { class: 'tag ok' }, 'Done') : null, h('span', { class: 'tag' }, C.sessionMinutes(s) + ' min')),
      list, s.blocks.length ? null : h('p', { class: 'sub' }, 'No exercises yet: add them here or during the session.'),
      h('div', { class: 'btns' },
        btn(done ? 'Repeat' : 'Start', () => startSession(r), 'pri'),
        edit ? [btn('+ Exercise', () => pickExercise(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'), btn('+ Test', () => pickTest(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'),
          btn('Edit', () => sessionSheet(r), 'sm')] : btn('Edit', () => go('calendar-' + (r.x ? r.x.date : C.dateOf(r.p, r.w, r.d))), 'sm')));
  }
  const climbText = c => surfName(c.surface) + (c.top ? ' ' + fmtG(c.top) : '') + (c.sends != null ? ` · ${c.sends} ${c.sends === 1 ? 'send' : 'sends'}` : '');
  const logCard = l => h('div', { class: 'card tap', onclick: () => logSheet(l) },
    h('div', { class: 'row' }, h('div', { class: 'grow n', style: 'font-weight:600' }, l.title), h('span', { class: 'tag' }, (l.minutes || 0) + ' min')),
    h('div', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)}${l.rpe ? ' · RPE ' + dec(l.rpe) : ''}${l.feel ? ' · feeling ' + l.feel + '/5' : ''}`),
    (l.climbs || []).length ? h('div', { class: 'sub', style: 'color:var(--tx)' }, l.climbs.map(climbText).join('  |  ')) : null,
    (l.loads || []).length ? h('div', { class: 'p', style: 'color:var(--ac);font-size:13px' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
    (l.blocks || []).some(b => b.note) ? h('div', { class: 'sub' }, l.blocks.filter(b => b.note).map(b => `${b.name}: ${b.note}`).join(' · ')) : null,
    l.notes ? h('div', { class: 'sub', style: 'margin-top:4px;color:var(--tx)' }, l.notes) : null);

  /* ---------- Home ---------- */
  function viewHome() {
    const t = C.todayISO(), refs = refsOn(t), out = [h('div', { class: 'sub', style: 'text-transform:capitalize' }, `${WD_FULL[wdIdx(t)]} ${fmtDate(t)}`), h('h1', {}, 'Home')];
    if (S.live) {
      const lr = findRef(S.live.sid);
      if (lr) out.push(h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('div', { class: 'n' }, 'Session in progress'), h('div', { class: 'sub' }, autoTitle(sessOf(lr))),
        h('div', { class: 'btns' }, btn('Resume', () => startSession(lr), 'pri'), btn('Discard', () => { S.live = null; save(); render(); }))));
      else S.live = null;
    }
    if (rescued) out.push(h('div', { class: 'card' }, h('div', { class: 'sub' }, 'The saved data could not be read, so the app started empty. A copy of the old data was kept: export it and send it to whoever develops the app.'),
      h('div', { class: 'btns' }, btn('Export old data', () => { const k = Object.keys(localStorage).filter(x => x.startsWith(KEY + '.rescue-')).sort().pop(); if (k) exportSheet('Old data', 'allenamento-rescue.json', localStorage.getItem(k)); }, 'sm'),
        btn('Hide', () => { rescued = false; render(); }, 'sm'))));
    if (newVersion) out.push(h('div', { class: 'card row' }, h('div', { class: 'grow sub' }, 'A newer version of the app is available.'), btn('Update', () => location.reload(), 'sm pri')));
    const since = S.settings.lastBackup ? C.diffDays(t, S.settings.lastBackup) : null;
    if (cloudOn() && S.settings.gh.error) out.push(h('div', { class: 'card', style: 'border-color:var(--bad)' }, h('div', { class: 'sub' }, 'Automatic backup failed: ' + S.settings.gh.error + '.'),
      h('div', { class: 'btns' }, btn('Retry', () => cloudBackup(true), 'sm'), btn('Settings', () => go('more'), 'sm'))));
    else if (S.logs.length && (since == null || since >= 7))
      out.push(h('div', { class: 'card row' }, h('div', { class: 'grow sub' }, since == null ? 'Your data has no backup yet.' : `Last backup ${since} days ago.`), btn('Save backup', doBackup, 'sm')));
    refs.forEach(r => out.push(sessionCard(r, false)));
    if (!refs.length) out.push(h('div', { class: 'card' }, h('div', { class: 'big' }, 'Rest day'), h('p', { class: 'sub', style: 'margin-bottom:0' }, 'No session planned today.')));
    out.push(h('div', { class: 'btns' }, btn('Create session', () => newSessionSheet(t), 'pri'), btn('Log session', () => logSheet(null))));
    return out;
  }

  /* ---------- Sessioni extra e calendario ---------- */
  function showDate(iso) { // dopo aver creato o spostato una sessione si apre quel giorno nel calendario, dove si aggiungono gli esercizi
    go('calendar-' + iso);
  }
  function newSessionSheet(dateDefault) {
    const date = h('input', { type: 'date', value: dateDefault }), title = h('input', { placeholder: 'E.g. Board session with friends' });
    const ov = openSheet('Create session', [h('div', { class: 'cols' }, field('Date', date), field('Title (optional)', title)),
      btn('Create session', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Pick a valid date.');
        S.extras.push({ id: C.uid(), date: iso, type: 'wall', period: 'base', title: title.value.trim().slice(0, 80), blocks: [] });
        save(); ov.remove(); showDate(iso);
      }, 'pri block')]);
  }
  function copyToDateSheet(r) {
    const s = sessOf(r), date = h('input', { type: 'date', value: C.todayISO() });
    const ov = openSheet('Copy to a date', [h('p', { class: 'sub' }, `"${autoTitle(s)}" is copied to another date with the same exercises.`), field('Date', date),
      btn('Copy', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Pick a valid date.');
        const copy = { ...C.cloneSession(s), date: iso, title: s.title || '' }; privatize(S, copy); S.extras.push(copy);
        save(); ov.remove(); toast(`Copied to ${wdOf(iso)} ${fmtDate(iso)}.`); render();
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
        'aria-label': `${WD_FULL[wdIdx(iso)]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}, ${refs.length} sessions`, 'aria-pressed': iso === calSel ? 'true' : 'false',
        onclick: () => go('calendar-' + iso) }, d.getDate(), h('span', { class: 'dots' }, dots));
    };
    const refs = refsOn(calSel), logs = S.logs.filter(l => l.date === calSel);
    return [h('h1', {}, 'Calendar'),
      h('div', { class: 'week' }, btn('‹', () => shift(-1), 'sm'), h('div', { class: 't big', style: 'font-size:17px;text-transform:capitalize' }, `${MONTHS_FULL[first.getMonth()]} ${first.getFullYear()}`),
        btn('Today', () => { calMonth = t.slice(0, 7) + '-01'; go('calendar-' + t); }, 'sm'), btn('›', () => shift(1), 'sm')),
      h('div', { class: 'cal' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('div', { class: 'wh' }, x)), cells.map(cell)),
      h('div', { class: 'cal-key sub' }, h('span', {}, h('i', {}), 'planned'), h('span', {}, h('i', { class: 'ok' }), 'done')),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('h2', { class: 'grow', style: 'margin:0;text-transform:capitalize' }, `${WD_FULL[wdIdx(calSel)]} ${fmtDate(calSel)}`),
        btn('Create session', () => newSessionSheet(calSel), 'sm pri')),
      refs.map(r => sessionCard(r, true)),
      refs.length ? null : h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'No session planned.')),
      logs.length ? [h('h2', {}, 'Logged'), h('div', { class: 'sub' }, 'Tap to view or edit.'), logs.map(logCard)] : null];
  }

  /* ---------- Programmi: insiemi di sessioni importati, visibili solo nel calendario ---------- */
  function planSheet(p) {
    const title = h('input', { value: p.title }), start = h('input', { type: 'date', value: C.firstSessionDate(p) });
    const done = () => { save(); ov.remove(); render(); };
    const ov = openSheet('Programme', [field('Name', title), field('First session on', start),
      h('p', { class: 'sub' }, `${p.weeks.length} weeks · until ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))}. Sessions are edited from the calendar.`),
      btn('Save', () => { p.title = title.value.trim().slice(0, 80) || p.title; if (C.validISO(start.value)) p.startDate = C.startForFirst(p, start.value); done(); }, 'pri block'),
      h('div', { class: 'btns' }, btn('Export .yaml', () => exportSheet('Export programme', p.title.replace(/[^\w+-]+/g, '_') + '.yaml', C.exportYaml(p, S.exercises)), 'sm'),
        btn('Delete programme', async () => { if (await confirmDlg(`Delete "${p.title}"? Its sessions disappear from the calendar, logged sessions stay.`, 'Delete')) { S.plans = S.plans.filter(x => x !== p); done(); } }, 'sm danger'))]);
  }

  function fileBtn(label, after) {
    const inp = h('input', { type: 'file', accept: '.yaml,.yml,.json,application/json,application/yaml,text/yaml,text/plain', hidden: '', onchange: async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      try { await importText(await f.text()); if (after) after(); }
      catch (e) { console.warn('[import] failed', e); importErrors(e); }
    } });
    return h('span', {}, inp, btn(label, () => inp.click(), 'sm'));
  }
  /** Errori di un file di programma: tutti, in un foglio, così si correggono in una volta sola. */
  function importErrors(e) {
    const list = e.errors || [e.message];
    openSheet('The programme was not imported', [h('p', { class: 'sub' }, list.length === 1 ? 'Fix this in the file and import it again:' : `Fix these ${list.length} points in the file and import it again:`),
      h('ul', { class: 'errs' }, list.slice(0, 30).map(x => h('li', {}, x))), list.length > 30 ? h('p', { class: 'sub' }, `…and ${list.length - 30} more.`) : null,
      h('div', { class: 'btns' }, btn('Copy the list', async () => { try { await navigator.clipboard.writeText(list.join('\n')); toast('Copied.'); } catch (_) { toast('Copy not available.'); } }, 'sm'))]);
  }
  async function importText(text) {
    // Un backup è JSON con lo stato completo; tutto il resto si legge come programma YAML (anche il JSON lo è).
    let obj = null;
    try { obj = JSON.parse(text); } catch (_) { /* non è JSON: è YAML */ }
    if (obj && C.validState(obj)) {
      if (!await confirmDlg('This is a full backup: replace ALL current data?', 'Replace')) return;
      S = migrate(obj); calSel = calMonth = null; save(); render(); toast('Backup restored.'); log('import', 'backup restored');
      return;
    }
    const r = C.importYaml(text, { surfaces: S.surfaces, testDefs: S.testDefs }); // lancia con tutti gli errori: lo stato non viene toccato
    const title = h('input', { value: r.plan.title }), start = h('input', { type: 'date', value: r.firstSession || C.todayISO() });
    const ov = openSheet('Import programme', [h('p', { class: 'sub' }, `${r.plan.weeks.length} weeks. Choose when it starts: sessions appear in the calendar.`),
      field('Name', title), field('First session on', start),
      h('p', { class: 'sub' }, 'The other sessions keep their order and the days between them.'),
      btn('Import', () => {
        const iso = C.validISO(start.value);
        if (!iso) return toast('Pick a valid date.');
        r.plan.title = title.value.trim().slice(0, 80) || r.plan.title; r.plan.startDate = C.startForFirst(r.plan, iso);
        for (const e of r.exercises) S.exercises[e.id] = e; // già un'istanza per ogni esercizio di ogni sessione
        ensureTests(S);
        S.plans.push(r.plan);
        save(); ov.remove();
        toast(`Imported ${r.plan.title}.`); log('import', 'programme imported', { title: r.plan.title, weeks: r.plan.weeks.length, exercises: r.exercises.length });
        go('calendar-' + C.firstSessionDate(r.plan));
      }, 'pri block')]);
  }


  function sessionSheet(r) {
    const s = sessOf(r), title = h('input', { value: s.title || '', placeholder: 'Session' }), date = r.x ? h('input', { type: 'date', value: r.x.date }) : null;
    const ov = openSheet('Session', [field('Title', title), r.x ? field('Date', date) : null,
      btn('Save', () => {
        const iso = r.x ? C.validISO(date.value) : null, moved = iso && iso !== r.x.date;
        s.title = title.value.trim().slice(0, 80);
        if (iso) r.x.date = iso;
        save(); ov.remove();
        if (moved) showDate(iso); else render();
      }, 'pri block'),
      h('div', { class: 'btns' }, btn('Copy to a date…', () => { ov.remove(); copyToDateSheet(r); }, 'sm'),
        btn('Delete session', async () => {
          if (!await confirmDlg('Delete this session? Its logged entries stay.', 'Delete')) return;
          if (r.x) S.extras = S.extras.filter(e => e !== r.x); else r.p.weeks[r.w][r.d].sessions.splice(r.si, 1);
          save(); ov.remove(); render();
        }, 'sm danger'))]);
  }
  /** Parametri di un esercizio in questa sessione. Valgono solo qui: gli esercizi di base non hanno descrizioni né valori fissi. */
  function blockSheet(r, bi) {
    const s = sessOf(r), b = s.blocks[bi], e = S.exercises[b.exId];
    const close = () => { save(); ov.remove(); render(); };
    if (!e) { const ov0 = openSheet('Exercise removed', btn('Remove from session', () => { s.blocks.splice(bi, 1); save(); ov0.remove(); render(); }, 'danger block')); return; }
    const iv = e.interval || {}, ld = e.load || {};
    const name = h('input', { value: e.name }), min = numInp(b.minutes), note = h('input', { value: b.note || '', placeholder: 'Optional: also shown in the timer' });
    const sfSel = opts(surfOpts().concat([['+new', '＋ Add new…']]), e.surface || '', { onchange: () => sync() }), sfNew = h('input', { placeholder: 'E.g. Spray wall' });
    const sfNewField = field('Name of the new surface', sfNew);
    const mode = opts([['none', 'Duration only'], ['timed', 'Timed (countdown)'], ['reps', 'Reps (tap "Done")']], !e.interval ? 'none' : iv.selfPaced ? 'reps' : 'timed', { onchange: () => sync() });
    const rounds = numInp(iv.rounds || 3), work = numInp(iv.workSeconds || 7), rest = numInp(iv.restSeconds == null ? 180 : iv.restSeconds);
    const reps = numInp(iv.reps), perSet = numInp(iv.roundsPerSet), setRest = numInp(iv.setRestSeconds);
    const sides = h('input', { type: 'checkbox', checked: (iv.cues || []).length > 0 });
    const pairs = pairsPresent();
    const refs = [['', 'None']].concat(S.testDefs.filter(t => t.key !== 'bw' && !inPair(t.key, pairs)).map(t => [t.key, t.name]), pairs.map(k => [k, C.PAIRS[k] + ' (L/R alternating)']));
    const ref = opts(refs, ld.ref || ''), pct = numInp(ld.pct);
    const workF = field('Work (s)', work), repsF = field('Reps', reps);
    const timer = h('div', {}, h('div', { class: 'cols3' }, field('Round', rounds), workF, repsF, field('Rest (s)', rest)),
      h('div', { class: 'cols' }, field('Rounds per set (optional)', perSet), field('Rest between sets (s)', setRest)),
      h('label', { class: 'f' }, 'Sides', h('div', { style: 'margin-top:8px;color:var(--tx)' }, sides, ' Alternate L/R (rounds count both sides: 6 rounds = 3 per side)')));
    // Minuti: con un timer si calcolano dai parametri (sola lettura); a mano solo per "Duration only".
    const minF = field('Minutes', min), durLine = h('p', { class: 'sub' });
    const draft = () => C.normInterval({ rounds: Math.max(1, val(rounds) || 1), workSeconds: mode.value === 'timed' ? val(work) || 0 : 45, restSeconds: val(rest) || 0, selfPaced: mode.value === 'reps',
      reps: mode.value === 'reps' ? val(reps) || 0 : 0, roundsPerSet: val(perSet) || 0, setRestSeconds: val(setRest) || 0, cues: sides.checked ? ['L', 'R'] : [] });
    const showDur = () => { if (mode.value !== 'none') durLine.textContent = `Duration: ${C.intervalMinutes(draft())} min, calculated from the timer` + (mode.value === 'reps' ? ' (about 45 s per round)' : '') + '.'; };
    for (const x of [rounds, work, rest, reps, perSet, setRest]) x.addEventListener('input', showDur);
    sides.addEventListener('change', showDur);
    const sync = () => { minF.hidden = mode.value !== 'none'; durLine.hidden = mode.value === 'none'; showDur(); timer.hidden = mode.value === 'none'; workF.hidden = mode.value !== 'timed'; repsF.hidden = mode.value !== 'reps'; sfNewField.hidden = sfSel.value !== '+new'; };
    const isTest = !!ld.test;
    const ov = openSheet(e.std && C.STD[e.std] ? C.STD[e.std].name : e.name, [h('p', { class: 'sub' }, 'Parameters of this exercise in this session.'),
      field('Name', name), field('Timer', mode), minF, durLine, timer,
      isTest ? null : h('div', { class: 'cols' }, field('Load: reference test', ref), field('% of max', pct)),
      e.slot === 'wall' || e.slot === 'warmup' || e.surface ? [field('Climbing surface', sfSel), sfNewField] : null,
      field('Note', note),
      btn('Save', () => {
        if (!name.value.trim()) return toast('A name is required.');
        let sf = sfSel.value;
        if (sf === '+new') { const nm = sfNew.value.trim().slice(0, 40); if (!nm) return toast('Type the name of the new surface.'); sf = addSurface(nm); }
        e.name = name.value.trim().slice(0, 80); e.surface = sf;
        if (mode.value === 'none' && !(val(min) > 0)) return toast('Type the minutes.');
        e.interval = mode.value === 'none' ? null : draft();
        if (!isTest) { const d = S.testDefs.find(t => t.key === C.refKeys(ref.value)[0]); e.load = ref.value ? { ref: ref.value, mode: d && d.mode === 'hang' ? 'hang' : 'lift', pct: val(pct), test: false } : null; }
        b.minutes = e.interval ? C.intervalMinutes(e.interval) : Math.round(val(min));
        b.note = note.value.trim().slice(0, 200);
        close();
      }, 'pri block'),
      h('div', { class: 'btns' }, btn('Replace…', () => pickExercise(tpl => { s.blocks.splice(bi, 1); addBlock(s, tpl); s.blocks.splice(bi, 0, s.blocks.pop()); close(); }), 'sm'), btn('Remove', () => { s.blocks.splice(bi, 1); close(); }, 'sm danger'))]);
    sync();
  }

  /* ---------- Esercizi: libreria standard + esercizi propri (solo nome e sezione; i parametri si impostano nella sessione) ---------- */
  const secHead = t => h('div', { class: 'sec' }, t);
  const customTpl = c => ({ std: null, custom: c.key, name: c.name, slot: c.slot, location: c.slot === 'wall' || c.slot === 'warmup' ? 'wall' : 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low', equipment: [], interval: null, load: null, surface: '' });
  function customSheet(onDone) {
    const name = h('input', { placeholder: 'E.g. Spray circuit' }), slot = opts(C.SLOTS, 'wall');
    const ov = openSheet('New exercise', [h('p', { class: 'sub' }, 'It joins your library. Sets, times and loads are set each time in the session.'), h('div', { class: 'cols' }, field('Name', name), field('Section', slot)),
      btn('Create exercise', () => {
        const n = name.value.trim().slice(0, 80);
        if (!n) return toast('A name is required.');
        const c = { key: 'c-' + C.uid().slice(0, 8), name: n, slot: slot.value };
        S.custom.push(c); save(); ov.remove();
        if (onDone) onDone(customTpl(c)); else render();
      }, 'pri block')]);
  }
  function pickExercise(cb) {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Search…', oninput: () => fill() });
    let ov;
    const row = (name, sub, tpl) => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => { ov.remove(); cb(tpl()); } }, h('div', { class: 'grow n' }, name), sub ? h('div', { class: 'm' }, sub) : null);
    const fill = () => {
      const t = q.value.trim().toLowerCase(), nodes = [], mine = S.custom.filter(c => !t || c.name.toLowerCase().includes(t));
      if (mine.length) nodes.push(secHead('My exercises'), ...mine.map(c => row(c.name, '', () => customTpl(c))));
      for (const [sec, label] of Object.entries(C.SECTIONS)) {
        const items = C.LIBRARY.filter(x => x.section === sec && (!t || x.name.toLowerCase().includes(t)));
        if (items.length) nodes.push(secHead(label), ...items.map(x => row(x.name, '', () => C.stdVariant(x.key))));
      }
      list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'sub' }, 'No exercise with this name: create it with "+ New".')]));
    };
    ov = openSheet('Choose exercise', [h('div', { class: 'row' }, h('div', { class: 'grow' }, q), btn('+ New', () => { ov.remove(); customSheet(cb); }, 'sm pri')), list]);
    fill();
  }
  function viewLibrary() {
    const list = h('div', {}), q = h('input', { class: 'inp', placeholder: 'Search…', oninput: () => fill() });
    const fill = () => {
      const t = q.value.trim().toLowerCase(), nodes = [], mine = S.custom.filter(c => !t || c.name.toLowerCase().includes(t));
      if (mine.length) nodes.push(secHead('My exercises'), ...mine.map(c => h('div', { class: 'blk' }, h('div', { class: 'grow' }, h('div', { class: 'n' }, c.name), h('div', { class: 'p' }, C.SLOTS[c.slot])),
        btn('Delete', async () => { if (await confirmDlg(`Delete "${c.name}" from the library? Sessions that contain it do not change.`, 'Delete')) { S.custom = S.custom.filter(x => x !== c); save(); render(); } }, 'sm danger'))));
      for (const [sec, label] of Object.entries(C.SECTIONS)) {
        const items = C.LIBRARY.filter(x => x.section === sec && (!t || x.name.toLowerCase().includes(t)));
        if (items.length) nodes.push(secHead(label), ...items.map(x => h('div', { class: 'blk' }, h('div', { class: 'grow n' }, x.name))));
      }
      list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'sub' }, 'No results.')]));
    };
    fill();
    return [h('div', { class: 'row' }, btn('‹ More', () => { location.hash = 'more'; }, 'sm'), btn('+ New', () => customSheet(null), 'sm pri right')),
      h('h1', { style: 'margin-top:10px' }, 'Exercises'), h('div', { class: 'sub' }, 'Base exercises only have a name. Sets, times, reps and loads are parameters you set in each session.'),
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
        h('div', { class: 'cols' }, field('Surface', sf), field('Top grade sent', gr)), h('div', { class: 'cols' }, field('Problems sent', sends), field('Minutes', min))));
    };
    rows.forEach(add);
    return { node: h('div', {}, box, btn('+ Surface', () => add({ minutes: items.length ? null : defaultMinutes() }), 'sm')),
      read: () => items.filter(i => i.sf.value).map(i => ({ name: i.c.name || '', surface: i.sf.value, top: i.gr.value || null,
        sends: val(i.sends) == null ? null : Math.max(0, Math.round(val(i.sends))), minutes: Math.max(0, Math.round(val(i.min) || 0)) })) };
  }
  function logSheet(l) {
    const isNew = !l; l = l || { id: C.uid(), date: C.todayISO(), type: 'wall', title: 'Free session', minutes: 60, rpe: null, feel: null, notes: '', loads: [], climbs: [] };
    const date = h('input', { type: 'date', value: l.date }), title = h('input', { value: l.title }), min = numInp(l.minutes);
    const rpe = numInp(l.rpe), feel = opts(FEEL, l.feel ? String(l.feel) : '');
    const notes = h('textarea', {}); notes.value = l.notes || '';
    const climbs = climbEditor(l.climbs || [], () => val(min));
    const ov = openSheet(isNew ? 'Log session' : 'Edit log entry', [h('div', { class: 'cols' }, field('Date', date), field('Minutes', min)),
      field('Title', title),
      h('div', { class: 'cols' }, field('RPE (1-10)', rpe), field('How you felt', feel)),
      h('h2', {}, 'Climbing'), climbs.node, field('Notes', notes),
      (l.loads || []).length ? h('div', { class: 'sub' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
      btn('Save', () => {
        Object.assign(l, { date: C.validISO(date.value) || l.date, title: title.value.trim() || 'Session', minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe),
          feel: feel.value ? +feel.value : null, notes: notes.value.trim(), climbs: climbs.read() });
        if (isNew) S.logs.push(l);
        save(); ov.remove(); render();
      }, 'pri block'),
      isNew ? null : btn('Delete', async () => { if (await confirmDlg('Delete this log entry?', 'Delete')) { S.logs = S.logs.filter(x => x !== l); save(); ov.remove(); render(); } }, 'danger block')]);
  }
  /* ---------- Analisi ---------- */
  const anHead = cur => [h('h1', {}, 'Analytics'), seg([['analytics', 'Charts'], ['tests', 'Tests and maxes']], cur, k => { location.hash = k; })];
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
    const out = [anHead('analytics'), seg([[4, '4 wk'], [8, '8 wk'], [12, '12 wk'], [0, 'All']], anWeeks, k => { anWeeks = k; render(); }),
      h('div', { class: 'sub' }, `${fmtDate(from)} – ${fmtDate(to)} · current week included`),
      h('div', { class: 'tiles' },
        tile('Sessions', sum.sessions, sum.due ? `${sum.due} planned so far` : ''),
        tile('Time', sum.minutes < 120 ? sum.minutes + ' min' : dec((sum.minutes / 60).toFixed(1)) + ' h', sum.sessions ? `${Math.round(sum.minutes / sum.sessions)} min per session` : ''),
        tile('Average RPE', sum.rpe == null ? '—' : dec(sum.rpe.toFixed(1)), sum.rpeN ? `over ${sum.rpeN} ${sum.rpeN === 1 ? 'session' : 'sessions'}` : 'no RPE logged'),
        tile('Adherence', sum.due ? Math.round(sum.dueDone / sum.due * 100) + '%' : '—', sum.due ? `${sum.dueDone} of ${sum.due} sessions done` : 'nothing planned'))];
    if (!sum.sessions && !wk.some(w => w.plannedMinutes))
      return out.concat(h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'No data in this period. Charts fill in when you complete a session or log one from Home.')));

    // Tempo per categoria: quota di arrampicata in evidenza, poi le sezioni ordinate (colore = gruppo)
    const cat = C.timeBySection(S.logs, from, to), grp = C.weeklyGroups(S.logs, from, to), SEC = { ...C.SECTIONS, strength: 'General strength', mobility: 'Mobility', other: 'Other' };
    if (cat.classified || cat.unclassified) {
      const pct = m => Math.round(m / cat.classified * 100) + '%'; // stessa base della cifra in evidenza: il tempo classificato
      const rows = cat.rows.map(r => ({ label: SEC[r.section], value: r.minutes, text: `${hm(r.minutes)} · ${pct(r.minutes)}`, cls: 'g-' + C.SECTION_GROUP[r.section] }));
      if (cat.unclassified) rows.push({ label: 'Unclassified', value: cat.unclassified, text: hm(cat.unclassified), cls: 'g-none' });
      out.push(chartCard('Time by category', cat.classified ? 'From the minutes logged for each exercise.' : 'Needs sessions done with the timer: only there are minutes logged per exercise.',
        cat.wallShare == null ? null : [h('div', { class: 'hero', style: 'margin-top:4px' }, Math.round(cat.wallShare * 100) + '%', h('small', {}, 'on the wall')), h('div', { class: 'sub', style: 'margin-bottom:10px' }, `${hm(cat.wall)} of ${hm(cat.classified)} classified`)],
        Charts.hbars(rows),
        cat.unclassified ? h('p', { class: 'sub', style: 'margin-bottom:0' }, 'Unclassified: sessions logged by hand, or time not assigned to an exercise. Left out of the percentages.') : null));
    }
    if (wk.some(w => w.minutes || w.plannedMinutes)) out.push(chartCard('Weekly volume', 'Minutes logged by group, compared with the planned ones.',
      Charts.stacked({ labels, longLabels: long, unit: 'min', targets: wk.map(w => w.plannedMinutes), targetName: 'Planned', aria: 'Training minutes per week, split by group',
        series: [['wall', C.GROUPS.wall], ['strength', C.GROUPS.strength], ['other', C.GROUPS.other], ['unclassified', 'Unclassified']].map(([k, name]) => ({ name, cls: k === 'unclassified' ? 'g-none' : 'g-' + k, values: grp.map(w => w[k]) })).filter(x => x.values.some(v => v > 0)) })));
    if (wk.some(w => w.load)) out.push(chartCard('Weekly load', 'Sum of minutes × RPE for sessions with an RPE (arbitrary units).',
      Charts.columns({ labels, longLabels: long, values: wk.map(w => Math.round(w.load)), name: 'Load', aria: 'Training load (sRPE) per week' })));
    if (wk.some(w => w.rpe != null)) out.push(chartCard('Perceived effort', 'Average RPE of the sessions in the week (scale 1–10).',
      Charts.line({ labels, longLabels: long, values: wk.map(w => w.rpe), name: 'Average RPE', domain: { min: 0, max: 10, step: 5 }, height: 120, aria: 'Average RPE per week' })));
    if (wk.some(w => w.feel != null)) out.push(chartCard('Feeling', 'Average of "how you felt" (1 wrecked – 5 great).',
      Charts.line({ labels, longLabels: long, values: wk.map(w => w.feel), name: 'Average feeling', domain: { min: 1, max: 5, step: 2 }, height: 120, aria: 'Average feeling per week' })));

    // Superfici: tempo, blocchi chiusi e grado massimo; poi un pannello per superficie, tutti sulla stessa scala di gradi
    const surf = C.surfaceStats(S.logs, from, to);
    if (surf.length) {
      const table = h('table', { class: 'tbl' }, h('tr', {}, ['Surface', 'Sessions', 'Problems sent', 'Top grade'].map(x => h('th', {}, x))),
        surf.map(x => h('tr', {}, h('td', {}, surfName(x.surface)), h('td', {}, x.sessions), h('td', {}, x.sends), h('td', {}, x.top ? fmtG(x.top) : '—'))));
      out.push(chartCard('Climbing surfaces', 'Minutes spent on each surface in the period.',
        Charts.hbars(surf.map(x => ({ label: surfName(x.surface), value: x.minutes, text: x.minutes + ' min' }))), table));
      const tg = C.weeklyTopGrades(S.logs, from, to);
      const keys = S.surfaces.map(x => x.key).filter(k => tg.series[k]).concat(Object.keys(tg.series).filter(k => !S.surfaces.some(x => x.key === k)));
      if (keys.length) {
        const all = keys.flatMap(k => tg.series[k].filter(v => v != null));
        const lo = Math.max(0, Math.min(...all) - 1), hi = Math.min(C.GRADES.length - 1, Math.max(...all) + 1), step = Math.max(1, Math.ceil((hi - lo) / 4));
        const domain = { min: lo, max: lo + step * Math.ceil((hi - lo) / step), step }, fmt = v => (C.GRADES[Math.round(v)] ? fmtG(C.GRADES[Math.round(v)]) : '');
        out.push(chartCard('Top grade sent by surface', 'The hardest problem sent each week. Panels share the same scale, so they compare at a glance.',
          keys.map(k => [h('div', { class: 'sm-t' }, surfName(k)),
            Charts.line({ labels, longLabels: long, values: tg.series[k], name: 'Top grade', domain, fmt, height: 112, aria: `Top grade sent per week on ${surfName(k)}` })])));
      }
    }

    const loads = C.loadSeries(S.logs, from, to);
    if (loads.length) out.push(chartCard('Loads by exercise', 'One chart per standard exercise and test: two-handed hangs in one series, lifts split by side L/R. Tap a row for detail.',
      loads.map(s => {
        const v = s.points.map(p => p.kg), last = v[v.length - 1];
        return h('div', { class: 'blk', style: 'cursor:pointer;align-items:center', onclick: () => openSheet(s.name, Charts.line({ labels: s.points.map(p => fmtDate(p.date)), values: v, name: 'Load', unit: 'kg', colLabel: 'Date', aria: `Load used for ${s.name}` })) },
          h('div', { class: 'grow' }, h('div', { class: 'n' }, s.name), h('div', { class: 'p' }, `${v.length} ${v.length === 1 ? 'entry' : 'entries'}`)),
          Charts.spark(v), h('div', { class: 'm', style: 'color:var(--tx);font-weight:600;min-width:58px;text-align:right' }, dec(last) + ' kg'));
      })));
    return out;
  }

  const MODES = [['hang', 'Weight added to body weight'], ['lift', 'Load lifted'], ['value', 'Free value (seconds, kg…)']];
  const testUsed = key => Object.values(S.exercises).some(e => e.load && C.refKeys(e.load.ref).includes(key));
  function testDefSheet(def) {
    const isNew = !def; def = def || { key: 'c-' + C.uid().slice(0, 8), name: '', unit: 'kg', mode: 'hang', hands: 2 };
    const name = h('input', { value: def.name, placeholder: 'Half-crimp' }), unit = h('input', { value: def.unit }), mode = opts(MODES, def.mode || 'value');
    const edge = numInp(def.edge), secs = numInp(def.seconds), reps = numInp(def.reps), hands = opts([['2', 'Two hands'], ['1', 'One hand']], String(def.hands || 2));
    const ov = openSheet(isNew ? 'New test' : 'Test parameters', [field('Name', name), h('div', { class: 'cols' }, field('What it measures', mode), field('Unit', unit)),
      h('div', { class: 'cols' }, field('Edge (mm)', edge), field('Duration (seconds)', secs)), h('div', { class: 'cols' }, field('Reps (RM)', reps), field('Hands', hands)),
      h('p', { class: 'sub' }, 'Leave unused parameters empty. Edge, seconds and reps are shown next to the name.'),
      btn(isNew ? 'Create test' : 'Save', () => {
        if (!name.value.trim()) return toast('A name is required.');
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
    ov = openSheet(def.name, [C.testLabel(def) ? h('p', { class: 'sub' }, C.testLabel(def)) : null, h('div', { class: 'cols' }, field('Date', date), field(`Value (${def.unit})`, v)),
      btn('Add result', () => { const n = val(v); if (n == null) return toast('Enter a number.'); S.tests.push({ id: C.uid(), key: def.key, date: C.validISO(date.value) || C.todayISO(), value: n }); again(); }, 'pri block'),
      h('h2', {}, 'History'), hist.length ? hist.map(t => h('div', { class: 'blk' }, h('div', { class: 'grow' }, `${fmtDate(t.date)} ${t.date.slice(0, 4)}`), h('div', { class: 'n' }, dec(t.value) + ' ' + def.unit),
        btn('✕', () => { S.tests = S.tests.filter(x => x !== t); again(); }, 'sm'))) : h('p', { class: 'sub' }, 'No results yet.'),
      h('div', { class: 'btns' }, btn('Edit parameters', () => { ov.remove(); testDefSheet(def); }, 'sm'),
        def.key === 'bw' ? null : btn('Delete test', async () => {
          if (testUsed(def.key)) return toast('It is used by some exercises to compute kg: remove it from them first.');
          if (await confirmDlg(`Delete "${def.name}" and its history?`, 'Delete')) { S.testDefs = S.testDefs.filter(x => x !== def); S.tests = S.tests.filter(t => t.key !== def.key); again(); }
        }, 'sm danger'))]);
  }
  function viewProgress() {
    const missing = C.TEST_TEMPLATES.filter(t => !S.testDefs.some(d => d.key === t.key));
    return [anHead('tests'), h('div', { class: 'sub' }, 'The latest result of each test is the max used to compute kg. A test can also be added to a session: the result lands here when the exercise ends.'),
      S.testDefs.map(def => {
        const hist = S.tests.filter(t => t.key === def.key).sort((a, b) => (a.date < b.date ? -1 : 1)), last = hist[hist.length - 1];
        return h('div', { class: 'card tap row', onclick: () => testSheet(def) },
          h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, def.name), C.testLabel(def) ? h('div', { class: 'sub' }, C.testLabel(def)) : null,
            h('div', { class: 'big' }, last ? dec(last.value) + ' ' + def.unit : '—'),
            h('div', { class: 'sub' }, last ? `${fmtDate(last.date)} · ${hist.length} ${hist.length === 1 ? 'result' : 'results'}` : 'Tap to add a result')),
          Charts.spark(hist.map(t => t.value)));
      }),
      h('h2', {}, 'Add a test'), h('div', { class: 'card' },
        missing.length ? [h('p', { class: 'sub', style: 'margin-top:0' }, 'Start from a template (then change edge, seconds and the rest) or create one from scratch.'),
          h('div', { class: 'btns', style: 'margin-top:0' }, missing.map(t => btn(t.name, () => { S.testDefs.push({ ...t }); save(); render(); }, 'sm')))] : null,
        btn('Custom test', () => testDefSheet(null), 'sm pri block'))];
  }

  /* ---------- Altro ---------- */
  function surfaceSheet(x) {
    const name = h('input', { value: x.name });
    const used = Object.values(S.exercises).some(e => e.surface === x.key) || S.logs.some(l => (l.climbs || []).some(c => c.surface === x.key));
    const ov = openSheet('Surface', [field('Name', name),
      btn('Save', () => { const n = name.value.trim().slice(0, 40); if (!n) return toast('A name is required.'); x.name = n; save(); ov.remove(); render(); }, 'pri block'),
      btn(used ? 'In use: cannot be deleted' : 'Delete', async () => {
        if (used) return toast('It is used by exercises or log entries: you can rename it.');
        if (await confirmDlg(`Delete the surface "${x.name}"?`, 'Delete')) { S.surfaces = S.surfaces.filter(s => s !== x); save(); ov.remove(); render(); }
      }, 'danger block')]);
  }
  /** Backup su file: con il menu di condivisione di iOS finisce in File/iCloud Drive; dove non c'è, download o copia. */
  async function doBackup() {
    if (cloudOn()) return cloudBackup(true);
    const name = `allenamento-backup-${C.todayISO()}.json`, mark = () => { S.settings.lastBackup = C.todayISO(); save(); render(); };
    const text = backupText();
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Allenamento backup' }); mark(); return toast('Backup saved.'); }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // l'utente ha chiuso il menu: nessun backup fatto
      console.warn('[backup] sharing failed, falling back to file', e);
    }
    exportSheet('Backup', name, text); mark();
  }
  function cloudCard() {
    const g = S.settings.gh || {}, repo = h('input', { value: g.repo || '', placeholder: 'user/repository-name', autocapitalize: 'off', autocorrect: 'off' }), token = h('input', { type: 'password', value: g.token || '', placeholder: 'github_pat_…', autocomplete: 'off' });
    return h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Saves your data automatically to a private GitHub repository of yours, a few seconds after each change. It needs a fine-grained token limited to that repository, with Contents: Read and write. The token stays on this device only.'),
      field('Private repository', repo), field('Token', token),
      cloudOn() ? h('p', { class: 'sub' }, g.error ? 'Last attempt failed: ' + g.error + '.' : S.settings.lastBackup ? `Active. Last backup: ${fmtDate(S.settings.lastBackup)}.` : 'Active. No backup yet.') : null,
      h('div', { class: 'btns' }, btn('Save and test', () => {
        const r = repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
        if (!/^[\w.-]+\/[\w.-]+$/.test(r)) return toast('Type the repository as user/name.');
        if (!token.value.trim()) return toast('Paste the token.');
        S.settings.gh = { repo: r, token: token.value.trim(), error: null }; save(); cloudBackup(true);
      }, 'sm pri'),
        cloudOn() ? [btn('Restore from GitHub', cloudRestore, 'sm'), btn('Disconnect', async () => { if (await confirmDlg('Disconnect GitHub? The token is deleted from this device; backups already uploaded stay in the repository.', 'Disconnect')) { S.settings.gh = null; clearTimeout(cloudTimer); save(); render(); } }, 'sm danger')] : null));
  }
  /* ---------- Taccuino: note al volo durante la prova dell'app, con il contesto per poterle riprodurre ---------- */
  const VERSION = '__APP_VERSION__';
  function noteSheet() {
    const text = h('textarea', { class: 'inp', placeholder: 'What is wrong, or what would you like to be different?' });
    const where = P ? 'timer: ' + P.steps[P.idx].name : R ? 'session in progress' : (location.hash.slice(1) || 'home');
    const ov = openSheet('Note a problem', [h('p', { class: 'sub' }, `Saved with screen (${where}), date and version. You find it in More → Notebook.`), text,
      btn('Save note', () => {
        const t = text.value.trim().slice(0, 1000);
        if (!t) return toast('Write something.');
        S.notes.push({ id: C.uid(), at: new Date().toISOString(), text: t, where, version: VERSION });
        save(); ov.remove(); toast('Note saved.'); if (!R && !P) render();
      }, 'pri block')]);
    ov.style.zIndex = 50; // anche sopra il timer
    setTimeout(() => text.focus(), 50);
  }
  const noteLine = n => `[${n.at.slice(0, 16).replace('T', ' ')} · ${n.where} · v${n.version}] ${n.text}`;
  function viewNotes() {
    const notes = [...S.notes].reverse();
    return [h('div', { class: 'row' }, btn('‹ More', () => go('more'), 'sm'), btn('+ Note', noteSheet, 'sm pri right')),
      h('h1', { style: 'margin-top:10px' }, 'Notebook'), h('div', { class: 'sub' }, 'Notes taken while you use the app. Export them to hand them to whoever develops it.'),
      notes.length ? h('div', { class: 'btns' }, btn('Export list', () => exportSheet('Notebook', `allenamento-notes-${C.todayISO()}.txt`, notes.map(noteLine).reverse().join('\n')), 'sm pri'),
        btn('Clear', async () => { if (await confirmDlg(`Delete all ${notes.length} notes?`, 'Clear')) { S.notes = []; save(); render(); } }, 'sm danger')) : null,
      notes.length ? notes.map(n => h('div', { class: 'card' }, h('div', {}, n.text), h('div', { class: 'row', style: 'margin-top:6px' }, h('div', { class: 'grow sub' }, `${n.at.slice(0, 16).replace('T', ' ')} · ${n.where} · v${n.version}`),
        btn('✕', () => { S.notes = S.notes.filter(x => x !== n); save(); render(); }, 'sm'))))
        : h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'No notes. Use "Note" in the bottom bar (or in the session in progress) when something feels off.'))];
  }

  /* ---------- Diagnostica: cosa funziona davvero su questo dispositivo ---------- */
  let diag = null;
  async function runDiag() {
    const out = [], add = (name, ok, detail) => out.push({ name, ok, detail });
    try { localStorage.setItem(KEY + '.t', '1'); const v = localStorage.getItem(KEY + '.t'); localStorage.removeItem(KEY + '.t'); add('Data storage', v === '1', v === '1' ? 'read and write succeeded' : 'the written value cannot be read back'); }
    catch (e) { add('Data storage', false, 'not available: ' + e.message); }
    try {
      if (navigator.storage && navigator.storage.persist) { const p = await navigator.storage.persisted() || await navigator.storage.persist(); add('Data protected from automatic cleanup', p ? true : null, p ? 'the system commits to keeping them' : 'not granted: open the app regularly and keep the backup on'); }
      else add('Data protected from automatic cleanup', null, 'not available in this browser');
    } catch (e) { add('Data protected from automatic cleanup', null, 'request failed'); }
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    add('Installed on the Home Screen', standalone ? true : null, standalone ? 'opened as an app' : 'opened in the browser: add it to the Home Screen');
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null, hit = reg && window.caches ? await caches.match('./') : null;
      add('Offline use', reg && hit ? true : reg ? null : false, reg && hit ? 'a copy of the app is stored on the device' : reg ? 'getting ready: reopen the app once while online' : 'not available in this mode');
    } catch (e) { add('Offline use', false, 'check failed'); }
    try { audioInit(); beep(880, 0.25); add('Sound signals', ac && ac.state === 'running' ? true : null, ac && ac.state === 'running' ? 'a signal was just played: if you did not hear it, check the volume and the silent switch' : 'audio not started: try again by tapping "Run the checks"'); }
    catch (e) { add('Sound signals', false, 'audio not available'); }
    try {
      if (navigator.wakeLock) { const l = await navigator.wakeLock.request('screen'); await l.release(); add('Screen stays on during a session', true, 'granted'); }
      else add('Screen stays on during a session', false, 'not supported: the screen may turn off during the timer');
    } catch (e) { add('Screen stays on during a session', false, 'refused by the system (for example with Low Power Mode on)'); }
    add('Network', navigator.onLine !== false ? true : null, navigator.onLine !== false ? 'online' : 'offline');
    add('Backup', cloudOn() ? !S.settings.gh.error : null, cloudOn() ? (S.settings.gh.error ? 'last attempt failed: ' + S.settings.gh.error : 'automatic to GitHub, active') : S.settings.lastBackup ? 'manual, last on ' + fmtDate(S.settings.lastBackup) : 'no backup yet');
    diag = out; log('diagnostics', 'run', out.map(x => `${x.name}: ${x.ok === true ? 'ok' : x.ok === false ? 'no' : 'warning'}`));
    render();
  }
  function viewDiag() {
    const report = () => [`Allenamento v${VERSION}`, navigator.userAgent, ...(diag || []).map(x => `${x.ok === true ? 'OK ' : x.ok === false ? 'NO ' : '?? '} ${x.name}: ${x.detail}`)].join('\n');
    return [h('div', { class: 'row' }, btn('‹ More', () => go('more'), 'sm')), h('h1', { style: 'margin-top:10px' }, 'Diagnostics'),
      h('div', { class: 'sub' }, 'Checks on this device the things that cannot be tested in the lab. Run it from the app opened from the Home Screen.'),
      h('div', { class: 'btns' }, btn('Run the checks', runDiag, 'pri'), diag ? btn('Copy report', () => exportSheet('Report', 'allenamento-diagnostics.txt', report()), '') : null),
      diag ? h('div', { class: 'card' }, diag.map(x => h('div', { class: 'blk' }, h('span', { class: 'tag ' + (x.ok === true ? 'ok' : x.ok === false ? 'bad' : 'ac') }, x.ok === true ? 'OK' : x.ok === false ? 'No' : 'Warning'),
        h('div', { class: 'grow' }, h('div', { class: 'n' }, x.name), h('div', { class: 'p' }, x.detail))))) : null,
      h('div', { class: 'sub', style: 'margin-top:14px' }, 'Version ' + VERSION)];
  }
  /** Aggiornamenti: confronta la versione in uso con quella pubblicata (solo con rete; in anteprima il file non c'è). */
  let newVersion = null;
  async function checkUpdate(force) {
    if (force !== true && !/^https?:$/.test(location.protocol)) return; // file locale o anteprima: niente da confrontare
    try {
      const r = await fetch('version.json', { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()).version;
      if (v && v !== VERSION && v !== newVersion) { newVersion = v; if (!R && !P) render(); }
    } catch (e) { /* offline o anteprima: nessun controllo */ }
  }

  function viewMore() {
    const pr = S.settings.prog, progOn = h('input', { type: 'checkbox', checked: pr.on }), progStep = numInp(pr.step), progRpe = numInp(pr.rpe);
    const prep = numInp(S.settings.prep), sound = h('input', { type: 'checkbox', checked: S.settings.sound, onchange: () => { S.settings.sound = sound.checked; save(); } });
    const sfNew = h('input', { class: 'inp', style: 'margin:0', placeholder: 'New surface' });
    return [h('h1', {}, 'More'),
      h('div', { class: 'card tap row', onclick: () => { location.hash = 'library'; } }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Exercise library'), h('div', { class: 'sub' }, (C.LIBRARY.length + S.custom.length) + ' exercises')), '›'),
      h('div', { class: 'card tap row', onclick: () => go('notebook') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Notebook'), h('div', { class: 'sub' }, S.notes.length ? `${S.notes.length} notes` : 'Note what is wrong while you use the app')), '›'),
      h('div', { class: 'card tap row', onclick: () => go('diagnostics') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Diagnostics'), h('div', { class: 'sub' }, 'Audio, screen on, offline and storage on this device · v' + VERSION)), '›'),
      h('h2', {}, 'Programmes'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'A programme is a set of sessions: import it, choose when it starts and find it in the calendar.'),
        S.plans.map(p => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => planSheet(p) }, h('div', { class: 'grow' }, h('div', { class: 'n' }, p.title),
          h('div', { class: 'p' }, `${fmtDate(C.firstSessionDate(p))} – ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))} · ${p.weeks.length} weeks`)), h('div', { class: 'm' }, '›'))),
        h('div', { class: 'btns' }, fileBtn('Import programme (.yaml)'))),
      h('h2', {}, 'Climbing surfaces'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Assigned to exercises and log entries, to compare progress in the charts. Tap to rename.'),
        h('div', { class: 'btns', style: 'margin-top:0' }, S.surfaces.map(x => btn(x.name, () => surfaceSheet(x), 'sm'))),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, sfNew), btn('Add', () => { const n = sfNew.value.trim().slice(0, 40); if (!n) return toast('Type a name.'); addSurface(n); save(); render(); }, 'sm')),
        h('p', { class: 'sub', style: 'margin-bottom:0' }, `Grade scale: ${C.GRADE_SCALES[S.settings.gradeScale] || 'Font'}. Other scales will be selectable here.`)),
      h('h2', {}, 'Timer'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Get-ready time before a hang (s)', prep), h('label', { class: 'f' }, 'Sound signals', h('div', { style: 'margin-top:12px' }, sound, ' on'))),
        btn('Save', () => { S.settings.prep = Math.min(60, Math.max(0, Math.round(val(prep) || 0))); save(); toast('Saved.'); }, 'sm')),
      h('h2', {}, 'Load progression'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'When an exercise ends you log load and RPE. Next time the app suggests the load: higher if the RPE was within the threshold, lower if it was well above, the same otherwise.'),
        h('div', { class: 'cols3' }, h('label', { class: 'f' }, 'Suggestions', h('div', { style: 'margin-top:12px' }, progOn, ' on')), field('Increase (%)', progStep), field('RPE threshold', progRpe)),
        btn('Save', () => { Object.assign(S.settings.prog, { on: progOn.checked, step: Math.min(20, Math.max(0.5, val(progStep) || 2.5)), rpe: Math.min(10, Math.max(1, val(progRpe) || 8)) }); save(); toast('Saved.'); render(); }, 'sm')),
      h('h2', {}, 'Automatic backup'), cloudCard(),
      h('h2', {}, 'Data'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, (cloudOn() ? 'Automatic backup to GitHub is active. ' : 'Data stays on this device only. "Save backup" opens the share sheet: choose "Save to Files" to put it in iCloud Drive.') + (S.settings.lastBackup ? ` Last backup: ${fmtDate(S.settings.lastBackup)}.` : ' No backup yet.')),
        h('div', { class: 'btns' }, btn(cloudOn() ? 'Back up now' : 'Save backup', doBackup, 'sm pri'), fileBtn('Restore / import file'),
          btn('Reset everything', async () => { if (await confirmDlg('Delete programmes, sessions, exercises, log entries and tests? This cannot be undone: make a backup first.', 'Reset')) { S = fresh(); calSel = calMonth = null; save(); render(); } }, 'sm danger')))];
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
    log('session', resumed ? 'resumed' : 'started', { title: autoTitle(s), exercises: s.blocks.length });
  }
  function closeRunner() { $('runner').hidden = true; R = null; try { if (wl) wl.release(); } catch (e) { /* già rilasciato */ } wl = null; }
  function drawRunner() {
    const { s, done } = R, nextB = s.blocks.find(b => !done[b.id] && S.exercises[b.exId]);
    const row = (b, i) => {
      const ex = S.exercises[b.exId], d = done[b.id], hint = ex ? loadHint(ex) : '';
      return h('div', { class: 'run-r' + (d ? ' done' : '') }, h('div', { class: 'st' }, d ? '✓' : i + 1),
        h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, ex ? ex.name : 'Exercise removed'), ex ? h('div', { class: 'sub' }, exLine(ex)) : null,
          hint && !d ? h('div', { style: 'color:var(--ac);font-size:13px;font-weight:600' }, hint) : null, ex && !d ? propLine(ex) : null, d && d.minutes ? h('div', { class: 'sub' }, `done · ${d.minutes} min`) : null),
        ex ? btn(d ? 'Redo' : 'Start', () => startBlock(b), 'sm' + (b === nextB ? ' pri' : '')) : null);
    };
    const quit = () => {
      const ov = openSheet('Leave the session?', h('div', { class: 'btns' }, btn('Continue', () => ov.remove()),
        btn('Leave and resume later', () => { ov.remove(); closeRunner(); render(); }), btn('Abandon', () => { ov.remove(); S.live = null; save(); closeRunner(); render(); }, 'danger')), true);
    };
    $('runner').hidden = false;
    $('runner').replaceChildren(h('div', { class: 'in' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'sub' }, 'Session in progress'), h('h1', {}, s.title || 'Session')), btn('Note', noteSheet, 'sm'), btn('Leave', quit, 'sm')),
      h('div', { class: 'card' }, s.blocks.map(row), s.blocks.length ? null : h('p', { class: 'sub', style: 'margin:0' }, 'No exercises: add one to start.')),
      h('div', { class: 'btns' }, btn('+ Exercise', () => pickExercise(tpl => { addBlock(s, tpl); save(); drawRunner(); }), ''), btn('+ Test', () => pickTest(tpl => { addBlock(s, tpl); save(); drawRunner(); }), ''),
        btn('Finish session', finishSession, nextB ? '' : 'pri'))));
  }

  function startBlock(b) {
    const steps = C.buildSteps([b], S.exercises, S.settings.prep);
    if (!steps.length) return toast('Exercise not available.');
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
    $('p-ph').textContent = { prep: 'GET READY', work: st.selfPaced ? 'GO' : 'WORK', rest: 'REST', free: 'IN PROGRESS' }[ph];
    $('p-name').textContent = st.name;
    $('p-round').textContent = st.kind === 'free' ? (ex && ex.surface ? surfName(ex.surface) : '') : `Round ${st.round} of ${st.rounds}`;
    $('p-cue').textContent = [st.cue, P.b.note].filter(Boolean).join(' · ');
    const kg = ex && st.kind !== 'free' ? C.loadKg(ex.load, st.cue, maxes()) : null;
    $('p-kg').textContent = kg == null ? '' : (ex.load.mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
    $('p-next').textContent = nx ? 'Next: ' + (nx.kind === 'rest' ? `rest ${mmss(nx.seconds)}` : (nx.cue || `round ${nx.round}`)) : 'Last step of the exercise';
    $('p-done').textContent = isAuto(st) ? 'Skip' : 'Done';
    $('p-done').className = 'btn ' + (isAuto(st) ? '' : 'pri');
    $('p-plus').disabled = st.kind === 'work';
    $('p-pause').textContent = P.paused ? 'Resume' : 'Pause';
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
    const min = numInp(Math.round(ms / 60000)), note = h('input', { placeholder: 'Optional' });
    const isTest = !!(ex.load && ex.load.test), prop = proposal(ex), planned = loadHint(ex).replace('kg: maxes missing', '');
    // Carico e RPE per ogni esercizio di forza: sono lo storico da cui nasce la proposta della volta dopo.
    const load = !isTest && (ex.load || ex.slot === 'strength') ? h('input', { value: planned || (prop ? prop.text : ''), placeholder: 'e.g. 20 kg or L 18 kg · R 20 kg' }) : null;
    const rpe = load ? numInp(null, { placeholder: '1-10' }) : null;
    const tests = ex.load && ex.load.test ? C.refKeys(ex.load.ref).map(k => S.testDefs.find(t => t.key === k)).filter(Boolean)
      .map(def => ({ def, inp: numInp(null, { placeholder: m[def.key] == null ? '' : 'previous: ' + dec(m[def.key]) }) })) : [];
    const sf = isClimb ? opts(surfOpts(), ex.surface || '') : null, gr = isClimb ? opts(gradeOpts(), '') : null, sends = isClimb ? numInp(null) : null;
    const put = rec => {
      const prev = R.done[b.id], date = C.todayISO();
      if (prev && prev.testIds) S.tests = S.tests.filter(t => !prev.testIds.includes(t.id)); // "Rifai": il nuovo risultato sostituisce il precedente
      rec.testIds = (rec.tests || []).map(t => { const id = C.uid(); S.tests.push({ id, key: t.key, date, value: t.value }); return id; });
      R.done[b.id] = rec; S.live.done = R.done; save(); ov.remove(); drawRunner();
    };
    const ov = openSheet(ex.name, [h('p', { class: 'sub' }, 'Exercise complete: log how it went.'),
      field('Minutes', min),
      tests.length ? [tests.map(x => field(`Result: ${x.def.name} (${x.def.unit})`, x.inp)), h('p', { class: 'sub' }, 'On save, the result immediately updates the max in the Tests section.')] : null,
      load ? h('div', { class: 'cols' }, field('Load used', load), field('Exercise RPE', rpe)) : null,
      load && prop && planned ? h('p', { class: 'sub' }, `Suggested: ${prop.text} (${prop.why}).`) : null,
      isClimb ? [h('div', { class: 'cols' }, field('Surface', sf), field('Top grade sent', gr)), field('Problems sent', sends)] : null,
      field('Note', note),
      btn('Save', () => put({ name: ex.name, minutes: Math.max(0, Math.round(val(min) || 0)), note: note.value.trim().slice(0, 200), load: load ? load.value.trim() : '', sec: exSection(ex),
        key: exKey(ex), label: exLabel(ex), kgs: load ? C.parseLoads(load.value) : [], rpe: rpe ? val(rpe) : null, mode: ex.load ? ex.load.mode : 'lift',
        tests: tests.map(x => ({ key: x.def.key, value: val(x.inp) })).filter(x => x.value != null),
        climb: isClimb && sf.value ? { name: ex.name, surface: sf.value, top: gr.value || null, sends: val(sends) == null ? null : Math.max(0, Math.round(val(sends))), minutes: Math.max(0, Math.round(val(min) || 0)) } : null }), 'pri block'),
      btn('Done, without logging', () => put({ name: ex.name, minutes: Math.round(ms / 60000) }), 'block'),
      btn('Not done: back to the list', () => { ov.remove(); drawRunner(); }, 'block')]);
  }
  function finishSession() {
    const { r, s, done } = R, recs = s.blocks.map(b => done[b.id]).filter(Boolean);
    const min = numInp(Math.max(1, Math.round((Date.now() - R.startedAt) / 60000))), rpe = numInp(null), feel = opts(FEEL, ''), notes = h('textarea', {});
    let ov;
    const end = () => { S.live = null; save(); ov.remove(); closeRunner(); go('calendar-' + C.todayISO()); };
    ov = openSheet('Finish session', [h('p', { class: 'sub' }, `${recs.length} of ${s.blocks.length} exercises done.`),
      h('div', { class: 'cols3' }, field('Total minutes', min), field('RPE (1-10)', rpe), field('Feeling', feel)), field('Notes', notes),
      btn('Save', () => {
        const date = C.todayISO();
        S.logs.push({ id: C.uid(), date, sid: s.id, type: s.type || 'wall', title: autoTitle(s), minutes: Math.max(0, Math.round(val(min) || 0)), rpe: val(rpe), feel: feel.value ? +feel.value : null, notes: notes.value.trim(),
          loads: recs.filter(x => x.load).map(x => ({ name: x.name, kg: x.load })), climbs: recs.map(x => x.climb).filter(Boolean),
          blocks: recs.map(x => ({ name: x.name, minutes: x.minutes || 0, note: x.note || '', key: x.key, label: x.label, sec: x.sec, kgs: x.kgs && x.kgs.length ? x.kgs : undefined, rpe: x.rpe == null ? undefined : x.rpe, mode: x.mode })) });
        log('session', 'logged', { exercises: recs.length });
        end();
      }, 'pri block'), btn('Close without saving', end, 'block')]);
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
  const VIEWS = { home: viewHome, calendar: viewCalendar, analytics: viewAnalytics, tests: viewProgress, more: viewMore, library: viewLibrary, notebook: viewNotes, diagnostics: viewDiag };
  function render() {
    const [name, ...args] = (location.hash.slice(1) || 'home').split('-');
    const fn = VIEWS[name] || viewHome;
    let nodes;
    try { nodes = fn(args); }
    catch (e) { console.error('[ui] error in view ' + name, e); nodes = [h('h1', {}, 'Something went wrong'), h('p', { class: 'sub' }, String(e.message || e)), btn('Back to Home', () => go('home'))]; }
    $('view').replaceChildren(...[nodes].flat(Infinity).filter(n => n != null && n !== false));
    const tab = { library: 'more', notebook: 'more', diagnostics: 'more', tests: 'analytics' }[name] || (VIEWS[name] ? name : 'home');
    for (const el of document.querySelectorAll('#tabs a')) el.classList.toggle('on', el.getAttribute('href') === '#' + tab);
  }
  let lastView = (location.hash.slice(1) || 'home').split('-')[0];
  window.addEventListener('hashchange', () => {
    for (const o of document.querySelectorAll('.overlay')) o.remove();
    const view = (location.hash.slice(1) || 'home').split('-')[0];
    if (view !== lastView || view !== 'calendar') window.scrollTo(0, 0); // nel calendario cambiare giorno non deve riportare in cima
    lastView = view;
    render();
  });
  wirePlayer();
  $('tab-note').addEventListener('click', e => { e.preventDefault(); noteSheet(); });
  render();
  cloudRetry();
  checkUpdate();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  // Chiede al sistema di non cancellare i dati quando lo spazio scarseggia (dove supportato); l'esito si vede in Diagnostica.
  if (S.logs.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.__app = { get state() { return S; }, render, cloudBackup, checkUpdate }; // utile per debug dalla console
})();
