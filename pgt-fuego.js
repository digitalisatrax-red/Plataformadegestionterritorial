/* Plataforma de Gestión Territorial · Módulo de incendios (FIRE).
   - Reportes de campo (app móvil y QField) desde Supabase: tabla `reportes_incendio`.
   - Puntos de calor satelitales: tabla `detecciones_calor` (FIRMS / IDEAM-SMByC) y CSV cargado por el usuario.
   - Cruce reporte ↔ satélite: distancia y ventana de tiempo ajustables.
   - Histórico MapBiomas Fuego: data/mapbiomas_fuego_caldas.json (se genera con herramientas/mapbiomas_fuego_gee.js).
   Sin sesión solo se ven reportes validados; con sesión de Planeación se ven todos y se pueden validar. */
(function () {
  var CFG = window.PGT_CONFIG || {};
  var SB = String(CFG.supabaseUrl || '').trim().replace(/\/+$/, '');
  var IDEAM = 'https://visualizador.ideam.gov.co/gisserver/rest/services/StoryMaps_IDA/Alertas_ICV/MapServer';
  function urlCapa(id) { var l = (window.__pgtCapas || []).filter(function (c) { return c.id === id; })[0]; return l ? { url: l.url, id: l.layerId, name: l.name } : null; }
  var DIN = {
    ideam: { op: .65, nom: 'Amenaza IDEAM', get: function () { return { url: IDEAM, id: 3 }; } },
    sinap: { op: .6, nom: 'Áreas SINAP', get: function () { return urlCapa('eep-sinap'); } },
    aica: { op: .6, nom: 'AICA', get: function () { return urlCapa('eep-aica'); } },
    ver: { op: .85, nom: 'Veredas', get: function () { return urlCapa('caldas-veredas'); } }
  };
  var E = { firms: [], actualizado: '', tab: 'mapa', dias: 7, radio: 1, horas: 48, solo: 'todos', rep: [], det: [], csv: [], err: '', mapa: null, capas: {}, sel: null, sw: { mun: true, ideam: false, sinap: false, aica: false, ver: false }, fondo: 'sat', hist: undefined, tim: null };
  var el = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sesion() { try { var s = JSON.parse(sessionStorage.getItem('pgt.sesion') || 'null'); if (s && s.exp > Date.now()) return s; } catch (e) {} return null; }
  function hdr() { var s = sesion(); return { apikey: CFG.anonKey, Authorization: 'Bearer ' + ((s && s.tk) || CFG.anonKey), 'content-type': 'application/json' }; }
  function puedeValidar() { var s = sesion(); return !!(s && s.tk && s.roles && s.roles.indexOf('planeacion') >= 0); }
  function fmt(t) { try { return new Date(t).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return t; } }

  /* ── Datos ──────────────────────────────────────────── */
  async function cargar() {
    E.err = '';
    if (!SB || !CFG.anonKey) { E.err = 'La base de datos (Supabase) no está configurada.'; return; }
    var desde = new Date(Date.now() - E.dias * 864e5).toISOString();
    try {
      var r = await fetch(SB + '/rest/v1/reportes_incendio?select=*&fecha_hora=gte.' + encodeURIComponent(desde) + '&order=fecha_hora.desc&limit=2000', { headers: hdr() });
      if (!r.ok) throw new Error('reportes (HTTP ' + r.status + '). ¿Ya ejecutó supabase/incendios.sql?');
      E.rep = await r.json();
      var d = await fetch(SB + '/rest/v1/detecciones_calor?select=*&fecha_hora=gte.' + encodeURIComponent(new Date(Date.now() - (E.dias + 3) * 864e5).toISOString()) + '&order=fecha_hora.desc&limit=5000', { headers: hdr() });
      E.det = d.ok ? await d.json() : [];
    } catch (e) { E.err = e.message; }
    try {
      var fr = await fetch('data/firms_caldas.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' });
      if (fr.ok) { var fj = await fr.json(); var lim = Date.now() - (E.dias + 3) * 864e5; E.firms = (fj.puntos || []).filter(function (p) { return new Date(p.fecha_hora).getTime() >= lim; }); E.actualizado = fj.actualizado || ''; }
    } catch (e) {}
  }

  function km(a, b, c, d) {
    var R = 6371, t = Math.PI / 180, dl = (c - a) * t, dg = (d - b) * t;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dg / 2) * Math.sin(dg / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function todasDet() { var vistos = {}; return E.det.concat(E.firms, E.csv).filter(function (d) { var k = d.fuente + d.fecha_hora + d.lat + d.lon; if (vistos[k]) return false; vistos[k] = 1; return true; }); }
  function cruzar(r) {
    var t0 = new Date(r.fecha_hora).getTime(), mejor = null;
    todasDet().forEach(function (d) {
      var dt = Math.abs(new Date(d.fecha_hora).getTime() - t0) / 36e5; if (dt > E.horas) return;
      var dk = km(r.lat, r.lon, d.lat, d.lon); if (dk > E.radio) return;
      if (!mejor || dk < mejor.km) mejor = { km: dk, h: dt, d: d };
    });
    return mejor;
  }
  function estadoCruce(r) { var c = cruzar(r); return c ? { k: 'ok', t: 'Confirmado por satélite', c: c } : { k: 'no', t: 'Sin detección satelital', c: null }; }
  function sinReporte() {
    return todasDet().filter(function (d) {
      var t = new Date(d.fecha_hora).getTime();
      return !E.rep.some(function (r) { return Math.abs(new Date(r.fecha_hora).getTime() - t) / 36e5 <= E.horas && km(r.lat, r.lon, d.lat, d.lon) <= E.radio; });
    });
  }
  function reportesVisibles() { return E.rep.filter(function (r) { return E.solo === 'todos' || (E.solo === 'activos' ? r.estado === 'Activo' : r.estado === E.solo); }); }

  /* ── Interfaz ───────────────────────────────────────── */
  function abrir() {
    if (el || !permitido()) return;
    el = document.createElement('div'); el.className = 'fg-root';
    el.innerHTML = '<div class="fg-cab"><div><span class="fg-ey">Módulo FIRE</span><h1>Incendios de la cobertura vegetal · Caldas</h1><div class="fg-sub">Reportes de campo + puntos de calor satelitales + histórico MapBiomas Fuego</div></div><button class="fg-x" aria-label="Cerrar">×</button></div>' +
      '<div class="fg-tabs"><button data-t="mapa" class="on">Mapa y reportes</button><button data-t="hist">Histórico (MapBiomas Fuego)</button><button data-t="fuentes">Fuentes y créditos</button></div>' +
      '<div data-r="cont" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>' +
      '<div class="fg-pie">Histórico: MapBiomas Fuego Colombia · Puntos de calor: NASA FIRMS y IDEAM-SMByC · Amenaza: IDEAM. Los reportes de campo sin validar no son oficiales.</div>';
    document.body.appendChild(el);
    el.querySelector('.fg-x').onclick = cerrar;
    el.querySelectorAll('.fg-tabs button').forEach(function (b) { b.onclick = function () { E.tab = b.dataset.t; el.querySelectorAll('.fg-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); pintar(); }; });
    pintar(); refrescar();
    E.tim = setInterval(function () { if (E.tab === 'mapa') refrescar(); }, 60000);
  }
  function cerrar() { if (!el) return; clearInterval(E.tim); if (E.mapa) { E.mapa.remove(); E.mapa = null; E.capas = {}; } el.remove(); el = null; }
  async function refrescar() { await cargar(); if (el && E.tab === 'mapa') pintarDatos(); }

  function pintar() {
    var c = el.querySelector('[data-r=cont]');
    if (E.mapa) { E.mapa.remove(); E.mapa = null; E.capas = {}; }
    if (E.tab === 'mapa') {
      c.innerHTML = '<div class="fg-ctl">' +
        '<label>Periodo<select data-k="dias"><option value="1">Últimas 24 h</option><option value="3">3 días</option><option value="7" selected>7 días</option><option value="30">30 días</option></select></label>' +
        '<label>Estado<select data-k="solo"><option value="todos">Todos</option><option value="activos">Activos</option><option value="Controlado">Controlados</option><option value="Extinguido">Extinguidos</option></select></label>' +
        '<label>Radio cruce (km)<input type="number" data-k="radio" value="' + E.radio + '" min="0.1" step="0.5"></label>' +
        '<label>Ventana (± h)<input type="number" data-k="horas" value="' + E.horas + '" min="1" step="6"></label>' +
        '<label>Fondo<select data-k="fondo"><option value="sat">Imagen satelital</option><option value="osm">Calles</option><option value="claro">Claro</option></select></label>' +
        '<label class="fg-chk"><input type="checkbox" data-k="sw:mun"> Municipios</label>' +
        '<label class="fg-chk"><input type="checkbox" data-k="sw:ver"> Veredas</label>' +
        '<label class="fg-chk"><input type="checkbox" data-k="sw:sinap"> Áreas SINAP</label>' +
        '<label class="fg-chk"><input type="checkbox" data-k="sw:aica"> AICA</label>' +
        '<label class="fg-chk"><input type="checkbox" data-k="sw:ideam"> Amenaza IDEAM</label>' +
        '<button class="fg-b" data-a="csv">Cargar CSV de puntos de calor</button><input type="file" accept=".csv,text/csv" data-r="file" hidden>' +
        '<button class="fg-b p" data-a="ref">Actualizar</button></div>' +
        '<div class="fg-cuerpo"><div class="fg-mapa"><div data-r="map"></div><div class="fg-leyenda"><div><i style="background:#dc2626;border-radius:50%"></i>Reporte activo</div><div><i style="background:#f59e0b;border-radius:50%"></i>Controlado</div><div><i style="background:#6b7280;border-radius:50%"></i>Extinguido</div><div><i style="background:#7c3aed"></i>Punto de calor</div></div></div><div class="fg-lado" data-r="lado"></div></div>';
      c.querySelector('[data-k=dias]').value = String(E.dias); c.querySelector('[data-k=solo]').value = E.solo; c.querySelector('[data-k=fondo]').value = E.fondo; Object.keys(E.sw).forEach(function (k) { c.querySelector('[data-k="sw:' + k + '"]').checked = E.sw[k]; });
      c.querySelectorAll('[data-k]').forEach(function (i) {
        i.onchange = function () {
          var k = i.dataset.k;
          if (k.indexOf('sw:') === 0) { var kk = k.slice(3); E.sw[kk] = i.checked; if (kk === 'mun') munCapa(); else din(kk); return; }
          if (k === 'fondo') { E.fondo = i.value; fondo(); return; }
          E[k] = (k === 'solo') ? i.value : Number(i.value);
          if (k === 'dias') refrescar(); else pintarDatos();
        };
      });
      c.querySelector('[data-a=ref]').onclick = refrescar;
      var f = c.querySelector('[data-r=file]'); c.querySelector('[data-a=csv]').onclick = function () { f.click(); };
      f.onchange = function () { if (f.files[0]) leerCsv(f.files[0]); };
      iniciarMapa(); pintarDatos();
    } else if (E.tab === 'hist') { c.innerHTML = '<div class="fg-pagina" data-r="hist">Cargando…</div>'; historico(c.querySelector('[data-r=hist]')); }
    else { c.innerHTML = '<div class="fg-pagina">' + fuentes() + '</div>'; }
  }

  var FONDOS = {
    sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Esri'],
    osm: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap'],
    claro: ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', '© OpenStreetMap, © CARTO']
  };
  function fondo() {
    var L = window.__pgtL; if (!E.mapa || !L) return;
    if (E.capas.fondo) E.mapa.removeLayer(E.capas.fondo);
    var f = FONDOS[E.fondo] || FONDOS.sat;
    E.capas.fondo = L.tileLayer(f[0], { maxZoom: 18, attribution: f[1] }).addTo(E.mapa); E.capas.fondo.bringToBack();
  }
  function iniciarMapa() {
    var L = window.__pgtL, cont = el.querySelector('[data-r=map]'); if (!L || !cont) { if (cont) cont.innerHTML = '<div class="fg-vacio">El mapa no está disponible todavía. Cierre esta ventana, abra Territorio y vuelva a intentarlo.</div>'; return; }
    E.mapa = L.map(cont, { zoomControl: true }).setView([5.28, -75.3], 9);
    fondo();
    E.capas.rep = L.layerGroup().addTo(E.mapa); E.capas.det = L.layerGroup().addTo(E.mapa);
    munCapa(); Object.keys(DIN).forEach(din);
    [100, 400, 1200].forEach(function (t) { setTimeout(function () { if (E.mapa) E.mapa.invalidateSize(); }, t); });
  }
  /* Contorno de los municipios de Caldas (CORPOCALDAS) */
  var munGeo = null;
  async function munCapa() {
    var L = window.__pgtL; if (!E.mapa || !L) return;
    if (E.capas.mun) { E.mapa.removeLayer(E.capas.mun); E.capas.mun = null; }
    if (!E.sw.mun) return;
    try {
      if (!munGeo) {
        var c = urlCapa('caldas-municipios'); if (!c) throw new Error('capa de municipios no disponible');
        var r = await fetch(c.url + '/' + c.id + '/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ where: '1=1', outFields: 'MpNombre', outSR: '4326', maxAllowableOffset: '0.001', geometryPrecision: '4', f: 'json' }) });
        var j = await r.json(); if (j.error || !j.features) throw new Error('sin respuesta');
        munGeo = j.features;
      }
      if (!E.mapa || !E.sw.mun) return;
      var g = L.layerGroup();
      munGeo.forEach(function (f) { if (!f.geometry || !f.geometry.rings) return; L.polygon(f.geometry.rings.map(function (rg) { return rg.map(function (p) { return [p[1], p[0]]; }); }), { color: '#fde047', weight: 1.6, fill: true, fillOpacity: 0, interactive: true }).bindTooltip(String(f.attributes.MpNombre || ''), { sticky: true }).addTo(g); });
      E.capas.mun = g.addTo(E.mapa);
    } catch (e) { fallo('mun', 'Municipios'); }
  }
  /* Capas dinámicas (imagen exportada del servicio ArcGIS para la vista actual) */
  function fallo(k, nom) { E.fallas = E.fallas || {}; E.fallas[k] = nom; var l = el && el.querySelector('[data-r=lado]'); if (l && !l.querySelector('.fg-av-' + k)) l.insertAdjacentHTML('afterbegin', '<div class="fg-aviso fg-av-' + k + '">La capa «' + nom + '» no respondió desde este navegador.</div>'); }
  function din(k) {
    var L = window.__pgtL, m = E.mapa; if (!m || !L) return;
    var o = E.capas['d_' + k];
    if (o) { m.off('moveend', o.f); if (o.l) m.removeLayer(o.l); if (o.p) m.removeLayer(o.p); delete E.capas['d_' + k]; }
    if (E.fallas) delete E.fallas[k];
    var av = el && el.querySelector('.fg-av-' + k); if (av) av.remove();
    if (!E.sw[k]) return;
    var cfg = DIN[k], sv = cfg.get(); if (!sv) { fallo(k, cfg.nom); return; }
    var st = {};
    var pon = function () {
      var b = m.getBounds(), z = m.getSize();
      var u = sv.url + '/export?bbox=' + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',') + '&bboxSR=4326&imageSR=4326&size=' + z.x + ',' + z.y + '&format=png32&transparent=true&layers=show:' + sv.id + '&f=image';
      var l = L.imageOverlay(u, b, { opacity: cfg.op, interactive: false });
      l.on('load', function () { if (st.l && st.l !== l && m.hasLayer(st.l)) m.removeLayer(st.l); st.l = l; if (E.fallas) delete E.fallas[k]; var a2 = el && el.querySelector('.fg-av-' + k); if (a2) a2.remove(); });
      l.on('error', function () { if (m.hasLayer(l)) m.removeLayer(l); if (!st.l) fallo(k, cfg.nom); });
      if (st.p && st.p !== st.l && m.hasLayer(st.p)) m.removeLayer(st.p); st.p = l; l.addTo(m);
    };
    st.f = pon; E.capas['d_' + k] = st; m.on('moveend', pon); pon();
  }

  function color(r) { return r.estado === 'Activo' ? '#dc2626' : r.estado === 'Controlado' ? '#f59e0b' : '#6b7280'; }
  function pintarDatos() {
    var L = window.__pgtL, lado = el.querySelector('[data-r=lado]'); if (!lado) return;
    var reps = reportesVisibles(), dets = todasDet();
    if (E.mapa && L) {
      E.capas.rep.clearLayers(); E.capas.det.clearLayers();
      dets.forEach(function (d) { L.circleMarker([d.lat, d.lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: '#7c3aed', fillOpacity: .9 }).bindPopup('<b>Punto de calor</b><br>' + esc(d.fuente || 'CSV') + '<br>' + fmt(d.fecha_hora) + (d.frp ? '<br>FRP ' + esc(d.frp) + ' MW' : '') + (d.confianza ? '<br>Confianza ' + esc(d.confianza) : '')).addTo(E.capas.det); });
      reps.forEach(function (r) {
        var m = L.circleMarker([r.lat, r.lon], { radius: 9, color: '#fff', weight: 2, fillColor: color(r), fillOpacity: .95 });
        m.bindPopup(popup(r)); m.addTo(E.capas.rep); r._m = m;
      });
      var pts = reps.map(function (r) { return [r.lat, r.lon]; }); if (pts.length && !E._enc) { E.mapa.fitBounds(pts, { maxZoom: 12, padding: [40, 40] }); E._enc = true; }
    }
    var conf = reps.filter(function (r) { return estadoCruce(r).k === 'ok'; }).length, sr = sinReporte().length, ha = reps.reduce(function (a, r) { return a + (Number(r.area_ha) || 0); }, 0);
    var h = '';
    Object.keys(E.fallas || {}).forEach(function (k) { h += '<div class="fg-aviso fg-av-' + k + '">La capa «' + esc(E.fallas[k]) + '» no respondió desde este navegador.</div>'; });
    if (E.err) h += '<div class="fg-aviso">' + esc(E.err) + '</div>';
    if (!sesion()) h += '<div class="fg-aviso">Sin sesión: solo se muestran reportes validados. Planeación puede ver y validar todos.</div>';
    h += '<div class="fg-kpis"><div class="fg-kpi"><span>Reportes</span><b>' + reps.length + '</b></div><div class="fg-kpi"><span>Activos</span><b>' + reps.filter(function (r) { return r.estado === 'Activo'; }).length + '</b></div><div class="fg-kpi"><span>Área reportada (ha)</span><b>' + ha.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '</b></div><div class="fg-kpi"><span>Confirmados por satélite</span><b>' + conf + '</b></div><div class="fg-kpi"><span>Detecciones sin reporte</span><b>' + sr + '</b></div></div>';
    if (E.actualizado) h += '<div class="fg-nota" style="font-size:11.5px;color:#7c6a5d;margin:0 0 8px">Puntos de calor (NASA FIRMS) actualizados: ' + fmt(E.actualizado) + ' · ' + dets.length + ' detecciones en el periodo.</div>';
    if (!dets.length) h += '<div class="fg-aviso">No hay puntos de calor en este periodo. Se actualizan solos cada 3 horas desde NASA FIRMS; también puede cargar un CSV de FIRMS o del IDEAM.</div>';
    if (!reps.length) h += '<div class="fg-vacio">No hay reportes en este periodo.</div>';
    if (dets.length) {
      h += '<h4 style="margin:12px 0 6px;color:#6d28d9">Puntos de calor recientes</h4>';
      dets.slice().sort(function (x, y) { return y.fecha_hora < x.fecha_hora ? -1 : 1; }).slice(0, 12).forEach(function (d, j) {
        h += '<div class="fg-item" data-d="' + j + '"><h4>' + fmt(d.fecha_hora) + '</h4><p>' + esc(d.fuente || 'CSV') + (d.frp ? ' · FRP ' + esc(d.frp) + ' MW' : '') + ' · ' + d.lat.toFixed(3) + ', ' + d.lon.toFixed(3) + '</p></div>';
      });
    }
    reps.forEach(function (r, i) {
      var c = estadoCruce(r);
      h += '<div class="fg-item" data-i="' + i + '"><h4>' + esc(r.municipio || 'Sin municipio') + (r.vereda ? ' · ' + esc(r.vereda) : '') + '<span class="fg-tag ' + c.k + '">' + c.t + '</span>' + (r.validado ? '' : '<span class="fg-tag nv">Sin validar</span>') + '</h4><p>' + fmt(r.fecha_hora) + ' · ' + esc(r.estado) + (r.area_ha != null ? ' · ' + r.area_ha + ' ha' : '') + (r.origen ? ' · ' + esc(r.origen) : '') + '</p>' +
        (c.c ? '<p>Detección a ' + c.c.km.toFixed(2) + ' km y ' + c.c.h.toFixed(1) + ' h</p>' : '') +
        (puedeValidar() && !r.validado ? '<p><button class="fg-b" data-v="' + i + '">Validar reporte</button></p>' : '') + '</div>';
    });
    lado.innerHTML = h;
    lado.querySelectorAll('.fg-item').forEach(function (n) { n.onclick = function (ev) { if (ev.target.dataset.v) return; var r = reps[n.dataset.i]; if (E.mapa) { E.mapa.setView([r.lat, r.lon], 14); r._m && r._m.openPopup(); } }; });
    var ord = dets.slice().sort(function (x, y) { return y.fecha_hora < x.fecha_hora ? -1 : 1; });
    lado.querySelectorAll('[data-d]').forEach(function (n) { n.onclick = function () { var d = ord[n.dataset.d]; if (E.mapa) E.mapa.setView([d.lat, d.lon], 14); }; });
    lado.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { validar(reps[b.dataset.v]); }; });
  }
  function popup(r) {
    var c = estadoCruce(r);
    var f = (r.fotos && r.fotos.length) ? '<br>' + r.fotos.slice(0, 3).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">foto</a>'; }).join(' · ') : '';
    return '<b>' + esc(r.municipio || '') + (r.vereda ? ' · ' + esc(r.vereda) : '') + '</b><br>' + fmt(r.fecha_hora) + '<br>' + esc(r.estado) + (r.tipo_fuego ? ' · ' + esc(r.tipo_fuego) : '') + (r.cobertura ? '<br>Cobertura: ' + esc(r.cobertura) : '') + (r.area_ha != null ? '<br>' + r.area_ha + ' ha' : '') + (r.causa_probable ? '<br>Causa: ' + esc(r.causa_probable) : '') + (r.afectacion ? '<br>Afectación: ' + esc(r.afectacion) : '') + '<br><i>' + c.t + '</i>' + f;
  }
  async function validar(r) {
    try {
      var x = await fetch(SB + '/rest/v1/reportes_incendio?id=eq.' + encodeURIComponent(r.id), { method: 'PATCH', headers: Object.assign(hdr(), { Prefer: 'return=minimal' }), body: JSON.stringify({ validado: true }) });
      if (!x.ok) throw new Error('HTTP ' + x.status);
      r.validado = true; pintarDatos();
    } catch (e) { E.err = 'No se pudo validar: ' + e.message; pintarDatos(); }
  }

  /* ── CSV de puntos de calor (FIRMS / IDEAM) ─────────── */
  function leerCsv(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var lin = String(fr.result).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean); if (lin.length < 2) return;
      var sep = lin[0].indexOf(';') > lin[0].indexOf(',') && lin[0].indexOf(';') >= 0 ? ';' : ',';
      var H = lin[0].split(sep).map(function (x) { return x.trim().toLowerCase().replace(/"/g, ''); });
      var ix = function () { for (var a = 0; a < arguments.length; a++) { var i = H.indexOf(arguments[a]); if (i >= 0) return i; } return -1; };
      var iLa = ix('latitude', 'latitud', 'lat'), iLo = ix('longitude', 'longitud', 'lon', 'long'), iF = ix('acq_date', 'fecha'), iH = ix('acq_time', 'hora'), iFr = ix('frp'), iC = ix('confidence', 'confianza'), iS = ix('satellite', 'satelite', 'instrument');
      if (iLa < 0 || iLo < 0) { E.err = 'El CSV no tiene columnas latitude/longitude.'; pintarDatos(); return; }
      var out = [];
      lin.slice(1).forEach(function (l) {
        var c = l.split(sep).map(function (x) { return x.replace(/"/g, '').trim(); });
        var la = parseFloat(c[iLa]), lo = parseFloat(c[iLo]); if (!isFinite(la) || !isFinite(lo)) return;
        if (la < 4.6 || la > 6.1 || lo < -76.1 || lo > -74.4) return; /* recorte aproximado a Caldas */
        var hh = iH >= 0 ? String(c[iH]).padStart(4, '0') : '1200', t = iF >= 0 ? new Date(c[iF] + 'T' + hh.slice(0, 2) + ':' + hh.slice(2, 4) + ':00Z') : new Date();
        if (isNaN(t)) return;
        out.push({ fuente: 'CSV cargado', satelite: iS >= 0 ? c[iS] : '', fecha_hora: t.toISOString(), lat: la, lon: lo, frp: iFr >= 0 ? c[iFr] : null, confianza: iC >= 0 ? c[iC] : '' });
      });
      E.csv = out; E.err = out.length ? '' : 'El CSV no tiene puntos dentro de Caldas.'; pintarDatos();
    };
    fr.readAsText(file);
  }

  /* ── Histórico MapBiomas Fuego ──────────────────────── */
  async function historico(box) {
    if (E.hist === undefined) { try { var r = await fetch('data/mapbiomas_fuego_caldas.json', { cache: 'no-cache' }); E.hist = r.ok ? await r.json() : null; } catch (e) { E.hist = null; } }
    if (!E.hist || !E.hist.municipios) {
      box.innerHTML = '<h2>Histórico de área quemada · MapBiomas Fuego</h2><div class="fg-aviso">Los datos históricos aún no están cargados. Se generan una sola vez con el script de Google Earth Engine (<code>herramientas/mapbiomas_fuego_gee.js</code>) y el resultado se guarda en <code>data/mapbiomas_fuego_caldas.json</code>.</div><p>Cuando estén cargados verá aquí el área quemada anual por municipio (ha), la frecuencia de fuego y el desglose por cobertura, con el crédito a MapBiomas Fuego Colombia.</p>'; return;
    }
    var H = E.hist, anios = H.anios || [], filas = H.municipios;
    var tot = anios.map(function (_, i) { return filas.reduce(function (a, f) { return a + (f.ha[i] || 0); }, 0); }), mx = Math.max.apply(null, tot.concat([1]));
    var w = 760, h = 200, bw = w / Math.max(anios.length, 1);
    var svg = '<svg viewBox="0 0 ' + w + ' ' + (h + 30) + '" style="width:100%;height:auto">' + tot.map(function (v, i) { var bh = v / mx * h; return '<rect x="' + (i * bw + 2) + '" y="' + (h - bh) + '" width="' + (bw - 4) + '" height="' + bh + '" fill="#c2410c"><title>' + anios[i] + ': ' + Math.round(v).toLocaleString('es-CO') + ' ha</title></rect>' + (i % 3 === 0 ? '<text x="' + (i * bw + bw / 2) + '" y="' + (h + 14) + '" font-size="10" text-anchor="middle" fill="#7c6a5d">' + anios[i] + '</text>' : ''); }).join('') + '</svg>';
    var tabla = '<table class="g-tab" style="border-collapse:collapse;width:100%"><tr><th align="left">Municipio</th><th align="right">Total ' + anios[0] + '–' + anios[anios.length - 1] + ' (ha)</th><th align="right">Último año (ha)</th></tr>' +
      filas.slice().sort(function (a, b) { return b.ha.reduce(function (s, v) { return s + v; }, 0) - a.ha.reduce(function (s, v) { return s + v; }, 0); }).map(function (f) { var s = f.ha.reduce(function (a, v) { return a + v; }, 0); return '<tr><td>' + esc(f.nombre) + '</td><td align="right">' + Math.round(s).toLocaleString('es-CO') + '</td><td align="right">' + Math.round(f.ha[f.ha.length - 1] || 0).toLocaleString('es-CO') + '</td></tr>'; }).join('') + '</table>';
    box.innerHTML = '<h2>Área quemada anual en Caldas (ha)</h2>' + svg + '<p style="font-size:11.5px;color:#7c6a5d">Fuente: MapBiomas Fuego Colombia, Colección 1 (' + esc(H.generado || '') + '). Procesamiento: Plataforma de Gestión Territorial.</p>' + tabla;
  }

  function fuentes() {
    return '<h2>Fuentes de datos del módulo</h2>' +
      '<p><b>Reportes de campo.</b> App móvil de registro de incendios y formulario QField (proyecto «Incendios Caldas»), almacenados en la base de datos Supabase. Solo se publican los validados.</p>' +
      '<p><b>Puntos de calor.</b> Se descargan cada 3 horas de NASA FIRMS (archivos públicos de 7 días: VIIRS S-NPP, NOAA-20, NOAA-21 y MODIS), se recortan a Caldas y se acumulan 30 días. NASA FIRMS (MODIS y VIIRS) y la página de puntos de calor del IDEAM – Sistema de Monitoreo de Bosques y Carbono (SMByC), que distribuye CSV diarios derivados de FIRMS. Son detecciones térmicas, no incendios confirmados.</p>' +
      '<p><b>Amenaza.</b> Servicio de Alertas ICV del IDEAM (probabilidad de incendio de la cobertura vegetal).</p>' +
      '<p><b>Histórico.</b> MapBiomas Fuego Colombia (Colección 1, 2000–2026), iniciativa MapBiomas Colombia con la Universidad del Rosario. Los datos se consultan mediante Google Earth Engine (proyecto <code>projects/mapbiomas-public/assets/colombia/fire/collection1</code>) y se resumen por municipio.</p>' +
      '<p><b>Cruce.</b> Un reporte se marca «Confirmado por satélite» cuando existe una detección a menos del radio elegido (por defecto 1 km) y dentro de la ventana de tiempo (por defecto ±48 h). Una detección sin reporte cercano se cuenta como «Detección sin reporte».</p>' +
      '<p style="font-size:12px;color:#7c6a5d">Las referencias formales (APA) se completan al cerrar el instrumento.</p>';
  }

  /* ── Botón ──────────────────────────────────────────── */
  function permitido() { var s = sesion(); return !!(s && s.roles && s.roles.indexOf('planeacion') >= 0); }
  function montar() {
    var ex = document.querySelector('.fg-btn');
    if (!permitido()) { if (ex) ex.remove(); if (el) cerrar(); return; }
    if (ex) return;
    var ref = document.querySelector('.pgi-btn'); if (!ref) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pgi-btn fg-btn'; b.textContent = 'Incendios'; b.onclick = abrir;
    ref.parentNode.insertBefore(b, ref);
  }
  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
  window.__pgtFuego = { abrir: abrir, cruzar: cruzar };
})();
