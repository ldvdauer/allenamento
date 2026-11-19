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
  const fresh = () => migrate({ v: 13, plans: [], activePlan: null, exercises: {}, logs: [], tests: [] });
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
    if (fromV < 9) pruneEmpty(s); // v9: niente più sessioni vuote
    // v10: si mostra il nome della libreria; anche le registrazioni passate lo prendono, dalla chiave std|riferimento.
    if (fromV < 10) for (const l of s.logs) {
      const ren = new Map();
      for (const b of l.blocks || []) {
        const k = typeof b.key === 'string' ? b.key.split('|')[0] : '', st = C.STD[k];
        if (st && k !== 'test' && b.name !== st.name) { ren.set(b.name, st.name); b.name = st.name; }
      }
      for (const x of l.loads || []) if (ren.has(x.name)) x.name = ren.get(x.name);
    }
    // v11: categorie per qualità (non più per luogo) e niente riscaldamento.
    if (fromV < 11) {
      const legacy = sec => C.LEGACY_SECTION[sec] || 'conditioning';
      for (const c of s.custom) if (!c.section) { c.section = legacy(c.slot); delete c.slot; }
      const customs = Object.fromEntries(s.custom.map(c => [c.key, c]));
      const gone = new Set(['warmup-general', 'warmup-wall']); // riscaldamento generico: dato per scontato, esce dai programmi
      const drop = list => { for (const x of list) { const n = x.blocks.length; x.blocks = x.blocks.filter(b => { const e = s.exercises[b.exId]; return !(e && gone.has(e.std)); }); if (n !== x.blocks.length && s.live && s.live.sid === x.id) s.live = null; } };
      for (const p of s.plans) for (const w of p.weeks) for (const d of w) drop(d.sessions);
      drop(s.extras);
      for (const e of Object.values(s.exercises)) {
        if (gone.has(e.std)) { e.std = null; e.section = 'other'; } // resta solo se registrato altrove; prune lo toglie se non serve più
        else if (e.std && C.STD[e.std]) { e.slot = C.slotOf(C.STD[e.std].section, e.std); e.location = e.slot === 'wall' ? 'wall' : 'off_wall'; }
        else if (e.std !== 'test' && !e.section) e.section = e.custom && customs[e.custom] ? customs[e.custom].section : legacy(e.slot);
      }
      for (const l of s.logs) for (const b of l.blocks || []) {
        const k = typeof b.key === 'string' ? b.key.split('|')[0] : '';
        b.sec = k === 'test' ? 'fingers' : C.STD[k] ? C.STD[k].section : b.sec ? legacy(b.sec) : b.sec;
      }
      pruneEmpty(s); prune(s); // e gli esercizi rimasti senza giornata
    }
    if (fromV < 12) delete s.live; // v12: niente più sessione in corso: ogni esercizio si avvia dalla giornata
    s.trips = C.cleanTrips(s.trips, C.todayISO()); // v13: viaggi e progetti (sezione a sé); un backup precedente non li ha
    s.v = 13;
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
  /** Il giorno è l'unità di allenamento: senza esercizi è riposo, quindi non resta nessun contenitore vuoto. */
  function pruneEmpty(st) {
    st.extras = st.extras.filter(x => x.blocks.length);
    for (const p of st.plans) for (const w of p.weeks) for (const d of w) d.sessions = d.sessions.filter(x => x.blocks.length);
  }
  function save() {
    pruneEmpty(S);
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
  const cloudRetry = () => { if (cloudOn() && navigator.onLine !== false) { clearTimeout(cloudTimer); cloudTimer = setTimeout(() => cloudBackup(false).then(() => { if (!P) render(); }), 3000); } };
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
  const autoTitle = s => s.title || s.blocks.map(b => S.exercises[b.exId]).filter(e => e && e.slot !== 'warmup').slice(0, 2).map(C.exName).join(' · ') || 'Training';
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
  /** Aggiunge un esercizio alla giornata `iso`: a quella in programma se c'è, altrimenti la crea. */
  function addToDay(iso, tpl) {
    const r = refsOn(iso)[0];
    if (r) addBlock(sessOf(r), tpl);
    else { const x = { id: C.uid(), date: iso, type: 'wall', period: 'base', title: '', blocks: [] }; addBlock(x, tpl); S.extras.push(x); }
    save(); render();
  }
  /** Porta degli esercizi in una giornata: si aggiungono in fondo a quella che c'è già, altrimenti diventano una giornata nuova. */
  function mergeIntoDay(iso, blocks, title) {
    const r = refsOn(iso)[0];
    if (r) { const t = sessOf(r); t.blocks.push(...blocks); if (!t.title && title) t.title = title; }
    else S.extras.push({ id: C.uid(), date: iso, type: 'wall', period: 'base', title: title || '', blocks });
  }
  const dayOf = r => (r.x ? r.x.date : C.dateOf(r.p, r.w, r.d));
  function restCard(iso, edit) {
    return h('div', { class: 'card' }, h('div', { class: 'big' }, 'Rest day'), h('p', { class: 'sub' }, 'Nothing planned. Add an exercise to train on this day.'),
      h('div', { class: 'btns' }, btn('+ Exercise', () => pickExercise(tpl => addToDay(iso, tpl)), 'sm' + (edit ? '' : ' pri')), btn('+ Test', () => pickTest(tpl => addToDay(iso, tpl)), 'sm')));
  }
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
  // Chiave della serie dei carichi: esercizio, riferimento e presa (Max hang 20 mm half crimp ≠ Max hang 20 mm open hand)
  const exKey = e => (e.std || e.name) + '|' + (e.load ? e.load.ref : '') + (e.grip ? '|' + [e.grip.type || '', e.grip.edge || '', e.grip.hands || ''].join('/') : '');
  function exLabel(e) {
    const base = e.std && C.STD[e.std] ? C.STD[e.std].name : e.name, d = e.load && !C.PAIRS[e.load.ref] ? S.testDefs.find(t => t.key === e.load.ref) : null;
    return [d ? `${base} · ${d.name}` : base, C.gripText(e)].filter(Boolean).join(' · ');
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
  // Il titolo è sempre il nome della libreria (C.exName): la riga sotto ha solo parametri e superficie.
  const exLine = e => [C.gripText(e), C.describe(e), e.surface ? surfName(e.surface) : ''].filter(Boolean).join(' · ');
  function blockRow(b, onclick, drag, run, extra) {
    const ex = S.exercises[b.exId];
    const grip = drag ? h('span', { class: 'grip', 'data-grip': '', role: 'img', 'aria-label': 'Drag to reorder', onclick: e => e.stopPropagation() }, '≡') : null;
    if (!ex) return h('div', { class: 'blk', 'data-id': b.id }, grip, h('span', { class: 'p' }, 'Exercise removed'));
    const hint = loadHint(ex);
    return h('div', { class: 'blk', 'data-id': b.id, onclick, style: onclick ? 'cursor:pointer' : null }, grip,
      h('div', { class: 'grow' }, h('div', { class: 'n' }, catBar(exSection(ex)), C.exName(ex)), exLine(ex) ? h('div', { class: 'p' }, exLine(ex)) : null, hint ? h('div', { class: 'kg' }, hint) : null, propLine(ex), b.note ? h('div', { class: 'p note' }, b.note) : null, extra || null),
      h('div', { class: 'm' }, b.minutes + ' min', run ? run(b) : null));
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
  /** Registrazione di oggi per questa giornata (una sola). Con `create` la crea vuota se manca. */
  function dayLog(r, create) {
    const s = sessOf(r), date = dayOf(r);
    let l = S.logs.find(x => x.sid === s.id && x.date === date);
    if (!l && create) { l = { id: C.uid(), date, sid: s.id, type: s.type || 'wall', title: autoTitle(s), minutes: 0, rpe: null, feel: null, notes: '', loads: [], climbs: [], blocks: [] }; S.logs.push(l); }
    return l;
  }
  /** La giornata: ogni esercizio si fa partire dal suo ▶ (solo oggi). Ordine ed esercizi si cambiano sempre, anche a metà. */
  function sessionCard(r, edit) {
    const s = sessOf(r), today = dayOf(r) === C.todayISO(), l = dayOf(r) <= C.todayISO() ? dayLog(r, false) : null, done = isDone(r);
    const doneIds = new Set(l ? l.blocks.map(x => x.bid).filter(Boolean) : []);
    const run = today ? b => (S.exercises[b.exId] ? h('button', { class: 'play' + (doneIds.has(b.id) ? ' done' : ''), 'aria-label': (doneIds.has(b.id) ? 'Redo ' : 'Start ') + C.exName(S.exercises[b.exId]),
      onclick: e => { e.stopPropagation(); startBlock(r, b); } }, doneIds.has(b.id) ? '✓' : '▶') : null) : null;
    // Quello che è stato registrato sta sotto il suo esercizio; gli esercizi registrati e poi tolti dalla giornata restano in fondo
    const logged = new Map(l ? l.blocks.filter(x => x.bid).map(x => [x.bid, x]) : []), ids = new Set(s.blocks.map(b => b.id));
    const list = h('div', {}, s.blocks.map((b, bi) => blockRow(b, edit ? () => blockSheet(r, bi) : null, edit, run, logged.has(b.id) ? loggedLine(logged.get(b.id)) : null)));
    const gone = l ? l.blocks.filter(x => !x.bid || !ids.has(x.bid)) : [];
    if (edit) enableDrag(list, s);
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow big', style: 'font-size:17px' }, s.title || 'Training'),
        done ? h('span', { class: 'tag ok' }, today && doneIds.size < s.blocks.length ? `${doneIds.size} of ${s.blocks.length} done` : 'Done') : null, h('span', { class: 'tag' }, C.sessionMinutes(s) + ' min')),
      list,
      gone.length ? h('div', { class: 'logged-x' }, gone.map(x => h('div', {}, h('b', {}, x.name), loggedLine(x)))) : null,
      l ? dayLine(l) : null,
      h('div', { class: 'btns' },
        edit ? [btn('+ Exercise', () => pickExercise(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'), btn('+ Test', () => pickTest(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'),
          btn('Day…', () => daySheet(r), 'sm')] : null,
        l ? btn('Rate the day', () => logSheet(l), 'sm') : null));
  }
  /** Riga di ciò che è stato registrato per un esercizio: carico, RPE, serie, arrampicata, risultati dei test, nota. */
  function loggedLine(x) {
    const res = (x.testIds || []).map(id => S.tests.find(t => t.id === id)).filter(Boolean).map(t => { const d = S.testDefs.find(k => k.key === t.key); return `${d ? d.name : t.key} ${dec(t.value)}`; });
    const parts = [x.load, x.rpe ? 'RPE ' + dec(x.rpe) : '', x.sets ? `${x.sets.done}/${x.sets.of} sets` : '', x.repsMissed ? `${x.repsMissed} reps missed` : '',
      x.climb ? climbText(x.climb) : '', ...res].filter(Boolean);
    const short = (x.sets && x.sets.done < x.sets.of) || x.repsMissed;
    if (!parts.length && !x.note) return null;
    return h('div', { class: 'logged' + (short ? ' short' : '') }, parts.length ? h('div', {}, '✓ ' + parts.join(' · ')) : null, x.note ? h('div', { class: 'p' }, x.note) : null);
  }
  /** RPE, sensazione e note della giornata, se dati. */
  function dayLine(l) {
    const p = [l.rpe ? 'RPE ' + dec(l.rpe) : '', l.feel ? `feeling ${l.feel}/5` : ''].filter(Boolean);
    if (!p.length && !l.notes) return null;
    return h('div', { class: 'logged-day' }, p.length ? h('div', {}, 'Day: ' + p.join(' · ')) : null, l.notes ? h('div', { class: 'p' }, l.notes) : null);
  }
  const climbText = c => surfName(c.surface) + (c.top ? ' ' + fmtG(c.top) : '') + (c.sends != null ? ` · ${c.sends} ${c.sends === 1 ? 'send' : 'sends'}` : '');
  const logCard = l => h('div', { class: 'card tap', onclick: () => logSheet(l) },
    h('div', { class: 'row' }, h('div', { class: 'grow n', style: 'font-weight:600' }, l.title), h('span', { class: 'tag' }, (l.minutes || 0) + ' min')),
    h('div', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)}${l.rpe ? ' · RPE ' + dec(l.rpe) : ''}${l.feel ? ' · feeling ' + l.feel + '/5' : ''}`),
    (l.climbs || []).length ? h('div', { class: 'sub', style: 'color:var(--tx)' }, l.climbs.map(climbText).join('  |  ')) : null,
    (l.loads || []).length ? h('div', { class: 'p', style: 'color:var(--ac);font-size:13px' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
    (l.blocks || []).some(b => (b.sets && b.sets.done < b.sets.of) || b.repsMissed) ? h('div', { class: 'sub', style: 'color:var(--warn)' }, l.blocks.filter(b => (b.sets && b.sets.done < b.sets.of) || b.repsMissed)
      .map(b => [b.name + ':', b.sets && b.sets.done < b.sets.of ? `${b.sets.done}/${b.sets.of} sets` : '', b.repsMissed ? `${b.repsMissed} reps missed` : ''].filter(Boolean).join(' ')).join(' · ')) : null,
    (l.blocks || []).some(b => b.note) ? h('div', { class: 'sub' }, l.blocks.filter(b => b.note).map(b => `${b.name}: ${b.note}`).join(' · ')) : null,
    l.notes ? h('div', { class: 'sub', style: 'margin-top:4px;color:var(--tx)' }, l.notes) : null);

  /* ---------- Home ---------- */
  function viewHome() {
    const t = C.todayISO(), refs = refsOn(t), out = [h('div', { class: 'sub', style: 'text-transform:capitalize' }, `${WD_FULL[wdIdx(t)]} ${fmtDate(t)}`), h('h1', {}, 'Home')];
    if (rescued) out.push(h('div', { class: 'card' }, h('div', { class: 'sub' }, 'The saved data could not be read, so the app started empty. A copy of the old data was kept: export it and send it to whoever develops the app.'),
      h('div', { class: 'btns' }, btn('Export old data', () => { const k = Object.keys(localStorage).filter(x => x.startsWith(KEY + '.rescue-')).sort().pop(); if (k) exportSheet('Old data', 'allenamento-rescue.json', localStorage.getItem(k)); }, 'sm'),
        btn('Hide', () => { rescued = false; render(); }, 'sm'))));
    if (newVersion) out.push(h('div', { class: 'card row' }, h('div', { class: 'grow sub' }, 'A newer version of the app is available.'), btn('Update', () => location.reload(), 'sm pri')));
    const since = S.settings.lastBackup ? C.diffDays(t, S.settings.lastBackup) : null;
    if (cloudOn() && S.settings.gh.error) out.push(h('div', { class: 'card', style: 'border-color:var(--bad)' }, h('div', { class: 'sub' }, 'Automatic backup failed: ' + S.settings.gh.error + '.'),
      h('div', { class: 'btns' }, btn('Retry', () => cloudBackup(true), 'sm'), btn('Settings', () => go('more'), 'sm'))));
    else if (S.logs.length && (since == null || since >= 7))
      out.push(h('div', { class: 'card row' }, h('div', { class: 'grow sub' }, since == null ? 'Your data has no backup yet.' : `Last backup ${since} days ago.`), btn('Save backup', doBackup, 'sm')));
    refs.forEach(r => out.push(sessionCard(r, true)));
    if (!refs.length) out.push(restCard(t, false));
    const next = C.nextTrip(S.trips, t);
    if (next) out.push(countdownCard(next, t)); // uno solo, il più vicino; dopo la giornata di oggi, che resta il contenuto principale
    return out;
  }

  /** Countdown del prossimo viaggio (confermato o possibile, pallino verde o giallo): anello che si riempie verso la partenza, come la ciambella di Analytics. */
  function countdownCard(trip, today) {
    const cd = C.tripCountdown(trip, today), pr = C.tripProgress(trip);
    const NS = 'http://www.w3.org/2000/svg', R = 34, L = 2 * Math.PI * R;
    const el = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = el('svg', { viewBox: '0 0 80 80', class: 'cd-ring', 'aria-hidden': 'true' });
    svg.append(el('circle', { cx: 40, cy: 40, r: R, class: 'cd-track' }),
      el('circle', { cx: 40, cy: 40, r: R, class: 'cd-arc', transform: 'rotate(-90 40 40)', 'stroke-dasharray': L.toFixed(1), 'stroke-dashoffset': (L * (1 - cd.fill)).toFixed(1), style: `--cd-len:${L.toFixed(1)}` }));
    const big = cd.now ? 'Day ' + cd.day : (cd.approx ? '~' : '') + cd.days, small = cd.now ? `of ${cd.length}` : cd.days === 1 ? 'day' : 'days';
    const label = `${TRIP_ST[trip.status]} trip ` + (cd.now ? `${trip.name}: day ${cd.day} of ${cd.length}` : `${trip.name}: ${cd.approx ? 'about ' : ''}${cd.days} days to go`);
    return h('div', { class: 'card tap cd', role: 'link', 'aria-label': label, onclick: () => go('trip-' + trip.id) },
      h('div', { class: 'cd-dial' }, svg, h('div', { class: 'cd-c' + (cd.now ? ' now' : '') }, h('b', {}, big), h('span', {}, small))),
      h('div', { class: 'grow' }, h('div', { class: 'cd-k' }, h('i', { class: 'cd-dot ' + trip.status, 'aria-hidden': 'true' }), (cd.now ? 'On trip' : 'Next trip') + ' · ' + TRIP_ST[trip.status]), h('div', { class: 'cd-n' }, trip.name),
        h('div', { class: 'sub' }, [trip.place, fmtTrip(trip)].filter(Boolean).join(' · ')),
        pr.total ? h('div', { class: 'cd-p' }, `${pr.sent}/${pr.total} sent`) : null), h('div', { class: 'm' }, '›'));
  }

  /* ---------- Sessioni extra e calendario ---------- */
  function copyToDateSheet(r) {
    const s = sessOf(r), date = h('input', { type: 'date', value: C.todayISO() });
    const ov = openSheet('Copy to a date', [h('p', { class: 'sub' }, `The exercises of "${autoTitle(s)}" are copied to another day. If that day already has exercises, they are added after them.`), field('Date', date),
      btn('Copy', () => {
        const iso = C.validISO(date.value);
        if (!iso) return toast('Pick a valid date.');
        const copy = C.cloneSession(s); privatize(S, copy); mergeIntoDay(iso, copy.blocks, s.title || '');
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
        'aria-label': `${WD_FULL[wdIdx(iso)]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}${refs.length ? ', training' : ''}`, 'aria-pressed': iso === calSel ? 'true' : 'false',
        onclick: () => go('calendar-' + iso) }, d.getDate(), h('span', { class: 'dots' }, dots));
    };
    // Le registrazioni si vedono già nella giornata sopra (✓ e "Rate the day"): qui solo quelle senza giornata, es. di un programma eliminato
    const refs = refsOn(calSel), shown = new Set(refs.map(r => sessOf(r).id)), logs = S.logs.filter(l => l.date === calSel && !shown.has(l.sid));
    return [h('h1', {}, 'Calendar'),
      h('div', { class: 'week' }, btn('‹', () => shift(-1), 'sm'), h('div', { class: 't big', style: 'font-size:17px;text-transform:capitalize' }, `${MONTHS_FULL[first.getMonth()]} ${first.getFullYear()}`),
        btn('Today', () => { calMonth = t.slice(0, 7) + '-01'; go('calendar-' + t); }, 'sm'), btn('›', () => shift(1), 'sm')),
      h('div', { class: 'cal' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('div', { class: 'wh' }, x)), cells.map(cell)),
      h('div', { class: 'cal-key sub' }, h('span', {}, h('i', {}), 'planned'), h('span', {}, h('i', { class: 'ok' }), 'done')),
      h('h2', { style: 'margin-top:18px;text-transform:capitalize' }, `${WD_FULL[wdIdx(calSel)]} ${fmtDate(calSel)}`),
      refs.length ? refs.map(r => sessionCard(r, true)) : restCard(calSel, true),
      logs.length ? [h('h2', {}, 'Without a planned day'), h('div', { class: 'sub' }, 'Logged on this day, but its day is no longer in the calendar. Tap to rate it or delete it.'), logs.map(logCard)] : null];
  }

  /* ---------- Programmi: insiemi di sessioni importati, visibili solo nel calendario ---------- */
  function planSheet(p) {
    const title = h('input', { value: p.title }), start = h('input', { type: 'date', value: C.firstSessionDate(p) });
    const done = () => { save(); ov.remove(); render(); };
    const ov = openSheet('Programme', [field('Name', title), field('First training day on', start),
      h('p', { class: 'sub' }, `${p.weeks.length} weeks · until ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))}. Days are edited from the calendar.`),
      btn('Save', () => { p.title = title.value.trim().slice(0, 80) || p.title; if (C.validISO(start.value)) p.startDate = C.startForFirst(p, start.value); done(); }, 'pri block'),
      h('div', { class: 'btns' }, btn('Export .yaml', () => exportSheet('Export programme', p.title.replace(/[^\w+-]+/g, '_') + '.yaml', C.exportYaml(p, S.exercises)), 'sm'),
        btn('Delete programme', async () => { if (await confirmDlg(`Delete "${p.title}"? Its days disappear from the calendar, logged exercises stay.`, 'Delete')) { S.plans = S.plans.filter(x => x !== p); done(); } }, 'sm danger'))]);
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
    const ov = openSheet('Import programme', [h('p', { class: 'sub' }, `${r.plan.weeks.length} weeks. Choose when it starts: its days appear in the calendar.`),
      field('Name', title), field('First training day on', start),
      h('p', { class: 'sub' }, 'The other days keep their order and the gaps between them.'),
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


  /** Titolo, spostamento (solo giornate create a mano), copia e svuotamento di una giornata. */
  function daySheet(r) {
    const s = sessOf(r), title = h('input', { value: s.title || '', placeholder: 'Optional' }), date = r.x ? h('input', { type: 'date', value: r.x.date }) : null;
    const ov = openSheet('Day', [field('Title', title), r.x ? field('Move to', date) : null,
      r.x ? h('p', { class: 'sub' }, 'If the new day already has exercises, these are added after them.') : null,
      btn('Save', () => {
        const iso = r.x ? C.validISO(date.value) : null, moved = iso && iso !== r.x.date;
        s.title = title.value.trim().slice(0, 80);
        if (moved) { S.extras = S.extras.filter(e => e !== r.x); mergeIntoDay(iso, r.x.blocks, s.title); }
        save(); ov.remove();
        if (moved) go('calendar-' + iso); else render();
      }, 'pri block'),
      h('div', { class: 'btns' }, btn('Copy to a date…', () => { ov.remove(); copyToDateSheet(r); }, 'sm'),
        btn('Clear the day', async () => {
          if (!await confirmDlg('Remove all exercises from this day? Logged exercises stay.', 'Remove')) return;
          s.blocks = []; save(); ov.remove(); render();
        }, 'sm danger'))]);
  }
  /** Parametri di un esercizio in questa sessione. Valgono solo qui: gli esercizi di base non hanno descrizioni né valori fissi. */
  function blockSheet(r, bi) {
    const s = sessOf(r), b = s.blocks[bi], e = S.exercises[b.exId];
    const close = () => { save(); ov.remove(); render(); };
    if (!e) { const ov0 = openSheet('Exercise removed', btn('Remove from the day', () => { s.blocks.splice(bi, 1); save(); ov0.remove(); render(); }, 'danger block')); return; }
    const iv = e.interval || {}, ld = e.load || {}, isStd = !!(e.std && e.std !== 'test' && C.STD[e.std]);
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
    const isFingers = exSection(e) === 'fingers', gp = e.grip || {};
    const grip = opts([['', '—']].concat(Object.entries(C.GRIPS)), gp.type || ''), edge = numInp(gp.edge, { placeholder: 'mm' }), hands = opts([['', '—'], ['2', 'Two'], ['1', 'One']], gp.hands ? String(gp.hands) : '');
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
    const ov = openSheet(C.exName(e), [h('p', { class: 'sub' }, isStd ? 'Parameters of this exercise on this day. To change exercise use Replace.' : 'Parameters of this exercise on this day.'),
      isStd ? null : field('Name', name),
      isFingers ? h('div', { class: 'cols3' }, field('Grip', grip), field('Edge (mm)', edge), field('Hands', hands)) : null,
      field('Timer', mode), minF, durLine, timer,
      isTest ? null : h('div', { class: 'cols' }, field('Load: reference test', ref), field('% of max', pct)),
      e.slot === 'wall' || e.slot === 'warmup' || e.surface ? [field('Climbing surface', sfSel), sfNewField] : null,
      field('Note', note),
      btn('Save', () => {
        if (!isStd && !name.value.trim()) return toast('A name is required.');
        let sf = sfSel.value;
        if (sf === '+new') { const nm = sfNew.value.trim().slice(0, 40); if (!nm) return toast('Type the name of the new surface.'); sf = addSurface(nm); }
        if (!isStd) e.name = name.value.trim().slice(0, 80); // uno standard ha il nome della libreria
        e.surface = sf;
        if (mode.value === 'none' && !(val(min) > 0)) return toast('Type the minutes.');
        e.interval = mode.value === 'none' ? null : draft();
        if (isFingers) { const g = { type: grip.value || undefined, edge: val(edge) > 0 ? val(edge) : undefined, hands: hands.value ? +hands.value : undefined }; e.grip = Object.values(g).some(v => v != null) ? JSON.parse(JSON.stringify(g)) : undefined; }
        if (!isTest) { const d = S.testDefs.find(t => t.key === C.refKeys(ref.value)[0]); e.load = ref.value ? { ref: ref.value, mode: d && d.mode === 'hang' ? 'hang' : 'lift', pct: val(pct), test: false } : null; }
        b.minutes = e.interval ? C.intervalMinutes(e.interval) : Math.round(val(min));
        b.note = note.value.trim().slice(0, 200);
        close();
      }, 'pri block'),
      dayOf(r) <= C.todayISO() ? btn('Log without timer', () => { ov.remove(); recordSheet(r, b, (b.minutes || 0) * 60000, e.interval && e.interval.rounds ? { done: e.interval.rounds, of: e.interval.rounds } : null); }, 'block') : null,
      h('div', { class: 'btns' }, btn('Replace…', () => pickExercise(tpl => { s.blocks.splice(bi, 1); addBlock(s, tpl); s.blocks.splice(bi, 0, s.blocks.pop()); close(); }), 'sm'), btn('Remove', () => { s.blocks.splice(bi, 1); close(); }, 'sm danger'))]);
    sync();
  }

  /* ---------- Esercizi: libreria standard + esercizi propri (solo nome e sezione; i parametri si impostano nella sessione) ---------- */
  /** Barretta colorata della categoria. Il colore aiuta a leggere la giornata; il nome della categoria è nell'etichetta accessibile e nella libreria. */
  const catBar = sec => h('i', { class: 'cb c-' + (C.SECTIONS[sec] ? sec : 'other'), title: C.SECTIONS[sec] || 'Other', 'aria-label': 'Category: ' + (C.SECTIONS[sec] || 'Other') });
  const secHead = (t, sec) => h('div', { class: 'sec' }, sec ? catBar(sec) : null, t);
  const customTpl = c => { const sec = c.section || 'other', slot = C.slotOf(sec); return { std: null, custom: c.key, name: c.name, section: sec, slot, location: slot === 'wall' ? 'wall' : 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low', equipment: [], interval: null, load: null, surface: '' }; };
  function customSheet(onDone) {
    const name = h('input', { placeholder: 'E.g. Spray circuit' }), cat = opts(C.SECTIONS, 'strength');
    const ov = openSheet('New exercise', [h('p', { class: 'sub' }, 'It joins your library. Sets, times and loads are set each time on the day.'), field('Name', name), field('Category', cat),
      btn('Create exercise', () => {
        const n = name.value.trim().slice(0, 80);
        if (!n) return toast('A name is required.');
        const c = { key: 'c-' + C.uid().slice(0, 8), name: n, section: cat.value };
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
      if (mine.length) nodes.push(secHead('My exercises'), ...mine.map(c => row(h('span', {}, catBar(c.section), c.name), '', () => customTpl(c))));
      for (const [sec, label] of Object.entries(C.SECTIONS)) {
        const items = C.LIBRARY.filter(x => x.section === sec && (!t || x.name.toLowerCase().includes(t)));
        if (items.length) nodes.push(secHead(label, sec), ...items.map(x => row(x.name, '', () => C.stdVariant(x.key))));
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
      if (mine.length) nodes.push(secHead('My exercises'), ...mine.map(c => h('div', { class: 'blk' }, h('div', { class: 'grow' }, h('div', { class: 'n' }, catBar(c.section), c.name), h('div', { class: 'p' }, C.SECTIONS[c.section] || 'Other')),
        btn('Delete', async () => { if (await confirmDlg(`Delete "${c.name}" from the library? Days that contain it do not change.`, 'Delete')) { S.custom = S.custom.filter(x => x !== c); save(); render(); } }, 'sm danger'))));
      for (const [sec, label] of Object.entries(C.SECTIONS)) {
        const items = C.LIBRARY.filter(x => x.section === sec && (!t || x.name.toLowerCase().includes(t)));
        if (items.length) nodes.push(secHead(label, sec), ...items.map(x => h('div', { class: 'blk' }, h('div', { class: 'grow n' }, x.name))));
      }
      list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'sub' }, 'No results.')]));
    };
    fill();
    return [h('div', { class: 'row' }, btn('‹ More', () => { location.hash = 'more'; }, 'sm'), btn('+ New', () => customSheet(null), 'sm pri right')),
      h('h1', { style: 'margin-top:10px' }, 'Exercises'), h('div', { class: 'sub' }, 'Base exercises only have a name. Sets, times, reps and loads are parameters you set on each day.'),
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
  /** Valutazione di una giornata registrata: RPE, sensazione e note. Gli esercizi si registrano uno per uno. */
  function logSheet(l) {
    const legacy = !(l.blocks || []).length; // registrazioni delle versioni precedenti, fatte a mano: minuti e arrampicata modificabili
    const min = numInp(l.minutes), rpe = numInp(l.rpe), feel = opts(FEEL, l.feel ? String(l.feel) : '');
    const notes = h('textarea', {}); notes.value = l.notes || '';
    const climbs = legacy ? climbEditor(l.climbs || [], () => val(min)) : null;
    const ov = openSheet('Rate the day', [h('p', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)} · ${(l.blocks || []).length} exercises logged · ${l.minutes || 0} min`),
      legacy ? field('Minutes', min) : null,
      h('div', { class: 'cols' }, field('RPE of the day (1-10)', rpe), field('How you felt', feel)),
      legacy ? [h('h2', {}, 'Climbing'), climbs.node] : null, field('Notes', notes),
      btn('Save', () => {
        Object.assign(l, { rpe: val(rpe), feel: feel.value ? +feel.value : null, notes: notes.value.trim() });
        if (legacy) Object.assign(l, { minutes: Math.max(0, Math.round(val(min) || 0)), climbs: climbs.read() });
        save(); ov.remove(); render();
      }, 'pri block'),
      btn('Delete what was logged this day', async () => { if (await confirmDlg('Delete the exercises logged on this day, with RPE and notes? Test results stay.', 'Delete')) { S.logs = S.logs.filter(x => x !== l); save(); ov.remove(); render(); } }, 'danger block')]);
  }
  /* ---------- Analisi ---------- */
  const anHead = cur => [h('h1', {}, 'Analytics'), seg([['analytics', 'Charts'], ['tests', 'Tests and maxes']], cur, k => { location.hash = k; })];
  const chartCard = (title, sub, ...nodes) => h('div', { class: 'card' }, h('div', { class: 'ct' }, title), sub ? h('div', { class: 'sub' }, sub) : null, nodes);
  /** Sezione della libreria a cui appartiene un esercizio (per il tempo per categoria). */
  /** Categoria di un esercizio: quella della libreria per gli standard e i test (dita), altrimenti quella scelta. */
  const exSection = e => (!e ? 'other' : e.std === 'test' ? 'fingers' : e.std && C.STD[e.std] ? C.STD[e.std].section : C.SECTIONS[e.section] ? e.section : 'other');
  const hm = m => (m < 120 ? m + ' min' : dec(Math.round(m / 6) / 10) + ' h');
  const tile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), h('div', { class: 's' }, sub || ' '));
  // Periodo e metrica della pagina Analytics (ispirata a Lattice): restano per la durata della sessione dell'app
  let anDays = 30, anMetric = 'time';
  const PERIODS = [[7, 'Past week'], [30, 'Past month'], [90, 'Past 3 months'], [365, 'Past year']];
  const hours = m => (m < 120 ? [String(Math.round(m)), 'min'] : [dec(Math.round(m / 6) / 10), 'hours']);
  const shortH = m => (m < 60 ? Math.round(m) + 'm' : dec(Math.round(m / 6) / 10) + 'h');
  const deltaTag = (d, fmt) => (d == null ? null : h('div', { class: 'd ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'same') }, d === 0 ? 'no change' : (d > 0 ? '+' : '−') + fmt(Math.abs(d))));
  function viewAnalytics() {
    const t = C.todayISO(), P = anDays, prevFromFull = C.addDays(t, -(2 * P - 1));
    // I conti partono dalla prima registrazione: prima l'app non c'era, non è un periodo senza allenamento
    const first = S.logs.reduce((m, l) => (l.date < m ? l.date : m), t);
    const from = C.addDays(t, -(P - 1)) < first ? first : C.addDays(t, -(P - 1)), days = C.diffDays(t, from) + 1;
    const prevFrom = C.addDays(t, -(2 * P - 1)), prevTo = C.addDays(t, -P), hasPrev = first <= prevFromFull; // confronto solo con un periodo precedente intero
    const sched = S.plans.flatMap(p => C.scheduled(p, [])).concat(C.scheduled(null, S.extras));
    const sum = C.summary(S.logs, sched, from, t, t), prev = C.summary(S.logs, sched, prevFrom, prevTo, t);
    const cat = C.timeBySection(S.logs, from, t), weekly = P > 30;
    const metric = opts([['time', 'Training time'], ['days', 'Training days']], anMetric, { onchange: e => { anMetric = e.target.value; render(); } });
    const period = opts(PERIODS.map(([k, l]) => [String(k), l]), String(P), { onchange: e => { anDays = +e.target.value; render(); } });
    const out = [anHead('analytics')];
    const main = [h('div', { class: 'an-sel' }, metric, period)];
    const pctChange = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
    if (anMetric === 'time') {
      const [v, u] = hours(sum.minutes), ch = pctChange(sum.minutes, prev.minutes);
      main.push(h('div', { class: 'an-big' }, v, h('small', {}, u)), h('div', { class: 'sub' }, !hasPrev || ch == null ? `${fmtDate(from)} – ${fmtDate(t)}` : `${ch >= 0 ? '+' : '−'}${Math.abs(ch)}% vs the previous ${P} days`));
    } else {
      const d = sum.sessions - prev.sessions;
      main.push(h('div', { class: 'an-big' }, String(sum.sessions), h('small', {}, sum.sessions === 1 ? 'training day' : 'training days')), h('div', { class: 'sub' }, hasPrev ? `${d >= 0 ? '+' : '−'}${Math.abs(d)} vs the previous ${P} days` : `${fmtDate(from)} – ${fmtDate(t)}`));
    }
    if (!sum.sessions) return out.concat(h('div', { class: 'card' }, main, h('p', { class: 'sub' }, 'No exercises logged in this period. Charts fill in as you log exercises.')));

    // Ciambella: tempo per categoria; al centro la quota di arrampicata sul tempo classificato
    const climb = cat.rows.filter(r => C.CLIMBING.includes(r.section)).reduce((a, r) => a + r.minutes, 0);
    const slices = cat.rows.map(r => ({ label: C.SECTIONS[r.section], value: r.minutes, text: hm(r.minutes), short: shortH(r.minutes), cls: 'c-' + r.section }));
    if (cat.unclassified) slices.push({ label: 'Unclassified', value: cat.unclassified, text: hm(cat.unclassified), short: shortH(cat.unclassified), cls: 'g-none' });
    if (slices.length) main.push(Charts.donut({ slices, center: cat.classified ? [Math.round(climb / cat.classified * 100) + '%', 'climbing'] : null, aria: 'Training time by category in the period' }));

    // Andamento: barre giornaliere (settimana, mese) o settimanali (3 mesi, anno), colorate per categoria
    if (anMetric === 'time') {
      const per = weekly ? sum.minutes / Math.max(1, days / 7) : sum.minutes / sum.sessions, [pv, pu] = hours(per);
      main.push(h('div', { class: 'an-big', style: 'font-size:26px;margin-top:18px' }, pv, h('small', {}, pu + (weekly ? ' / week' : ' / training day'))));
      const rows = weekly ? C.weeklyGroups(S.logs, from, t) : C.dailyGroups(S.logs, from, t);
      const labels = rows.map(r => fmtDate(weekly ? r.week : r.date)), long = rows.map(r => (weekly ? `${fmtDate(r.week)} – ${fmtDate(C.addDays(r.week, 6))}` : `${wdOf(r.date)} ${fmtDate(r.date)}`));
      main.push(Charts.stacked({ labels, longLabels: long, unit: 'min', aria: weekly ? 'Training minutes per week, by category' : 'Training minutes per day, by category',
        series: [...Object.entries(C.SECTIONS), ['unclassified', 'Unclassified']].map(([k, name]) => ({ name, cls: k === 'unclassified' ? 'g-none' : 'c-' + k, values: rows.map(r => r[k]) })).filter(x => x.values.some(v => v > 0)) }));
    } else {
      const wk = C.weeklyStats(S.logs, sched, from, t, t);
      main.push(h('div', { class: 'an-big', style: 'font-size:26px;margin-top:18px' }, dec(Math.round(sum.sessions / Math.max(1, days / 7) * 10) / 10), h('small', {}, 'days / week')),
        Charts.columns({ labels: wk.map(w => fmtDate(w.week)), longLabels: wk.map(w => `${fmtDate(w.week)} – ${fmtDate(C.addDays(w.week, 6))}`), values: wk.map(w => w.sessions), targets: wk.map(w => w.plannedSessions), targetName: 'Planned', name: 'Training days', aria: 'Training days per week' }));
    }
    out.push(h('div', { class: 'card' }, main));

    // Progressi: massimali dei test e grado massimo per superficie, con la variazione nel periodo; tocco → andamento
    const prog = [];
    for (const x of C.testProgress(S.tests, from, t)) {
      const def = S.testDefs.find(d => d.key === x.key);
      if (!def || def.key === 'bw') continue;
      const fmt = v => (def.mode === 'hang' ? C.fmtKg(v) : dec(v) + ' ' + def.unit), fmtD = v => dec(v) + ' ' + def.unit;
      prog.push(h('div', { class: 'prog-r', onclick: () => openSheet(def.name, [C.testLabel(def) ? h('p', { class: 'sub' }, C.testLabel(def)) : null,
        Charts.line({ labels: x.points.map(p => fmtDate(p.date)), values: x.points.map(p => p.value), name: def.name, unit: def.unit, colLabel: 'Date', aria: `${def.name} over time` })]) },
        h('div', { class: 'grow' }, h('div', { class: 'n' }, catBar('fingers'), def.name), h('div', { class: 'sub' }, [C.testLabel(def), 'last ' + fmtDate(x.date)].filter(Boolean).join(' · '))),
        h('div', {}, h('div', { class: 'v' }, fmt(x.latest)), deltaTag(x.delta, fmtD))));
    }
    const grades = C.gradeProgress(S.logs, from, t, prevFrom);
    for (const g of grades) {
      const chFrom = C.addDays(t, -7 * 11), tg = C.weeklyTopGrades(S.logs, P > 77 ? from : chFrom, t), vals = tg.series[g.surface] || [];
      const all = vals.filter(v => v != null), lo = Math.max(0, Math.min(...all, g.top ?? 99) - 1), hi = Math.min(C.GRADES.length - 1, Math.max(...all, g.top ?? 0) + 1), step = Math.max(1, Math.ceil((hi - lo) / 4));
      const domain = { min: lo, max: lo + step * Math.ceil((hi - lo) / step), step }, fmtGr = v => (C.GRADES[Math.round(v)] ? fmtG(C.GRADES[Math.round(v)]) : '');
      prog.push(h('div', { class: 'prog-r', onclick: () => all.length ? openSheet(surfName(g.surface), [h('p', { class: 'sub' }, 'Top grade sent each week.'),
        Charts.line({ labels: tg.weeks.map(fmtDate), values: vals, name: 'Top grade', domain, fmt: fmtGr, aria: `Top grade sent per week on ${surfName(g.surface)}` })]) : null },
        h('div', { class: 'grow' }, h('div', { class: 'n' }, catBar('strength'), surfName(g.surface)), h('div', { class: 'sub' }, 'Top grade sent')),
        h('div', {}, h('div', { class: 'v' }, g.top == null ? '—' : fmtG(C.GRADES[g.top])), g.top != null && g.prev != null ? deltaTag(g.top - g.prev, n => n + (n === 1 ? ' grade' : ' grades')) : null)));
    }
    out.push(h('div', { class: 'card' }, h('div', { class: 'ct' }, 'Progress'), h('div', { class: 'sub' }, `Latest value and change since ${fmtDate(from)}. Tap for the trend.`),
      prog.length ? prog : h('p', { class: 'sub' }, 'Add test results (Tests and maxes) or log grades on climbing exercises to see them here.')));

    // Costanza: giornate fatte su previste, serie completate, sforzo e sensazione medi
    const sets = C.setsCompletion(S.logs, from, t), row = (l, v) => h('div', { class: 'prog-r', style: 'cursor:default' }, h('div', { class: 'grow' }, l), h('div', { class: 'v' }, v));
    out.push(h('div', { class: 'card' }, h('div', { class: 'ct' }, 'Consistency'),
      row('Planned days trained', sum.due ? `${sum.dueDone} / ${sum.due}` : '—'),
      row('Sets completed', sets.of ? `${Math.round(sets.share * 100)}%` : '—'),
      row('Average RPE · feeling', `${sum.rpe == null ? '—' : dec(sum.rpe.toFixed(1))} · ${sum.feel == null ? '—' : dec(sum.feel.toFixed(1)) + '/5'}`)));
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
    return [anHead('tests'), h('div', { class: 'sub' }, 'The latest result of each test is the max used to compute kg. A test can also be added to a day: the result lands here when the exercise ends.'),
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
        if (used) return toast('It is used by exercises or logged exercises: you can rename it.');
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
    const where = P ? 'timer: ' + P.steps[P.idx].name : (location.hash.slice(1) || 'home');
    const ov = openSheet('Note a problem', [h('p', { class: 'sub' }, `Saved with screen (${where}), date and version. You find it in More → Notebook.`), text,
      btn('Save note', () => {
        const t = text.value.trim().slice(0, 1000);
        if (!t) return toast('Write something.');
        S.notes.push({ id: C.uid(), at: new Date().toISOString(), text: t, where, version: VERSION });
        save(); ov.remove(); toast('Note saved.'); if (!P) render();
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
        : h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'No notes. Use "Note" in the bottom bar when something feels off.'))];
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
    try { audioInit(); SOUND.setEnd(); add('Sound signals', ac && ac.state === 'running' ? true : null, ac && ac.state === 'running' ? 'a signal was just played: if you did not hear it, check the volume and the silent switch' : 'audio not started: try again by tapping "Run the checks"'); }
    catch (e) { add('Sound signals', false, 'audio not available'); }
    try {
      if (navigator.wakeLock) { const l = await navigator.wakeLock.request('screen'); await l.release(); add('Screen stays on while a timer runs', true, 'granted'); }
      else add('Screen stays on while a timer runs', false, 'not supported: the screen may turn off during the timer');
    } catch (e) { add('Screen stays on while a timer runs', false, 'refused by the system (for example with Low Power Mode on)'); }
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
      if (v && v !== VERSION && v !== newVersion) { newVersion = v; if (!P) render(); }
    } catch (e) { /* offline o anteprima: nessun controllo */ }
  }

  function viewMore() {
    const pr = S.settings.prog, progOn = h('input', { type: 'checkbox', checked: pr.on }), progStep = numInp(pr.step), progRpe = numInp(pr.rpe);
    const prep = numInp(S.settings.prep), sound = h('input', { type: 'checkbox', checked: S.settings.sound, onchange: () => { S.settings.sound = sound.checked; save(); } });
    const sfNew = h('input', { class: 'inp', style: 'margin:0', placeholder: 'New surface' });
    return [h('h1', {}, 'More'),
      // Strumento della prova d'uso (prima stava nella barra): sparirà nella versione definitiva
      h('div', { class: 'card tap row', id: 'more-note', onclick: noteSheet }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Note'), h('div', { class: 'sub' }, 'Write down what is wrong while you use the app')), '+'),
      h('div', { class: 'card tap row', onclick: () => { location.hash = 'library'; } }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Exercise library'), h('div', { class: 'sub' }, (C.LIBRARY.length + S.custom.length) + ' exercises')), '›'),
      h('div', { class: 'card tap row', onclick: () => go('notebook') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Notebook'), h('div', { class: 'sub' }, S.notes.length ? `${S.notes.length} notes` : 'No notes yet')), '›'),
      h('div', { class: 'card tap row', onclick: () => go('diagnostics') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Diagnostics'), h('div', { class: 'sub' }, 'Audio, screen on, offline and storage on this device · v' + VERSION)), '›'),
      h('h2', {}, 'Programmes'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'A programme is a set of training days: import it, choose when it starts and find it in the calendar.'),
        S.plans.map(p => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => planSheet(p) }, h('div', { class: 'grow' }, h('div', { class: 'n' }, p.title),
          h('div', { class: 'p' }, `${fmtDate(C.firstSessionDate(p))} – ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))} · ${p.weeks.length} weeks`)), h('div', { class: 'm' }, '›'))),
        h('div', { class: 'btns' }, fileBtn('Import programme (.yaml)'))),
      h('h2', {}, 'Climbing surfaces'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Assigned to exercises and logged exercises, to compare progress in the charts. Tap to rename.'),
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
          btn('Reset everything', async () => { if (await confirmDlg('Delete programmes, days, exercises, logs and tests? This cannot be undone: make a backup first.', 'Reset')) { S = fresh(); calSel = calMonth = null; save(); render(); } }, 'sm danger')))];
  }


  /* ---------- Viaggi e progetti ----------
     Sezione a sé: non programma nulla e non tocca giornate, esercizi, test e analisi. Logica pura in core.js. */
  const TRIP_ST = Object.fromEntries(C.TRIP_STATUS);
  const tripById = id => S.trips.find(t => t.id === id);
  // Le vie usano la stessa scala, scritta in minuscolo come nella scala francese (7a+); i blocchi restano Font (7A+).
  const prjGrade = p => (p.grade ? (p.style === 'route' ? fmtG(p.grade).toLowerCase() : fmtG(p.grade)) : '');
  /** "Mar 2027", "Mar – Apr 2027", "14 – 28 Mar 2027", "28 Feb – 3 Mar 2027"; senza date: "No dates yet". */
  function fmtTrip(t) {
    const part = v => { const [y, m, d] = v.split('-').map(Number); return { y, m: MONTHS[m - 1], d }; };
    if (!t.from) return 'No dates yet';
    const a = part(t.from), b = t.to ? part(t.to) : null;
    const one = x => (x.d ? `${x.d} ${x.m} ${x.y}` : `${x.m} ${x.y}`);
    if (!b || t.to === t.from) return one(a);
    if (a.y === b.y && !!a.d === !!b.d) return a.d ? (a.m === b.m ? `${a.d} – ${b.d} ${b.m} ${b.y}` : `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`) : `${a.m} – ${b.m} ${b.y}`;
    return `${one(a)} – ${one(b)}`;
  }
  /** "in 118 days", "tomorrow", "now"; per le date al mese è approssimativo. */
  function whenTrip(t) {
    const n = C.daysTo(t, C.todayISO());
    if (n == null) return '';
    return n === 0 ? 'now' : (t.from.length === 7 ? '~' : '') + (n === 1 ? 'tomorrow' : `in ${n} days`);
  }
  const statusTag = t => h('span', { class: 'tag ts-' + t.status }, TRIP_ST[t.status]);
  function progressBar(t) {
    const p = C.tripProgress(t);
    if (!p.total) return null;
    return h('div', { class: 'tprog' }, h('div', { class: 'tbar' }, h('i', { style: `width:${Math.round(p.sent / p.total * 100)}%` })), h('span', {}, `${p.sent}/${p.total} sent`));
  }
  function tripCard(t, big) {
    const when = whenTrip(t);
    return h('div', { class: 'card tap trip' + (big ? ' next' : ''), onclick: () => go('trip-' + t.id) },
      h('div', { class: 'row' }, h('div', { class: 'grow n' }, t.name), statusTag(t)),
      h('div', { class: 'sub' }, [t.place, fmtTrip(t)].filter(Boolean).join(' · ') + (when ? ' · ' + when : '')),
      progressBar(t));
  }
  function viewTrips() {
    const g = C.groupTrips(S.trips, C.todayISO());
    return [h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Trips'), btn('+ Trip', () => tripSheet(null), 'sm pri')),
      !S.trips.length ? h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'Climbing trips and the projects you want to do there. Add a trip, even just an idea, then its projects: tick them off as you send them.')) : null,
      g.upcoming.length ? [h('h2', {}, 'Coming up'), g.upcoming.map(t => tripCard(t, true))] : null,
      g.ideas.length ? [h('h2', {}, 'Ideas and maybes'), g.ideas.map(t => tripCard(t))] : null,
      g.archive.length ? [h('h2', {}, 'Archive'), g.archive.map(t => tripCard(t))] : null];
  }
  /** Date approssimative: nessuna, solo il mese o i giorni esatti. */
  function datesEditor(t) {
    const prec = t && t.from ? (t.from.length === 7 ? 'month' : 'day') : 'none';
    const sel = opts([['none', 'No dates yet'], ['month', 'Month'], ['day', 'Exact days']], prec);
    const from = h('input', { class: 'inp' }), to = h('input', { class: 'inp' });
    const cols = h('div', { class: 'cols' }, field('From', from), field('To (optional)', to));
    const sync = keep => {
      const k = sel.value;
      cols.hidden = k === 'none';
      for (const [el, v] of [[from, t ? t.from : ''], [to, t ? t.to : '']]) {
        const cur = keep ? v : el.value;
        el.type = k === 'month' ? 'month' : 'date';
        el.value = !cur ? '' : k === 'month' ? cur.slice(0, 7) : cur.length === 7 ? cur + '-01' : cur;
      }
    };
    sel.addEventListener('change', () => sync(false));
    sync(true);
    return { node: [field('Dates', sel), cols], read: () => (sel.value === 'none' ? { from: '', to: '' } : { from: C.tripDate(from.value), to: C.tripDate(to.value) }) };
  }
  function tripSheet(t) {
    const name = h('input', { class: 'inp', value: t ? t.name : '', placeholder: 'e.g. Fontainebleau spring' });
    const place = h('input', { class: 'inp', value: t ? t.place : '', placeholder: 'e.g. Fontainebleau, France' });
    const st = opts(C.TRIP_STATUS, t ? t.status : 'idea'), dates = datesEditor(t);
    const notes = h('textarea', { class: 'inp', placeholder: 'Accommodation, travel, conditions…' }); notes.value = t ? t.notes : '';
    const ov = openSheet(t ? 'Edit trip' : 'New trip', [field('Name', name), field('Place', place), field('Status', st), dates.node, field('Notes', notes),
      btn('Save', () => {
        const n = name.value.trim();
        if (!n) return toast('Give the trip a name.');
        const d = dates.read();
        if (d.from && d.to && C.tripLast(d.to) < C.tripFirst(d.from)) return toast('The end is before the start.');
        const x = t || { id: C.uid(), projects: [], checklist: [], since: C.todayISO() };
        // L'anello del countdown parte dal giorno in cui il viaggio entra in Home (Possible o Confirmed); passare da Possible a Confirmed non lo azzera
        const inHome = k => k === 'possible' || k === 'confirmed';
        if (inHome(st.value) && (!t || !inHome(t.status))) x.since = C.todayISO();
        Object.assign(x, { name: n.slice(0, 80), place: place.value.trim().slice(0, 80), status: st.value, from: d.from, to: d.from ? d.to : '', notes: notes.value.trim().slice(0, 2000) });
        if (!t) S.trips.push(x);
        save(); ov.remove(); log('trips', t ? 'edited' : 'added', { name: x.name });
        if (t) render(); else go('trip-' + x.id);
      }, 'pri block'),
      t ? btn('Delete trip', async () => {
        if (!await confirmDlg(`Delete "${t.name}" with its ${t.projects.length} projects and checklist? This cannot be undone.`, 'Delete')) return;
        S.trips = S.trips.filter(x => x !== t); save(); ov.remove(); log('trips', 'deleted', { name: t.name }); go('trips');
      }, 'danger block') : null]);
  }
  function projectSheet(t, p) {
    const name = h('input', { class: 'inp', value: p ? p.name : '', placeholder: 'e.g. Karma' });
    const grade = opts(gradeOpts(), p ? p.grade : ''), style = opts(C.STYLES, p ? p.style : 'boulder');
    const sector = h('input', { class: 'inp', value: p ? p.sector : '', placeholder: 'e.g. Franchard Cuisinière' });
    const st = opts(C.PROJECT_STATUS, p ? p.status : 'todo');
    const sent = h('input', { class: 'inp', type: 'date', value: p && p.sentOn ? p.sentOn : '' }), sentF = field('Sent on', sent);
    const syncSent = () => { sentF.hidden = st.value !== 'sent'; if (st.value === 'sent' && !sent.value) sent.value = C.todayISO(); };
    st.addEventListener('change', syncSent); syncSent();
    const notes = h('textarea', { class: 'inp', placeholder: 'Beta, conditions, pads…' }); notes.value = p ? p.notes : '';
    const ov = openSheet(p ? 'Edit project' : 'New project', [field('Name', name), h('div', { class: 'cols' }, field('Grade', grade), field('Style', style)),
      field('Sector', sector), field('Status', st), sentF, field('Notes', notes),
      btn('Save', () => {
        const n = name.value.trim();
        if (!n) return toast('Give the project a name.');
        const x = p || { id: C.uid() };
        Object.assign(x, { name: n.slice(0, 80), grade: grade.value, style: style.value, sector: sector.value.trim().slice(0, 80), status: st.value,
          sentOn: st.value === 'sent' ? C.validISO(sent.value) || C.todayISO() : '', notes: notes.value.trim().slice(0, 2000) });
        if (!p) t.projects.push(x);
        save(); ov.remove(); render();
      }, 'pri block'),
      p ? btn('Delete project', async () => {
        if (!await confirmDlg(`Delete "${p.name}"?`, 'Delete')) return;
        t.projects = t.projects.filter(x => x !== p); save(); ov.remove(); render();
      }, 'danger block') : null]);
  }
  /** Un tocco sul cerchio chiude il progetto (data di oggi); un altro tocco lo riapre. */
  function toggleSent(t, p, el) {
    if (p.status === 'sent') { p.status = 'todo'; p.sentOn = ''; save(); render(); return; }
    p.status = 'sent'; p.sentOn = C.todayISO(); save();
    log('trips', 'sent', { name: p.name });
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* non supportato */ }
    const pr = C.tripProgress(t);
    toast(`${p.name} sent!` + (pr.total > 1 ? ` ${pr.sent}/${pr.total}` : ''));
    // Prima l'animazione sul cerchio, poi il ridisegno
    el.classList.add('pop');
    setTimeout(render, 450);
  }
  function projectRow(t, p) {
    const sub = [p.sector, C.STYLES.find(s => s[0] === p.style)[1], p.status === 'sent' && p.sentOn ? 'sent ' + fmtDate(p.sentOn) + ' ' + p.sentOn.slice(0, 4) : p.status === 'working' ? 'working' : ''].filter(Boolean).join(' · ');
    const dot = h('button', { type: 'button', class: 'pdot ' + p.status, 'aria-label': p.status === 'sent' ? `${p.name}: sent, tap to reopen` : `Mark ${p.name} as sent`,
      onclick: e => { e.stopPropagation(); toggleSent(t, p, dot); } });
    // Elementi SVG: vanno creati nel loro namespace, altrimenti non si disegnano
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), tick = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); tick.setAttribute('d', 'M6 12.5l4 4 8-9'); svg.append(tick); dot.append(svg);
    return h('div', { class: 'blk prj ' + p.status, onclick: () => projectSheet(t, p), style: 'cursor:pointer' }, dot,
      h('div', { class: 'grow' }, h('div', { class: 'n' }, p.name, p.grade ? h('span', { class: 'gr' }, prjGrade(p)) : null),
        sub ? h('div', { class: 'p' }, sub) : null, p.notes ? h('div', { class: 'p note clamp' }, p.notes) : null));
  }
  /** Lista libera con spunta (cose da portare, prenotazioni): leggera e separabile, compare solo se usata. */
  let checklistOpen = null;
  function checklistCard(t) {
    if (!t.checklist.length && checklistOpen !== t.id) return h('div', { class: 'btns' }, btn('+ Checklist', () => { checklistOpen = t.id; render(); }, 'sm'));
    const inp = h('input', { class: 'inp', style: 'margin:0', placeholder: 'Add an item' });
    const add = () => { const v = inp.value.trim().slice(0, 120); if (!v) return; t.checklist.push({ id: C.uid(), text: v, done: false }); save(); render(); setTimeout(() => { const i = document.querySelector('#view .chk-add input'); if (i) i.focus(); }, 0); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const done = t.checklist.filter(c => c.done).length;
    return [h('h2', {}, 'Checklist', t.checklist.length ? h('span', { class: 'cnt' }, ` ${done}/${t.checklist.length}`) : null), h('div', { class: 'card chk' },
      t.checklist.map(c => h('div', { class: 'chk-i' + (c.done ? ' done' : '') },
        h('label', { class: 'grow' }, h('input', { type: 'checkbox', checked: c.done, onchange: e => { c.done = e.target.checked; save(); render(); } }), ' ', c.text),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + c.text, onclick: () => { t.checklist = t.checklist.filter(x => x !== c); save(); render(); } }, '×'))),
      h('div', { class: 'row chk-add' }, h('div', { class: 'grow' }, inp), btn('Add', add, 'sm')))];
  }
  function viewTrip(args) {
    const t = tripById(args.join('-'));
    if (!t) return [h('h1', {}, 'Trip not found'), btn('‹ Trips', () => go('trips'), 'sm')];
    const when = whenTrip(t), pr = C.tripProgress(t);
    return [h('div', { class: 'row' }, btn('‹ Trips', () => go('trips'), 'sm'), btn('Edit', () => tripSheet(t), 'sm right')),
      h('h1', { class: 'trip-h' }, t.name),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, statusTag(t), h('span', { class: 'sub' }, [t.place, fmtTrip(t), when].filter(Boolean).join(' · '))),
      t.notes ? h('p', { class: 'trip-notes' }, t.notes) : null,
      h('h2', {}, 'Projects', pr.total ? h('span', { class: 'cnt' }, ` ${pr.sent}/${pr.total} sent`) : null),
      h('div', { class: 'card' }, t.projects.length ? t.projects.map(p => projectRow(t, p)) : h('p', { class: 'sub', style: 'margin-top:0' }, 'The boulders and routes you want to do on this trip. Tap the circle when you send one.'),
        h('div', { class: 'btns' }, btn('+ Project', () => projectSheet(t, null), 'sm pri'))),
      checklistCard(t)];
  }

  /* ---------- Player ---------- */
  let P = null, ac = null, wl = null;
  /* Suoni. Su iPhone l'audio delle web app segue l'interruttore silenzioso: con l'Audio Session API (Safari 17+)
     si dichiara "playback", come un'app di musica, e i segnali suonano anche in modalità silenziosa (il volume conta ancora).
     Il contesto audio si crea e si sblocca solo dentro un tocco dell'utente, con un suono muto. */
  function audioInit() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* API non disponibile */ }
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination); src.start(0);
      }
      if (ac.state !== 'running') ac.resume();
    } catch (e) { ac = null; }
  }
  function beep(freq, dur, at = 0) {
    if (!S.settings.sound || !ac) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
      o.type = 'square'; o.frequency.value = freq; o.connect(g); g.connect(ac.destination); // onda quadra: si sente meglio dell'onda sinusoidale in palestra
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      g.gain.setValueAtTime(0.35, t + Math.max(0.02, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio non disponibile: il player continua senza suoni */ }
  }
  // Segnali: bip corti negli ultimi 3 secondi; suono lungo a fine serie (fine del lavoro); fine esercizio = due suoni lunghi.
  const SOUND = { count: () => beep(880, 0.12), go: () => beep(1320, 0.35), setEnd: () => beep(660, 0.9), exEnd: () => { beep(660, 0.7); beep(990, 1.0, 0.8); } };
  async function wake() { try { if (navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); } catch (e) { wl = null; } }
  document.addEventListener('visibilitychange', () => { if (P && document.visibilityState === 'visible') { wake(); tick(); } });
  const mmss = s => { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s); };
  const isAuto = st => st.kind === 'rest' || (st.kind === 'work' && !st.selfPaced);

  function startBlock(r, b) {
    const steps = C.buildSteps([b], S.exercises, S.settings.prep);
    if (!steps.length) return toast('Exercise not available.');
    audioInit(); wake();
    P = { r, b, steps, idx: null, ms: 0, paused: false, completed: 0, works: steps.filter(x => x.kind === 'work').length };
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
      if (rem <= 0) {
        const last = P.idx + 1 >= P.steps.length;
        if (last) SOUND.exEnd(); else if (st.kind === 'work') SOUND.setEnd(); else SOUND.go();
        if (st.kind === 'work') P.completed = (P.completed || 0) + 1; // serie arrivata in fondo, non saltata
        return next();
      }
      if (rem <= 3 && rem !== P.lastBeep) { P.lastBeep = rem; SOUND.count(); }
    } else if (st.kind === 'free' && st.seconds > 0) {
      // esercizio a durata: allo scadere il timer si ferma e si passa alla registrazione, non all'esercizio successivo
      if (rem <= 0) { SOUND.exEnd(); return endBlock(); }
      if (rem <= 3 && rem !== P.lastBeep) { P.lastBeep = rem; SOUND.count(); }
    }
    drawClock();
  }
  function drawClock() {
    const st = P.steps[P.idx], rem = remaining();
    // A ripetizioni il numero da fare conta più del tempo: si mostra quello (e il tempo trascorso solo se non c'è un numero)
    const reps = st.kind === 'work' && st.selfPaced && st.reps;
    $('p-clock').classList.toggle('reps', !!reps);
    $('p-clock').textContent = reps ? `${st.reps} reps` : st.kind === 'work' && st.selfPaced ? mmss(st.seconds - rem) : mmss(Math.ceil(rem));
  }
  function draw() {
    const st = P.steps[P.idx], nx = P.steps[P.idx + 1], ex = S.exercises[st.exId];
    const ph = st.prep ? 'prep' : st.kind;
    $('player').dataset.ph = ph;
    $('p-bar').style.width = (P.idx / P.steps.length * 100) + '%';
    $('p-ph').textContent = { prep: 'GET READY', work: st.selfPaced ? 'GO' : 'WORK', rest: 'REST', free: 'IN PROGRESS' }[ph];
    $('p-name').textContent = st.name;
    $('p-round').textContent = st.kind === 'free' ? (ex && ex.surface ? surfName(ex.surface) : '') : `Round ${st.round} of ${st.rounds}`;
    // Parametri dell'esercizio (lato, presa, tacca, mani, % del massimale); la nota del giorno sotto, più piccola
    $('p-cue').textContent = [st.cue, C.gripText(ex), ex && ex.load && ex.load.pct != null && !ex.load.test ? ex.load.pct + '% max' : ''].filter(Boolean).join(' · ');
    $('p-note').textContent = P.b.note || '';
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
    const { r, b, ms, completed, works } = P;
    clearInterval(P.timer); P = null; $('player').hidden = true;
    try { if (wl) wl.release(); } catch (e) { /* già rilasciato */ } wl = null;
    recordSheet(r, b, ms, works ? { done: completed, of: works } : null);
  }
  function recordSheet(r, b, ms, sets) {
    const ex = S.exercises[b.exId], m = maxes(), isClimb = ex.slot === 'wall' || !!ex.surface;
    const min = numInp(Math.round(ms / 60000)), note = h('input', { placeholder: 'Optional' });
    const isTest = !!(ex.load && ex.load.test), prop = proposal(ex), planned = loadHint(ex).replace('kg: maxes missing', '');
    // Carico e RPE per ogni esercizio di forza: sono lo storico da cui nasce la proposta della volta dopo.
    const load = !isTest && (ex.load || ex.slot === 'strength') ? h('input', { value: planned || (prop ? prop.text : ''), placeholder: 'e.g. 20 kg or L 18 kg · R 20 kg' }) : null;
    const rpe = load ? numInp(null, { placeholder: '1-10' }) : null;
    const tests = ex.load && ex.load.test ? C.refKeys(ex.load.ref).map(k => S.testDefs.find(t => t.key === k)).filter(Boolean)
      .map(def => ({ def, inp: numInp(null, { placeholder: m[def.key] == null ? '' : 'previous: ' + dec(m[def.key]) }) })) : [];
    const sf = isClimb ? opts(surfOpts(), ex.surface || '') : null, gr = isClimb ? opts(gradeOpts(), '') : null, sends = isClimb ? numInp(null) : null;
    // Serie fatte: precompilate da quelle arrivate in fondo nel timer (le saltate non contano); ripetizioni mancanti a mano.
    const setsDone = sets ? numInp(sets.done) : null, repsMissed = ex.interval && ex.interval.selfPaced && ex.interval.reps ? numInp(null, { placeholder: '0' }) : null;
    const put = rec => {
      const l = dayLog(r, true), i = l.blocks.findIndex(x => x.bid === b.id), prev = i >= 0 ? l.blocks[i] : null;
      if (prev && prev.testIds) S.tests = S.tests.filter(t => !prev.testIds.includes(t.id)); // rifatto: il nuovo risultato sostituisce il precedente
      rec.testIds = (rec.tests || []).map(t => { const id = C.uid(); S.tests.push({ id, key: t.key, date: l.date, value: t.value }); return id; });
      delete rec.tests;
      rec.bid = b.id;
      for (const k of Object.keys(rec)) if (rec[k] == null || rec[k] === '' || (Array.isArray(rec[k]) && !rec[k].length)) delete rec[k];
      if (prev) l.blocks[i] = rec; else l.blocks.push(rec);
      l.minutes = Math.max(0, (l.minutes || 0) + (rec.minutes || 0) - (prev && prev.minutes || 0));
      l.loads = l.blocks.filter(x => x.load).map(x => ({ name: x.name, kg: x.load }));
      l.climbs = l.blocks.map(x => x.climb).filter(Boolean);
      save(); ov.remove(); render();
      log('exercise', 'logged', { name: rec.name });
    };
    const of = sets ? sets.of : 0;
    const ov = openSheet(C.exName(ex), [h('p', { class: 'sub' }, 'Exercise complete: log how it went.'),
      sets ? h('div', { class: 'cols' }, field(`Sets done (of ${of})`, setsDone), repsMissed ? field('Reps missed (total)', repsMissed) : field('Minutes', min)) : field('Minutes', min),
      sets && repsMissed ? field('Minutes', min) : null,
      tests.length ? [tests.map(x => field(`Result: ${x.def.name} (${x.def.unit})`, x.inp)), h('p', { class: 'sub' }, 'On save, the result immediately updates the max in the Tests section.')] : null,
      load ? h('div', { class: 'cols' }, field('Load used', load), field('Exercise RPE', rpe)) : null,
      load && prop && planned ? h('p', { class: 'sub' }, `Suggested: ${prop.text} (${prop.why}).`) : null,
      isClimb ? [h('div', { class: 'cols' }, field('Surface', sf), field('Top grade sent', gr)), field('Problems sent', sends)] : null,
      field('Note', note),
      btn('Save', () => {
        const sd = setsDone ? Math.round(val(setsDone)) : null;
        if (setsDone && !(sd >= 0 && sd <= of)) return toast(`Sets done: from 0 to ${of}.`);
        const rm = repsMissed ? Math.max(0, Math.round(val(repsMissed) || 0)) : null;
        put({ name: C.exName(ex), minutes: Math.max(0, Math.round(val(min) || 0)), note: note.value.trim().slice(0, 200), load: load ? load.value.trim() : '', sec: exSection(ex),
          key: exKey(ex), label: exLabel(ex), kgs: load ? C.parseLoads(load.value) : [], rpe: rpe ? val(rpe) : null, mode: ex.load ? ex.load.mode : 'lift',
          sets: sets ? { done: sd, of } : null, repsMissed: rm || null,
          tests: tests.map(x => ({ key: x.def.key, value: val(x.inp) })).filter(x => x.value != null),
          climb: isClimb && sf.value ? { name: C.exName(ex), surface: sf.value, top: gr.value || null, sends: val(sends) == null ? null : Math.max(0, Math.round(val(sends))), minutes: Math.max(0, Math.round(val(min) || 0)) } : null });
      }, 'pri block'),
      btn('Done, without logging', () => put({ name: C.exName(ex), minutes: Math.round(ms / 60000), sec: exSection(ex), key: exKey(ex), label: exLabel(ex) }), 'block'),
      btn('Not done', () => ov.remove(), 'block')]);
  }
  function wirePlayer() {
    $('p-done').onclick = () => { const st = P.steps[P.idx]; if (st.kind === 'work' && st.selfPaced) { P.completed++; if (P.idx + 1 < P.steps.length) SOUND.setEnd(); } next(); };
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
  const VIEWS = { home: viewHome, calendar: viewCalendar, trips: viewTrips, trip: viewTrip, analytics: viewAnalytics, tests: viewProgress, more: viewMore, library: viewLibrary, notebook: viewNotes, diagnostics: viewDiag };
  function render() {
    const [name, ...args] = (location.hash.slice(1) || 'home').split('-');
    const fn = VIEWS[name] || viewHome;
    let nodes;
    try { nodes = fn(args); }
    catch (e) { console.error('[ui] error in view ' + name, e); nodes = [h('h1', {}, 'Something went wrong'), h('p', { class: 'sub' }, String(e.message || e)), btn('Back to Home', () => go('home'))]; }
    $('view').replaceChildren(...[nodes].flat(Infinity).filter(n => n != null && n !== false));
    const tab = { library: 'more', notebook: 'more', diagnostics: 'more', tests: 'analytics', trip: 'trips' }[name] || (VIEWS[name] ? name : 'home');
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
  render();
  cloudRetry();
  checkUpdate();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  // Chiede al sistema di non cancellare i dati quando lo spazio scarseggia (dove supportato); l'esito si vede in Diagnostica.
  if (S.logs.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.__app = { get state() { return S; }, render, cloudBackup, checkUpdate }; // utile per debug dalla console
})();
