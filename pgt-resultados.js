/* Plataforma de Gestión Territorial · Resultados territoriales.
   Cruce de las capas de Ciudadanía (9) con el territorio elegido, con niveles ligados:
   Departamento (Caldas) → Municipio → Vereda. Las medidas son de la porción de cada capa DENTRO del territorio
   (hectáreas para polígonos, kilómetros para líneas), calculadas en el navegador con Turf.js sobre los servicios
   ArcGIS REST de CORPOCALDAS (solo lectura). */
(function () {
  'use strict';
  var IDS = ['caldas-municipios', 'caldas-veredas', 'rios-principales', 'drenajes-sencillos', 'red-vial', 'eep-sinap', 'eep-aica', 'cuencas', 'subcuencas'];
  var BASE_MUN = 'caldas-municipios', BASE_VER = 'caldas-veredas';
  var S = { mun: '', ver: '', lista: null, veredas: null, res: null, cruce: null, busy: false, cancel: false, msg: '', terr: null, seq: 0, off: {}, visSig: '', map: null, mapEl: null, mapKey: '' };
  var turfP = null;
  (function () { if (document.getElementById('pgt-res-x')) return; var st = document.createElement('style'); st.id = 'pgt-res-x'; st.textContent = '.r-chk{display:flex;flex-wrap:wrap;gap:8px 18px;margin:8px 0}.r-chk label{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}.r-chk i{width:10px;height:10px;border-radius:2px;display:inline-block}.r-chk em{color:#0b5cab;font-style:normal;font-size:11.5px}.r-capasel{margin-bottom:12px}'; document.head.appendChild(st); })();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nf(v, d) { return (v == null || !isFinite(v)) ? '—' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: d == null ? 1 : d }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
  function capas() { var all = window.__pgtCapas || []; return IDS.map(function (id) { return all.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean); }
  function capa(id) { return capas().filter(function (c) { return c.id === id; })[0]; }
  function base(c) { return c.url + '/' + c.layerId; }
  /* Capas que entran al análisis: las 7 de Ciudadanía + cualquier capa vectorial (ArcGIS) que esté encendida en Territorio. */
  function visibles() { return window.__pgtVisibles || {}; }
  function visSig() { return Object.keys(visibles()).sort().join(',') + '|' + (window.__pgtCapas || []).length; }
  function medibles() {
    var all = window.__pgtCapas || [], vis = visibles();
    return all.filter(function (c) {
      if (c.id === BASE_MUN || c.id === BASE_VER) return false;
      if (c.kind === 'wms' || !c.url) return false;
      return CRUCE_IDS.indexOf(c.id) !== -1 || (vis[c.id] != null);
    }).sort(function (a, b) { return CRUCE_IDS.indexOf(a.id) === -1 ? 1 : CRUCE_IDS.indexOf(b.id) === -1 ? -1 : 0; });
  }
  function elegidas() { return medibles().filter(function (c) { return !S.off[c.id]; }); }
  function wmsVisibles() { var vis = visibles(); return (window.__pgtCapas || []).filter(function (c) { return c.kind === 'wms' && vis[c.id] != null; }); }
  function esExtra(c) { return CRUCE_IDS.indexOf(c.id) === -1; }
  function esPoli(c, meta) { return /pol/i.test(meta && meta.geom || ''); }

  function cargarTurf() {
    if (window.turf) return Promise.resolve();
    if (!turfP) turfP = new Promise(function (ok, no) {
      var fuentes = ['vendor/turf.min.js?v=1', 'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js', 'https://unpkg.com/@turf/turf@6.5.0/turf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/Turf.js/6.5.0/turf.min.js'], i = 0;
      (function otra() {
        if (window.turf) return ok();
        if (i >= fuentes.length) { turfP = null; return no(new Error('No se pudo cargar la librería de cálculo espacial. Suba vendor/turf.min.js al repositorio.')); }
        var sc = document.createElement('script'); sc.src = fuentes[i++]; sc.onload = function () { window.turf ? ok() : otra(); }; sc.onerror = otra; document.head.appendChild(sc);
      })();
    });
    return turfP;
  }
  function meta(c) { var I = window.__pgtInforme; return I && I.campos ? I.campos(c) : Promise.resolve({ campos: [], geom: '' }); }
  async function campoNombre(c) {
    var m = await meta(c), cs = m.campos || [];
    var n = cs.filter(function (f) { return f.rol === 'nombre' && !f.virtual; })[0];
    if (n) return n.name;
    var d = (m.def || []).filter(function (x) { return cs.some(function (f) { return f.name === x && !f.virtual; }); })[0];
    return d || (cs.filter(function (f) { return !f.virtual; })[0] || {}).name || '';
  }

  /* ── Consultas ──────────────────────────────────────── */
  async function traer(c, o) {
    try { return await traer1(c, o, false); }
    catch (e) { if ((o.fields || []).length && /execute|operation|invalid|field/i.test(e.message)) return await traer1(c, o, true); throw e; }
  }
  async function traer1(c, o, todos) {
    var P = { f: 'json', outSR: '4326', geometryPrecision: '5', outFields: (todos || !(o.fields || []).length) ? '*' : o.fields.join(','), returnGeometry: o.geom === false ? 'false' : 'true', where: o.where || '1=1' };
    if (o.offset) P.maxAllowableOffset = String(o.offset);
    if (o.rings) { P.geometry = JSON.stringify({ rings: o.rings, spatialReference: { wkid: 4326 } }); P.geometryType = 'esriGeometryPolygon'; P.inSR = '4326'; P.spatialRel = 'esriSpatialRelIntersects'; }
    var out = [], off = 0;
    for (;;) {
      var r = await fetch(base(c) + '/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams(Object.assign({}, P, { resultOffset: String(off), resultRecordCount: '1000' })) });
      if (!r.ok) throw new Error('El servicio respondió HTTP ' + r.status + '.');
      var j = await r.json(); if (j.error) throw new Error(j.error.message || 'Error consultando la capa.');
      var fs = j.features || []; out = out.concat(fs);
      if (!j.exceededTransferLimit || !fs.length || out.length >= 20000) break;
      off += fs.length;
    }
    return out;
  }
  function attr(f, nom) { var a = f.attributes || {}; if (!nom) return undefined; if (a[nom] !== undefined) return a[nom]; var k = Object.keys(a).filter(function (x) { return x.toLowerCase() === nom.toLowerCase(); })[0]; return k ? a[k] : undefined; }

  /* ── Geometría ──────────────────────────────────────── */
  function anilloArea(r) { var s = 0, rad = Math.PI / 180; for (var i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * rad * (2 + Math.sin(r[i][1] * rad) + Math.sin(r[i + 1][1] * rad)); return s * 6378137 * 6378137 / 2; }
  function haEsri(rings) { var t = 0; rings.forEach(function (r) { t += anilloArea(r); }); return Math.abs(t) / 10000; }
  function kmSeg(a, b) { var R = 6371.0088, rad = Math.PI / 180, dl = (b[0] - a[0]) * rad, dp = (b[1] - a[1]) * rad; var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dl / 2) * Math.sin(dl / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function kmEsri(paths) { var t = 0; paths.forEach(function (p) { for (var i = 0; i < p.length - 1; i++) t += kmSeg(p[i], p[i + 1]); }); return t; }
  function pip(p, r) { var x = p[0], y = p[1], d = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) d = !d; } return d; }
  function aTurf(rings) {          // anillos Esri → MultiPolygon; exterior/hueco se decide por contención (no por orientación)
    var rs = rings.filter(function (r) { return r.length >= 4; }).map(function (r) { return { r: r, a: Math.abs(anilloArea(r)) }; }).sort(function (x, y) { return y.a - x.a; });
    var polys = [], pol = [];
    rs.forEach(function (o, i) {
      var cont = []; for (var j = 0; j < i; j++) if (pip(o.r[0], rs[j].r)) cont.push(j);
      if (cont.length % 2 === 0) { pol[i] = polys.length; polys.push([o.r]); }
      else { pol[i] = pol[cont[cont.length - 1]]; polys[pol[i]].push(o.r); }
    });
    return polys.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } } : null;
  }
  function aEsri(f) {              // Feature → anillos Esri orientados
    var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, rings = [];
    polys.forEach(function (p) { p.forEach(function (r, i) { var hor = anilloArea(r) < 0; rings.push(hor === (i === 0) ? r : r.slice().reverse()); }); });
    return rings;
  }
  function bbox(f) { return window.turf.bbox(f); }

  function crearTerritorio(rings, nombre) {
    var full = aTurf(rings); if (!full) throw new Error('El territorio no tiene geometría.');
    var simple = full;
    try { simple = window.turf.simplify(full, { tolerance: 0.0003, highQuality: false }); } catch (e) {}
    if (!simple || !simple.geometry || !simple.geometry.coordinates.length) simple = full;
    return { nombre: nombre, full: full, simple: simple, ha: window.turf.area(full) / 10000, bb: bbox(simple), rings: aEsri(simple) };
  }

  /* ── Análisis de una capa dentro del territorio ─────── */
  async function medir(c, terr) {
    var m = await meta(c), poli = esPoli(c, m), nom = await campoNombre(c);
    var feats = await traer(c, terr ? { rings: terr.rings, fields: nom ? [nom] : [], offset: 0.0002 } : { fields: nom ? [nom] : [], offset: 0.0008 });
    var items = {}, total = 0, n = 0, aprox = false, geo = [];
    for (var k = 0; k < feats.length; k++) {
      var f = feats[k], g = f.geometry; if (!g) continue;
      var v = 0, gj = null;
      if (poli && g.rings) {
        if (terr) { var ft = aTurf(g.rings); if (ft) { try { var it = window.turf.intersect(terr.simple, ft); v = it ? window.turf.area(it) / 10000 : 0; if (it && v > 0) { try { it = window.turf.truncate(it, { precision: 5, mutate: true }); } catch (e3) {} gj = it.geometry; } } catch (e) { aprox = true; v = 0; } } }
        else v = haEsri(g.rings);
      } else if (g.paths) {
        if (terr) {
          v = 0; var bb = terr.bb, runs = [];
          g.paths.forEach(function (p) {
            var cur = [], flush = function () { if (cur.length >= 2) runs.push(cur); cur = []; };
            for (var i = 0; i < p.length - 1; i++) {
              var a = p[i], b = p[i + 1], d = kmSeg(a, b), nn = Math.max(1, Math.ceil(d / 0.05));
              for (var s = 0; s < nn; s++) {
                var x = a[0] + (b[0] - a[0]) * (s + .5) / nn, y = a[1] + (b[1] - a[1]) * (s + .5) / nn, dentro = false;
                if (!(x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3])) dentro = window.turf.booleanPointInPolygon([x, y], terr.simple);
                if (dentro) {
                  v += d / nn;
                  if (!cur.length) cur.push([+(a[0] + (b[0] - a[0]) * s / nn).toFixed(5), +(a[1] + (b[1] - a[1]) * s / nn).toFixed(5)]);
                  cur.push([+(a[0] + (b[0] - a[0]) * (s + 1) / nn).toFixed(5), +(a[1] + (b[1] - a[1]) * (s + 1) / nn).toFixed(5)]);
                } else flush();
              }
            }
            flush();
          });
          if (runs.length) gj = { type: 'MultiLineString', coordinates: runs };
        } else v = kmEsri(g.paths);
      } else if (g.x !== undefined) { v = 1; if (terr) gj = { type: 'Point', coordinates: [+(+g.x).toFixed(5), +(+g.y).toFixed(5)] }; }
      if (terr && !(v > 0)) continue;
      n++; total += v;
      var nv = attr(f, nom), nombre = (nv != null && nv !== '') ? String(nv) : 'Sin nombre';
      items[nombre] = (items[nombre] || 0) + v;
      if (terr && gj) geo.push({ type: 'Feature', properties: { capa: c.name, nombre: nombre, medida: +v.toFixed(3), unidad: poli ? 'ha' : (g.x !== undefined ? 'punto' : 'km'), territorio: terr.nombre }, geometry: gj });
      if (k % 40 === 39) await new Promise(function (r) { setTimeout(r, 0); });
    }
    var lista = Object.keys(items).map(function (k2) { return { n: k2, v: items[k2] }; }).sort(function (a, b) { return b.v - a.v; });
    return { c: c, poli: poli, u: poli ? 'ha' : 'km', n: n, v: total, items: lista, geo: geo, aprox: aprox || feats.length >= 20000 };
  }
  var CRUCE_IDS = ['rios-principales', 'drenajes-sencillos', 'red-vial', 'eep-sinap', 'eep-aica', 'cuencas', 'subcuencas'];
  async function analizar(terr, onP, mi) {
    var out = [], cs = elegidas();
    for (var i = 0; i < cs.length; i++) {
      if (S.cancel || (mi && mi !== S.seq)) throw new Error('cancelado');
      if (onP) onP(cs[i].name, i, cs.length);
      try { out.push(await medir(cs[i], terr)); } catch (e) { if (e.message === 'cancelado') throw e; out.push({ c: cs[i], error: e.message }); }
    }
    return out;
  }

  /* ── Listas ligadas ─────────────────────────────────── */
  async function cargarListas() {
    if (S.lista) return;
    var cm = capa(BASE_MUN), cv = capa(BASE_VER); if (!cm || !cv) throw new Error('No están disponibles las capas de municipios y veredas.');
    var nm = await campoNombre(cm);
    var ms = await traer(cm, { fields: [nm], geom: false });
    S.lista = ms.map(function (f) { return attr(f, nm); }).filter(Boolean).sort(function (a, b) { return String(a).localeCompare(String(b), 'es'); });
    var vs = await traer(cv, { fields: ['ID_VEREDA', 'NOMBRE', 'MUNICIPIO'], geom: false });
    S.veredas = vs.map(function (f) { return f.attributes; });
  }
  function veredasDe(mun) {
    var m = norm(mun), l = (S.veredas || []).filter(function (v) { return norm(v.MUNICIPIO) === m; });
    var cuenta = {}; l.forEach(function (v) { cuenta[v.NOMBRE] = (cuenta[v.NOMBRE] || 0) + 1; });
    return l.map(function (v) { return { id: v.ID_VEREDA, nombre: v.NOMBRE, etq: cuenta[v.NOMBRE] > 1 ? v.NOMBRE + ' (' + v.ID_VEREDA + ')' : v.NOMBRE }; }).sort(function (a, b) { return a.etq.localeCompare(b.etq, 'es'); });
  }
  async function territorioMun(mun) {
    var cm = capa(BASE_MUN), nm = await campoNombre(cm);
    var fs = await traer(cm, { where: nm + "='" + String(mun).replace(/'/g, "''") + "'", fields: [nm] });
    var rings = []; fs.forEach(function (f) { if (f.geometry && f.geometry.rings) rings = rings.concat(f.geometry.rings); });
    return crearTerritorio(rings, 'Municipio de ' + mun);
  }
  async function territorioVer(v, mun) {
    var cv = capa(BASE_VER);
    var fs = await traer(cv, { where: 'ID_VEREDA=' + (isFinite(Number(v.id)) ? Number(v.id) : "'" + String(v.id).replace(/'/g, "''") + "'"), fields: ['ID_VEREDA', 'NOMBRE'] });
    var rings = []; fs.forEach(function (f) { if (f.geometry && f.geometry.rings) rings = rings.concat(f.geometry.rings); });
    return crearTerritorio(rings, 'Vereda ' + v.nombre + ' (' + mun + ')');
  }
  async function territorioCaldas() {
    var cm = capa(BASE_MUN), fs = await traer(cm, { fields: [], offset: 0.0008 }), ha = 0;
    fs.forEach(function (f) { if (f.geometry && f.geometry.rings) ha += haEsri(f.geometry.rings); });
    return { nombre: 'Departamento de Caldas', ha: ha, caldas: true };
  }

  /* ── Cálculo principal ──────────────────────────────── */
  async function calcular(root) {
    var mi = ++S.seq; S.busy = true; S.cancel = false; S.res = null; S.cruce = null; S.msg = 'Preparando…'; S.terr = null; pintar(root);
    try {
      await cargarTurf(); await cargarListas();
      var terr;
      if (S.ver) { var v = veredasDe(S.mun).filter(function (x) { return String(x.id) === String(S.ver); })[0]; S.msg = 'Cargando el límite de la vereda…'; pintar(root); terr = await territorioVer(v, S.mun); }
      else if (S.mun) { S.msg = 'Cargando el límite del municipio…'; pintar(root); terr = await territorioMun(S.mun); }
      else { S.msg = 'Cargando el límite del departamento…'; pintar(root); terr = await territorioCaldas(); }
      if (mi !== S.seq) return; S.terr = terr;
      var rs = await analizar(terr.caldas ? null : terr, function (n, i, t) { if (mi === S.seq) { S.msg = 'Analizando ' + n + ' (' + (i + 1) + ' de ' + t + ')…'; pintar(root); } }, mi);
      if (mi !== S.seq) return;
      S.res = rs; S.msg = ''; S.mapKey = ''; S.mapTs = Date.now(); S.visSig = visSig();
    } catch (e) { if (mi !== S.seq) return; S.msg = e.message === 'cancelado' ? 'Cálculo cancelado.' : 'No se pudo completar: ' + e.message; }
    if (mi === S.seq) { S.busy = false; pintar(root); }
  }

  async function calcularCruce(root) {
    if (!S.terr || S.busy) return;
    var mi = ++S.seq; S.busy = true; S.cancel = false; S.cruce = { filas: [], total: 0, hecho: 0, tipo: S.mun ? 'vereda' : 'municipio' };
    try {
      await cargarTurf();
      var unidades;
      if (S.mun) unidades = veredasDe(S.mun).map(function (v) { return { etq: v.etq, id: v.id, hijo: v }; });
      else unidades = S.lista.map(function (m) { return { etq: m, id: m }; });
      S.cruce.total = unidades.length;
      for (var i = 0; i < unidades.length; i++) {
        if (S.cancel) break;
        var u = unidades[i]; S.msg = 'Cruzando ' + u.etq + ' (' + (i + 1) + ' de ' + unidades.length + ')…'; pintar(root);
        try {
          var t = S.mun ? await territorioVer(u.hijo, S.mun) : await territorioMun(u.id);
          var r = await analizar(t, null, mi), fila = { etq: u.etq, id: u.id, ha: t.ha, v: {} };
          r.forEach(function (x) { if (!x.error) fila.v[x.c.id] = x.v; });
          S.cruce.filas.push(fila);
        } catch (e) { if (e.message === 'cancelado') break; S.cruce.filas.push({ etq: u.etq, id: u.id, error: e.message, v: {} }); }
        S.cruce.hecho = i + 1;
      }
      S.msg = S.cancel ? 'Cruce detenido; se muestran las unidades ya calculadas.' : '';
    } catch (e) { S.msg = 'No se pudo completar el cruce: ' + e.message; }
    S.busy = false; pintar(root);
  }

  /* ── Pantalla ───────────────────────────────────────── */
  function barras(items, max, color, u) {
    return '<div class="r-hb">' + items.map(function (it) {
      return '<div class="r-hbr"><span class="r-hbl">' + esc(it.n) + '</span><span class="r-hbt"><i style="width:' + Math.max(1, it.v / max * 100) + '%;background:' + color + '"></i></span><b>' + nf(it.v, 1) + ' ' + u + '</b></div>';
    }).join('') + '</div>';
  }
  function tablaCapas() {
    var rs = S.res || []; if (!rs.length) return '';
    var ok = rs.filter(function (x) { return !x.error; }), caldas = S.terr && S.terr.caldas, ha = S.terr && S.terr.ha;
    var h = '<table class="r-tab"><thead><tr><th>Capa</th><th>Elementos</th><th>Medida</th><th>' + (caldas ? '' : '% del territorio / densidad') + '</th></tr></thead><tbody>';
    rs.forEach(function (x) {
      if (x.error) { h += '<tr><td><i style="background:' + esc(x.c.color) + '"></i>' + esc(x.c.name) + '</td><td colspan="3" class="r-nota">No disponible: ' + esc(x.error) + '</td></tr>'; return; }
      var ex = '';
      if (ha && x.poli) ex = nf(x.v / ha * 100, 1) + ' % del territorio';
      else if (ha) ex = nf(x.v / (ha / 100), 2) + ' km/km²';
      h += '<tr><td><i style="background:' + esc(x.c.color) + '"></i>' + esc(x.c.name) + '</td><td class="n">' + nf(x.n, 0) + '</td><td class="n">' + nf(x.v, 1) + ' ' + x.u + (x.aprox ? ' *' : '') + '</td><td>' + ex + '</td></tr>';
    });
    wmsVisibles().forEach(function (c) { h += '<tr><td><i style="background:' + esc(c.color || '#64748b') + '"></i>' + esc(c.name) + ' <em>(WMS)</em></td><td colspan="3" class="r-nota">Capa de imagen encendida en el mapa: se incluye como referencia, no se mide.</td></tr>'; });
    return h + '</tbody></table>' + (ok.some(function (x) { return x.aprox; }) ? '<p class="r-nota">* Cifra aproximada: algunos elementos no pudieron recortarse o la capa superó el límite de 20.000 elementos consultados.</p>' : '');
  }
  function detalle() {
    return (S.res || []).filter(function (x) { return !x.error && x.items.length; }).map(function (x) {
      var top = x.items.slice(0, 12), max = top[0].v || 1;
      return '<details class="r-det"><summary><i style="background:' + esc(x.c.color) + '"></i>' + esc(x.c.name) + ' <span>' + nf(x.items.length, 0) + ' nombre(s)</span></summary>' + barras(top, max, x.c.color || '#18724a', x.u) + (x.items.length > 12 ? '<p class="r-nota">Se muestran los 12 mayores de ' + x.items.length + '.</p>' : '') + '</details>';
    }).join('');
  }
  function cruceHtml() {
    var tipo = S.mun ? 'veredas' : 'municipios', Cs = elegidas();
    var h = '<div class="r-cruce"><div class="r-ctl2">';
    if (S.busy && S.cruce) h += '<button type="button" data-r="cancel">Detener</button>'; else h += '<button type="button" data-r="cruce"' + (S.busy || !S.terr ? ' disabled' : '') + '>Calcular cruce por ' + tipo + '</button>';
    h += '<span class="r-nota">Mide cada capa dentro de cada unidad; puede tardar varios minutos.</span></div>';
    if (S.cruce && S.cruce.filas.length) {
      h += '<div class="r-scroll"><table class="r-tab"><thead><tr><th>' + (S.mun ? 'Vereda' : 'Municipio') + '</th><th>Área (ha)</th>' + Cs.map(function (c) { return '<th>' + esc(c.name) + '<br><small>' + (/rios|drenajes|vial/.test(c.id) ? 'km' : 'ha') + '</small></th>'; }).join('') + '</tr></thead><tbody>';
      S.cruce.filas.forEach(function (f) {
        h += '<tr><td>' + (S.mun ? esc(f.etq) : '<a href="#" data-m="' + esc(f.id) + '">' + esc(f.etq) + '</a>') + '</td>' + (f.error ? '<td colspan="' + (Cs.length + 1) + '" class="r-nota">' + esc(f.error) + '</td>' : '<td class="n">' + nf(f.ha, 0) + '</td>' + Cs.map(function (c) { return '<td class="n">' + nf(f.v[c.id], 1) + '</td>'; }).join('')) + '</tr>';
      });
      h += '</tbody></table></div><p class="r-nota">' + S.cruce.hecho + ' de ' + S.cruce.total + ' ' + tipo + ' calculados.' + (S.mun ? '' : ' Pulse un municipio para bajar de nivel.') + '</p>';
    }
    return h + '</div>';
  }
  function kpis() {
    if (!S.res || !S.terr) return '';
    var g = function (id) { return (S.res.filter(function (x) { return x.c.id === id && !x.error; })[0]) || null; };
    var sinap = g('eep-sinap'), rios = g('rios-principales'), via = g('red-vial'), sub = g('subcuencas');
    var k = function (t, v, e, col) { return '<div class="r-kpi" style="border-top-color:' + col + '"><span>' + t + '</span><b>' + v + '</b><em>' + e + '</em></div>'; };
    var ha = S.terr.ha;
    return '<div class="r-kpis">' + k('Área del territorio', nf(ha, 0) + ' ha', S.terr.nombre, '#334155') +
      (sinap ? k('Áreas SINAP', nf(sinap.v, 0) + ' ha', ha ? nf(sinap.v / ha * 100, 1) + ' % del territorio' : '', '#166534') : '') +
      (rios ? k('Ríos principales', nf(rios.v, 1) + ' km', nf(rios.n, 0) + ' tramo(s)', '#0e7490') : '') +
      (via ? k('Red vial', nf(via.v, 1) + ' km', nf(via.n, 0) + ' tramo(s)', '#a16207') : '') +
      (sub ? k('Subcuencas', nf(sub.n, 0), 'que tocan el territorio', '#0284c7') : '') + '</div>';
  }


  /* ── Capas del reporte (encendidas en Territorio + WMS) ── */
  function panelCapas() {
    var ms = medibles(), w = wmsVisibles();
    var h = '<section class="r-sec r-capasel"><div class="r-kick">Capas del reporte</div><h2>¿Qué capas entran en el análisis?</h2><div class="r-chk">';
    ms.forEach(function (c) {
      h += '<label><input type="checkbox" data-r="sel" data-id="' + esc(c.id) + '"' + (S.off[c.id] ? '' : ' checked') + '> <i style="background:' + esc(c.color || '#64748b') + '"></i>' + esc(c.name) + (esExtra(c) ? ' <em>(encendida en Territorio)</em>' : '') + '</label>';
    });
    h += '</div>';
    if (w.length) h += '<p class="r-nota">Capas WMS encendidas (se muestran en el mapa y se listan en el informe, pero al ser imagen no se pueden medir): ' + w.map(function (c) { return '<b>' + esc(c.name) + '</b>'; }).join(', ') + '.</p>';
    h += '<p class="r-nota">Para sumar otra capa, enciéndala en Territorio o conecte un servicio ArcGIS/WMS y vuelva aquí: aparece sola en esta lista. Luego pulse «Calcular».</p></section>';
    return h;
  }
  function geoTodo() {
    var fc = { type: 'FeatureCollection', features: [] };
    if (S.terr && S.terr.full) fc.features.push({ type: 'Feature', properties: { capa: 'Territorio', nombre: S.terr.nombre, medida: +(S.terr.ha || 0).toFixed(2), unidad: 'ha' }, geometry: S.terr.full.geometry });
    (S.res || []).forEach(function (x) { if (!x.error && x.geo) fc.features = fc.features.concat(x.geo); });
    return fc;
  }
  function bajarGeo(fc, nombre) {
    var b = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = nombre + '.geojson'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
  }
  function slug(t) { return String(t || 'territorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_'); }
  function seccionMapa() {
    if (!S.res || !S.terr) return '';
    if (S.terr.caldas) return '<section class="r-sec r-mapsec"><div class="r-kick">Mapa</div><h2>Capas recortadas al territorio</h2><p class="r-nota">Elige un municipio o una vereda para ver en el mapa las capas recortadas y descargarlas en GeoJSON.</p></section>';
    var con = S.res.filter(function (x) { return !x.error && x.geo && x.geo.length; });
    return '<section class="r-sec r-mapsec"><div class="r-kick">Mapa</div><h2>Capas recortadas al territorio</h2><div id="r-map" style="height:540px;border:1px solid #e5e7eb;border-radius:10px;background:#eef2f7"></div>' +
      '<div class="r-geo" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center"><button type="button" data-r="geo" style="border:0;background:#166534;color:#fff;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer">Descargar GeoJSON (todas las capas)</button>' +
      con.map(function (x) { return '<button type="button" data-r="geo1" data-id="' + esc(x.c.id) + '" style="border:1px solid #166534;background:#fff;color:#166534;border-radius:8px;padding:6px 10px;font-weight:600;cursor:pointer">' + esc(x.c.name) + '</button>'; }).join('') + '</div>' +
      '<div class="r-fuente">Fuente: servicios de CORPOCALDAS (y capas encendidas en Territorio), recortados al límite oficial de ' + esc(S.terr.nombre) + '. Coordenadas WGS84 (EPSG:4326).</div></section>';
  }
  function mapaRes(root) {
    var el = root.querySelector('#r-map'); if (!el || !S.res || !S.terr || S.terr.caldas) return;
    var L = window.L || window.__pgtL; if (!L) { el.innerHTML = '<p class="r-nota" style="padding:14px">No se pudo cargar el visor de mapa.</p>'; return; }
    var key = S.mapKey || (S.mapKey = S.terr.nombre + '|' + S.mapTs);
    if (S.map && S.mapEl && S.mapEl.__key === key) { el.replaceWith(S.mapEl); try { S.map.invalidateSize(); } catch (e) {} return; }
    if (S.map) { try { S.map.remove(); } catch (e) {} S.map = null; }
    var m = L.map(el, { preferCanvas: true }); S.map = m; S.mapEl = el; el.__key = key;
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }).addTo(m);
    var ov = {}, tl = L.geoJSON(S.terr.full, { style: { color: '#111827', weight: 3, fill: false } }).addTo(m); ov['Límite: ' + S.terr.nombre] = tl;
    S.res.forEach(function (x) {
      if (x.error || !x.geo || !x.geo.length) return; var col = x.c.color || '#18724a';
      var lyr = L.geoJSON({ type: 'FeatureCollection', features: x.geo }, {
        style: function () { return { color: col, weight: x.poli ? 1.5 : 3, fillColor: col, fillOpacity: x.poli ? 0.3 : 0 }; },
        pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1, fillColor: col, fillOpacity: 0.9 }); },
        onEachFeature: function (f, l) { var p = f.properties; l.bindPopup('<b>' + esc(p.capa) + '</b><br>' + esc(p.nombre) + '<br>' + nf(p.medida, 2) + ' ' + esc(p.unidad)); }
      }).addTo(m);
      ov[x.c.name] = lyr;
    });
    wmsVisibles().forEach(function (c) { try { ov[c.name + ' (WMS)'] = L.tileLayer.wms(c.url, { layers: c.wmsLayers || '0', format: 'image/png', transparent: true, opacity: 0.7 }).addTo(m); } catch (e) {} });
    L.control.layers(null, ov, { collapsed: false }).addTo(m);
    try { m.fitBounds(tl.getBounds(), { padding: [20, 20] }); } catch (e) { m.setView([5.28, -75.25], 9); }
    setTimeout(function () { try { m.invalidateSize(); } catch (e) {} }, 150);
  }

  function pintar(root) {
    var activo = document.activeElement && root.contains(document.activeElement) ? document.activeElement.getAttribute('data-r') : null;
    var munOpts = '<option value="">Todos los municipios</option>' + (S.lista || []).map(function (m) { return '<option' + (m === S.mun ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    var verOpts = '<option value="">Todas las veredas</option>' + (S.mun ? veredasDe(S.mun).map(function (v) { return '<option value="' + esc(v.id) + '"' + (String(v.id) === String(S.ver) ? ' selected' : '') + '>' + esc(v.etq) + '</option>'; }).join('') : '');
    var nivel = S.ver ? 'Vereda' : S.mun ? 'Municipio' : 'Departamento';
    var bread = 'Colombia › Caldas' + (S.mun ? ' › ' + esc(S.mun) : '') + (S.ver ? ' › ' + esc((veredasDe(S.mun).filter(function (v) { return String(v.id) === String(S.ver); })[0] || {}).etq || '') : '');
    var cab = '<header class="r-cab"><div><div class="r-bread">' + bread + '</div><h1>Resultados territoriales</h1><div class="r-sub">Cruce de las capas de Ciudadanía con el ' + nivel.toLowerCase() + ' elegido · niveles ligados Departamento → Municipio → Vereda</div></div>' +
      '<div class="r-ctl"><label>Departamento<select disabled><option>Caldas</option></select></label>' +
      '<label>Municipio<select data-r="mun">' + munOpts + '</select></label>' +
      '<label>Vereda<select data-r="ver"' + (S.mun ? '' : ' disabled') + '>' + verOpts + '</select></label>' +
      '<button type="button" data-r="calc"' + (S.busy ? ' disabled' : '') + '>Calcular</button></div></header>';
    var cuerpo, panel = panelCapas(); S.visSig = visSig();
    if (S.busy && !S.res) cuerpo = '<section class="r-vacio"><h2>' + esc(S.msg || 'Calculando…') + '</h2><p>Se están cruzando las capas con el territorio. Esto puede tardar de unos segundos a un par de minutos.</p><button type="button" data-r="cancel">Cancelar</button></section>';
    else if (!S.res) cuerpo = '<section class="r-vacio"><h2>' + (S.msg ? esc(S.msg) : 'Elige el territorio y pulsa «Calcular»') + '</h2><p>Los niveles están ligados: al elegir un municipio se habilitan sus veredas. Solo se evalúan las 9 capas de Ciudadanía.</p></section>';
    else {
      cuerpo = (S.msg ? '<div class="r-aviso">' + esc(S.msg) + '</div>' : '') + kpis() + seccionMapa() +
        '<section class="r-sec"><div class="r-kick">Capas en el territorio</div><h2>Resumen por capa</h2>' + tablaCapas() + '<div class="r-fuente">Fuente: servicios ArcGIS REST de CORPOCALDAS (capas de Ciudadanía), consulta del ' + new Date().toLocaleDateString('es-CO') + '. Cálculo en el navegador sobre geometrías simplificadas (≈ 30 m); error esperado menor al 1 % en área.</div></section>' +
        '<section class="r-sec"><div class="r-kick">Detalle</div><h2>Por nombre dentro de cada capa</h2>' + detalle() + '</section>' +
        '<section class="r-sec"><div class="r-kick">Cruce ligado</div><h2>Cruce por ' + (S.terr && S.terr.caldas ? 'municipios' : S.mun && !S.ver ? 'veredas' : 'unidades') + '</h2>' + (S.ver ? '<p class="r-nota">Una vereda es el nivel más bajo; no tiene unidades por debajo.</p>' : cruceHtml()) + '</section>' +
        '<section class="r-sec"><p class="r-nota">Las medidas corresponden a la porción de cada capa dentro del territorio. Las líneas se miden por tramos dentro del límite; los polígonos se recortan al límite. Las capas de municipios y veredas definen los niveles y no se miden entre sí.</p></section>';
    }
    root.innerHTML = cab + '<div class="r-body">' + panel + cuerpo + '</div>' +
      (S.res ? '<div class="r-pie"><button type="button" data-r="aoi">Usar como área de interés en el mapa</button><button type="button" data-r="csv">Descargar CSV</button><button type="button" data-r="pdf">Descargar PDF</button></div>' : '');
    enlazar(root); mapaRes(root);
    if (activo) { var el = root.querySelector('[data-r=' + activo + ']'); if (el && !el.disabled) try { el.focus(); } catch (e) {} }
  }

  function enlazar(root) {
    var q = function (s) { return root.querySelector('[data-r=' + s + ']'); };
    if (q('mun')) q('mun').onchange = function (e) { S.mun = e.target.value; S.ver = ''; S.res = null; S.cruce = null; pintar(root); calcular(root); };
    if (q('ver')) q('ver').onchange = function (e) { S.ver = e.target.value; S.res = null; S.cruce = null; pintar(root); calcular(root); };
    if (q('calc')) q('calc').onclick = function () { calcular(root); };
    root.querySelectorAll('[data-r=cancel]').forEach(function (b) { b.onclick = function () { S.cancel = true; }; });
    if (q('cruce')) q('cruce').onclick = function () { calcularCruce(root); };
    root.querySelectorAll('[data-m]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); S.mun = a.getAttribute('data-m'); S.ver = ''; S.res = null; S.cruce = null; pintar(root); calcular(root); root.scrollIntoView({ behavior: 'smooth' }); }; });
    if (q('aoi')) q('aoi').onclick = function () {
      if (!S.terr || S.terr.caldas) { alert('Elige un municipio o una vereda para enviarlo al mapa.'); return; }
      if (window.__pgtAoi) { try { window.__pgtAoi(S.terr.full, S.terr.nombre); S.msg = 'Área enviada al mapa de Territorio.'; pintar(root); } catch (e) { S.msg = 'No se pudo enviar el área: ' + e.message; pintar(root); } }
    };
    root.querySelectorAll('[data-r=sel]').forEach(function (cb) { cb.onchange = function () { S.off[cb.getAttribute('data-id')] = !cb.checked; }; });
    if (q('geo')) q('geo').onclick = function () { bajarGeo(geoTodo(), 'resultados_' + slug(S.terr.nombre)); };
    root.querySelectorAll('[data-r=geo1]').forEach(function (b) { b.onclick = function () { var x = (S.res || []).filter(function (r) { return r.c.id === b.getAttribute('data-id'); })[0]; if (x) bajarGeo({ type: 'FeatureCollection', features: x.geo || [] }, slug(x.c.name) + '_' + slug(S.terr.nombre)); }; });
    if (q('csv')) q('csv').onclick = csv;
    if (q('pdf')) q('pdf').onclick = function () { pdf(root); };
  }

  function csv() {
    var out = [['Territorio', 'Capa', 'Elementos', 'Medida', 'Unidad'].join(';')];
    (S.res || []).forEach(function (x) { if (!x.error) out.push([S.terr.nombre, x.c.name, x.n, String(x.v.toFixed(2)).replace('.', ','), x.u].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';')); });
    if (S.cruce && S.cruce.filas.length) {
      var Cs = elegidas();
      out.push(''); out.push([S.mun ? 'Vereda' : 'Municipio', 'Area_ha'].concat(Cs.map(function (c) { return c.name; })).join(';'));
      S.cruce.filas.forEach(function (f) { if (!f.error) out.push(['"' + f.etq + '"', String((f.ha || 0).toFixed(1)).replace('.', ',')].concat(Cs.map(function (c) { return f.v[c.id] == null ? '' : String(f.v[c.id].toFixed(2)).replace('.', ','); })).join(';')); });
    }
    var b = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'resultados_' + (S.terr.nombre || 'territorio').replace(/[^\w]+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  function pdf(root) {
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    var clon = root.cloneNode(true); ['.r-ctl', '.r-pie', '.r-ctl2', '.r-mapsec', '.r-capasel'].forEach(function (s) { clon.querySelectorAll(s).forEach(function (n) { n.remove(); }); });
    var css = new URL('pgt-resultados.css', location.href).href, d = f.contentWindow.document;
    d.open(); d.write('<!doctype html><html><head><meta charset="utf-8"><title>Resultados territoriales</title><link rel="stylesheet" href="' + css + '"><style>body{background:#fff;margin:0}.r-root{max-width:none}.r-det{open:true}@page{margin:12mm}</style></head><body>' + clon.outerHTML.replace(/<details/g, '<details open') + '</body></html>'); d.close();
    var go = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 4000); };
    var l = d.querySelector('link'); if (l) { l.onload = function () { setTimeout(go, 200); }; l.onerror = go; } else setTimeout(go, 600);
  }

  /* ── Montaje en la pestaña «Resultados» ─────────────── */
  var pend = false, arrancado = false;
  function revisar() {
    var main = document.querySelector('main.dashboard-page');
    if (!main) { return; }
    var root = main.querySelector('.r-root');
    if (!root) {
      root = document.createElement('div'); root.className = 'r-root'; main.appendChild(root); main.classList.add('pgt-res2');
      arrancado = false;
    }
    if (arrancado && !S.busy && root && visSig() !== S.visSig) { S.visSig = visSig(); pintar(root); }
    if (arrancado || pend) return; pend = true;
    setTimeout(function () {
      pend = false; arrancado = true;
      var nom = (window.__pgtNombre && window.__pgtNombre()) || '';    // enlaza con la selección de Territorio
      var m = /^Municipio de (.+)$/.exec(nom);
      if (m) S.mun = m[1];
      cargarListas().then(function () {
        var v = /^Vereda (.+) \((.+)\)$/.exec(nom);
        if (v) { S.mun = (S.lista.filter(function (x) { return norm(x) === norm(v[2]); })[0]) || v[2]; var h = veredasDe(S.mun).filter(function (x) { return x.nombre === v[1]; })[0]; if (h) S.ver = h.id; }
        if (S.mun && !S.busy && !S.res) calcular(root); else pintar(root);
      }).catch(function (e) { S.msg = e.message; pintar(root); });
      pintar(root);
    }, 150);
  }
  new MutationObserver(revisar).observe(document.documentElement, { childList: true, subtree: true });
})();
