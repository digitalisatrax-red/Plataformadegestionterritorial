/* Plataforma de Gestión Territorial · Tablero del reporte (estilo tablero analítico).
   Recibe los datos de «Mi reporte» y muestra: tarjetas (KPI), ranking, anillo por categoría, mini mapa y tabla,
   todo filtrable con un clic (los gráficos filtran el resto). Sin dependencias externas. */
(function () {
  'use strict';
  var PAL = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
  var T = null;   // estado del tablero

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('es-CO', { maximumFractionDigits: d == null ? 1 : d }) : '—'; }
  function val(v, f) {
    if (v === null || v === undefined || v === '') return '—';
    if (f && f.fecha && typeof v === 'number') return new Date(v).toLocaleDateString('es-CO');
    return typeof v === 'number' ? num(v, 2) : String(v);
  }
  function corto(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  /* ── Configuración por defecto de cada tabla ───────── */
  function inicio(it) {
    var numericos = it.campos.filter(function (f) { return f.num && (f.virtual || f.unidad || f.rol === 'numero'); });
    var medida = numericos.filter(function (f) { return f.virtual; })[0] || numericos.filter(function (f) { return f.unidad; })[0] || numericos[0] || null;
    var cats = it.campos.filter(function (f) { return !f.num && f.rol !== 'fecha'; });
    var cat = cats.filter(function (f) { return f.rol === 'categoria' || f.rol === 'municipio'; })[0] || cats.filter(function (f) { return f.rol !== 'nombre'; })[0] || null;
    var etiq = it.campos.filter(function (f) { return f.rol === 'nombre'; })[0] || cats[0] || it.campos[0];
    return { medida: medida && medida.name, cat: cat && cat.name, etiq: etiq && etiq.name, filtro: null, busca: '', orden: null, desc: true };
  }
  function campoDe(it, n) { return it.campos.filter(function (f) { return f.name === n; })[0] || null; }
  function alias(it, f) { var i = it.campos.indexOf(f); return it.alias && it.alias[i] ? it.alias[i] : f.alias; }

  /* ── Filtrado y agregados ──────────────────────────── */
  function filas(it, c) {
    var q = c.busca.trim().toLowerCase();
    return it.filas.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
      if (c.filtro) {
        if (c.filtro.t === 'fila' && x.i !== c.filtro.v) return false;
        if (c.filtro.t === 'cat' && String(x.r[c.cat] == null ? 'Sin dato' : x.r[c.cat]) !== c.filtro.v) return false;
      }
      if (q && !it.campos.some(function (f) { return String(x.r[f.name] == null ? '' : x.r[f.name]).toLowerCase().indexOf(q) !== -1; })) return false;
      return true;
    });
  }
  function medidaDe(r, c) { return c.medida ? (typeof r[c.medida] === 'number' ? r[c.medida] : 0) : 1; }

  /* ── Piezas visuales ───────────────────────────────── */
  function kpis(it, c, xs) {
    var f = campoDe(it, c.medida), u = f && (f.unidad || (f.virtual ? (f.name === '__long_km' ? 'km' : 'ha') : '')), t = 0, mx = null;
    xs.forEach(function (x) { var m = medidaDe(x.r, c); t += m; if (c.medida && (mx === null || m > mx.m)) mx = { m: m, r: x.r }; });
    var cats = {}; if (c.cat) xs.forEach(function (x) { cats[x.r[c.cat]] = 1; });
    var cs = [{ t: 'Registros', v: num(xs.length, 0), s: 'de ' + num(it.filas.length, 0) }];
    if (c.medida) {
      cs.push({ t: 'Total · ' + alias(it, f), v: num(t, 1), s: u || '' });
      cs.push({ t: 'Promedio', v: num(xs.length ? t / xs.length : 0, 1), s: u || '' });
      cs.push({ t: 'Mayor', v: num(mx ? mx.m : 0, 1), s: mx ? corto(mx.r[c.etiq] == null ? '' : mx.r[c.etiq], 28) : '' });
    }
    if (c.cat) cs.push({ t: 'Categorías · ' + alias(it, campoDe(it, c.cat)), v: num(Object.keys(cats).length, 0), s: 'distintas' });
    return cs;
  }
  function ranking(it, c, xs) {
    var top = xs.slice().sort(function (a, b) { return medidaDe(b.r, c) - medidaDe(a.r, c); }).slice(0, 10);
    var mx = top.length ? Math.max.apply(null, top.map(function (x) { return medidaDe(x.r, c); })) || 1 : 1;
    return top.map(function (x, k) {
      var m = medidaDe(x.r, c), sel = c.filtro && c.filtro.t === 'fila' && c.filtro.v === x.i;
      return '<div class="tb-bar' + (sel ? ' sel' : '') + '" data-fila="' + x.i + '" title="' + esc(x.r[c.etiq]) + '"><span class="tb-bl">' + esc(corto(x.r[c.etiq] == null ? 'Sin dato' : x.r[c.etiq], 34)) + '</span><span class="tb-bt"><i style="width:' + Math.max(2, m / mx * 100) + '%;background:' + PAL[0] + '"></i></span><span class="tb-bv">' + num(m, 1) + '</span></div>';
    }).join('') || '<div class="tb-vacio">Sin datos</div>';
  }
  function grupos(it, c, xs) {
    var g = {};
    xs.forEach(function (x) { var k = String(x.r[c.cat] == null ? 'Sin dato' : x.r[c.cat]); g[k] = (g[k] || 0) + medidaDe(x.r, c); });
    var l = Object.keys(g).map(function (k) { return { k: k, v: g[k] }; }).sort(function (a, b) { return b.v - a.v; });
    if (l.length > 7) { var otros = l.slice(6).reduce(function (a, b) { return a + b.v; }, 0); l = l.slice(0, 6).concat([{ k: 'Otros', v: otros, otros: true }]); }
    return l;
  }
  function anillo(it, c, xs) {
    if (!c.cat) return '<div class="tb-vacio">Elige una categoría</div>';
    var l = grupos(it, c, xs), tot = l.reduce(function (a, b) { return a + b.v; }, 0) || 1, R = 15.9, acc = 0, h = '';
    var arcos = l.map(function (g, i) {
      var p = g.v / tot * 100, a = '<circle class="tb-arco" data-cat="' + esc(g.k) + '" r="' + R + '" cx="21" cy="21" fill="none" stroke="' + PAL[i % PAL.length] + '" stroke-width="7" stroke-dasharray="' + p + ' ' + (100 - p) + '" stroke-dashoffset="' + (25 - acc) + '"><title>' + esc(g.k) + ': ' + num(g.v, 1) + '</title></circle>';
      acc += p; return a;
    }).join('');
    var leyenda = l.map(function (g, i) {
      var sel = c.filtro && c.filtro.t === 'cat' && c.filtro.v === g.k;
      return '<div class="tb-ley' + (sel ? ' sel' : '') + '" data-cat="' + esc(g.k) + '"><i style="background:' + PAL[i % PAL.length] + '"></i><span>' + esc(corto(g.k, 26)) + '</span><b>' + num(g.v / tot * 100, 0) + '%</b></div>';
    }).join('');
    return '<div class="tb-anillo"><svg viewBox="0 0 42 42">' + arcos + '<text x="21" y="22.5" text-anchor="middle" class="tb-c">' + num(tot, 0) + '</text></svg><div>' + leyenda + '</div></div>';
  }
  function tabla(it, c, xs) {
    var orden = c.orden, lista = xs.slice();
    if (orden) lista.sort(function (a, b) {
      var x = a.r[orden], y = b.r[orden], d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'es');
      return c.desc ? -d : d;
    });
    var h = '<table class="tb-tab"><thead><tr>' + it.campos.map(function (f) {
      return '<th data-ord="' + esc(f.name) + '">' + esc(alias(it, f)) + (orden === f.name ? (c.desc ? ' ▼' : ' ▲') : '') + '</th>';
    }).join('') + '</tr></thead><tbody>';
    lista.slice(0, 300).forEach(function (x) {
      h += '<tr data-fila="' + x.i + '"' + (c.filtro && c.filtro.t === 'fila' && c.filtro.v === x.i ? ' class="sel"' : '') + '>' + it.campos.map(function (f) { return '<td' + (f.num ? ' class="n"' : '') + '>' + esc(val(x.r[f.name], f)) + '</td>'; }).join('') + '</tr>';
    });
    return h + '</tbody></table>' + (lista.length > 300 ? '<div class="tb-vacio">Mostrando 300 de ' + lista.length + ' (use el buscador o los gráficos para filtrar).</div>' : '');
  }

  /* ── Mini mapa ─────────────────────────────────────── */
  function colorFila(c, r, cats) { return c.cat ? PAL[cats.indexOf(String(r[c.cat] == null ? 'Sin dato' : r[c.cat])) % PAL.length] : PAL[0]; }
  function mapa(it, c, xs) {
    var L = window.__pgtL, cont = T.el.querySelector('[data-r=mapa]'); if (!L || !cont) return;
    if (!T.mapa) {
      T.mapa = L.map(cont, { zoomControl: true, attributionControl: false });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17 }).addTo(T.mapa);
      T.capa = L.featureGroup().addTo(T.mapa);
    }
    T.capa.clearLayers();
    var gs = grupos(it, c, it.filas.map(function (r, i) { return { r: r, i: i }; })).map(function (g) { return g.k; });
    var ok = {}; xs.forEach(function (x) { ok[x.i] = 1; });
    it.filas.forEach(function (r, i) {
      var g = r._g; if (!g) return;
      var col = colorFila(c, r, gs), activo = !!ok[i], o = { color: activo ? '#16302a' : '#9aa8a2', weight: activo ? 1.2 : 0.6, fillColor: col, fillOpacity: activo ? 0.65 : 0.12, opacity: activo ? 0.9 : 0.4 }, ly = null;
      if (g.rings) ly = L.polygon(g.rings.map(function (a) { return a.map(function (p) { return [p[1], p[0]]; }); }), o);
      else if (g.paths) ly = L.polyline(g.paths.map(function (a) { return a.map(function (p) { return [p[1], p[0]]; }); }), { color: col, weight: activo ? 3 : 1, opacity: activo ? 0.95 : 0.3 });
      else if (g.x !== undefined) ly = L.circleMarker([g.y, g.x], { radius: activo ? 6 : 3, color: '#fff', weight: 1, fillColor: col, fillOpacity: activo ? 0.9 : 0.3 });
      if (!ly) return;
      ly.bindTooltip(esc(r[c.etiq] == null ? '' : r[c.etiq]));
      ly.on('click', function () { c.filtro = (c.filtro && c.filtro.t === 'fila' && c.filtro.v === i) ? null : { t: 'fila', v: i }; pintar(true); });
      T.capa.addLayer(ly);
    });
    setTimeout(function () {
      T.mapa.invalidateSize();
      var vis = L.featureGroup(); T.capa.eachLayer(function (l) { if (ok[l._pgtI] !== 0) vis.addLayer(l); });
      var b = T.capa.getBounds(); if (b.isValid() && !T.ajustado) { T.mapa.fitBounds(b, { padding: [14, 14] }); T.ajustado = true; }
    }, 60);
  }

  /* ── Ventana ───────────────────────────────────────── */
  function cerrar() { if (T) { try { T.mapa && T.mapa.remove(); } catch (e) {} T.el.remove(); T = null; document.removeEventListener('keydown', teclas); } }
  function teclas(e) { if (e.key === 'Escape') cerrar(); }
  function abrir(datos, estado) {
    cerrar();
    var el = document.createElement('div'); el.className = 'tb-root';
    document.body.appendChild(el);
    T = { el: el, datos: datos, estado: estado, k: 0, cfg: datos.items.map(inicio), mapa: null, ajustado: false };
    document.addEventListener('keydown', teclas);
    pintar(false);
  }
  function opciones(lista, actual, vacio) {
    return (vacio ? '<option value="">' + vacio + '</option>' : '') + lista.map(function (o) { return '<option value="' + esc(o.v) + '"' + (o.v === actual ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('');
  }
  function pintar(soloContenido) {
    var D = T.datos, it = D.items[T.k], c = T.cfg[T.k], xs = filas(it, c);
    if (!soloContenido || T.k !== T.kPintado) T.ajustado = false;
    T.kPintado = T.k;
    var numericos = it.campos.filter(function (f) { return f.num; }).map(function (f) { return { v: f.name, t: alias(it, f) }; });
    var cats = it.campos.filter(function (f) { return !f.num && f.rol !== 'fecha'; }).map(function (f) { return { v: f.name, t: alias(it, f) }; });
    var fm = campoDe(it, c.medida);
    if (!soloContenido) {
      if (T.mapa) { try { T.mapa.remove(); } catch (e) {} T.mapa = null; }
      T.el.innerHTML = '<header class="tb-cab"><div><span class="tb-ey">Tablero del reporte</span><h1>' + esc(T.estado.titulo || 'Reporte territorial') + '</h1><div class="tb-sub">' + esc(D.aoi || '') + ' · ' + D.fecha.toLocaleDateString('es-CO') + '</div></div>' +
        '<div class="tb-acc"><button type="button" class="tb-pri" data-a="pdf">Descargar PDF</button><button type="button" class="tb-x" data-a="cerrar" aria-label="Cerrar">×</button></div></header>' +
        '<nav class="tb-tabs">' + D.items.map(function (x, i) { return '<button type="button" data-k="' + i + '" class="' + (i === T.k ? 'on' : '') + '">' + esc(x.capa.name) + '</button>'; }).join('') + '</nav>' +
        '<section class="tb-ctl"><label>Medida<select data-r="medida">' + opciones(numericos, c.medida, 'Conteo de registros') + '</select></label>' +
        '<label>Agrupar por<select data-r="cat">' + opciones(cats, c.cat, 'Sin agrupar') + '</select></label>' +
        '<label>Etiqueta<select data-r="etiq">' + opciones(cats.concat(numericos), c.etiq) + '</select></label>' +
        '<label class="tb-bus">Buscar<input data-r="busca" placeholder="Filtrar la tabla…" value="' + esc(c.busca) + '"></label>' +
        '<button type="button" class="tb-lim" data-a="limpiar">Limpiar filtros</button></section>' +
        '<main class="tb-main"><div class="tb-kpis" data-r="kpis"></div>' +
        '<div class="tb-card"><h3>Ranking <small data-r="rtit"></small></h3><div data-r="rank"></div></div>' +
        '<div class="tb-card"><h3>Participación <small data-r="atit"></small></h3><div data-r="anillo"></div></div>' +
        '<div class="tb-card tb-mapa"><h3>Mapa</h3><div data-r="mapa" class="tb-mapa-in"></div></div>' +
        '<div class="tb-card tb-tabla"><h3>Datos <small data-r="ttit"></small></h3><div class="tb-scroll" data-r="tabla"></div></div></main>' +
        '<footer class="tb-pie">Fuente: CORPOCALDAS (servicios ArcGIS REST). Haz clic en una barra, una categoría o un polígono para filtrar todo el tablero.</footer>';
      T.el.querySelector('[data-a=cerrar]').onclick = cerrar;
      T.el.querySelector('[data-a=pdf]').onclick = pdf;
      T.el.querySelector('[data-a=limpiar]').onclick = function () { c.filtro = null; c.busca = ''; T.el.querySelector('[data-r=busca]').value = ''; pintar(true); };
      Array.prototype.forEach.call(T.el.querySelectorAll('.tb-tabs button'), function (b) { b.onclick = function () { T.k = +b.getAttribute('data-k'); pintar(false); }; });
      ['medida', 'cat', 'etiq'].forEach(function (r) { T.el.querySelector('[data-r=' + r + ']').onchange = function (e) { c[r] = e.target.value || null; c.filtro = null; pintar(true); }; });
      T.el.querySelector('[data-r=busca]').oninput = function (e) { c.busca = e.target.value; pintar(true, true); };
    }
    var q = function (r) { return T.el.querySelector('[data-r=' + r + ']'); };
    q('kpis').innerHTML = kpis(it, c, xs).map(function (k) { return '<div class="tb-kpi"><span>' + esc(k.t) + '</span><b>' + esc(k.v) + '</b><em>' + esc(k.s) + '</em></div>'; }).join('');
    var un = fm ? (fm.unidad || (fm.virtual ? (fm.name === '__long_km' ? 'km' : 'ha') : '')) : '';
    q('rtit').textContent = '· top 10' + (fm ? ' por ' + alias(it, fm) + (un && alias(it, fm).indexOf('(') === -1 && alias(it, fm).toLowerCase().indexOf(un.toLowerCase()) === -1 ? ' (' + un + ')' : '') : ' (conteo)');
    q('atit').textContent = c.cat ? '· ' + alias(it, campoDe(it, c.cat)) : '';
    q('ttit').textContent = '· ' + xs.length + ' de ' + it.filas.length + ' registros' + (c.filtro ? ' (filtrado)' : '');
    q('rank').innerHTML = ranking(it, c, xs);
    q('anillo').innerHTML = anillo(it, c, xs);
    q('tabla').innerHTML = tabla(it, c, xs);
    Array.prototype.forEach.call(T.el.querySelectorAll('[data-fila]'), function (n) {
      n.onclick = function () { var i = +n.getAttribute('data-fila'); c.filtro = (c.filtro && c.filtro.t === 'fila' && c.filtro.v === i) ? null : { t: 'fila', v: i }; pintar(true); };
    });
    Array.prototype.forEach.call(T.el.querySelectorAll('[data-cat]'), function (n) {
      n.onclick = function () { var k = n.getAttribute('data-cat'); c.filtro = (c.filtro && c.filtro.t === 'cat' && c.filtro.v === k) ? null : { t: 'cat', v: k }; pintar(true); };
    });
    Array.prototype.forEach.call(T.el.querySelectorAll('th[data-ord]'), function (th) {
      th.onclick = function () { var n = th.getAttribute('data-ord'); if (c.orden === n) c.desc = !c.desc; else { c.orden = n; c.desc = true; } pintar(true); };
    });
    mapa(it, c, xs);
  }

  /* ── PDF del tablero ───────────────────────────────── */
  function mapaSvg(it, c) {
    var pts = [], gs = grupos(it, c, it.filas.map(function (r, i) { return { r: r, i: i }; })).map(function (g) { return g.k; });
    it.filas.forEach(function (r) {
      var g = r._g; if (!g) return;
      (g.rings || g.paths || []).forEach(function (a) { a.forEach(function (p) { pts.push(p); }); });
      if (g.x !== undefined) pts.push([g.x, g.y]);
    });
    if (!pts.length) return '';
    var x0 = Math.min.apply(null, pts.map(function (p) { return p[0]; })), x1 = Math.max.apply(null, pts.map(function (p) { return p[0]; })),
      y0 = Math.min.apply(null, pts.map(function (p) { return p[1]; })), y1 = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    var k = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 520, w = (x1 - x0) * k || 1e-6, h = (y1 - y0) || 1e-6, H = Math.min(360, W * h / w), sc = Math.min(W / w, H / h);
    function P(p) { return ((p[0] - x0) * k * sc + 6).toFixed(1) + ',' + ((y1 - p[1]) * sc + 6).toFixed(1); }
    var s = '<svg viewBox="0 0 ' + (w * sc + 12).toFixed(0) + ' ' + (h * sc + 12).toFixed(0) + '" class="m">';
    it.filas.forEach(function (r) {
      var g = r._g; if (!g) return; var col = colorFila(c, r, gs);
      if (g.rings) s += '<path d="' + g.rings.map(function (a) { return 'M' + a.map(P).join('L') + 'Z'; }).join('') + '" fill="' + col + '" fill-opacity=".6" stroke="#16302a" stroke-width=".6" fill-rule="evenodd"/>';
      else if (g.paths) s += '<path d="' + g.paths.map(function (a) { return 'M' + a.map(P).join('L'); }).join('') + '" fill="none" stroke="' + col + '" stroke-width="1.4"/>';
      else if (g.x !== undefined) { var q = P([g.x, g.y]).split(','); s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3" fill="' + col + '"/>'; }
    });
    return s + '</svg>';
  }
  function pdf() {
    var D = T.datos, f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    var css = '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font:11px/1.4 Arial,sans-serif;color:#16302a;margin:0}h1{font-size:20px;margin:0;color:#0e5235}.sub{color:#555;margin:2px 0 10px}h2{font-size:14px;margin:0 0 6px;color:#0e5235;border-bottom:2px solid #18724a;padding-bottom:3px}.sec{page-break-after:always;padding:2px 0}.sec:last-child{page-break-after:auto}.k{display:flex;gap:8px;margin:8px 0}.k div{flex:1;border:1px solid #c9d6d0;border-radius:6px;padding:6px 8px;background:#f4f8f6}.k span{font-size:9px;color:#555;display:block}.k b{font-size:17px}.k em{font-size:9px;color:#555;font-style:normal;display:block}.g{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0}.b{display:grid;grid-template-columns:150px 1fr 60px;gap:6px;align-items:center;margin:2px 0;font-size:10px}.b i{display:block;height:9px;background:#4e79a7;border-radius:2px}.b b{text-align:right}.l{display:flex;gap:6px;align-items:center;font-size:10px;margin:2px 0}.l i{width:9px;height:9px;border-radius:2px;display:inline-block}.l b{margin-left:auto}svg.m{width:100%;border:1px solid #c9d6d0;border-radius:6px;background:#eef3f0}table{border-collapse:collapse;width:100%;margin-top:6px}th{background:#e8f1ec;text-align:left}th,td{border:1px solid #c9d6d0;padding:3px 5px;font-size:9px}td.n{text-align:right}.src{font-size:8px;color:#666;margin-top:6px}@page{margin:12mm}';
    var h = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(T.estado.titulo) + '</title><style>' + css + '</style></head><body>';
    D.items.forEach(function (it, n) {
      var c = T.cfg[n], xs = it.filas.map(function (r, i) { return { r: r, i: i }; }), fm = campoDe(it, c.medida);
      var top = xs.slice().sort(function (a, b) { return medidaDe(b.r, c) - medidaDe(a.r, c); }).slice(0, 10), mx = top.length ? (medidaDe(top[0].r, c) || 1) : 1;
      var l = c.cat ? grupos(it, c, xs) : [], tot = l.reduce(function (a, b) { return a + b.v; }, 0) || 1;
      h += '<section class="sec">' + (n === 0 ? '<h1>' + esc(T.estado.titulo) + '</h1><div class="sub">' + esc(D.aoi || '') + ' · ' + D.fecha.toLocaleDateString('es-CO') + (T.estado.nota ? ' — ' + esc(T.estado.nota) : '') + '</div>' : '') +
        '<h2>' + esc(it.capa.name) + '</h2><div class="k">' + kpis(it, c, xs).map(function (k) { return '<div><span>' + esc(k.t) + '</span><b>' + esc(k.v) + '</b><em>' + esc(k.s) + '</em></div>'; }).join('') + '</div>' +
        '<div class="g"><div><strong>Ranking' + (fm ? ' · ' + esc(alias(it, fm)) : '') + '</strong>' + top.map(function (x) { var m = medidaDe(x.r, c); return '<div class="b"><span>' + esc(corto(x.r[c.etiq] == null ? 'Sin dato' : x.r[c.etiq], 30)) + '</span><i style="width:' + Math.max(2, m / mx * 100) + '%"></i><b>' + num(m, 1) + '</b></div>'; }).join('') + '</div>' +
        '<div><strong>Participación' + (c.cat ? ' · ' + esc(alias(it, campoDe(it, c.cat))) : '') + '</strong>' + l.map(function (g, i) { return '<div class="l"><i style="background:' + PAL[i % PAL.length] + '"></i>' + esc(corto(g.k, 34)) + '<b>' + num(g.v / tot * 100, 0) + '%</b></div>'; }).join('') + '</div></div>' +
        mapaSvg(it, c) + '<table><thead><tr>' + it.campos.map(function (x) { return '<th>' + esc(alias(it, x)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        it.filas.slice(0, 200).map(function (r) { return '<tr>' + it.campos.map(function (x) { return '<td' + (x.num ? ' class="n"' : '') + '>' + esc(val(r[x.name], x)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' +
        (it.filas.length > 200 ? '<div class="src">Se muestran 200 de ' + it.filas.length + ' registros.</div>' : '') +
        '<div class="src">Fuente: CORPOCALDAS, servicio ArcGIS REST ' + esc(it.capa.url + '/' + it.capa.layerId) + '. Consulta: ' + D.fecha.toLocaleString('es-CO') + '. Áreas y longitudes calculadas sobre el elipsoide.</div></section>';
    });
    var d = f.contentWindow.document; d.open(); d.write(h + '</body></html>'); d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 4000); }, 400);
  }

  window.__pgtTablero = { abrir: abrir, cerrar: cerrar };
})();
