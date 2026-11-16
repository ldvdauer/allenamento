/* Grafici SVG senza dipendenze (funzionano offline).
   Regole: una sola tinta per i dati, grigio per il termine di confronto, mai due scale sullo stesso grafico,
   testo sempre nei colori del testo, e ogni grafico ha tooltip (tocco, mouse, tastiera) + vista tabella. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', W = 330;
  const svgEl = (tag, attrs, ...kids) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    for (const c of kids) if (c != null) e.append(c);
    return e;
  };
  // Le etichette arrivano dai dati dell'utente: sempre textContent, mai innerHTML.
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmtNum = (v, digits) => v.toLocaleString('en-GB', { maximumFractionDigits: digits || 0 });
  const tickDigits = step => (Number.isInteger(step) ? 0 : Number.isInteger(step * 10) ? 1 : 2);

  function frame(height, aria) {
    const wrap = el('div', 'viz'), svg = svgEl('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': aria }), tip = el('div', 'viz-tip');
    tip.hidden = true;
    wrap.append(svg, tip);
    return {
      wrap, svg,
      show(x, title, rows) { // il valore è l'elemento forte, il nome della serie lo segue
        tip.replaceChildren(el('div', 'viz-tip-t', title), ...rows.map(r => {
          const row = el('div', 'viz-tip-r');
          row.append(el('i', 'viz-key' + (r.key ? ' ' + r.key : '')), el('b', '', r.value), document.createTextNode(' ' + r.label));
          return row;
        }));
        tip.hidden = false;
        tip.style.left = Math.min(Math.max(x / W * 100, 24), 76) + '%';
      },
      hide() { tip.hidden = true; },
    };
  }
  function tableView(head, rows) {
    const d = el('details', 'viz-table'), t = el('table'), hr = el('tr');
    d.append(el('summary', '', 'Table'));
    head.forEach(x => hr.append(el('th', '', x)));
    t.append(hr);
    rows.forEach(r => { const tr = el('tr'); r.forEach(c => tr.append(el('td', '', c))); t.append(tr); });
    d.append(t);
    return d;
  }
  /** Griglia orizzontale + etichette dell'asse Y; restituisce la funzione y(valore). */
  function yAxis(svg, g, H, dom, tickFmt) {
    const ph = H - g.t - g.b, y = v => g.t + ph * (1 - (v - dom.min) / (dom.max - dom.min)), d = tickDigits(dom.step);
    for (let v = dom.min; v <= dom.max + dom.step / 1000; v += dom.step) {
      svg.append(svgEl('line', { class: v === dom.min ? 'axis' : 'grid', x1: g.l, x2: W - g.r, y1: y(v), y2: y(v) }));
      const t = svgEl('text', { x: g.l - 6, y: y(v) + 3.5, 'text-anchor': 'end' });
      t.textContent = tickFmt ? tickFmt(v) : fmtNum(v, d);
      svg.append(t);
    }
    return y;
  }
  function xLabels(svg, labels, xOf, H, spacing) {
    const n = labels.length, every = Math.max(1, Math.ceil(42 / spacing));
    labels.forEach((lab, i) => {
      if ((n - 1 - i) % every) return; // l'ultima etichetta (il periodo corrente) c'è sempre
      const t = svgEl('text', { x: xOf(i), y: H - 5, 'text-anchor': 'middle' });
      t.textContent = lab;
      svg.append(t);
    });
  }

  /** Colonne (una serie) con eventuale riferimento per colonna (trattino grigio).
      o: { labels, longLabels, values, targets?, unit, name, targetName?, aria } */
  function columns(o) {
    const H = 172, g = { l: 34, r: 6, t: 14, b: 20 }, n = o.values.length, f = frame(H, o.aria);
    const hasT = !!(o.targets && o.targets.some(v => v > 0));
    const dom = Core.niceRange(0, Math.max(0, ...o.values, ...(hasT ? o.targets : [])));
    const y = yAxis(f.svg, g, H, dom), band = (W - g.l - g.r) / n, bw = Math.max(2, Math.min(24, band - 2, band * 0.62));
    const cx = i => g.l + band * (i + 0.5), y0 = y(0), bars = [];
    let active = -1;
    const unit = o.unit ? ' ' + o.unit : '';
    o.values.forEach((v, i) => {
      const x = cx(i) - bw / 2, yt = y(v), r = Math.min(4, bw / 2, y0 - yt);
      // estremità arrotondata verso il dato, squadrata sulla linea di base
      const bar = v > 0 ? svgEl('path', { class: 'bar', d: `M${x},${y0}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${y0}Z` }) : null;
      bars.push(bar);
      if (bar) f.svg.append(bar);
      if (hasT && o.targets[i] > 0) f.svg.append(svgEl('line', { class: 'tick', x1: x - 3, x2: x + bw + 3, y1: y(o.targets[i]), y2: y(o.targets[i]) }));
    });
    xLabels(f.svg, o.labels, cx, H, band);
    o.values.forEach((v, i) => {
      const title = (o.longLabels || o.labels)[i];
      const rows = [{ value: fmtNum(v) + unit, label: o.name.toLowerCase() }];
      if (hasT) rows.push({ key: 'ref', value: fmtNum(o.targets[i]) + unit, label: o.targetName.toLowerCase() });
      const hit = svgEl('rect', { class: 'hit', x: g.l + band * i, y: g.t, width: band, height: H - g.t - g.b, tabindex: 0,
        'aria-label': `${title}: ${rows.map(r => r.value + ' ' + r.label).join(', ')}` });
      const on = () => { if (bars[active]) bars[active].classList.remove('on'); active = i; if (bars[i]) bars[i].classList.add('on'); f.show(cx(i), title, rows); };
      const off = () => { if (bars[i]) bars[i].classList.remove('on'); f.hide(); };
      hit.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') on(); });
      hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') off(); });
      hit.addEventListener('click', on);
      hit.addEventListener('focus', on);
      hit.addEventListener('blur', off);
      f.svg.append(hit);
    });
    const box = el('div');
    if (hasT) { // due serie → legenda sempre presente (rettangolo per le colonne, linea per il riferimento)
      const lg = el('div', 'viz-legend'), a = el('span'), b = el('span');
      a.append(el('i', 'sw'), document.createTextNode(o.name));
      b.append(el('i', 'lk'), document.createTextNode(o.targetName));
      lg.append(a, b);
      box.append(lg);
    }
    box.append(f.wrap, tableView(hasT ? [o.colLabel || 'Week', o.name, o.targetName] : [o.colLabel || 'Week', o.name],
      o.values.map((v, i) => [(o.longLabels || o.labels)[i], fmtNum(v) + unit].concat(hasT ? [fmtNum(o.targets[i]) + unit] : []))));
    return box;
  }

  /** Colonne impilate: poche serie con colori fissi per entità (mai riassegnati), 2 px di stacco tra i segmenti,
      legenda sempre presente, riferimento opzionale come tacca grigia. o.series: [{ name, cls, values }]. */
  function stacked(o) {
    const H = 172, g = { l: 34, r: 6, t: 14, b: 20 }, n = o.labels.length, f = frame(H, o.aria);
    const hasT = !!(o.targets && o.targets.some(v => v > 0)), tot = o.labels.map((_, i) => o.series.reduce((t, s) => t + s.values[i], 0));
    const dom = Core.niceRange(0, Math.max(0, ...tot, ...(hasT ? o.targets : [])));
    const y = yAxis(f.svg, g, H, dom), band = (W - g.l - g.r) / n, bw = Math.max(2, Math.min(24, band - 2, band * 0.62));
    const cx = i => g.l + band * (i + 0.5), unit = o.unit ? ' ' + o.unit : '';
    o.labels.forEach((_, i) => {
      const x = cx(i) - bw / 2, live = o.series.filter(s => s.values[i] > 0);
      let base = 0;
      live.forEach((s, k) => {
        const yb = y(base) - (k ? 1 : 0), yt = y(base + s.values[i]) + (k < live.length - 1 ? 1 : 0), top = k === live.length - 1;
        base += s.values[i];
        if (yb - yt < 0.5) return;
        const r = top ? Math.min(4, bw / 2, yb - yt) : 0; // solo l'estremità in cima è arrotondata
        f.svg.append(svgEl('path', { class: 'seg ' + s.cls, d: `M${x},${yb}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${yb}Z` }));
      });
      if (hasT && o.targets[i] > 0) f.svg.append(svgEl('line', { class: 'tick', x1: x - 3, x2: x + bw + 3, y1: y(o.targets[i]), y2: y(o.targets[i]) }));
    });
    xLabels(f.svg, o.labels, cx, H, band);
    o.labels.forEach((_, i) => {
      const title = (o.longLabels || o.labels)[i];
      const rows = o.series.filter(s => s.values[i] > 0).map(s => ({ key: s.cls, value: fmtNum(s.values[i]) + unit, label: s.name.toLowerCase() })).reverse();
      rows.unshift({ key: 'none', value: fmtNum(tot[i]) + unit, label: 'in total' });
      if (hasT) rows.push({ key: 'ref', value: fmtNum(o.targets[i]) + unit, label: o.targetName.toLowerCase() });
      const hit = svgEl('rect', { class: 'hit', x: g.l + band * i, y: g.t, width: band, height: H - g.t - g.b, tabindex: 0, 'aria-label': `${title}: ${rows.map(r => r.value + ' ' + r.label).join(', ')}` });
      const on = () => f.show(cx(i), title, rows);
      hit.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') on(); });
      hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') f.hide(); });
      hit.addEventListener('click', on); hit.addEventListener('focus', on); hit.addEventListener('blur', f.hide);
      f.svg.append(hit);
    });
    const box = el('div'), lg = el('div', 'viz-legend');
    for (const s of o.series) { const a = el('span'); a.append(el('i', 'sw ' + s.cls), document.createTextNode(s.name)); lg.append(a); }
    if (hasT) { const b = el('span'); b.append(el('i', 'lk'), document.createTextNode(o.targetName)); lg.append(b); }
    box.append(lg, f.wrap, tableView(['Week'].concat(o.series.map(s => s.name), ['Total'], hasT ? [o.targetName] : []),
      o.labels.map((_, i) => [(o.longLabels || o.labels)[i]].concat(o.series.map(s => fmtNum(s.values[i])), [fmtNum(tot[i]) + unit], hasT ? [fmtNum(o.targets[i]) + unit] : []))));
    return box;
  }

  /** Linea (una serie) con valori mancanti ammessi (null).
      o: { labels, longLabels, values, name, unit?, digits?, domain?: {min,max,step}, fmt?, height?, colLabel?, aria } */
  function line(o) {
    const idxs = o.values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0), nums = idxs.map(i => o.values[i]), last = idxs[idxs.length - 1];
    const dom = o.domain || Core.niceRange(Math.min(...nums), Math.max(...nums));
    const fmt = o.fmt || (v => fmtNum(v, o.digits == null ? 1 : o.digits) + (o.unit ? ' ' + o.unit : ''));
    // il margine destro si adatta all'etichetta dell'ultimo valore, così non viene mai tagliata
    const H = o.height || 132, g = { l: 34, r: Math.max(30, fmt(o.values[last]).length * 6.6 + 14), t: 12, b: 20 }, n = o.values.length, f = frame(H, o.aria);
    const y = yAxis(f.svg, g, H, dom, o.fmt), pw = W - g.l - g.r - 8;
    const x = i => (n === 1 ? g.l + 8 + pw / 2 : g.l + 8 + pw * i / (n - 1)); // 8px di respiro dall'asse Y
    xLabels(f.svg, o.labels, x, H, n > 1 ? pw / (n - 1) : pw);
    let d = '', pen = false;
    o.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
      pen = true;
    });
    f.svg.append(svgEl('path', { class: 'ln', d }));
    const cross = svgEl('line', { class: 'cross', y1: g.t, y2: H - g.b, visibility: 'hidden' });
    f.svg.append(cross);
    // punti: tutti se sono pochi (servono a vedere i valori isolati), altrimenti solo l'ultimo
    for (const i of idxs.length <= 26 ? idxs : [last]) f.svg.append(svgEl('circle', { class: 'dot', cx: x(i), cy: y(o.values[i]), r: 4 }));
    const end = svgEl('text', { class: 'end', x: x(last) + 8, y: y(o.values[last]) + 4 }); // etichetta diretta solo sull'ultimo valore
    end.textContent = fmt(o.values[last]);
    f.svg.append(end);
    let cur = -1;
    const pick = k => {
      cur = k;
      const i = idxs[k];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      f.show(x(i), (o.longLabels || o.labels)[i], [{ value: fmt(o.values[i]), label: o.name.toLowerCase() }]);
    };
    const off = () => { cross.setAttribute('visibility', 'hidden'); f.hide(); };
    const near = e => { // il puntatore deve solo essere vicino a una data, non centrare un punto
      const b = f.svg.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * W;
      let best = 0;
      idxs.forEach((i, k) => { if (Math.abs(x(i) - px) < Math.abs(x(idxs[best]) - px)) best = k; });
      pick(best);
    };
    const hit = svgEl('rect', { class: 'hit', x: g.l - 4, y: g.t, width: pw + 24, height: H - g.t - g.b, tabindex: 0,
      'aria-label': `${o.aria}. Left and right arrows to move through the values.` });
    hit.addEventListener('pointermove', near);
    hit.addEventListener('pointerdown', near);
    hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') off(); });
    hit.addEventListener('focus', () => pick(cur < 0 ? idxs.length - 1 : cur));
    hit.addEventListener('blur', off);
    hit.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      pick(Math.min(idxs.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    });
    f.svg.append(hit);
    const box = el('div');
    box.append(f.wrap, tableView([o.colLabel || 'Week', o.name], idxs.map(i => [(o.longLabels || o.labels)[i], fmt(o.values[i])])));
    return box;
  }

  /** Barre orizzontali ordinate, una tinta, valore scritto accanto: è già la sua tabella.
      rows: [{ label, value, text }] */
  function hbars(rows) {
    const max = Math.max(1, ...rows.map(r => r.value)), box = el('div', 'viz-hb');
    for (const r of rows) {
      const row = el('div', 'viz-hb-r'), track = el('span', 'viz-hb-t'), bar = el('i');
      bar.style.width = (r.value > 0 ? Math.max(1, r.value / max * 100) : 0) + '%';
      track.append(bar);
      if (r.cls) bar.className = r.cls;
      row.append(el('span', 'viz-hb-l', r.label), track, el('span', 'viz-hb-v', r.text));
      box.append(row);
    }
    return box;
  }

  /** Andamento in miniatura per le righe di riepilogo (nessun asse: il valore è scritto a fianco). */
  function spark(vals) {
    if (vals.length < 2) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
    const pts = vals.map((v, i) => [5 + i * 100 / (vals.length - 1), 29 - (v - lo) / sp * 24]);
    return svgEl('svg', { class: 'spark', viewBox: '0 0 110 34', 'aria-hidden': 'true' },
      svgEl('polyline', { points: pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ') }),
      svgEl('circle', { cx: pts[pts.length - 1][0].toFixed(1), cy: pts[pts.length - 1][1].toFixed(1), r: 4 }));
  }

  root.Charts = { columns, stacked, line, hbars, spark, fmtNum };
})(typeof self !== 'undefined' ? self : this);
