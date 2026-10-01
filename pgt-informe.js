/* Plataforma de Gestión Territorial · Consulta al clic y «Mi reporte».
   - Clic en el mapa: ventana con SOLO los campos que la persona eligió para cada capa visible.
   - Mi reporte: tablas armadas por capa y campos (nombre, área, etc.) para el área de interés o todo Caldas,
     con descarga en PDF (imprimir → guardar como PDF) y CSV.
   Consulta directamente los servicios ArcGIS REST públicos de CORPOCALDAS (solo lectura). */
(function () {
  'use strict';
  var LS_CAMPOS = 'pgt.campos.v1', LS_REPORTE = 'pgt.reporte.v1';
  var MAX_FILAS = 5000;
  var metas = {};            // id capa -> promesa con campos
  var estado = { tab: 'clic', secciones: [], titulo: 'Reporte territorial', nota: '', alcance: 'aoi', totales: true, datos: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lsGet(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function capas() { return (window.__pgtCapas || []).filter(function (c) { return c.kind === 'arcgis-dynamic' && c.layerId !== undefined && c.queryable !== false; }); }
  function capa(id) { return capas().filter(function (c) { return c.id === id; })[0]; }
  function base(c) { return c.url + '/' + c.layerId; }

  /* ── Campos de una capa ─────────────────────────────── */
  var VIRT = [
    { name: '__area_ha', alias: 'Área calculada (ha)', virtual: true, num: true, geom: true },
    { name: '__long_km', alias: 'Longitud calculada (km)', virtual: true, num: true, geom: true }
  ];
  function campos(c) {
    if (metas[c.id]) return metas[c.id];
    metas[c.id] = fetch(base(c) + '?f=json').then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message || 'Error leyendo la capa.');
      var gt = j.geometryType || '';
      var cs = (j.fields || []).filter(function (f) { return f.type !== 'esriFieldTypeGeometry' && !/^shape/i.test(f.name) && f.type !== 'esriFieldTypeBlob'; })
        .map(function (f) { return { name: f.name, alias: f.alias || f.name, type: f.type, num: /Double|Integer|Single|SmallInteger/.test(f.type), fecha: f.type === 'esriFieldTypeDate' }; });
      if (/Polygon/.test(gt)) cs.push(VIRT[0]); else if (/Polyline/.test(gt)) cs.push(VIRT[1]);
      return { campos: cs, geom: gt };
    }).catch(function (e) { delete metas[c.id]; throw e; });
    return metas[c.id];
  }
  function porDefecto(cs) {
    var nom = cs.filter(function (f) { return /^(nombre|name|nom_|nombre_)/i.test(f.name) || /nombre/i.test(f.alias); }).slice(0, 1);
    var ar = cs.filter(function (f) { return /area|hect|^ha$|shape_area/i.test(f.name + ' ' + f.alias) && !f.virtual; }).slice(0, 1);
    var v = cs.filter(function (f) { return f.virtual; }).slice(0, 1);
    var sel = nom.concat(ar.length ? ar : v);
    return (sel.length ? sel : cs.slice(0, 2)).map(function (f) { return f.name; });
  }

  /* ── Geometría ──────────────────────────────────────── */
  function anilloArea(r) {   // área esférica con signo (m²); positivo = antihorario
    var R = 6378137, s = 0, rad = Math.PI / 180;
    for (var i = 0, n = r.length - 1; i < n; i++) {
      s += (r[i + 1][0] - r[i][0]) * rad * (2 + Math.sin(r[i][1] * rad) + Math.sin(r[i + 1][1] * rad));
    }
    return s * R * R / 2;
  }
  function areaHa(g) {
    var t = 0; (g.rings || []).forEach(function (r) { t += anilloArea(r); });
    return Math.abs(t) / 10000;
  }
  function longKm(g) {
    var R = 6371008.8, rad = Math.PI / 180, t = 0;
    (g.paths || []).forEach(function (p) {
      for (var i = 0; i < p.length - 1; i++) {
        var a = p[i], b = p[i + 1], dl = (b[0] - a[0]) * rad, dp = (b[1] - a[1]) * rad;
        var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dl / 2) * Math.sin(dl / 2);
        t += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
      }
    });
    return t / 1000;
  }
  function aEsri(geo) {      // GeoJSON Polygon/MultiPolygon → anillos Esri (exterior horario, huecos antihorario)
    var polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' ? geo.coordinates : [];
    var rings = [];
    polys.forEach(function (p) {
      p.forEach(function (r, i) {
        var horario = anilloArea(r) < 0;
        var quiereHorario = i === 0;
        rings.push(horario === quiereHorario ? r : r.slice().reverse());
      });
    });
    return { rings: rings, spatialReference: { wkid: 4326 } };
  }

  /* ── Consultas ──────────────────────────────────────── */
  async function consultar(c, opt) {
    var meta = await campos(c);
    var cs = meta.campos, sel = opt.campos || [];
    var virt = cs.filter(function (f) { return f.virtual && sel.indexOf(f.name) !== -1; });
    var out = cs.filter(function (f) { return !f.virtual && sel.indexOf(f.name) !== -1; }).map(function (f) { return f.name; });
    var P = { f: 'json', outSR: '4326', geometryPrecision: '5', outFields: out.length ? out.join(',') : '*', returnGeometry: virt.length ? 'true' : 'false' };
    if (opt.punto) {
      P.geometry = JSON.stringify({ x: opt.punto.lng, y: opt.punto.lat, spatialReference: { wkid: 4326 } });
      P.geometryType = 'esriGeometryPoint'; P.inSR = '4326'; P.spatialRel = 'esriSpatialRelIntersects';
      if (opt.tolM) { P.distance = String(Math.round(opt.tolM)); P.units = 'esriSRUnit_Meter'; }
    } else if (opt.aoi) {
      P.geometry = JSON.stringify(aEsri(opt.aoi)); P.geometryType = 'esriGeometryPolygon'; P.inSR = '4326'; P.spatialRel = 'esriSpatialRelIntersects';
    } else { P.where = '1=1'; }
    if (!P.geometry) P.where = '1=1';
    var filas = [], off = 0, truncado = false;
    for (;;) {
      var Q = Object.assign({}, P, { resultOffset: String(off), resultRecordCount: String(opt.max && opt.max < 1000 ? opt.max : 1000) });
      var r = await fetch(base(c) + '/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams(Q) });
      if (!r.ok) throw new Error('El servicio respondió HTTP ' + r.status + '.');
      var j = await r.json(); if (j.error) throw new Error(j.error.message || 'Error consultando la capa.');
      var fs = j.features || [];
      fs.forEach(function (f) {
        var a = Object.assign({}, f.attributes || {});
        if (f.geometry) { a.__area_ha = areaHa(f.geometry); a.__long_km = longKm(f.geometry); }
        filas.push(a);
      });
      if (opt.max && filas.length >= opt.max) { truncado = filas.length > opt.max || !!j.exceededTransferLimit; filas.length = Math.min(filas.length, opt.max); break; }
      if (!j.exceededTransferLimit || !fs.length) break;
      off += fs.length;
      if (filas.length >= MAX_FILAS) { truncado = true; break; }
    }
    return { filas: filas, campos: cs, truncado: truncado };
  }

  function fmt(v, f) {
    if (v === null || v === undefined || v === '') return '—';
    if (f && f.fecha && typeof v === 'number') return new Date(v).toLocaleDateString('es-CO');
    if (typeof v === 'number') return v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    return String(v);
  }

  /* ── Clic en el mapa ────────────────────────────────── */
  var popup = null;
  function dibujando() {
    var t = document.querySelector('.leaflet-draw-tooltip'); return !!(t && t.style.display !== 'none' && t.offsetParent !== null);
  }
  async function alClic(e) {
    var map = window.__pgtMap, L = window.__pgtL; if (!map || !L || dibujando()) return;
    var vis = Object.keys(window.__pgtVisibles || {});
    var lista = capas().filter(function (c) { return vis.indexOf(c.id) !== -1; });
    var pos = e.latlng;
    popup = L.popup({ maxWidth: 360, className: 'pgi-popup' }).setLatLng(pos).setContent('<div class="pgi-pop"><div class="pgi-nota">Consultando…</div></div>').openOn(map);
    if (!lista.length) { popup.setContent('<div class="pgi-pop"><div class="pgi-nota">Activa una capa de la lista para consultar al hacer clic.</div></div>'); return; }
    var res = 156543.03 * Math.cos(pos.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    var guardados = lsGet(LS_CAMPOS, {});
    var html = [];
    await Promise.all(lista.map(async function (c) {
      try {
        var meta = await campos(c);
        var sel = guardados[c.id] && guardados[c.id].length ? guardados[c.id] : porDefecto(meta.campos);
        var r = await consultar(c, { punto: pos, tolM: res * 8, campos: sel, max: 5 });
        if (!r.filas.length) return;
        var cs = sel.map(function (n) { return meta.campos.filter(function (f) { return f.name === n; })[0]; }).filter(Boolean);
        var h = '<div class="pgi-capa"><div class="pgi-capa-t"><i style="background:' + esc(c.color) + '"></i>' + esc(c.name) + '</div>';
        r.filas.forEach(function (fila) {
          h += '<table class="pgi-tab">' + cs.map(function (f) { return '<tr><th>' + esc(f.alias) + '</th><td>' + esc(fmt(fila[f.name], f)) + '</td></tr>'; }).join('') + '</table>';
        });
        html.push({ i: lista.indexOf(c), h: h + '</div>' });
      } catch (err) { html.push({ i: lista.indexOf(c), h: '<div class="pgi-capa"><div class="pgi-capa-t">' + esc(c.name) + '</div><div class="pgi-nota">No disponible: ' + esc(err.message) + '</div></div>' }); }
    }));
    html.sort(function (a, b) { return a.i - b.i; });
    popup.setContent('<div class="pgi-pop">' + (html.length ? html.map(function (x) { return x.h; }).join('') : '<div class="pgi-nota">Sin información de las capas visibles en este punto.</div>') +
      '<button type="button" class="pgi-link" data-pgi="campos">Elegir campos que se muestran</button></div>');
    var b = popup.getElement() && popup.getElement().querySelector('[data-pgi=campos]');
    if (b) b.onclick = function () { map.closePopup(); abrir('clic'); };
  }
  var enganchado = null;
  function engancharMapa() {
    var m = window.__pgtMap; if (!m || enganchado === m) return;
    enganchado = m; m.on('click', alClic);
  }

  /* ── Ventana «Mi reporte» ───────────────────────────── */
  var modal = null;
  function cerrar() { if (modal) { modal.remove(); modal = null; } }
  function abrir(tab) {
    estado.tab = tab || estado.tab;
    if (!estado.secciones.length) {
      var g = lsGet(LS_REPORTE, null);
      if (g && g.secciones) { estado.secciones = g.secciones; estado.titulo = g.titulo || estado.titulo; estado.nota = g.nota || ''; estado.alcance = g.alcance || 'aoi'; }
      else estado.secciones = [{ capa: (capas().filter(function (c) { return /sinap/.test(c.id); })[0] || capas()[0] || {}).id, campos: null, orden: '' }];
    }
    cerrar();
    modal = document.createElement('div'); modal.className = 'pgt-modal pgi-modal';
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(); });
    document.body.appendChild(modal);
    pintar();
  }
  function pintar() {
    if (!modal) return;
    modal.innerHTML = '<div class="pgi-card"><div class="pgi-cab"><div><span class="pgi-ey">Consulta y reportes</span><h2>' + (estado.tab === 'clic' ? 'Campos al hacer clic' : 'Mi reporte') + '</h2></div>' +
      '<button type="button" class="pgi-x" data-a="cerrar" aria-label="Cerrar">×</button></div>' +
      '<div class="pgi-tabs"><button type="button" data-t="clic" class="' + (estado.tab === 'clic' ? 'on' : '') + '">Campos al hacer clic</button><button type="button" data-t="rep" class="' + (estado.tab === 'rep' ? 'on' : '') + '">Mi reporte</button></div>' +
      '<div class="pgi-cuerpo" data-r="cuerpo"></div></div>';
    modal.querySelector('[data-a=cerrar]').onclick = cerrar;
    Array.prototype.forEach.call(modal.querySelectorAll('[data-t]'), function (b) { b.onclick = function () { estado.tab = b.getAttribute('data-t'); pintar(); }; });
    if (estado.tab === 'clic') pintarClic(); else pintarRep();
  }

  function listaCampos(c, cs, sel, nombre) {
    return '<div class="pgi-campos">' + cs.map(function (f) {
      return '<label><input type="checkbox" name="' + esc(nombre) + '" value="' + esc(f.name) + '"' + (sel.indexOf(f.name) !== -1 ? ' checked' : '') + '> ' + esc(f.alias) + (f.virtual ? ' <em>(se calcula)</em>' : '') + '</label>';
    }).join('') + '</div>';
  }

  function pintarClic() {
    var cuerpo = modal.querySelector('[data-r=cuerpo]'), guardados = lsGet(LS_CAMPOS, {});
    cuerpo.innerHTML = '<p class="pgi-ayuda">Elige, capa por capa, qué datos aparecen en la ventana al hacer clic en el mapa. Se guardan en este navegador.</p>' +
      capas().map(function (c) { return '<details class="pgi-det" data-c="' + esc(c.id) + '"><summary><i style="background:' + esc(c.color) + '"></i>' + esc(c.name) + '</summary><div class="pgi-nota">Abre para cargar los campos…</div></details>'; }).join('') +
      '<div class="pgi-pie"><button type="button" class="pgi-sec" data-a="cerrar2">Cerrar</button></div>';
    cuerpo.querySelector('[data-a=cerrar2]').onclick = cerrar;
    Array.prototype.forEach.call(cuerpo.querySelectorAll('details'), function (d) {
      d.addEventListener('toggle', async function () {
        if (!d.open || d.getAttribute('data-ok')) return;
        var c = capa(d.getAttribute('data-c')), box = d.querySelector('.pgi-nota');
        try {
          var meta = await campos(c);
          var sel = guardados[c.id] && guardados[c.id].length ? guardados[c.id] : porDefecto(meta.campos);
          d.setAttribute('data-ok', '1');
          box.outerHTML = listaCampos(c, meta.campos, sel, 'c_' + c.id);
          Array.prototype.forEach.call(d.querySelectorAll('input'), function (i) {
            i.onchange = function () {
              var g = lsGet(LS_CAMPOS, {});
              g[c.id] = Array.prototype.map.call(d.querySelectorAll('input:checked'), function (x) { return x.value; });
              lsSet(LS_CAMPOS, g);
            };
          });
        } catch (e) { box.textContent = 'No se pudieron leer los campos: ' + e.message; }
      });
    });
  }

  function pintarRep() {
    var cuerpo = modal.querySelector('[data-r=cuerpo]');
    var aoi = window.__pgtGetAoi && window.__pgtGetAoi();
    cuerpo.innerHTML =
      '<div class="pgi-fila2"><label>Título del reporte<input data-r="titulo" value="' + esc(estado.titulo) + '"></label>' +
      '<label>Alcance<select data-r="alcance"><option value="aoi"' + (estado.alcance === 'aoi' ? ' selected' : '') + '>Área de interés' + (aoi ? '' : ' (aún sin definir)') + '</option><option value="todo"' + (estado.alcance === 'todo' ? ' selected' : '') + '>Todo Caldas</option></select></label></div>' +
      '<label class="pgi-bl">Nota o descripción (opcional)<textarea data-r="nota" rows="2">' + esc(estado.nota) + '</textarea></label>' +
      '<div data-r="secs"></div>' +
      '<div class="pgi-fila3"><button type="button" class="pgi-sec" data-a="mas">+ Agregar tabla</button><label class="pgi-ch"><input type="checkbox" data-r="totales"' + (estado.totales ? ' checked' : '') + '> Fila de totales (áreas y números)</label></div>' +
      '<div class="pgi-pie"><button type="button" class="pgi-pri" data-a="gen">Generar reporte</button></div>' +
      '<div data-r="msg" class="pgi-nota"></div><div data-r="vista"></div>';
    var q = function (s) { return cuerpo.querySelector(s); };
    q('[data-r=titulo]').oninput = function (e) { estado.titulo = e.target.value; guardarRep(); };
    q('[data-r=nota]').oninput = function (e) { estado.nota = e.target.value; guardarRep(); };
    q('[data-r=alcance]').onchange = function (e) { estado.alcance = e.target.value; guardarRep(); };
    q('[data-r=totales]').onchange = function (e) { estado.totales = e.target.checked; };
    q('[data-a=mas]').onclick = function () { estado.secciones.push({ capa: capas()[0].id, campos: null, orden: '' }); guardarRep(); pintarSecs(); };
    q('[data-a=gen]').onclick = generar;
    pintarSecs();
    if (estado.datos) mostrarVista();
  }
  function guardarRep() {
    lsSet(LS_REPORTE, { titulo: estado.titulo, nota: estado.nota, alcance: estado.alcance, secciones: estado.secciones });
  }
  async function pintarSecs() {
    var cont = modal.querySelector('[data-r=secs]'); if (!cont) return;
    cont.innerHTML = '';
    estado.secciones.forEach(function (s, idx) {
      var d = document.createElement('div'); d.className = 'pgi-sec-bloque';
      d.innerHTML = '<div class="pgi-sec-cab"><strong>Tabla ' + (idx + 1) + '</strong><label>Capa<select data-r="capa">' +
        capas().map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === s.capa ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
        '</select></label><button type="button" class="pgi-del" title="Quitar tabla">Quitar</button></div><div data-r="cs" class="pgi-nota">Cargando campos…</div>';
      cont.appendChild(d);
      d.querySelector('[data-r=capa]').onchange = function (e) { s.capa = e.target.value; s.campos = null; s.orden = ''; guardarRep(); pintarSecs(); };
      d.querySelector('.pgi-del').onclick = function () { estado.secciones.splice(idx, 1); guardarRep(); pintarSecs(); };
      var c = capa(s.capa);
      campos(c).then(function (meta) {
        if (!s.campos) s.campos = porDefecto(meta.campos);
        var box = d.querySelector('[data-r=cs]');
        box.className = ''; box.innerHTML = '<div class="pgi-sub">Campos de la tabla</div>' + listaCampos(c, meta.campos, s.campos, 's' + idx) +
          '<label class="pgi-bl">Ordenar por<select data-r="ord"><option value="">Sin orden</option>' + meta.campos.map(function (f) { return '<option value="' + esc(f.name) + '"' + (s.orden === f.name ? ' selected' : '') + '>' + esc(f.alias) + '</option>'; }).join('') + '</select></label>';
        Array.prototype.forEach.call(box.querySelectorAll('input[type=checkbox]'), function (i) {
          i.onchange = function () { s.campos = Array.prototype.map.call(box.querySelectorAll('input:checked'), function (x) { return x.value; }); guardarRep(); };
        });
        box.querySelector('[data-r=ord]').onchange = function (e) { s.orden = e.target.value; guardarRep(); };
      }).catch(function (e) { d.querySelector('[data-r=cs]').textContent = 'No se pudieron leer los campos: ' + e.message; });
    });
  }

  async function generar() {
    var msg = modal.querySelector('[data-r=msg]'), btn = modal.querySelector('[data-a=gen]');
    var aoiF = window.__pgtGetAoi && window.__pgtGetAoi();
    if (estado.alcance === 'aoi' && !aoiF) { msg.textContent = 'Define primero un municipio, vereda, archivo o polígono en el Paso 1, o cambia el alcance a «Todo Caldas».'; return; }
    var validas = estado.secciones.filter(function (s) { return s.capa && s.campos && s.campos.length; });
    if (!validas.length) { msg.textContent = 'Elige al menos un campo en alguna tabla.'; return; }
    btn.disabled = true; btn.textContent = 'Consultando…'; msg.textContent = '';
    var datos = [];
    try {
      for (var i = 0; i < validas.length; i++) {
        var s = validas[i], c = capa(s.capa); msg.textContent = 'Consultando ' + c.name + '…';
        var r = await consultar(c, { aoi: estado.alcance === 'aoi' ? aoiF.geometry : null, campos: s.campos });
        var cs = s.campos.map(function (n) { return r.campos.filter(function (f) { return f.name === n; })[0]; }).filter(Boolean);
        var ord = s.orden && r.campos.filter(function (f) { return f.name === s.orden; })[0];
        if (ord) r.filas.sort(function (a, b) {
          var x = a[ord.name], y = b[ord.name];
          return typeof x === 'number' && typeof y === 'number' ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'es');
        });
        datos.push({ capa: c, campos: cs, alias: cs.map(function (f) { return f.alias; }), filas: r.filas, truncado: r.truncado });
      }
      estado.datos = { items: datos, fecha: new Date(), aoi: estado.alcance === 'aoi' ? (document.querySelector('.area-card strong, .aoi-card strong') || {}).textContent : 'Todo Caldas' };
      msg.textContent = '';
      mostrarVista();
    } catch (e) { msg.textContent = 'No fue posible generar el reporte: ' + e.message; }
    btn.disabled = false; btn.textContent = 'Generar reporte';
  }

  function totales(it) {
    return it.campos.map(function (f, i) {
      if (!f.num || /(^|_)(id|objectid|codigo|cod)/i.test(f.name) || !/area|ha|hect|km|long|virtual/i.test(f.name + (f.virtual ? 'virtual' : ''))) return i === 0 ? 'Total' : '';
      var t = 0; it.filas.forEach(function (r) { if (typeof r[f.name] === 'number') t += r[f.name]; });
      return t.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    });
  }
  function tablaHtml(it, editable) {
    var h = '<table class="pgi-res"><thead><tr>' + it.campos.map(function (f, i) { return '<th' + (editable ? ' contenteditable="true" data-i="' + i + '"' : '') + '>' + esc(it.alias[i]) + '</th>'; }).join('') + (editable ? '<th></th>' : '') + '</tr></thead><tbody>';
    it.filas.forEach(function (r, k) { h += '<tr>' + it.campos.map(function (f) { return '<td' + (f.num ? ' class="n"' : '') + '>' + esc(fmt(r[f.name], f)) + '</td>'; }).join('') + (editable ? '<td class="x"><button type="button" data-k="' + k + '" title="Quitar fila">×</button></td>' : '') + '</tr>'; });
    if (estado.totales && it.filas.length) h += '<tr class="tot">' + totales(it).map(function (t, i) { return '<td' + (it.campos[i].num ? ' class="n"' : '') + '>' + esc(t) + '</td>'; }).join('') + (editable ? '<td></td>' : '') + '</tr>';
    return h + '</tbody></table>';
  }
  function mostrarVista() {
    var v = modal.querySelector('[data-r=vista]'), D = estado.datos; if (!D) return;
    v.innerHTML = '<div class="pgi-pie"><button type="button" class="pgi-pri" data-a="pdf">Descargar PDF</button><button type="button" class="pgi-sec" data-a="csv">Descargar CSV</button></div>' +
      D.items.map(function (it, n) {
        return '<div class="pgi-res-bl" data-n="' + n + '"><h3>' + esc(it.capa.name) + ' <small>' + it.filas.length + ' registros' + (it.truncado ? ' (límite de ' + MAX_FILAS + ')' : '') + '</small></h3><div class="pgi-scroll">' + tablaHtml(it, true) + '</div></div>';
      }).join('') + '<div class="pgi-nota">Puedes renombrar los encabezados (clic sobre ellos) y quitar filas con × antes de descargar.</div>';
    Array.prototype.forEach.call(v.querySelectorAll('.pgi-res-bl'), function (bl) {
      var it = D.items[+bl.getAttribute('data-n')];
      Array.prototype.forEach.call(bl.querySelectorAll('th[data-i]'), function (th) { th.oninput = function () { it.alias[+th.getAttribute('data-i')] = th.textContent; }; });
      Array.prototype.forEach.call(bl.querySelectorAll('button[data-k]'), function (b) {
        b.onclick = function () { it.filas.splice(+b.getAttribute('data-k'), 1); mostrarVista(); };
      });
    });
    v.querySelector('[data-a=pdf]').onclick = descargarPdf;
    v.querySelector('[data-a=csv]').onclick = descargarCsv;
  }

  function fuente(it) { return 'Fuente: CORPOCALDAS, servicio ArcGIS REST ' + it.capa.url + '/' + it.capa.layerId + '. Consulta: ' + estado.datos.fecha.toLocaleString('es-CO') + '.'; }
  function descargarPdf() {
    var D = estado.datos, f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    var css = 'body{font:11px/1.4 Arial,Helvetica,sans-serif;color:#16302a;margin:24px}h1{font-size:19px;margin:0 0 2px;color:#0e5235}.sub{color:#555;margin-bottom:10px}h2{font-size:13px;margin:18px 0 4px;color:#0e5235}table{border-collapse:collapse;width:100%;margin:4px 0}th{background:#e8f1ec;text-align:left}th,td{border:1px solid #c9d6d0;padding:3px 6px;font-size:10px}td.n{text-align:right}tr.tot td{font-weight:700;background:#f4f8f6}.src{font-size:8.5px;color:#666;margin:2px 0 8px}.nota{margin:6px 0}@page{margin:14mm}';
    var h = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(estado.titulo) + '</title><style>' + css + '</style></head><body><h1>' + esc(estado.titulo) + '</h1><div class="sub">' + esc(D.aoi || '') + ' · ' + D.fecha.toLocaleDateString('es-CO') + '</div>' +
      (estado.nota ? '<div class="nota">' + esc(estado.nota).replace(/\n/g, '<br>') + '</div>' : '') +
      D.items.map(function (it, n) { return '<h2>Tabla ' + (n + 1) + '. ' + esc(it.capa.name) + '</h2>' + tablaHtml(it, false) + '<div class="src">' + esc(fuente(it)) + (it.truncado ? ' Resultado limitado a ' + MAX_FILAS + ' registros.' : '') + '</div>'; }).join('') +
      '</body></html>';
    var d = f.contentWindow.document; d.open(); d.write(h); d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 4000); }, 300);
  }
  function descargarCsv() {
    var D = estado.datos, out = [];
    function cel(v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    D.items.forEach(function (it) {
      out.push(cel(it.capa.name)); out.push(it.alias.map(cel).join(';'));
      it.filas.forEach(function (r) { out.push(it.campos.map(function (f) { var v = r[f.name]; return cel(f.fecha && typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : (typeof v === 'number' ? String(v).replace('.', ',') : v)); }).join(';')); });
      out.push(cel(fuente(it))); out.push('');
    });
    var blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (estado.titulo || 'reporte').replace(/[^\w\-]+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ── Botón en la barra superior ─────────────────────── */
  function montarBoton() {
    if (document.querySelector('.pgi-btn')) return;
    var opt = document.querySelector('select option[value=planeacion]'); var sel = opt && opt.parentNode; if (!sel) return;
    var ref = sel.closest('label') || sel.parentNode;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pgi-btn'; b.textContent = 'Mi reporte';
    b.onclick = function () { abrir('rep'); };
    ref.parentNode.insertBefore(b, ref);
  }
  new MutationObserver(function () { montarBoton(); engancharMapa(); }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
  window.__pgtInforme = { consultar: consultar, campos: campos, abrir: abrir };
})();
