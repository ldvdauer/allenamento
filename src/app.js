/* Interfaccia: viste, editor, player. Tutta la logica testabile sta in core.js, i grafici in charts.js. */
(function () {
  'use strict';
  const C = Core, KEY = 'allenamento.v1';
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WD_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const wdIdx = iso => (C.fromISO(iso).getDay() + 6) % 7;
  const fmtDate = iso => { const d = C.fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const wdOf = iso => WD[wdIdx(iso)];
  const dec = v => String(v);
  const log = (area, msg, extra) => console.info(`[${area}] ${msg}`, extra === undefined ? '' : extra);

  /* ---------- Stato e persistenza ---------- */
  // Primo avvio: nessun piano precaricato, ogni utente importa o crea i propri.
  const fresh = () => migrate({ v: 20, plans: [], activePlan: null, exercises: {}, logs: [], tests: [] });
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
    s.settings = Object.assign({ prep: 10, sound: true, audioMode: 'duck', gradeScale: 'font', lastBackup: null }, s.settings);
    delete s.settings.prog; // proposta del carico tolta il 22 nov (scelta di Leo)
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
    // Profilo (dati fisici): altezza e ape index in cm, solo informativi; il peso corporeo resta lo storico del test "bw"
    s.profile = { height: Number.isFinite(s.profile && s.profile.height) ? s.profile.height : null, ape: Number.isFinite(s.profile && s.profile.ape) ? s.profile.ape : null };
    s.trips = C.cleanTrips(s.trips, C.todayISO()); // v13: viaggi e progetti (sezione a sé); un backup precedente non li ha
    // v14: esercizi registrati con 0 minuti (nota di Leo del 19 nov: Analytics a 0 min) prendono i minuti previsti dalla giornata
    if (fromV < 14) {
      const planned = new Map();
      for (const p of s.plans) for (const w of p.weeks) for (const d of w) for (const x of d.sessions) for (const b of x.blocks) planned.set(b.id, b.minutes);
      for (const x of s.extras || []) for (const b of x.blocks) planned.set(b.id, b.minutes);
      for (const l of s.logs) if ((l.blocks || []).length && fillMinutes(l, planned)) l.minutes = l.blocks.reduce((t, x) => t + (x.minutes || 0), 0);
    }
    // v15: superfici per la lead (scala francese); "Outdoor routes" diventa "Lead climbing" (nome dalla libreria)
    if (fromV < 15) for (const d of C.DEFAULT_SURFACES.filter(x => x.kind)) {
      const x = s.surfaces.find(y => y.key === d.key);
      if (!x) s.surfaces.push({ ...d }); else if (d.kind) x.kind = d.kind;
    }
    // v16: gli stretching della libreria sono tenute a tempo (3 × 30", bicipiti 6 × 30" L/R), non 5 minuti di durata
    // (nota di Leo del 23 nov): si aggiornano le versioni di base mai personalizzate rimaste senza timer
    if (fromV < 16) {
      const fixed = new Set();
      for (const e of Object.values(s.exercises)) {
        const d = C.STD[e.std];
        if (d && ['butterfly', 'side-split', 'frog', 'biceps-stretch'].includes(e.std) && !e.interval && d.interval) { e.interval = JSON.parse(JSON.stringify(d.interval)); e.minutes = C.intervalMinutes(e.interval); fixed.add(e.id); }
      }
      const blocks = [...s.plans.flatMap(p => p.weeks.flatMap(w => w.flatMap(d => d.sessions.flatMap(x => x.blocks)))), ...(s.extras || []).flatMap(x => x.blocks)];
      for (const b of blocks) if (fixed.has(b.exId)) b.minutes = s.exercises[b.exId].minutes;
    }
    // v17: negli esercizi alternati L/R una serie è L + R (cambio lato di 10 s, poi il recupero della serie): i round salvati
    // contavano i lati, quindi si dimezzano. I log restano com'erano.
    if (fromV < 17) C.sidesToSeries(s);
    // v18: i bip devono sentirsi sempre col volume alzato, anche in silenzioso (Leo, 26 nov): chi aveva il predefinito
    // della #10 ("mix", muto in silenzioso) passa a "duck" (segnali sempre udibili, la musica si interrompe solo durante i bip)
    if (fromV < 18 && s.settings.audioMode === 'mix') s.settings.audioMode = 'duck';
    // v19: niente più esercizi "A or B" in libreria (Leo, 28 nov): "Push-ups or dips" del programma diventa Dips,
    // "Squat or pistol" diventa Squat. Parametri e registrazioni passate restano (i log vecchi restano su Push-ups).
    if (fromV < 19) for (const e of Object.values(s.exercises)) {
      if (e.std === 'pushup' && /\bdip/i.test(e.name || '')) { e.std = 'dip'; e.name = 'Dips'; }
      else if (e.std === 'squat' && /pistol/i.test(e.name || '')) e.name = 'Squat';
    }
    // v20: niente parentesi nei nomi della libreria (Leo, 28 nov): "Flys (compression)" → "Flys" ecc.
    if (fromV < 20) for (const e of Object.values(s.exercises)) if (e.std && C.STD[e.std] && / \(/.test(e.name || '') && C.LEGACY_NAMES[e.name]) e.name = C.LEGACY_NAMES[e.name];
    s.v = 20;
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
  // Registrazioni rimaste senza giornata (es. programma eliminato e poi reimportato): si ricollegano alla giornata della stessa data
  try { C.relinkLogs(S); } catch (e) { console.warn('[store] relink failed', e); } // si salva con la prossima modifica; ad ogni avvio si rifà (idempotente)

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
  /** Superficie di vie (lead): gradi in scala francese. */
  const isRoute = k => !!(S.surfaces.find(x => x.key === k) || {}).kind;
  const gradeOpts = route => [['', '—']].concat(C.gradeList(route).map(g => [g, fmtG(g)]));
  /** Il select del grado segue la superficie scelta: scala francese per la lead, Font per i blocchi. Restituisce l'etichetta dei "sent". */
  function linkGrade(sf, gr, sentField) {
    const sync = () => {
      const route = isRoute(sf.value), keep = gr.value;
      gr.replaceChildren(...gradeOpts(route).map(([v, t]) => h('option', { value: v }, t)));
      gr.value = C.gradeList(route).includes(keep) ? keep : '';
      if (sentField) sentField.firstChild.textContent = route ? 'Routes sent' : 'Problems sent';
    };
    sf.addEventListener('change', sync); sync();
  }
  function addSurface(name) {
    const hit = S.surfaces.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.key;
    const x = { key: 's-' + C.uid().slice(0, 8), name };
    if (/\blead\b|\broutes?\b|\bvie\b|falesia|sport climb/i.test(name)) x.kind = 'route'; // vie: scala francese
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
  // Al tocco il valore è tutto selezionato: si scrive sopra (prima restava lo 0 davanti, "016"; nota del 24 nov)
  const selAll = e => {
    const el = e.target, v = el.value, sel = () => { try { el.setSelectionRange(0, el.value.length); } catch (x) { /* non selezionabile */ } };
    sel(); setTimeout(() => { if (el.value === v && document.activeElement === el) sel(); }, 0); // iOS deseleziona dopo il focus: si riprova solo se non si è già scritto
  };
  const numInp = (value, extra) => { const i = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value == null ? '' : dec(value), ...(extra || {}) }); i.addEventListener('focus', selAll); return i; };
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
  // Chiave della serie dei carichi: esercizio, riferimento e presa (Max hang 20 mm half crimp ≠ Max hang 20 mm open hand)
  const exKey = C.exKey;
  function exLabel(e) {
    const base = e.std && C.STD[e.std] ? C.STD[e.std].name : e.name, d = e.load && !C.PAIRS[e.load.ref] ? S.testDefs.find(t => t.key === e.load.ref) : null;
    return [d ? `${base} · ${d.name}` : base, C.gripText(e)].filter(Boolean).join(' · ');
  }
  function loadHint(ex) {
    if (!ex.load || ex.load.pct == null) return '';
    const cues = ex.interval && ex.interval.cues.length ? ex.interval.cues : [''];
    const m = maxes(), out = [];
    for (const c of cues) {
      const kg = C.loadKg(ex.load, c, m);
      if (kg == null) {
        // dire quale valore manca: per le sospensioni serve anche il peso corporeo (nota del 24 nov: "massimale mancante" con l'open hand appena testata)
        const need = [C.loadKey(ex.load, c)].concat(ex.load.mode === 'lift' ? [] : ['bw']).filter(k => m[k] == null || isNaN(m[k]));
        const names = [...new Set(need.filter(k => k !== 'bw').map(k => (S.testDefs.find(t => t.key === k) || { name: k }).name))];
        // il peso corporeo si inserisce nel profilo (More → Profile), i massimali nei Test
        return 'kg: add ' + [names.length ? `${names.join(' and ')} in Tests` : '', need.includes('bw') ? 'body weight in More → Profile' : ''].filter(Boolean).join(', ');
      }
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
      h('div', { class: 'grow' }, h('div', { class: 'n' }, catBar(exSection(ex)), C.exName(ex)), exLine(ex) ? h('div', { class: 'p' }, exLine(ex)) : null, hint ? h('div', { class: 'kg' }, hint) : null, b.note ? h('div', { class: 'p note' }, b.note) : null, extra || null),
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
    const list = h('div', {}, s.blocks.map((b, bi) => blockRow(b, edit ? () => blockSheet(r, bi) : null, edit, run, logged.has(b.id) ? loggedLine(logged.get(b.id), () => editRecord(r, b, logged.get(b.id))) : null)));
    const gone = l ? l.blocks.filter(x => !x.bid || !ids.has(x.bid)) : [];
    if (edit) enableDrag(list, s);
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow big', style: 'font-size:17px' }, s.title || 'Training'),
        done ? h('span', { class: 'tag ok' }, today && doneIds.size < s.blocks.length ? `${doneIds.size} of ${s.blocks.length} done` : 'Done') : null, h('span', { class: 'tag' }, C.sessionMinutes(s) + ' min')),
      list,
      gone.length ? h('div', { class: 'logged-x' }, gone.map(x => h('div', {}, h('b', {}, x.name), loggedLine(x, () => deleteRecord(l, x))))) : null,
      h('div', { class: 'btns' },
        edit ? [btn('+ Exercise', () => pickExercise(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'), btn('+ Test', () => pickTest(tpl => { addBlock(s, tpl); save(); render(); }), 'sm'),
          btn('Edit day', () => daySheet(r), 'sm')] : null));
  }
  /** Riga di ciò che è stato registrato per un esercizio: minuti, carico, RPE, serie, arrampicata, risultati dei test, nota.
      Si tocca per modificare quanto registrato. */
  function loggedLine(x, onEdit) {
    const res = (x.testIds || []).map(id => S.tests.find(t => t.id === id)).filter(Boolean).map(t => { const d = S.testDefs.find(k => k.key === t.key); return `${d ? d.name : t.key} ${dec(t.value)}`; });
    const parts = [x.minutes ? x.minutes + ' min' : '', (x.kgs || []).length ? C.fmtLoads(x.kgs) : x.load, x.rpe ? 'RPE ' + dec(x.rpe) : '', x.sets ? `${x.sets.done}/${x.sets.of} sets` : '', x.repsMissed ? `${x.repsMissed} reps missed` : '',
      x.climb ? climbText(x.climb) : '', ...res].filter(Boolean);
    const short = (x.sets && x.sets.done < x.sets.of) || x.repsMissed;
    return h('div', { class: 'logged' + (short ? ' short' : '') + (onEdit ? ' tap' : ''), role: onEdit ? 'button' : null, 'aria-label': onEdit ? 'Edit what was logged for ' + x.name : null,
      onclick: onEdit ? e => { e.stopPropagation(); onEdit(); } : null },
      h('div', {}, '✓ ' + (parts.join(' · ') || 'logged'), onEdit ? h('span', { class: 'ed' }, ' ✎') : null), x.note ? h('div', { class: 'p' }, x.note) : null);
  }
  /** Modifica di un esercizio già registrato: stessa scheda della registrazione, precompilata. */
  function editRecord(r, b, rec) {
    const ex = S.exercises[b.exId];
    if (!ex) return deleteRecord(dayLog(r), rec);
    recordSheet(r, b, (rec.minutes || 0) * 60000, rec.sets || (ex.interval && ex.interval.rounds ? { done: ex.interval.rounds, of: ex.interval.rounds } : null), rec);
  }
  /** Toglie un esercizio registrato (e i risultati di test che aveva creato); la giornata senza esercizi registrati sparisce. */
  async function deleteRecord(l, rec, ov) {
    if (!l || !await confirmDlg(`Delete what was logged for ${rec.name}?` + ((rec.testIds || []).length ? ' Its test results are deleted too.' : ''), 'Delete')) return;
    if (rec.testIds) S.tests = S.tests.filter(t => !rec.testIds.includes(t.id));
    l.blocks = l.blocks.filter(x => x !== rec);
    if (!l.blocks.length) S.logs = S.logs.filter(x => x !== l);
    else {
      l.minutes = l.blocks.reduce((t, x) => t + (x.minutes || 0), 0);
      l.loads = l.blocks.filter(x => x.load).map(x => ({ name: x.name, kg: x.load }));
      l.climbs = l.blocks.map(x => x.climb).filter(Boolean);
    }
    save(); if (ov) ov.remove(); render(); log('exercise', 'log deleted', { name: rec.name });
  }
  const climbText = c => surfName(c.surface) + (c.top ? ' ' + fmtG(c.top) : '') + (c.sends != null ? ` · ${c.sends} ${isRoute(c.surface) ? (c.sends === 1 ? 'route' : 'routes') : c.sends === 1 ? 'send' : 'sends'}` : '');
  const logCard = l => h('div', { class: 'card tap', onclick: async () => { if (await confirmDlg(`Delete what was logged on ${fmtDate(l.date)} (${l.title})?`, 'Delete')) { const ids = (l.blocks || []).flatMap(x => x.testIds || []); S.tests = S.tests.filter(t => !ids.includes(t.id)); S.logs = S.logs.filter(x => x !== l); save(); render(); } } },
    h('div', { class: 'row' }, h('div', { class: 'grow n', style: 'font-weight:600' }, l.title), h('span', { class: 'tag' }, (l.minutes || 0) + ' min')),
    h('div', { class: 'sub' }, `${wdOf(l.date)} ${fmtDate(l.date)}${l.rpe ? ' · RPE ' + dec(l.rpe) : ''}${l.feel ? ' · feeling ' + l.feel + '/5' : ''}`),
    (l.climbs || []).length ? h('div', { class: 'sub', style: 'color:var(--tx)' }, l.climbs.map(climbText).join('  |  ')) : null,
    (l.loads || []).length ? h('div', { class: 'p', style: 'color:var(--ac);font-size:13px' }, l.loads.map(x => `${x.name}: ${x.kg}`).join(' · ')) : null,
    (l.blocks || []).some(b => (b.sets && b.sets.done < b.sets.of) || b.repsMissed) ? h('div', { class: 'sub', style: 'color:var(--warn)' }, l.blocks.filter(b => (b.sets && b.sets.done < b.sets.of) || b.repsMissed)
      .map(b => [b.name + ':', b.sets && b.sets.done < b.sets.of ? `${b.sets.done}/${b.sets.of} sets` : '', b.repsMissed ? `${b.repsMissed} reps missed` : ''].filter(Boolean).join(' ')).join(' · ')) : null,
    (l.blocks || []).some(b => b.note) ? h('div', { class: 'sub' }, l.blocks.filter(b => b.note).map(b => `${b.name}: ${b.note}`).join(' · ')) : null,
    l.notes ? h('div', { class: 'sub', style: 'margin-top:4px;color:var(--tx)' }, l.notes) : null);

  /* ---------- Home ---------- */
  // Home: Today | Week (come Lattice); la scelta resta finché non si cambia
  const homeHead = (t, cur) => [h('div', { class: 'sub', style: 'text-transform:capitalize' }, `${WD_FULL[wdIdx(t)]} ${fmtDate(t)}`), h('h1', {}, 'Home'),
    seg([['home', 'Today'], ['week', 'Week']], cur, k => { try { localStorage.setItem(KEY + '.homeTab', k); } catch (e) { /* solo comodità */ } location.hash = k; })];
  function viewHome() {
    const t = C.todayISO(), refs = refsOn(t), out = homeHead(t, 'home');
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

  /** Home → Week: settimana da lunedì a domenica con i pallini per categoria e, sotto, ogni giorno con i suoi esercizi.
      Si scorre di settimana in settimana; un giorno si apre nel calendario, dove si modifica. */
  function viewWeek(args) {
    const t = C.todayISO(), mon = C.mondayOf(C.validISO(args.join('-')) || t), days = [0, 1, 2, 3, 4, 5, 6].map(i => C.addDays(mon, i));
    const goWeek = iso => { location.hash = iso === C.mondayOf(t) ? 'week' : 'week-' + iso; };
    // Programma della settimana: "Karma - Fase 1 · Week 2 of 4" (il primo che ha giorni visibili in questa settimana)
    const plan = S.plans.map(p => ({ p, pos: days.map(d => C.locate(p, d)).find(Boolean) })).find(x => x.pos);
    const m0 = C.fromISO(mon), m6 = C.fromISO(days[6]);
    const month = m0.getMonth() === m6.getMonth() ? MONTHS_FULL[m0.getMonth()] : `${MONTHS_FULL[m0.getMonth()]} – ${MONTHS_FULL[m6.getMonth()]}`;
    const cell = iso => {
      const cats = dayCategories(iso, refsOn(iso)), d = C.fromISO(iso);
      return h('button', { type: 'button', class: 'cal-d wk-d' + (iso === t ? ' today' : ''), 'aria-label': `${WD_FULL[wdIdx(iso)]} ${d.getDate()}`,
        onclick: () => { const el = document.getElementById('wd-' + iso); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
        h('span', { class: 'wk-wd' }, WD_FULL[wdIdx(iso)].slice(0, 3)), h('b', {}, d.getDate()),
        h('span', { class: 'dots' }, cats.slice(0, 3).map(c => h('i', { class: 'cat c-' + c.sec + (c.done ? ' ok' : '') }))));
    };
    const dayRow = iso => {
      const refs = refsOn(iso), cats = dayCategories(iso, refs), d = C.fromISO(iso);
      const sessions = refs.map(r => {
        const s = sessOf(r), l = iso <= t ? dayLog(r, false) : null, ids = new Set(l ? l.blocks.map(x => x.bid) : []);
        return h('div', { class: 'wk-s' }, s.title ? h('div', { class: 'wk-st' }, s.title) : null,
          s.blocks.map((b, bi) => { const ex = S.exercises[b.exId], ok = ids.has(b.id);
            // tocco: parametri, sostituisci, sposta, rimuovi (la stessa scheda del calendario)
            return h('div', { class: 'wk-ex tap' + (ok ? ' ok' : ''), role: 'button', onclick: () => blockSheet(r, bi) }, catBar(exSection(ex)), h('span', { class: 'grow' }, ex ? C.exName(ex) : '—'), h('span', { class: 'm' }, ok ? '✓' : b.minutes + ' min')); }));
      });
      const min = refs.reduce((a, r) => a + C.sessionMinutes(sessOf(r)), 0), done = refs.length && refs.every(r => isDone(r));
      const lead = cats[0];
      return h('div', { class: 'wk-day' + (iso === t ? ' now' : ''), id: 'wd-' + iso },
        h('div', { class: 'wk-h tap', role: 'link', 'aria-label': 'Open in the calendar', onclick: () => go('calendar-' + iso) }, h('i', { class: 'wk-dia' + (lead ? ' c-' + lead.sec + (lead.done ? ' ok' : '') : ''), 'aria-hidden': 'true' }),
          h('span', { class: 'grow' }, WD_FULL[wdIdx(iso)], h('span', { class: 'sub' }, ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (iso === t ? ' · today' : ''))),
          refs.length ? (done ? h('span', { class: 'tag ok' }, 'Done') : h('span', { class: 'tag' }, min + ' min')) : h('span', { class: 'sub' }, 'Rest')),
        sessions,
        h('div', { class: 'wk-add' }, btn('+ Exercise', () => pickExercise(tpl => addToDay(iso, tpl)), 'sm'), btn('+ Test', () => pickTest(tpl => addToDay(iso, tpl)), 'sm')));
    };
    return [homeHead(t, 'week'),
      h('div', { class: 'card wk' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'sub' }, plan ? `${plan.p.title} · Week ${plan.pos.w + 1} of ${plan.p.weeks.length}` : 'No plan'),
          h('div', { class: 'big', style: 'font-size:19px' }, month)),
          btn('‹', () => goWeek(C.addDays(mon, -7)), 'sm'), mon === C.mondayOf(t) ? null : btn('Today', () => goWeek(C.mondayOf(t)), 'sm'), btn('›', () => goWeek(C.addDays(mon, 7)), 'sm')),
        h('div', { class: 'cal wk-cal' }, days.map(cell))),
      days.map(dayRow)];
  }

  /** Countdown del prossimo viaggio (confermato o idea con date, pallino verde o giallo): anello che si riempie verso la partenza, come la ciambella di Analytics. */
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

  /** Sposta un esercizio in un altro giorno: i giorni della sua settimana (e di quella dopo) a portata di tocco, o una data qualsiasi.
      Va in fondo alla giornata di quel giorno; se il giorno è vuoto diventa una giornata nuova. */
  function moveSheet(r, bi) {
    const s = sessOf(r), b = s.blocks[bi], from = dayOf(r), e = S.exercises[b.exId];
    const move = iso => {
      if (!C.validISO(iso) || iso === from) return toast('Pick another day.');
      s.blocks.splice(bi, 1); mergeIntoDay(iso, [b], ''); save(); ov.remove(); render();
      toast(`${e ? C.exName(e) : 'Exercise'} moved to ${WD_FULL[wdIdx(iso)]} ${fmtDate(iso)}.`);
    };
    const week = mon => h('div', { class: 'mv-wk' }, [0, 1, 2, 3, 4, 5, 6].map(i => {
      const iso = C.addDays(mon, i), d = C.fromISO(iso), n = refsOn(iso).reduce((a, x) => a + sessOf(x).blocks.length, 0);
      return h('button', { type: 'button', class: 'mv-d' + (iso === from ? ' cur' : '') + (iso < C.todayISO() ? ' past' : ''), disabled: iso === from, onclick: () => move(iso) },
        h('span', {}, WD_FULL[i].slice(0, 3)), h('b', {}, d.getDate()), h('small', {}, iso === from ? 'here' : n ? n + ' ex' : 'rest'));
    }));
    const mon = C.mondayOf(from), date = h('input', { type: 'date', value: from });
    const ov = openSheet('Move to another day', [h('p', { class: 'sub' }, `${e ? C.exName(e) : 'Exercise'}, now on ${WD_FULL[wdIdx(from)]} ${fmtDate(from)}. It goes at the end of the chosen day.`),
      h('div', { class: 'sub' }, 'This week'), week(mon), h('div', { class: 'sub', style: 'margin-top:10px' }, 'Next week'), week(C.addDays(mon, 7)),
      h('div', { class: 'row', style: 'margin-top:12px;align-items:flex-end' }, h('div', { class: 'grow' }, field('Another date', date)), btn('Move', () => move(date.value), 'pri'))]);
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
      const refs = refsOn(iso), cats = dayCategories(iso, refs);
      // Un pallino per categoria, dalla più lunga: pieno = fatta, cerchietto = prevista; oltre tre un "+"
      const dots = cats.slice(0, 3).map(c => h('i', { class: 'cat c-' + c.sec + (c.done ? ' ok' : '') }));
      if (cats.length > 3) dots.push(h('b', { class: 'more', 'aria-hidden': 'true' }, '+'));
      const d = C.fromISO(iso);
      return h('button', { type: 'button', class: 'cal-d' + (iso.slice(0, 7) === calMonth.slice(0, 7) ? '' : ' out') + (iso === t ? ' today' : '') + (iso === calSel ? ' sel' : ''),
        'aria-label': `${WD_FULL[wdIdx(iso)]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}` + (cats.length ? ': ' + cats.map(c => (C.SECTIONS[c.sec] || 'Other') + (c.done ? ' done' : ' planned')).join(', ') : ''), 'aria-pressed': iso === calSel ? 'true' : 'false',
        onclick: () => go('calendar-' + iso) }, d.getDate(), h('span', { class: 'dots' }, dots));
    };
    // Le registrazioni si vedono già nella giornata sopra (✓ sotto ogni esercizio): qui solo quelle senza giornata, es. di un programma eliminato
    const refs = refsOn(calSel), shown = new Set(refs.map(r => sessOf(r).id)), logs = S.logs.filter(l => l.date === calSel && !shown.has(l.sid));
    return [h('h1', {}, 'Calendar'),
      h('div', { class: 'week' }, btn('‹', () => shift(-1), 'sm'), h('div', { class: 't big', style: 'font-size:17px;text-transform:capitalize' }, `${MONTHS_FULL[first.getMonth()]} ${first.getFullYear()}`),
        btn('Today', () => { calMonth = t.slice(0, 7) + '-01'; go('calendar-' + t); }, 'sm'), btn('›', () => shift(1), 'sm')),
      h('div', { class: 'cal' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('div', { class: 'wh' }, x)), cells.map(cell)),
      h('h2', { style: 'margin-top:18px;text-transform:capitalize' }, `${WD_FULL[wdIdx(calSel)]} ${fmtDate(calSel)}`),
      refs.length ? refs.map(r => sessionCard(r, true)) : restCard(calSel, true),
      logs.length ? [h('h2', {}, 'Without a planned day'), h('div', { class: 'sub' }, 'Logged on this day, but its day is no longer in the calendar. Tap to delete it.'), logs.map(logCard)] : null];
  }

  /* ---------- Programmi: insiemi di sessioni importati, visibili solo nel calendario ---------- */
  function planSheet(p) {
    // Con giornate già registrate la data di inizio non si sposta: le registrazioni resterebbero senza giornata
    const logged = S.logs.filter(l => { const x = C.sessionDates({ plans: [p] }, true).get(l.sid); return x && x.date === l.date; }).length;
    const title = h('input', { value: p.title }), start = h('input', { type: 'date', value: C.firstSessionDate(p), disabled: logged > 0 });
    const done = () => { save(); ov.remove(); render(); };
    const ov = openSheet('Programme', [field('Name', title), field('First training day on', start),
      logged ? h('p', { class: 'sub' }, 'Already started: the first day cannot be moved, so what you logged stays on its days.') : null,
      h('p', { class: 'sub' }, `${p.weeks.length} weeks · until ${fmtDate(C.dateOf(p, p.weeks.length - 1, 6))}. Days are edited from the calendar.`),
      btn('Save', () => { p.title = title.value.trim().slice(0, 80) || p.title; if (!logged && C.validISO(start.value)) { p.startDate = C.startForFirst(p, start.value); if (p.shownFrom && p.startDate >= p.shownFrom) delete p.shownFrom; } done(); }, 'pri block'),
      h('div', { class: 'btns' }, btn('Export .yaml', () => exportSheet('Export programme', p.title.replace(/[^\w+-]+/g, '_') + '.yaml', C.exportYaml(p, S.exercises)), 'sm'),
        btn('Delete programme', async () => {
          // Le giornate già registrate restano nel calendario (come giornate singole): eliminare un programma non toglie mai nulla di fatto
          const n = S.logs.filter(l => { const x = C.sessionDates({ plans: [p] }, true).get(l.sid); return x && x.date === l.date; }).length;
          const msg = n ? `Delete "${p.title}"? ${n > 1 ? `The ${n} days you already logged stay` : 'The day you already logged stays'} in the calendar with everything you logged; the other days are removed.` : `Delete "${p.title}"? Its days are removed from the calendar.`;
          if (await confirmDlg(msg, 'Delete')) { const kept = C.deletePlan(S, p); done(); if (kept) toast(`Programme deleted. ${kept} logged day${kept > 1 ? 's' : ''} kept.`); }
        }, 'sm danger'))]);
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
  /** Backup scelto: di default si aggiungono solo le registrazioni e i test che mancano (niente viene sostituito);
      sostituire tutto è una scelta esplicita e separata. */
  function backupSheet(obj) {
    const b = migrate(JSON.parse(JSON.stringify(obj)));
    const ids = new Set(S.logs.map(l => l.id)), miss = b.logs.filter(l => !ids.has(l.id)), dates = [...new Set(miss.map(l => l.date))].sort();
    const ov = openSheet('Backup file', [
      h('p', { class: 'sub' }, miss.length ? `It has ${miss.length} logged day${miss.length > 1 ? 's' : ''} that ${miss.length > 1 ? 'are' : 'is'} not in the app (${dates.slice(-3).map(fmtDate).join(', ')}${dates.length > 3 ? '…' : ''}).` : 'Everything logged in this backup is already in the app.'),
      btn('Add what is missing', () => {
        const r = C.mergeLogs(S, b); save(); ov.remove(); render();
        toast(r.logs || r.tests ? `Added ${r.logs} logged day${r.logs === 1 ? '' : 's'} and ${r.tests} test${r.tests === 1 ? '' : 's'}.` : 'Nothing to add.'); log('import', 'backup merged ' + JSON.stringify(r));
      }, 'pri block'),
      h('p', { class: 'sub' }, 'Adds logged exercises and tests that are missing, and puts them back on their days. Nothing in the app is replaced or deleted.'),
      btn('Replace all data with the backup', async () => {
        if (!await confirmDlg('Replace ALL current data with this backup? Anything done after the backup is lost.', 'Replace')) return;
        S = b; calSel = calMonth = null; save(); ov.remove(); render(); toast('Backup restored.'); log('import', 'backup restored');
      }, 'danger block')]);
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
    if (obj && C.validState(obj)) { backupSheet(obj); return; }
    const r = C.importYaml(text, { surfaces: S.surfaces, testDefs: S.testDefs }); // lancia con tutti gli errori: lo stato non viene toccato
    const title = h('input', { value: r.plan.title }), start = h('input', { type: 'date', value: r.firstSession || C.todayISO() });
    const ov = openSheet('Import programme', [h('p', { class: 'sub' }, `${r.plan.weeks.length} weeks. Choose when it starts: its days appear in the calendar.`),
      field('Name', title), field('First training day on', start),
      h('p', { class: 'sub' }, 'The other days keep their order and the gaps between them.'),
      btn('Import', () => {
        const iso = C.validISO(start.value);
        if (!iso) return toast('Pick a valid date.');
        const today = C.todayISO();
        r.plan.title = title.value.trim().slice(0, 80) || r.plan.title; r.plan.startDate = C.startForFirst(r.plan, iso);
        // Il passato del nuovo programma non compare: non conta come saltato (scelta di Leo, 22 nov)
        if (r.plan.startDate < today) r.plan.shownFrom = today;
        const commit = how => {
          for (const e of r.exercises) S.exercises[e.id] = e; // già un'istanza per ogni esercizio di ogni sessione
          ensureTests(S);
          S.plans.push(r.plan);
          // giornate tenute da un programma eliminato: se il nuovo ha la stessa giornata, le registrazioni tornano lì
          const relinked = C.relinkLogs(S);
          // una giornata già registrata rimasta da un programma eliminato (esercizi diversi): il nuovo parte dal giorno dopo, niente doppioni
          const keptDays = S.extras.filter(x => x.kept && x.date >= C.planShownStart(r.plan) && x.date <= C.planEnd(r.plan)).map(x => x.date).sort();
          if (keptDays.length) r.plan.shownFrom = C.addDays(keptDays[keptDays.length - 1], 1);
          save(); ov.remove();
          if (relinked) log('import', 'logs moved to the imported days', relinked);
          toast(`Imported ${r.plan.title}.`); log('import', 'programme imported', { title: r.plan.title, weeks: r.plan.weeks.length, exercises: r.exercises.length, overlap: how || 'none' });
          go('calendar-' + (r.plan.shownFrom && r.plan.shownFrom > C.firstSessionDate(r.plan) ? r.plan.shownFrom : C.firstSessionDate(r.plan)));
        };
        const over = C.overlapping(S.plans, r.plan, today);
        if (!over.length) return commit();
        ov.remove(); overlapSheet(r.plan, over, today, commit);
      }, 'pri block')]);
  }
  /** Il nuovo programma si sovrappone a uno già presente: sostituirne i giorni rimasti o partire dopo la sua fine.
      In nessun caso si toccano registrazioni, test o giorni passati. */
  /** Il programma importato ha giorni in comune con uno già nel calendario: due scelte chiare, con le date
      (nota di Leo del 24 nov: la domanda era ambigua). Le registrazioni non si toccano mai. */
  function overlapSheet(plan, over, today, commit) {
    const q = t => `“${t}”`, one = over.length === 1;
    const span = p => `${fmtDate(C.planShownStart(p) > C.firstSessionDate(p) ? C.planShownStart(p) : C.firstSessionDate(p))} – ${fmtDate(C.lastSession(p) || C.planEnd(p))}`;
    // Un giorno di oggi già iniziato (qualcosa registrato) resta al programma vecchio
    const sids = new Set(over.flatMap(p => p.weeks.flatMap(w => w.flatMap(d => d.sessions.map(x => x.id)))));
    const startedToday = S.logs.some(l => l.date === today && sids.has(l.sid));
    const from = startedToday ? C.addDays(today, 1) : today;
    const lastEnd = over.map(p => C.lastSession(p) || C.planEnd(p)).sort().pop(), after = C.addDays(lastEnd, 1);
    const ov = openSheet('Programmes overlap', [
      h('p', {}, `You are importing ${q(plan.title)}. ${one ? 'The current programme' : 'The current programmes'} ${over.map(p => `${q(p.title)} (${span(p)})`).join(' and ')} ${one ? 'is' : 'are'} already in the calendar on some of the same days. Which one do you want to follow?`),
      btn(`Use the new one from ${fmtDate(from)}`, () => {
        for (const p of over) p.shownUntil = C.addDays(from, -1);
        if (plan.startDate < from) plan.shownFrom = from;
        ov.remove(); commit('replace');
      }, 'pri block'),
      h('p', { class: 'sub' }, `The current ${one ? 'one stops' : 'ones stop'} on ${fmtDate(C.addDays(from, -1))}${startedToday ? ' (today stays as you logged it)' : ''}; from ${fmtDate(from)} the calendar shows the new one.`),
      btn(`Keep the current one, start the new one on ${fmtDate(after)}`, () => {
        // la prima giornata del nuovo cade il giorno dopo la fine dell'ultimo programma sovrapposto; se ne tocca un altro, si sposta ancora
        let d = after;
        delete plan.shownFrom;
        for (let i = 0; i < 20; i++) {
          plan.startDate = C.startForFirst(plan, d);
          const more = C.overlapping(S.plans, plan, today);
          if (!more.length) break;
          d = C.addDays(more.map(p => C.lastSession(p) || C.planEnd(p)).sort().pop(), 1);
        }
        ov.remove(); commit('after');
      }, 'block'),
      h('p', { class: 'sub' }, `The current ${one ? 'one stays' : 'ones stay'} as ${one ? 'it is' : 'they are'}; the new one begins the day after ${one ? 'its' : 'their'} last session.`),
      h('p', { class: 'sub' }, 'Whatever you choose, what you already logged is never changed or deleted.'),
      btn('Don\'t import', () => ov.remove(), 'block')]);
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
      h('div', { class: 'btns' }, btn('Copy', () => { ov.remove(); copyToDateSheet(r); }, 'sm'),
        btn('Clear the day', async () => {
          if (!await confirmDlg('Remove all exercises from this day? Logged exercises stay.', 'Remove')) return;
          s.blocks = []; save(); ov.remove(); render();
        }, 'sm danger'))]);
  }
  /** Parametri di un esercizio in questa sessione. Valgono solo qui: gli esercizi di base non hanno descrizioni né valori fissi. */
  function blockSheet(r, bi) {
    const s = sessOf(r), b = s.blocks[bi], e = S.exercises[b.exId];
    const close = () => { save(); ov.remove(); render(); };
    const dl = dayLog(r), logged = dl ? dl.blocks.find(x => x.bid === b.id) : null;
    if (!e) { const ov0 = openSheet('Exercise removed', btn('Remove from the day', () => { s.blocks.splice(bi, 1); save(); ov0.remove(); render(); }, 'danger block')); return; }
    const iv = e.interval || {}, ld = e.load || {}, isStd = !!(e.std && e.std !== 'test' && C.STD[e.std]);
    const name = h('input', { value: e.name }), min = numInp(b.minutes), note = h('input', { value: b.note || '', placeholder: 'Optional: also shown in the timer' });
    const sfSel = opts(surfOpts().concat([['+new', '＋ Add new…']]), e.surface || '', { onchange: () => sync() }), sfNew = h('input', { placeholder: 'E.g. Spray wall' });
    const sfNewField = field('Name of the new surface', sfNew);
    const mode = opts([['none', 'Duration only'], ['timed', 'Timed (countdown)'], ['reps', 'Reps (tap "Done")']], !e.interval ? 'none' : iv.selfPaced ? 'reps' : 'timed', { onchange: () => sync() });
    const rounds = numInp(iv.rounds || 3), work = numInp(iv.workSeconds || 7), rest = numInp(iv.restSeconds == null ? 180 : iv.restSeconds);
    const reps = numInp(iv.reps), perSet = numInp(iv.roundsPerSet), setRest = numInp(iv.setRestSeconds);
    const sides = h('input', { type: 'checkbox', checked: C.isSided(iv) || (iv.cues || []).length > 0 }), sw = numInp(C.switchOf(iv));
    const pairs = pairsPresent();
    const refs = [['', 'None']].concat(S.testDefs.filter(t => t.key !== 'bw' && !inPair(t.key, pairs)).map(t => [t.key, t.name]), pairs.map(k => [k, C.PAIRS[k] + ' (L/R alternating)']));
    const ref = opts(refs, ld.ref || ''), pct = numInp(ld.pct);
    const isFingers = exSection(e) === 'fingers', gp = e.grip || {};
    const grip = opts([['', '—']].concat(Object.entries(C.GRIPS)), gp.type || ''), edge = numInp(gp.edge, { placeholder: 'mm' }), hands = opts([['', '—'], ['2', 'Two'], ['1', 'One']], gp.hands ? String(gp.hands) : '');
    const workF = field('Work (s)', work), repsF = field('Reps', reps);
    // Con L/R un round è una serie completa L + R: cambio lato breve tra i due, il recupero dopo R
    const perSetBox = h('div', { class: 'cols' }, field('Rounds per set (optional)', perSet), field('Rest between sets (s)', setRest)), swF = field('Switch side (s)', sw);
    const timer = h('div', {}, h('div', { class: 'cols3' }, field('Round', rounds), workF, repsF, field('Rest (s)', rest)), perSetBox,
      h('label', { class: 'f' }, 'Sides', h('div', { style: 'margin-top:8px;color:var(--tx)' }, sides, ' Alternate L/R (each round = L + R, rest after both sides)')), swF);
    // Minuti: con un timer si calcolano dai parametri (sola lettura); a mano solo per "Duration only".
    const minF = field('Minutes', min), durLine = h('p', { class: 'sub' });
    const draft = () => C.normInterval({ rounds: Math.max(1, val(rounds) || 1), workSeconds: mode.value === 'timed' ? val(work) || 0 : 45, restSeconds: val(rest) || 0, selfPaced: mode.value === 'reps',
      reps: mode.value === 'reps' ? val(reps) || 0 : 0, roundsPerSet: sides.checked ? 0 : val(perSet) || 0, setRestSeconds: sides.checked ? 0 : val(setRest) || 0, cues: sides.checked ? ['L', 'R'] : [],
      sides: sides.checked ? 2 : 0, switchSeconds: val(sw) == null ? C.SWITCH_DEFAULT : val(sw) });
    const showDur = () => { if (mode.value !== 'none') durLine.textContent = `Duration: ${C.intervalMinutes(draft())} min, calculated from the timer` + (mode.value === 'reps' ? ' (about 45 s per round)' : '') + '.'; };
    for (const x of [rounds, work, rest, reps, perSet, setRest, sw]) x.addEventListener('input', showDur);
    sides.addEventListener('change', () => { sync(); });
    const sync = () => { minF.hidden = mode.value !== 'none'; durLine.hidden = mode.value === 'none'; showDur(); timer.hidden = mode.value === 'none'; workF.hidden = mode.value !== 'timed'; repsF.hidden = mode.value !== 'reps'; sfNewField.hidden = sfSel.value !== '+new'; swF.hidden = !sides.checked; perSetBox.hidden = sides.checked; };
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
      // Già registrato: si modifica o si cancella la registrazione, l'esercizio resta nella giornata
      logged ? [btn('Edit log', () => { ov.remove(); editRecord(r, b, logged); }, 'block'), btn('Delete log', () => { ov.remove(); deleteRecord(dayLog(r), logged); }, 'danger block')]
        : dayOf(r) <= C.todayISO() ? btn('Log without timer', () => { ov.remove(); recordSheet(r, b, (b.minutes || 0) * 60000, e.interval && e.interval.rounds ? { done: e.interval.rounds, of: e.interval.rounds } : null); }, 'block') : null,
      h('div', { class: 'btns' }, btn('Replace', () => pickExercise(tpl => { s.blocks.splice(bi, 1); addBlock(s, tpl); s.blocks.splice(bi, 0, s.blocks.pop()); close(); }), 'sm'),
        // spostare: solo se non è registrato (la registrazione è legata a questo giorno)
        logged ? null : btn('Move to…', () => { ov.remove(); moveSheet(r, bi); }, 'sm'),
        btn('Remove', () => { s.blocks.splice(bi, 1); close(); }, 'sm danger'))]);
    sync();
  }

  /* ---------- Esercizi: libreria standard + esercizi propri (solo nome e sezione; i parametri si impostano nella sessione) ---------- */
  /** Barretta colorata della categoria. Il colore aiuta a leggere la giornata; il nome della categoria è nell'etichetta accessibile e nella libreria. */
  /** Categorie di un giorno per il calendario: minuti previsti per categoria e se qualcosa è stato registrato.
      Le registrazioni senza esercizio previsto quel giorno (sessione fatta altrove, programma eliminato) contano come fatte. */
  function dayCategories(iso, refs) {
    const m = new Map(), add = (sec, min, done) => { const c = m.get(sec) || { sec, min: 0, done: false }; c.min += min || 0; c.done = c.done || done; m.set(sec, c); };
    const seen = new Set();
    for (const r of refs) {
      const s = sessOf(r), l = dayLog(r), logged = new Set(l ? l.blocks.map(x => x.bid) : []);
      for (const b of s.blocks) { add(exSection(S.exercises[b.exId]), b.minutes, logged.has(b.id)); seen.add(b.id); }
    }
    for (const l of S.logs) if (l.date === iso) for (const x of l.blocks || []) if (!x.bid || !seen.has(x.bid)) add(C.SECTIONS[x.sec] ? x.sec : 'other', x.minutes, true);
    return [...m.values()].sort((a, b) => b.min - a.min);
  }
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
      const sf = opts(surfOpts(), c.surface || ''), gr = opts(gradeOpts(isRoute(c.surface)), c.top || ''), sends = numInp(c.sends), min = numInp(c.minutes), sentF = field('Problems sent', sends);
      linkGrade(sf, gr, sentF);
      items.push({ c, sf, gr, sends, min });
      box.append(h('div', { class: 'climb' }, c.name ? h('div', { class: 'n' }, c.name) : null,
        h('div', { class: 'cols' }, field('Surface', sf), field('Top grade sent', gr)), h('div', { class: 'cols' }, sentF, field('Minutes', min))));
    };
    rows.forEach(add);
    return { node: h('div', {}, box, btn('+ Surface', () => add({ minutes: items.length ? null : defaultMinutes() }), 'sm')),
      read: () => items.filter(i => i.sf.value).map(i => ({ name: i.c.name || '', surface: i.sf.value, top: i.gr.value || null,
        sends: val(i.sends) == null ? null : Math.max(0, Math.round(val(i.sends))), minutes: Math.max(0, Math.round(val(i.min) || 0)) })) };
  }
  /** Minuti previsti in proporzione alle serie fatte (tutti se le serie non si contano); almeno 1 se qualcosa è stato fatto. */
  function plannedShare(min, sets) {
    if (!(min > 0)) return 0;
    if (!sets || !sets.of) return min;
    return sets.done > 0 ? Math.max(1, Math.round(min * sets.done / sets.of)) : 0;
  }
  /** Minuti mancanti (0 o assenti) degli esercizi registrati: si usano quelli previsti. true se ha cambiato qualcosa. */
  function fillMinutes(l, planned) {
    let changed = false;
    for (const x of l.blocks) if (!(x.minutes > 0) && x.bid && plannedShare(planned.get(x.bid), x.sets) > 0) { x.minutes = plannedShare(planned.get(x.bid), x.sets); if (x.climb) x.climb.minutes = x.minutes; changed = true; }
    return changed;
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
      const route = isRoute(g.surface), list = C.gradeList(route); // ogni superficie nella sua scala: lead in francese, separata dal boulder
      const chFrom = C.addDays(t, -7 * 11), tg = C.weeklyTopGrades(S.logs, P > 77 ? from : chFrom, t), vals = tg.series[g.surface] || [];
      const all = vals.filter(v => v != null), lo = Math.max(0, Math.min(...all, g.top ?? 99) - 1), hi = Math.min(list.length - 1, Math.max(...all, g.top ?? 0) + 1), step = Math.max(1, Math.ceil((hi - lo) / 4));
      const domain = { min: lo, max: lo + step * Math.ceil((hi - lo) / step), step }, fmtGr = v => (list[Math.round(v)] ? fmtG(list[Math.round(v)]) : '');
      prog.push(h('div', { class: 'prog-r', onclick: () => all.length ? openSheet(surfName(g.surface), [h('p', { class: 'sub' }, 'Top grade sent each week.'),
        Charts.line({ labels: tg.weeks.map(fmtDate), values: vals, name: 'Top grade', domain, fmt: fmtGr, aria: `Top grade sent per week on ${surfName(g.surface)}` })]) : null },
        h('div', { class: 'grow' }, h('div', { class: 'n' }, catBar(route ? 'endurance' : 'strength'), surfName(g.surface)), h('div', { class: 'sub' }, route ? 'Top route grade (lead)' : 'Top grade sent')),
        h('div', {}, h('div', { class: 'v' }, g.top == null ? '—' : fmtG(list[g.top])), g.top != null && g.prev != null ? deltaTag(g.top - g.prev, n => n + (n === 1 ? ' grade' : ' grades')) : null)));
    }
    out.push(h('div', { class: 'card' }, h('div', { class: 'ct' }, 'Progress'), h('div', { class: 'sub' }, `Latest value and change since ${fmtDate(from)}. Tap for the trend.`),
      prog.length ? prog : h('p', { class: 'sub' }, 'Add test results (Tests and maxes) or log grades on climbing exercises to see them here.')));

    // (il riquadro Consistency è stato tolto su richiesta di Leo, 26 nov)
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
      S.testDefs.filter(def => def.key !== 'bw').map(def => { // il peso corporeo sta nel profilo
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
    try { audioInit(); SOUND.setEnd(); add('Sound signals', ac && ac.state === 'running' ? true : null, ac && ac.state === 'running' ? `a signal was just played (${AUDIO_MODES.find(m => m[0] === audioMode())[1].toLowerCase()})` + (audioMode() === 'mix' ? ': if you did not hear it, the phone may be in silent mode; see Sound test below' : '') : 'audio not started: try again by tapping "Run the checks"'); }
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
      // Prova dei suoni con la musica: si fa partire Spotify, si prova ogni modo e si sceglie quello che funziona
      h('h2', {}, 'Sound test'), h('div', { class: 'card', id: 'sound-test' },
        h('p', { class: 'sub', style: 'margin-top:0' }, 'Start some music (e.g. Spotify), then try each mode: you hear 3 short beeps and a long one, as in the timer. Also try with the phone in silent mode. Choose the one that works for you.'),
        AUDIO_MODES.map(m => h('div', { class: 'blk' }, h('div', { class: 'grow' }, h('div', { class: 'n' }, m[1] + (audioMode() === m[0] ? ' · in use' : '')), h('div', { class: 'p' }, m[2])),
          h('div', { class: 'm', style: 'flex-direction:row;gap:6px' }, btn('▶ Try', () => soundTest(m[0]), 'sm'), audioMode() === m[0] ? null : btn('Use', () => { S.settings.audioMode = m[0]; save(); render(); toast('Sounds: ' + m[1] + '.'); }, 'sm pri'))))),
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

  /** Programmi divisi in corso, futuri e passati secondo la parte visibile nel calendario. */
  function planGroups() {
    const t = C.todayISO(), now = [], next = [], past = [];
    // finito = l'ultima giornata con allenamento è prima di oggi (o non ne resta nessuna visibile)
    const end = p => C.lastSession(p) || '';
    for (const p of S.plans) (end(p) < t ? past : C.planShownStart(p) > t ? next : now).push(p);
    const by = (a, b) => C.planShownStart(a).localeCompare(C.planShownStart(b));
    return { now: now.sort(by), next: next.sort(by), past: past.sort((a, b) => end(b).localeCompare(end(a))) };
  }
  function viewPrograms() {
    const g = planGroups(), yr = C.todayISO().slice(0, 4), fmtY = iso => fmtDate(iso) + (iso.slice(0, 4) === yr ? '' : ' ' + iso.slice(0, 4));
    const row = (p, tag, cls) => h('div', { class: 'blk', style: 'cursor:pointer', onclick: () => planSheet(p) }, h('div', { class: 'grow' }, h('div', { class: 'n' }, p.title),
      h('div', { class: 'p' }, `${fmtY(C.firstSessionDate(p) > C.planShownStart(p) ? C.firstSessionDate(p) : C.planShownStart(p))} – ${fmtY(C.lastSession(p) || C.planEnd(p))} · ${p.weeks.length} weeks` + (p.shownFrom > p.startDate || p.shownUntil ? ' · partly shown' : ''))),
      h('span', { class: 'tag ' + cls }, tag));
    // l'anno solo quando non è quello corrente: programmi passati e futuri non si confondono
    const sec = (title, list, tag, cls) => list.length ? [h('h2', {}, title), h('div', { class: 'card' }, list.map(p => row(p, tag, cls)))] : null;
    return [h('div', { class: 'row' }, btn('‹ More', () => go('more'), 'sm')), h('h1', {}, 'Programmes'),
      h('p', { class: 'sub' }, 'A programme is a set of training days: import it, choose when it starts and find it in the calendar. Deleting one keeps what you logged.'),
      h('div', { class: 'btns' }, fileBtn('Import programme (.yaml)')),
      sec('In progress', g.now, 'In progress', 'ts-confirmed'), sec('Upcoming', g.next, 'Upcoming', 'ts-idea'), sec('Past', g.past, 'Past', 'ts-done'),
      !S.plans.length ? h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin:0' }, 'No programmes yet.')) : null];
  }
  /** Dati fisici attuali: peso = ultimo valore del test "bw" (con la data), altezza e ape index dal profilo. */
  function profileNow() {
    const w = S.tests.filter(t => t.key === 'bw').sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
    return { weight: w ? w.value : null, weightDate: w ? w.date : null, height: S.profile.height, ape: S.profile.ape };
  }
  /** More → Profile: peso corporeo (usato per i kg delle sospensioni, con lo storico), altezza e ape index (informativi). */
  function viewProfile() {
    const p = profileNow(), weight = numInp(p.weight, { placeholder: 'kg' }), height = numInp(p.height, { placeholder: 'cm' }), ape = numInp(p.ape, { placeholder: 'cm, e.g. +4 or -2' });
    const hist = S.tests.filter(t => t.key === 'bw').sort((a, b) => (a.date < b.date ? 1 : -1));
    const saveP = () => {
      const w = val(weight), hh = val(height), a = val(ape);
      if (w != null && !(w > 20 && w < 300)) return toast('Body weight: a number in kg, e.g. 70.');
      if (hh != null && !(hh > 80 && hh < 260)) return toast('Height: a number in cm, e.g. 178.');
      if (a != null && !(Math.abs(a) <= 40)) return toast('Ape index: arm span minus height, in cm (e.g. +4).');
      if (w != null && w !== p.weight) {
        // un valore al giorno: oggi si aggiorna, altrimenti si aggiunge allo storico
        const t = C.todayISO(), cur = S.tests.find(x => x.key === 'bw' && x.date === t);
        if (cur) cur.value = w; else S.tests.push({ id: C.uid(), key: 'bw', date: t, value: w });
        if (!S.testDefs.some(d => d.key === 'bw')) S.testDefs.unshift({ ...C.TEST_TEMPLATES.find(d => d.key === 'bw') });
      }
      S.profile.height = hh; S.profile.ape = a;
      save(); render(); toast('Saved.');
    };
    return [h('div', { class: 'row' }, btn('‹ More', () => go('more'), 'sm')), h('h1', {}, 'Profile'),
      h('div', { class: 'card' },
        field('Body weight (kg)', weight),
        h('p', { class: 'sub', style: 'margin-top:-4px' }, p.weight != null ? `Last value on ${fmtDate(p.weightDate)}. Used to compute the kg of hangs.` : 'Used to compute the kg of hangs: without it they cannot be calculated.'),
        h('div', { class: 'cols' }, field('Height (cm)', height), field('Ape index (cm)', h('div', { class: 'kg-in' }, ape, h('button', { type: 'button', class: 'btn sm kg-sign', 'aria-label': 'Change sign', onclick: () => { const v = val(ape); ape.value = v == null ? '-' : dec(-v); } }, '±')))),
        h('p', { class: 'sub' }, 'Ape index = arm span minus height. Height and ape index are for your reference only.'),
        btn('Save', saveP, 'pri block')),
      hist.length ? [h('h2', {}, 'Body weight history'), h('div', { class: 'card' }, hist.slice(0, 12).map(t => h('div', { class: 'blk' }, h('div', { class: 'grow' }, `${fmtDate(t.date)} ${t.date.slice(0, 4)}`), h('div', { class: 'n' }, dec(t.value) + ' kg'),
        btn('✕', async () => { if (await confirmDlg(`Delete ${dec(t.value)} kg of ${fmtDate(t.date)}?`, 'Delete')) { S.tests = S.tests.filter(x => x !== t); save(); render(); } }, 'sm'))))] : null];
  }
  function viewMore() {
    const prep = numInp(S.settings.prep), sound = h('input', { type: 'checkbox', checked: S.settings.sound, onchange: () => { S.settings.sound = sound.checked; save(); } });
    const audioSel = opts(AUDIO_MODES.map(m => [m[0], m[1]]), audioMode(), { onchange: () => { S.settings.audioMode = audioSel.value; save(); audioHelp.textContent = audioHelpText(); } });
    const audioHelpText = () => AUDIO_MODES.find(m => m[0] === audioMode())[2] + ' Try them in Diagnostics → Sound test.';
    const audioHelp = h('p', { class: 'sub' }, audioHelpText());
    const sfNew = h('input', { class: 'inp', style: 'margin:0', placeholder: 'New surface' });
    const pr = profileNow();
    return [h('h1', {}, 'More'),
      h('div', { class: 'card tap row', id: 'more-profile', onclick: () => go('profile') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Profile'),
        h('div', { class: 'sub' }, [pr.weight != null ? dec(pr.weight) + ' kg' : 'Body weight missing', pr.height != null ? pr.height + ' cm' : '', pr.ape != null ? 'ape index ' + (pr.ape > 0 ? '+' : '') + pr.ape + ' cm' : ''].filter(Boolean).join(' · '))), h('span', { class: 'sub' }, '›')),
      // Strumento della prova d'uso (prima stava nella barra): sparirà nella versione definitiva
      h('div', { class: 'card tap row', id: 'more-note', onclick: noteSheet }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Note'), h('div', { class: 'sub' }, 'Write down what is wrong while you use the app')), '+'),
      h('div', { class: 'card tap row', onclick: () => { location.hash = 'library'; } }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Exercise library'), h('div', { class: 'sub' }, (C.LIBRARY.length + S.custom.length) + ' exercises')), '›'),
      h('div', { class: 'card tap row', onclick: () => go('notebook') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Notebook'), h('div', { class: 'sub' }, S.notes.length ? `${S.notes.length} notes` : 'No notes yet')), '›'),
      h('div', { class: 'card tap row', onclick: () => go('diagnostics') }, h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Diagnostics'), h('div', { class: 'sub' }, 'Audio, screen on, offline and storage on this device · v' + VERSION)), '›'),
      // Programmi: in More solo la voce, la lista (in corso, futuri, passati) sta nella sua pagina
      (() => { const g = planGroups(); return h('div', { class: 'card tap row', id: 'more-programmes', onclick: () => go('programmes') },
        h('div', { class: 'grow' }, h('div', { class: 'n', style: 'font-weight:600' }, 'Programmes'),
          h('div', { class: 'sub' }, S.plans.length ? [g.now.length ? g.now.length + ' in progress' : '', g.next.length ? g.next.length + ' upcoming' : '', g.past.length ? g.past.length + ' past' : ''].filter(Boolean).join(' · ') : 'Import a programme')), '›'); })(),
      h('h2', {}, 'Climbing surfaces'), h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-top:0' }, 'Assigned to exercises and logged exercises, to compare progress in the charts. Tap to rename.'),
        h('div', { class: 'btns', style: 'margin-top:0' }, S.surfaces.map(x => btn(x.name, () => surfaceSheet(x), 'sm'))),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, sfNew), btn('Add', () => { const n = sfNew.value.trim().slice(0, 40); if (!n) return toast('Type a name.'); addSurface(n); save(); render(); }, 'sm')),
        h('p', { class: 'sub', style: 'margin-bottom:0' }, `Grade scale: ${C.GRADE_SCALES[S.settings.gradeScale] || 'Font'}. Other scales will be selectable here.`)),
      h('h2', {}, 'Timer'), h('div', { class: 'card' }, h('div', { class: 'cols' }, field('Get-ready time before a hang (s)', prep), h('label', { class: 'f' }, 'Sound signals', h('div', { style: 'margin-top:12px' }, sound, ' on'))),
        field('Sounds with music', audioSel), audioHelp,
        btn('Save', () => { S.settings.prep = Math.min(60, Math.max(0, Math.round(val(prep) || 0))); save(); toast('Saved.'); }, 'sm')),
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
  const prjGrade = p => (p.grade ? (p.style === 'route' ? (C.ROUTE_GRADES.includes(p.grade) ? p.grade : fmtG(p.grade).toLowerCase()) : fmtG(p.grade)) : '');
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
      g.ideas.length ? [h('h2', {}, 'Ideas'), g.ideas.map(t => tripCard(t))] : null,
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
        const x = t || { id: C.uid(), projects: [], since: C.todayISO() };
        // L'anello del countdown parte dal giorno in cui il viaggio entra in Home (Idea o Confirmed); confermare un'idea non lo azzera
        const inHome = k => k === 'idea' || k === 'confirmed';
        if (inHome(st.value) && (!t || !inHome(t.status))) x.since = C.todayISO();
        Object.assign(x, { name: n.slice(0, 80), place: place.value.trim().slice(0, 80), status: st.value, from: d.from, to: d.from ? d.to : '', notes: notes.value.trim().slice(0, 4000) });
        if (!t) S.trips.push(x);
        save(); ov.remove(); log('trips', t ? 'edited' : 'added', { name: x.name });
        if (t) render(); else go('trip-' + x.id);
      }, 'pri block'),
      t ? btn('Delete trip', async () => {
        if (!await confirmDlg(`Delete "${t.name}" with its ${t.projects.length} projects? This cannot be undone.`, 'Delete')) return;
        S.trips = S.trips.filter(x => x !== t); save(); ov.remove(); log('trips', 'deleted', { name: t.name }); go('trips');
      }, 'danger block') : null]);
  }
  function projectSheet(t, p) {
    const name = h('input', { class: 'inp', value: p ? p.name : '', placeholder: 'e.g. Karma' });
    const grade = opts(gradeOpts(p && p.style === 'route'), p ? p.grade : ''), style = opts(C.STYLES, p ? p.style : 'boulder');
    // Le vie in scala francese, i blocchi in Font
    style.addEventListener('change', () => { const route = style.value === 'route', keep = grade.value; grade.replaceChildren(...gradeOpts(route).map(([v, t]) => h('option', { value: v }, t))); grade.value = C.gradeList(route).includes(keep) ? keep : ''; });
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
        h('div', { class: 'btns' }, btn('+ Project', () => projectSheet(t, null), 'sm pri')))];
  }

  /* ---------- Player ---------- */
  let P = null, ac = null, wl = null;
  /* Suoni. Audio Session API (Safari 17+). Tre modi (More → Timer → "Sounds with music", provabili in Diagnostics):
     - "mix": tipo "transient" sempre: i segnali si mescolano alla musica senza fermarla; su iPhone seguono
       l'interruttore silenzioso (in modalità silenziosa sono muti anche col volume alto).
     - "duck": "ambient" quando tace, "playback" solo mentre suonano i segnali, poi di nuovo "ambient": suonano anche in
       modalità silenziosa; la musica si interrompe durante il segnale e riparte se l'app di musica lo consente.
     - "solo": "playback" sempre: suonano anche in silenzioso, la musica resta ferma finché il timer è aperto.
     Il contesto audio si crea e si sblocca solo dentro un tocco dell'utente, con un suono muto; a fine esercizio si sospende. */
  const audioMode = () => (['mix', 'duck', 'solo'].includes(S.settings.audioMode) ? S.settings.audioMode : 'duck');
  const setSession = t => { try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch (e) { /* API non disponibile */ } };
  const idleType = () => ({ mix: 'transient', duck: 'ambient', solo: 'playback' }[audioMode()]);
  let holdUntil = 0, holdTimer = null;
  /** Modo "duck": sessione "playback" solo per la durata dei segnali (+ un margine), poi si torna ad "ambient". */
  function holdAudio(sec) {
    if (audioMode() !== 'duck') return;
    setSession('playback');
    holdUntil = Math.max(holdUntil, Date.now() + sec * 1000 + 1500); // margine: i bip del conto alla rovescia (uno al secondo) restano in un'unica interruzione
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function rel() { if (Date.now() < holdUntil) { holdTimer = setTimeout(rel, holdUntil - Date.now()); return; } setSession('ambient'); }, holdUntil - Date.now());
  }
  function audioInit() {
    setSession(idleType());
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination); src.start(0);
      }
      if (ac.state !== 'running') ac.resume();
    } catch (e) { ac = null; }
  }
  const AUDIO_MODES = [
    ['duck', 'Interrupt the music briefly', 'Signals are always heard when the volume is up, also in silent mode; the music stops while a signal plays and restarts after it, if the music app allows it.'],
    ['mix', 'Play over the music', 'Signals play over Spotify without stopping it. On iPhone they are muted in silent mode, even with the volume up.'],
    ['solo', 'Pause the music', 'Signals are heard even in silent mode; music from other apps stays paused while the timer runs.']];
  /** Diagnostics → Sound test: prova un modo con un conto alla rovescia (3 bip + suono lungo), come nel timer. */
  function soundTest(mode) {
    const was = S.settings.audioMode, wasSound = S.settings.sound;
    S.settings.audioMode = mode; S.settings.sound = true;
    audioInit();
    [0, 1, 2].forEach(i => setTimeout(() => SOUND.count(), i * 1000)); setTimeout(() => SOUND.setEnd(), 3000);
    setTimeout(() => { S.settings.audioMode = was; S.settings.sound = wasSound; if (!P) audioRelease(); }, 4200);
  }
  /** Timer chiuso: dopo l'ultimo segnale si sospende l'audio, così l'app non trattiene l'uscita audio del telefono. */
  function audioRelease() {
    setTimeout(() => { if (P || !ac) return; try { ac.suspend(); } catch (e) { /* già sospeso */ } if (audioMode() !== 'mix') setSession('ambient'); }, 2500);
  }
  function beep(freq, dur, at = 0) {
    if (!S.settings.sound || !ac) return;
    try {
      holdAudio(at + dur);
      if (ac.state !== 'running') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at + (audioMode() === 'duck' ? 0.08 : 0); // "duck": un attimo per attivare la sessione
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
    P.rows = buildRows(b, steps);
    $('player').classList.toggle('tbl', !!P.rows);
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
        if (st.kind === 'work') { P.completed = (P.completed || 0) + 1; rowDone(st); } // serie arrivata in fondo, non saltata
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
    // A ripetizioni (o blocchi) niente tempo che scorre: si mostra cosa fare, il timer parte solo col recupero dopo "Done" (nota del 23 nov)
    // Tre tipi come Lattice: a ripetizioni il numero da fare, a blocchi il blocco corrente, a tempo il tempo che scende
    const self = st.kind === 'work' && st.selfPaced;
    $('p-clock').classList.toggle('reps', self);
    $('p-clock').textContent = self ? String(st.reps || st.round) : mmss(Math.ceil(rem));
    $('p-unit').textContent = self ? (st.reps ? (st.reps === 1 ? 'rep' : 'reps') : `of ${st.rounds}`) : '';
  }
  function draw() {
    const st = P.steps[P.idx], nx = P.steps[P.idx + 1], ex = S.exercises[st.exId];
    const ph = st.prep ? 'prep' : st.kind;
    $('player').dataset.ph = ph;
    $('p-bar').style.width = (P.idx / P.steps.length * 100) + '%';
    $('p-ph').textContent = st.switch ? 'SWITCH SIDE' : { prep: 'GET READY', work: st.selfPaced ? 'GO' : 'WORK', rest: 'REST', free: 'IN PROGRESS' }[ph];
    $('p-name').textContent = st.name;
    // Alternati L/R: il conteggio è per serie (L + R), non per lato
    $('p-round').textContent = st.kind === 'free' ? (ex && ex.surface ? surfName(ex.surface) : '') : `${ex && C.isSided(ex.interval) ? 'Set' : 'Round'} ${st.round} of ${st.rounds}`;
    // Parametri dell'esercizio (lato, presa, tacca, mani, % del massimale); la nota del giorno sotto, più piccola
    $('p-cue').textContent = [st.cue, C.gripText(ex), ex && ex.load && ex.load.pct != null && !ex.load.test ? ex.load.pct + '% max' : ''].filter(Boolean).join(' · ');
    $('p-note').textContent = P.b.note || '';
    const kg = ex && st.kind !== 'free' ? C.loadKg(ex.load, st.cue, maxes()) : null;
    $('p-kg').textContent = kg == null ? '' : (ex.load.mode === 'hang' ? C.fmtKg(kg) : dec(kg) + ' kg');
    $('p-next').textContent = 'Up next: ' + upNext(nx, ex);
    $('p-done').textContent = isAuto(st) ? 'Skip' : 'Done';
    $('p-done').className = 'btn ' + (isAuto(st) ? 'skip' : 'pri');
    // "End exercise" solo quando serve: se l'ultimo passo si chiude con Done, i due pulsanti farebbero la stessa cosa (nota di Leo del 19 nov)
    $('p-quit').hidden = !nx && !isAuto(st);
    $('p-plus').disabled = st.kind === 'work';
    $('p-pause').textContent = P.paused ? 'Resume' : 'Pause';
    drawClock();
    drawTable();
  }
  /* ---- Tabella sotto il timer (fase B, ispirata a Lattice): si compila durante l'esercizio ----
     Serie: una riga per serie (L/R separate) con reps e kg in più rispetto al peso corporeo, precompilati.
     Arrampicata: una riga per blocco/via con il grado (scala della superficie). Skip e Add; a fine esercizio una conferma breve. */
  const isClimbEx = ex => ex.slot === 'wall' || !!ex.surface;
  /** Ultimi kg registrati per questo esercizio (per lato), per precompilare. */
  function lastKgs(ex) {
    const key = exKey(ex);
    for (const l of [...S.logs].sort((a, b) => (a.date < b.date ? 1 : -1))) for (const x of l.blocks || []) if (x.key === key && (x.kgs || []).length) return x.kgs;
    return [];
  }
  function buildRows(b, steps) {
    const ex = S.exercises[b.exId];
    if (!ex || (ex.load && ex.load.test)) return null; // i test hanno la loro scheda con il risultato
    let n = 0;
    const works = steps.filter(st => st.kind === 'work');
    works.forEach(st => { st.row = n++; });
    if (isClimbEx(ex)) {
      P.surface = ex.surface || ''; // senza superficie niente dati di arrampicata, come nella scheda completa
      return works.map(st => ({ grade: '', done: false, round: st.round }));
    }
    const withLoad = !!(ex.load || ex.slot === 'strength'), hasReps = works.some(st => st.reps);
    if (!withLoad && !hasReps) return null; // stretching, mobilità: basta il timer
    const last = lastKgs(ex), m = maxes();
    const kgFor = side => {
      if (!withLoad) return undefined;
      if (ex.load && ex.load.mode === 'hang' && ex.load.pct != null) { const kg = C.loadKg(ex.load, side || '', m); if (kg != null) return kg; }
      const k = last.find(x => (x.side || null) === side) || last[0];
      return k ? k.kg : 0;
    };
    return works.map(st => { const side = st.cue === 'L' || st.cue === 'R' ? st.cue : null; return { side, plan: st.reps || null, reps: st.reps || null, kg: kgFor(side), done: false, round: st.round }; });
  }
  function rowDone(st) { if (P.rows && st.row != null && P.rows[st.row]) { P.rows[st.row].done = true; P.rows[st.row].skipped = false; } }
  /** Riga corrente: quella del passo di lavoro in corso, o della prossima serie durante il recupero. */
  function currentRow() {
    for (let i = P.idx; i < P.steps.length; i++) if (P.steps[i].row != null) return P.steps[i].row;
    return -1;
  }
  function stepper(value, fmt, onStep, input) {
    return h('div', { class: 'stp' }, h('button', { type: 'button', class: 'stp-b', 'aria-label': 'Decrease', onclick: () => onStep(-1) }, '−'),
      input || h('span', { class: 'stp-v' }, fmt(value)), h('button', { type: 'button', class: 'stp-b', 'aria-label': 'Increase', onclick: () => onStep(1) }, '+'));
  }
  function drawTable() {
    const box = $('p-table');
    if (!P || !P.rows) { box.replaceChildren(); return; }
    const ex = S.exercises[P.steps[0].exId], climb = isClimbEx(ex), cur = currentRow(), route = climb && isRoute(P.surface), list = C.gradeList(route);
    const withKg = !climb && P.rows.some(x => x.kg !== undefined), withReps = !climb && P.rows.some(x => x.plan != null);
    const head = climb
      ? h('div', { class: 'tb-h' }, h('span', {}, route ? 'Route' : 'Climb'), h('span', { class: 'grow' }), opts(surfOpts(), P.surface, { onchange: e => { P.surface = e.target.value; drawTable(); } }))
      : h('div', { class: 'tb-h' }, h('span', {}, 'Set'), withReps ? h('span', { class: 'c-reps' }, 'Reps') : null, withKg ? h('span', { class: 'c-kg' }, 'kg over body weight') : null);
    const rows = P.rows.map((x, i) => {
      const set = (k, v) => { x[k] = v; drawTable(); };
      let cells;
      if (climb) {
        const gi = x.grade ? list.indexOf(x.grade) : -1;
        const start = () => { const prev = [...P.rows].reverse().find(y => y.grade && list.includes(y.grade)); return prev ? list.indexOf(prev.grade) : Math.floor(list.length / 2) - 4; };
        cells = [stepper(x.grade, g => (g ? fmtG(g) : '—'), d => set('grade', list[Math.max(0, Math.min(list.length - 1, gi < 0 ? start() : gi + d))]))];
      } else {
        const kgIn = x.kg === undefined ? null : numInp(x.kg, { class: 'stp-in', 'aria-label': 'kg' });
        if (kgIn) ['input', 'change'].forEach(t => kgIn.addEventListener(t, () => { const v = val(kgIn); x.kg = v == null ? 0 : v; })); // subito: un ridisegno non perde quello che si sta scrivendo
        cells = [x.plan != null ? stepper(x.reps, v => String(v), d => set('reps', Math.max(0, (x.reps || 0) + d))) : null,
          kgIn ? stepper(x.kg, null, d => set('kg', Math.round(((x.kg || 0) + d) * 2) / 2), kgIn) : null];
      }
      return h('div', { class: 'tb-r' + (i === cur ? ' cur' : '') + (x.done ? ' done' : '') + (x.skipped ? ' skip' : ''), role: 'group', 'aria-label': `${climb ? 'Climb' : 'Set'} ${i + 1}${x.done ? ', done' : ''}` },
        h('span', { class: 'tb-n' }, String(x.side && x.round ? x.round : i + 1)), x.side ? h('span', { class: 'tb-side' }, x.side) : null, h('div', { class: 'tb-c' }, cells));
    });
    const skip = () => {
      const c = currentRow(); if (c < 0) return;
      P.rows[c].skipped = true;
      const j = P.steps.findIndex((st, k) => k > P.idx && st.row != null && st.row > c);
      if (j < 0) endBlock(); else enter(j);
    };
    // Aggiungere: per i blocchi una riga già fatta (si compila il grado); per le serie una serie vera in coda al timer
    // (recupero + lavoro, entrambi i lati se l'esercizio è per lato), registrata come le altre
    const add = () => {
      const last = P.rows[P.rows.length - 1];
      if (climb || !last) { P.rows.push(last ? { ...last, done: true, skipped: false, added: true, round: (last.round || 0) + 1 } : { grade: '', done: true, added: true }); drawTable(); return; }
      // Modello: l'ultima serie (per gli alternati L → cambio lato → R), preceduta dal recupero della serie
      const wi = P.steps.map((st, k) => (st.kind === 'work' ? k : -1)).filter(k => k >= 0);
      const lastI = wi[wi.length - 1], lastW = P.steps[lastI], iv = ex.interval || {};
      const sided = C.isSided(iv) && wi.length >= 2 && P.steps[wi[wi.length - 2]].round === lastW.round;
      const from = sided ? wi[wi.length - 2] : lastI, round = lastW.round + 1, rounds = lastW.rounds + 1;
      const before = P.steps[from - 1], restS = before && before.kind === 'rest' && !before.prep && !before.switch ? before.seconds : iv.restSeconds || 60;
      const extra = [{ ...lastW, kind: 'rest', prep: false, switch: false, selfPaced: false, afterBlock: false, row: undefined, reps: null, seconds: restS, cue: P.steps[from].cue, round: lastW.round }];
      for (let k = from; k <= lastI; k++) {
        const st = P.steps[k];
        if (st.kind !== 'work') { extra.push({ ...st, round }); continue; } // il cambio lato tra L e R
        const src = P.rows[st.row] || last, row = P.rows.length;
        P.rows.push({ side: src.side, plan: src.plan, reps: src.plan, kg: src.kg, done: false, round, added: true });
        extra.push({ ...st, round, row });
      }
      P.steps.forEach(st => { st.rounds = rounds; });
      extra.forEach(st => { st.rounds = rounds; });
      // dopo l'ultimo passo di lavoro, mai prima del passo in corso
      const at = Math.max(lastI + 1, P.idx + 1);
      P.steps.splice(at, 0, ...extra);
      draw();
    };
    box.replaceChildren(head, ...rows, h('div', { class: 'tb-f' },
      cur >= 0 ? h('button', { type: 'button', class: 'linkbtn', onclick: skip }, climb ? 'Skip climb' : 'Skip set') : h('span'),
      h('button', { type: 'button', class: 'linkbtn', onclick: add }, climb ? '+ Add climb' : '+ Add set')));
  }
  /** Riga "Up next" (stile Lattice): recupero tra serie o tra ripetizioni, lato, oppure fine dell'esercizio. */
  function upNext(nx, ex) {
    if (!nx) return 'finish the exercise';
    const iv = ex && ex.interval;
    if (nx.kind === 'rest') {
      const dur = nx.seconds >= 60 ? `${Math.floor(nx.seconds / 60)} min${nx.seconds % 60 ? ' ' + nx.seconds % 60 + ' s' : ''}` : nx.seconds + ' s';
      if (nx.prep) return 'get ready';
      if (nx.afterBlock) return `${dur} rest, then the next exercise`;
      if (nx.switch) return `${dur} switch to the right side`;
      const between = iv && iv.roundsPerSet ? (nx.round % iv.roundsPerSet === 0 ? ' between sets' : ' between reps') : iv && (iv.selfPaced || C.isSided(iv)) ? ' between sets' : '';
      return dur + ' rest' + between;
    }
    const side = nx.cue === 'L' ? 'left · ' : nx.cue === 'R' ? 'right · ' : nx.cue ? nx.cue + ' · ' : '';
    const what = nx.selfPaced ? (nx.reps ? `${nx.reps} reps` : `${nx.round} of ${nx.rounds}`) : `${nx.seconds} s work`;
    return side + what + (nx.selfPaced && !nx.reps ? '' : ` (${nx.round}/${nx.rounds})`);
  }
  /** Fine dell'esercizio: il timer si ferma e si apre la sua registrazione. */
  function endBlock() {
    track();
    const { r, b, ms, completed, works, rows, surface } = P;
    clearInterval(P.timer); P = null; $('player').hidden = true;
    try { if (wl) wl.release(); } catch (e) { /* già rilasciato */ } wl = null;
    audioRelease();
    if (rows) return recordSheet(r, b, ms, null, null, { rows, surface });
    recordSheet(r, b, ms, works ? { done: completed, of: works } : null);
  }
  /** Minuti proposti nella registrazione: il tempo del timer se è stato usato davvero (almeno mezzo minuto),
      altrimenti quelli previsti nei parametri dell'esercizio (nota di Leo del 26 nov: prima proponeva 0). */
  const defMinutes = (ms, b) => (ms >= 30000 ? Math.max(1, Math.round(ms / 60000)) : b.minutes || 0);
  function recordSheet(r, b, ms, sets, prev, table) {
    if (table) return confirmSheet(r, b, ms, table);
    const ex = S.exercises[b.exId], m = maxes(), isClimb = ex.slot === 'wall' || !!ex.surface;
    const min = numInp(prev ? Math.round(ms / 60000) : defMinutes(ms, b)), note = h('input', { placeholder: 'Optional', value: prev && prev.note || '' });
    const isTest = !!(ex.load && ex.load.test), planned = /^kg: add /.test(loadHint(ex)) ? '' : loadHint(ex);
    // Carico e RPE per ogni esercizio di forza: sono lo storico da cui nasce la proposta della volta dopo.
    // Carico: sempre kg in più rispetto al peso corporeo (nota di Leo del 23 nov); due campi se l'esercizio è per lato
    const sided = !!(ex.interval && C.splitCues(ex.interval.cues).sided) || !!(ex.load && C.PAIRS[ex.load.ref]);
    const plannedKg = side => { if (!ex.load || ex.load.mode !== 'hang' || ex.load.pct == null) return null; const c = (ex.interval && ex.interval.cues.find(x => !side || C.normSide(x.split(' ')[0]) === side)) || ''; return C.loadKg(ex.load, c, m); };
    const prevKg = side => { const k = prev && (prev.kgs || []).find(x => (x.side || null) === side); return k ? k.kg : prev ? null : plannedKg(side); };
    const kgInp = side => { const i = numInp(prevKg(side), { placeholder: '0' });
      return h('div', { class: 'kg-in' }, side ? h('span', { class: 'kg-side' }, side) : null, i, h('span', { class: 'kg-u' }, 'kg'),
        h('button', { type: 'button', class: 'btn sm kg-sign', 'aria-label': 'Change sign (assisted, less than body weight)', onclick: () => { const v = val(i); i.value = v == null ? '-' : dec(-v); } }, '±')); };
    const withLoad = !isTest && (ex.load || ex.slot === 'strength');
    const kgBoxes = withLoad ? (sided ? [['L', kgInp('L')], ['R', kgInp('R')]] : [[null, kgInp(null)]]) : [];
    const load = withLoad ? h('div', { class: 'kg-wrap' }, kgBoxes.map(x => x[1])) : null;
    const readKgs = () => kgBoxes.map(([side, box]) => ({ side, kg: val(box.querySelector('input')) })).filter(x => x.kg != null);
    const rpe = load ? numInp(prev ? prev.rpe : null, { placeholder: '1-10' }) : null;
    const prevTest = k => { const t = prev && (prev.testIds || []).map(id => S.tests.find(x => x.id === id)).find(x => x && x.key === k); return t ? t.value : null; };
    const tests = ex.load && ex.load.test ? C.refKeys(ex.load.ref).map(k => S.testDefs.find(t => t.key === k)).filter(Boolean)
      .map(def => ({ def, inp: numInp(prevTest(def.key), { placeholder: m[def.key] == null ? '' : 'previous: ' + dec(m[def.key]) }) })) : [];
    const pc = prev && prev.climb;
    const sf = isClimb ? opts(surfOpts(), pc ? pc.surface : ex.surface || '') : null, gr = isClimb ? opts(gradeOpts(isRoute(sf.value)), pc && pc.top || '') : null, sends = isClimb ? numInp(pc ? pc.sends : null) : null;
    const sentF = isClimb ? field('Problems sent', sends) : null;
    if (isClimb) linkGrade(sf, gr, sentF);
    // Serie fatte: precompilate da quelle arrivate in fondo nel timer (le saltate non contano); ripetizioni mancanti a mano.
    const setsDone = sets ? numInp(sets.done) : null, repsMissed = ex.interval && ex.interval.selfPaced && ex.interval.reps ? numInp(prev ? prev.repsMissed : null, { placeholder: '0' }) : null;
    const put = rec => {
      const l = dayLog(r, true), i = l.blocks.findIndex(x => x.bid === b.id), prev = i >= 0 ? l.blocks[i] : null;
      if (prev && prev.rows && !rec.rows) rec.rows = prev.rows; // la tabella del timer resta anche se si modifica il riepilogo
      if (prev && prev.testIds) S.tests = S.tests.filter(t => !prev.testIds.includes(t.id)); // rifatto: il nuovo risultato sostituisce il precedente
      rec.testIds = (rec.tests || []).map(t => { const id = C.uid(); S.tests.push({ id, key: t.key, date: l.date, value: t.value }); return id; });
      delete rec.tests;
      rec.bid = b.id;
      if (!(rec.minutes > 0)) { rec.minutes = plannedShare(b.minutes, rec.sets); if (rec.climb) rec.climb.minutes = rec.minutes; } // 0 minuti non ha senso per un esercizio fatto: si usano i previsti
      for (const k of Object.keys(rec)) if (rec[k] == null || rec[k] === '' || (Array.isArray(rec[k]) && !rec[k].length)) delete rec[k];
      if (prev) l.blocks[i] = rec; else l.blocks.push(rec);
      l.minutes = Math.max(0, (l.minutes || 0) + (rec.minutes || 0) - (prev && prev.minutes || 0));
      l.loads = l.blocks.filter(x => x.load).map(x => ({ name: x.name, kg: x.load }));
      l.climbs = l.blocks.map(x => x.climb).filter(Boolean);
      save(); ov.remove(); render();
      log('exercise', prev ? 'log edited' : 'logged', { name: rec.name, minutes: rec.minutes || 0, measured: Math.round(ms / 1000) });
    };
    const of = sets ? sets.of : 0;
    const ov = openSheet(C.exName(ex), [h('p', { class: 'sub' }, prev ? `Edit what you logged on ${fmtDate(dayOf(r))}.` : 'Exercise complete: log how it went.'),
      sets ? h('div', { class: 'cols' }, field(`Sets done (of ${of})`, setsDone), repsMissed ? field('Reps missed (total)', repsMissed) : field('Minutes', min)) : field('Minutes', min),
      sets && repsMissed ? field('Minutes', min) : null,
      tests.length ? [tests.map(x => field(`Result: ${x.def.name} (${x.def.unit})`, x.inp)), h('p', { class: 'sub' }, 'On save, the result immediately updates the max in the Tests section.')] : null,
      load ? [field('Added load (kg over body weight)', load), field('Exercise RPE', rpe)] : null,
      isClimb ? [h('div', { class: 'cols' }, field('Surface', sf), field('Top grade sent', gr)), sentF] : null,
      field('Note', note),
      btn('Save', () => {
        const sd = setsDone ? Math.round(val(setsDone)) : null;
        if (setsDone && !(sd >= 0 && sd <= of)) return toast(`Sets done: from 0 to ${of}.`);
        const rm = repsMissed ? Math.max(0, Math.round(val(repsMissed) || 0)) : null;
        put({ name: C.exName(ex), minutes: Math.max(0, Math.round(val(min) || 0)), note: note.value.trim().slice(0, 200), load: load ? C.fmtLoads(readKgs()) : '', sec: exSection(ex),
          key: exKey(ex), label: exLabel(ex), kgs: load ? readKgs() : [], rpe: rpe ? val(rpe) : null, mode: 'hang',
          sets: sets ? { done: sd, of } : null, repsMissed: rm || null,
          tests: tests.map(x => ({ key: x.def.key, value: val(x.inp) })).filter(x => x.value != null),
          climb: isClimb && sf.value ? { name: C.exName(ex), surface: sf.value, top: gr.value || null, sends: val(sends) == null ? null : Math.max(0, Math.round(val(sends))), minutes: Math.max(0, Math.round(val(min) || 0)) } : null });
      }, 'pri block'),
      prev ? btn('Delete this log', () => deleteRecord(dayLog(r), prev, ov), 'danger block') : btn('Mark as done, no details', () => put({ name: C.exName(ex), minutes: defMinutes(ms, b), sec: exSection(ex), key: exKey(ex), label: exLabel(ex) }), 'block'),
      btn(prev ? 'Cancel' : 'Not done, discard', () => ov.remove(), 'block')]);
  }
  /** Fine esercizio con la tabella già compilata: conferma breve (riepilogo, minuti, RPE, nota). */
  function confirmSheet(r, b, ms, table) {
    const ex = S.exercises[b.exId], climb = isClimbEx(ex), rows = table.rows, done = rows.filter(x => x.done);
    const min = numInp(defMinutes(ms, b)), note = h('input', { placeholder: 'Optional' }), rpe = numInp(null, { placeholder: '1-10' });
    // kg per lato: il massimo delle serie fatte (è il valore che conta per lo storico dei carichi)
    const kgs = climb ? [] : [...new Set(done.filter(x => x.kg !== undefined).map(x => x.side || null))].map(side => ({ side, kg: Math.max(...done.filter(x => (x.side || null) === side && x.kg !== undefined).map(x => x.kg)) }));
    const grades = climb ? done.map(x => x.grade).filter(Boolean) : [];
    const top = grades.length ? grades.reduce((a, g) => (C.gradeIdx(g) > C.gradeIdx(a) ? g : a)) : null;
    // Serie: con L/R una serie è fatta quando lo sono entrambi i lati (righe con lo stesso round)
    const series = climb ? null : seriesCount(rows);
    const repsMissed = climb ? 0 : done.reduce((t, x) => t + (x.plan != null ? Math.max(0, x.plan - (x.reps || 0)) : 0), 0);
    const summary = climb
      ? `${done.length} ${isRoute(table.surface) ? 'routes' : 'climbs'}` + (top ? ` · top ${fmtG(top)}` : '') + (table.surface ? ` · ${surfName(table.surface)}` : '')
      : `${series.done}/${series.of} sets` + (kgs.length ? ' · ' + C.fmtLoads(kgs) : '') + (repsMissed ? ` · ${repsMissed} reps missed` : '');
    const ov = openSheet(C.exName(ex), [h('p', { class: 'sub' }, 'Exercise complete.'), h('p', { class: 'sum' }, summary),
      h('div', { class: 'cols' }, field('Minutes', min), field('Exercise RPE', rpe)), field('Note', note),
      btn('Save', () => {
        const minutes = Math.max(0, Math.round(val(min) || 0));
        savePut(r, b, ms, ov, { name: C.exName(ex), minutes, note: note.value.trim().slice(0, 200), sec: exSection(ex), key: exKey(ex), label: exLabel(ex),
          load: C.fmtLoads(kgs), kgs, rpe: val(rpe), mode: 'hang', sets: climb ? null : series, repsMissed: repsMissed || null,
          rows: rows.map(x => climb ? { grade: x.grade || null, done: x.done } : { side: x.side, reps: x.reps, kg: x.kg, done: x.done }),
          climb: climb && table.surface ? { name: C.exName(ex), surface: table.surface, top, sends: done.length, minutes, grades } : null });
      }, 'pri block'),
      btn('Not done, discard', () => ov.remove(), 'block')]);
  }
  /** Serie fatte / previste dalle righe della tabella: le righe L e R della stessa serie contano una volta. */
  function seriesCount(rows) {
    if (!rows.some(x => x.side)) return { done: rows.filter(x => x.done).length, of: rows.length };
    const by = new Map();
    rows.forEach((x, i) => { const k = x.round || i; by.set(k, (by.get(k) || []).concat(x)); });
    const g = [...by.values()];
    return { done: g.filter(list => list.every(x => x.done)).length, of: g.length };
  }
  /** Salva una registrazione (stessa logica della scheda completa). */
  function savePut(r, b, ms, ov, rec) {
    const l = dayLog(r, true), i = l.blocks.findIndex(x => x.bid === b.id), prev = i >= 0 ? l.blocks[i] : null;
    if (prev && prev.testIds) S.tests = S.tests.filter(t => !prev.testIds.includes(t.id));
    rec.bid = b.id;
    if (!(rec.minutes > 0)) { rec.minutes = plannedShare(b.minutes, rec.sets); if (rec.climb) rec.climb.minutes = rec.minutes; }
    for (const k of Object.keys(rec)) if (rec[k] == null || rec[k] === '' || (Array.isArray(rec[k]) && !rec[k].length)) delete rec[k];
    if (prev) l.blocks[i] = rec; else l.blocks.push(rec);
    l.minutes = Math.max(0, (l.minutes || 0) + (rec.minutes || 0) - (prev && prev.minutes || 0));
    l.loads = l.blocks.filter(x => x.load).map(x => ({ name: x.name, kg: x.load }));
    l.climbs = l.blocks.map(x => x.climb).filter(Boolean);
    save(); ov.remove(); render();
    log('exercise', 'logged', { name: rec.name, minutes: rec.minutes || 0, measured: Math.round(ms / 1000), rows: (rec.rows || []).length });
  }
  function wirePlayer() {
    $('p-done').onclick = () => { const st = P.steps[P.idx]; if (st.kind === 'work' && st.selfPaced) { P.completed++; rowDone(st); if (P.idx + 1 < P.steps.length) SOUND.setEnd(); } next(); };
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
  const VIEWS = { home: viewHome, week: viewWeek, calendar: viewCalendar, trips: viewTrips, trip: viewTrip, analytics: viewAnalytics, tests: viewProgress, more: viewMore, profile: viewProfile, programmes: viewPrograms, library: viewLibrary, notebook: viewNotes, diagnostics: viewDiag };
  function render() {
    let start = 'home';
    try { if (!location.hash && localStorage.getItem(KEY + '.homeTab') === 'week') start = 'week'; } catch (e) { /* storage non disponibile */ } // all'avvio: l'ultima vista scelta in Home
    const [name, ...args] = (location.hash.slice(1) || start).split('-');
    const fn = VIEWS[name] || viewHome;
    let nodes;
    try { nodes = fn(args); }
    catch (e) { console.error('[ui] error in view ' + name, e); nodes = [h('h1', {}, 'Something went wrong'), h('p', { class: 'sub' }, String(e.message || e)), btn('Back to Home', () => go('home'))]; }
    $('view').replaceChildren(...[nodes].flat(Infinity).filter(n => n != null && n !== false));
    const tab = { week: 'home', library: 'more', profile: 'more', programmes: 'more', notebook: 'more', diagnostics: 'more', tests: 'analytics', trip: 'trips' }[name] || (VIEWS[name] ? name : 'home');
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
