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
  var E = { firms: [], actualizado: '', tab: 'mapa', dias: 7, radio: 1, horas: 48, solo: 'todos', rep: [], det: [], csv: [], err: '', mapa: null, capas: {}, sel: null, sw: { mun: true, ideam: false, sinap: false, aica: false, ver: false, lug: false }, fondo: 'satellite', hist: undefined, tim: null, mun: '', ver: '', vAttrs: null, verGeo: {}, vista: 'alertas', nivel: 'todos' };
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
    el.innerHTML = '<div class="fg-cab"><div><span class="fg-ey">Alerta temprana y monitoreo</span><h1>Incendios de la cobertura vegetal · Caldas</h1><div class="fg-sub">Puntos de calor satelitales + reportes comunitarios en una sola vista, para reducir el tiempo de reacción ante conatos</div></div><div class="fg-cab-d"><span class="fg-vivo" data-r="vivo"><i></i>En vivo</span><button class="fg-x" aria-label="Cerrar">×</button></div></div>' +
      '<div class="fg-tabs"><button data-t="mapa" class="on">Alerta temprana</button><button data-t="hist">Histórico (MapBiomas Fuego)</button><button data-t="fuentes">Fuentes y créditos</button></div>' +
      '<div data-r="cont" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>' +
      '<div class="fg-pie">Puntos de calor: NASA FIRMS y IDEAM-SMByC · Histórico: MapBiomas Fuego Colombia · Amenaza: IDEAM. Un punto de calor es una detección satelital que requiere verificación; los reportes sin validar no son oficiales.</div>';
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
      c.innerHTML = '<div class="fg-dash">' +
        '<div class="fg-filtros">' +
          '<div class="fg-grp"><span>Periodo</span><div class="fg-chips" data-g="dias"><button data-v="1">24 h</button><button data-v="3">3 días</button><button data-v="7">7 días</button><button data-v="30">30 días</button></div></div>' +
          '<div class="fg-grp"><span>Municipio</span><select data-k="mun"><option value="">Todo Caldas</option></select></div>' +
          '<div class="fg-grp"><span>Vereda</span><select data-k="ver"><option value="">Todas las veredas</option></select></div>' +
          '<div class="fg-grp"><span>Estado del reporte</span><div class="fg-chips" data-g="solo"><button data-v="todos">Todos</button><button data-v="activos">Activos</button><button data-v="Controlado">Controlados</button><button data-v="Extinguido">Extinguidos</button></div></div>' +
          '<div class="fg-grp fg-grow"></div>' +
          '<details class="fg-aj"><summary>Ajustes de cruce</summary><div class="fg-aj-p"><label>Radio para confirmar (km)<input type="number" data-k="radio" value="' + E.radio + '" min="0.1" step="0.5"></label><label>Ventana de tiempo (± h)<input type="number" data-k="horas" value="' + E.horas + '" min="1" step="6"></label><button class="fg-b" data-a="csv">Cargar CSV de puntos de calor</button><input type="file" accept=".csv,text/csv" data-r="file" hidden><p>Un reporte se «confirma» si hay un punto de calor a menos de ese radio y dentro de esa ventana.</p></div></details>' +
          '<button class="fg-b p" data-a="ref">Actualizar</button>' +
        '</div>' +
        '<div class="fg-kpis" data-r="kpis"></div>' +
        '<div class="fg-cuerpo"><div class="fg-mapa"><div data-r="map"></div>' +
          '<details class="fg-capas"><summary>Capas y fondo</summary><div class="fg-capas-p">' +
            '<label>Fondo<select data-k="fondo"><option value="satellite">Satélite</option><option value="osm">Calles</option><option value="light">Claro</option><option value="topographic">Topográfico</option></select></label>' +
            '<label class="fg-chk"><input type="checkbox" data-k="sw:lug"> Nombres de lugares</label><label class="fg-chk"><input type="checkbox" data-k="sw:mun"> Municipios</label><label class="fg-chk"><input type="checkbox" data-k="sw:ver"> Veredas</label><label class="fg-chk"><input type="checkbox" data-k="sw:sinap"> Áreas SINAP</label><label class="fg-chk"><input type="checkbox" data-k="sw:aica"> AICA</label><label class="fg-chk"><input type="checkbox" data-k="sw:ideam"> Amenaza IDEAM</label>' +
          '</div></details>' +
          '<div class="fg-leyenda"><div><i style="background:#dc2626;border-radius:50%"></i>Reporte activo</div><div><i style="background:#f59e0b;border-radius:50%"></i>Controlado</div><div><i style="background:#6b7280;border-radius:50%"></i>Extinguido</div><div><i style="background:#7c3aed;transform:rotate(45deg)"></i>Punto de calor ≤ 24 h</div><div><i style="background:#c4b5fd;transform:rotate(45deg)"></i>Punto de calor anterior</div></div></div>' +
          '<div class="fg-linea" data-r="linea"></div><div class="fg-lado-w"><div class="fg-stabs"><button data-vs="alertas">Alertas</button><button data-vs="analisis">Análisis</button><button data-vs="protocolo">Protocolo</button></div><div class="fg-lado" data-r="lado"></div></div>' +
        '</div></div>';
      c.querySelector('[data-k=fondo]').value = E.fondo; Object.keys(E.sw).forEach(function (k) { c.querySelector('[data-k="sw:' + k + '"]').checked = E.sw[k]; });
      c.querySelectorAll('[data-k]').forEach(function (i) {
        i.onchange = function () {
          var k = i.dataset.k;
          if (k.indexOf('sw:') === 0) { var kk = k.slice(3); E.sw[kk] = i.checked; if (kk === 'mun') munCapa(); else if (kk === 'lug') lugares(); else din(kk); return; }
          if (k === 'fondo') { E.fondo = i.value; fondo(); return; }
          if (k === 'mun') { E.mun = i.value; E.ver = ''; cargaTerr(); pintarDatos(); return; }
          if (k === 'ver') { E.ver = i.value; pintarDatos(); return; }
          E[k] = Number(i.value); pintarDatos();
        };
      });
      c.querySelectorAll('[data-g]').forEach(function (g) {
        g.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () { if (g.dataset.g === 'dias') { E.dias = Number(b.dataset.v); refrescar(); } else { E.solo = b.dataset.v; pintarDatos(); } marcar(); };
        });
      });
      c.querySelectorAll('[data-vs]').forEach(function (b) { b.onclick = function () { E.vista = b.dataset.vs; marcar(); pintarDatos(); }; });
      c.querySelector('[data-a=ref]').onclick = refrescar;
      var f = c.querySelector('[data-r=file]'); c.querySelector('[data-a=csv]').onclick = function () { f.click(); };
      f.onchange = function () { if (f.files[0]) leerCsv(f.files[0]); };
      marcar(); iniciarMapa(); pintarDatos(); ensureMun();
    } else if (E.tab === 'hist') { c.innerHTML = '<div class="fg-pagina" data-r="hist">Cargando…</div>'; historico(c.querySelector('[data-r=hist]')); }
    else { c.innerHTML = '<div class="fg-pagina">' + fuentes() + '</div>'; }
  }
  function marcar() {
    if (!el) return;
    el.querySelectorAll('[data-g=dias] button').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.v) === E.dias); });
    el.querySelectorAll('[data-g=solo] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === E.solo); });
    el.querySelectorAll('[data-vs]').forEach(function (b) { b.classList.toggle('on', b.dataset.vs === E.vista); });
  }

  var FONDOS = {
    osc: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', '© OpenStreetMap, © CARTO'],
    sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Esri'],
    osm: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap'],
    claro: ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', '© OpenStreetMap, © CARTO']
  };
  var LUG = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  function fondo() {
    var L = window.__pgtL; if (!E.mapa || !L) return;
    if (E.capas.fondo) { try { E.capas.fondo.remove(); } catch (e) {} E.capas.fondo = null; }
    E.mapa.__gcCentrado = true; /* el encuadre lo manejamos aquí */
    if (window.__gcBase) E.capas.fondo = window.__gcBase(L, { id: E.fondo }, E.mapa);
    else { var u = { satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', osm: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', topographic: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}' }[E.fondo]; E.capas.fondo = L.tileLayer(u, { maxZoom: 16, attribution: 'Esri' }).addTo(E.mapa); E.capas.fondo.bringToBack(); }
    lugares();
  }
  function lugares() {
    var L = window.__pgtL; if (!E.mapa || !L) return;
    if (E.capas.lug) { E.mapa.removeLayer(E.capas.lug); E.capas.lug = null; }
    if (E.sw.lug) E.capas.lug = L.tileLayer(LUG, { maxZoom: 16, opacity: .95, pane: 'overlayPane' }).addTo(E.mapa);
  }
  function iniciarMapa() {
    var L = window.__pgtL, cont = el.querySelector('[data-r=map]'); if (!L || !cont) { if (cont) cont.innerHTML = '<div class="fg-vacio">El mapa no está disponible todavía. Cierre esta ventana, abra Territorio y vuelva a intentarlo.</div>'; return; }
    E.mapa = L.map(cont, { zoomControl: true }).setView([5.28, -75.3], 9); medirZoom();
    fondo();
    E.capas.rep = L.layerGroup().addTo(E.mapa); E.capas.det = L.layerGroup().addTo(E.mapa);
    munCapa(); Object.keys(DIN).forEach(din);
    [100, 400, 1200].forEach(function (t) { setTimeout(function () { if (E.mapa) E.mapa.invalidateSize(); }, t); });
  }
  /* Contorno de los municipios de Caldas (CORPOCALDAS) */
  var munGeo = null, munProm = null;
  function ensureMun() {
    if (munGeo) return Promise.resolve(munGeo);
    if (munProm) return munProm;
    munProm = (async function () {
      try {
        var c = urlCapa('caldas-municipios'); if (!c) throw new Error('capa de municipios no disponible');
        var r = await fetch(c.url + '/' + c.id + '/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ where: '1=1', outFields: 'MpNombre', outSR: '4326', maxAllowableOffset: '0.001', geometryPrecision: '4', f: 'json' }) });
        var j = await r.json(); if (j.error || !j.features) throw new Error('sin respuesta');
        munGeo = j.features; munGeo.forEach(function (f) { var bb = [1e9, 1e9, -1e9, -1e9]; ((f.geometry && f.geometry.rings) || []).forEach(function (rg) { rg.forEach(function (q) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); }); }); f._bb = bb; });
        if (el && E.tab === 'mapa') pintarDatos();
        return munGeo;
      } catch (e) { munProm = null; return null; }
    })();
    return munProm;
  }
  /* Veredas (Corpocaldas): lista de atributos de todo Caldas y polígonos solo del municipio elegido */
  function aV(f, n) { var a = f.attributes || {}; if (a[n] !== undefined) return a[n]; var k = Object.keys(a).filter(function (x) { return x.toLowerCase() === n.toLowerCase(); })[0]; return k ? a[k] : undefined; }
  async function consultaV(c, P) {
    var r = await fetch(c.url + '/' + c.id + '/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams(Object.assign({ f: 'json', outFields: '*' }, P)) });
    var j = await r.json(); if (j.error) throw new Error(j.error.message || 'error'); return j;
  }
  async function listaVeredas() {
    if (E.vAttrs) return E.vAttrs;
    var c = urlCapa('caldas-veredas'); if (!c) throw new Error('capa de veredas no disponible');
    var out = [], off = 0;
    for (;;) {
      var j = await consultaV(c, { where: '1=1', returnGeometry: 'false', resultOffset: String(off), resultRecordCount: '1000' });
      var fs = j.features || []; out = out.concat(fs.map(function (f) { return { id: String(aV(f, 'ID_VEREDA')), nombre: String(aV(f, 'NOMBRE') || ''), mun: String(aV(f, 'MUNICIPIO') || '') }; }));
      if (!j.exceededTransferLimit || !fs.length || out.length >= 20000) break; off += fs.length;
    }
    E.vAttrs = out; return out;
  }
  function veredasDe(mk) { var l = (E.vAttrs || []).filter(function (v) { return norm(v.mun) === mk; }), c = {}; l.forEach(function (v) { c[v.nombre] = (c[v.nombre] || 0) + 1; }); return l.map(function (v) { return { id: v.id, nombre: v.nombre, etq: c[v.nombre] > 1 ? v.nombre + ' (' + v.id + ')' : v.nombre }; }).sort(function (a, b) { return a.etq.localeCompare(b.etq, 'es'); }); }
  async function cargaTerr() {
    var mk = E.mun; if (!mk) { pintarDatos(); return; }
    try {
      await listaVeredas();
      if (!E.verGeo[mk]) {
        var c = urlCapa('caldas-veredas'), ids = veredasDe(mk).map(function (v) { return v.id; }), out = [];
        for (var i = 0; i < ids.length; i += 120) {
          var ch = ids.slice(i, i + 120).map(function (x) { return isFinite(Number(x)) ? Number(x) : "'" + x + "'"; }).join(',');
          var j = await consultaV(c, { where: 'ID_VEREDA IN (' + ch + ')', outSR: '4326', returnGeometry: 'true', maxAllowableOffset: '0.0004', geometryPrecision: '4' });
          (j.features || []).forEach(function (f) { var rings = (f.geometry && f.geometry.rings) || [], bb = [1e9, 1e9, -1e9, -1e9]; rings.forEach(function (rg) { rg.forEach(function (q) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); }); }); out.push({ id: String(aV(f, 'ID_VEREDA')), nombre: String(aV(f, 'NOMBRE') || ''), rings: rings, bb: bb }); });
        }
        E.verGeo[mk] = out;
      }
    } catch (e) { E.errT = 'No se pudieron cargar las veredas: ' + e.message; }
    if (el && E.tab === 'mapa') pintarDatos();
  }
  function verDe(o, mk) {
    var k = '_v' + mk; if (o[k] !== undefined) return o[k];
    var g = E.verGeo[mk]; if (!g) return null;
    for (var i = 0; i < g.length; i++) { var f = g[i], b = f.bb; if (o.lon < b[0] || o.lon > b[2] || o.lat < b[1] || o.lat > b[3]) continue; if (enRings(f.rings, o.lon, o.lat)) return (o[k] = f.id); }
    return (o[k] = '');
  }
  function verNombre(id, mk) { var g = (E.verGeo[mk] || []).filter(function (f) { return f.id === String(id); })[0]; return g ? g.nombre : ''; }
  function enRings(rings, x, y) {
    var c = false;
    rings.forEach(function (rg) { for (var i = 0, j = rg.length - 1; i < rg.length; j = i++) { var xi = rg[i][0], yi = rg[i][1], xj = rg[j][0], yj = rg[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } });
    return c;
  }
  function munDe(lat, lon) {
    if (!munGeo) return null;
    for (var i = 0; i < munGeo.length; i++) { var f = munGeo[i], bb = f._bb; if (!bb || lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue; if (f.geometry && enRings(f.geometry.rings, lon, lat)) return String(f.attributes.MpNombre || ''); }
    return '';
  }
  async function munCapa() {
    var L = window.__pgtL; if (!E.mapa || !L) return;
    if (E.capas.mun) { E.mapa.removeLayer(E.capas.mun); E.capas.mun = null; }
    if (!E.sw.mun) return;
    try {
      if (!(await ensureMun())) throw new Error('sin municipios');
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
  function norm(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function tit(x) { x = String(x || ''); return x === x.toUpperCase() ? x.toLowerCase().replace(/(^|[\s-])([a-zñáéíóú])/g, function (m, a, b) { return a + b.toUpperCase(); }) : x; }
  function hace(t) { var h = (Date.now() - new Date(t).getTime()) / 36e5; if (h < 1) return 'hace ' + Math.max(1, Math.round(h * 60)) + ' min'; if (h < 48) return 'hace ' + Math.round(h) + ' h'; return 'hace ' + Math.round(h / 24) + ' d'; }
  function nombreMun(r) { return tit(r.municipio || (munDe(r.lat, r.lon)) || ''); }
  var NIV = { crit: ['Crítica', 0], alta: ['Alta', 1], media: ['Media', 2], baja: ['Baja', 3] };
  function mediana(a) { if (!a.length) return null; a = a.slice().sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  /* Calcula todo lo que muestra el tablero con los filtros actuales */
  function calcular() {
    var lim = Date.now() - E.dias * 864e5, sinM = !E.mun;
    var okM = function (n) { return sinM || norm(n) === E.mun; };
    var okV = function (o) { return !E.ver || verDe(o, E.mun) === String(E.ver); };
    var reps = reportesVisibles().filter(function (r) { return okM(nombreMun(r)) && okV(r); });
    var dets = todasDet().filter(function (d) { if (new Date(d.fecha_hora).getTime() < lim) return false; if (munGeo && d._mun === undefined) d._mun = munDe(d.lat, d.lon); return (sinM || (d._mun != null && norm(d._mun) === E.mun)) && okV(d); });
    var sinRep = dets.filter(function (d) { var t = new Date(d.fecha_hora).getTime(); return !E.rep.some(function (r) { return Math.abs(new Date(r.fecha_hora).getTime() - t) / 36e5 <= E.horas && km(r.lat, r.lon, d.lat, d.lon) <= E.radio; }); });
    var al = [], lat = [];
    reps.forEach(function (r) {
      var c = estadoCruce(r), activo = r.estado === 'Activo', niv = activo ? (c.k === 'ok' ? 'crit' : 'alta') : 'baja';
      var tit = activo ? (c.k === 'ok' ? 'Incendio activo confirmado por satélite' : 'Reporte comunitario activo · sin confirmación satelital') : ('Incendio ' + String(r.estado || '').toLowerCase());
      al.push({ niv: niv, tipo: 'rep', r: r, t: r.fecha_hora, lat: r.lat, lon: r.lon, mun: nombreMun(r), ver: r.vereda || verNombre(verDe(r, E.mun), E.mun) || '', tit: tit, c: c });
      if (c.c) { var dtl = (new Date(r.fecha_hora).getTime() - new Date(c.c.d.fecha_hora).getTime()) / 36e5; if (dtl >= 0) lat.push(dtl); }
    });
    sinRep.forEach(function (d) {
      var h = (Date.now() - new Date(d.fecha_hora).getTime()) / 36e5;
      al.push({ niv: h <= 24 ? 'alta' : 'media', tipo: 'det', d: d, t: d.fecha_hora, lat: d.lat, lon: d.lon, mun: tit(d._mun), ver: verNombre(verDe(d, E.mun), E.mun), tit: 'Punto de calor sin reporte comunitario' });
    });
    al.sort(function (a, b) { return NIV[a.niv][1] - NIV[b.niv][1] || (a.t < b.t ? 1 : -1); });
    return { reps: reps, dets: dets, sinRep: sinRep, al: al, lat: lat };
  }
  function kpi(c, v, t, sub, extra) { return '<div class="fg-kpi ' + (c || '') + '"><b>' + v + '</b><span>' + t + '</span>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; }
  function pintarDatos() {
    var L = window.__pgtL, lado = el.querySelector('[data-r=lado]'); if (!lado) return;
    var D = calcular(), reps = D.reps, dets = D.dets, al = D.al;
    /* Municipios en el selector */
    var sel = el.querySelector('[data-k=mun]');
    if (sel) {
      var nombres = {}; (munGeo || []).forEach(function (f) { nombres[norm(f.attributes.MpNombre)] = tit(f.attributes.MpNombre); }); E.rep.forEach(function (r) { if (r.municipio) nombres[norm(r.municipio)] = nombres[norm(r.municipio)] || tit(r.municipio); });
      var ks = Object.keys(nombres).sort(); var sig = ks.join('|');
      if (sel.dataset.sig !== sig) { sel.innerHTML = '<option value="">Todo Caldas</option>' + ks.map(function (k) { return '<option value="' + esc(k) + '">' + esc(nombres[k]) + '</option>'; }).join(''); sel.dataset.sig = sig; }
      sel.value = E.mun;
    }
    var sv = el.querySelector('[data-k=ver]');
    if (sv) {
      var vl = E.mun ? veredasDe(E.mun) : [], sg = E.mun + '|' + vl.length;
      if (sv.dataset.sig !== sg) { sv.innerHTML = '<option value="">' + (E.mun ? (vl.length ? 'Todas las veredas' : 'Cargando veredas…') : 'Elija un municipio') + '</option>' + vl.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.etq) + '</option>'; }).join(''); sv.dataset.sig = sg; }
      sv.disabled = !E.mun; sv.value = E.ver;
    }
    /* Mapa */
    if (E.mapa && L) {
      E.capas.rep.clearLayers(); E.capas.det.clearLayers();
      dets.forEach(function (d) {
        var rec = (Date.now() - new Date(d.fecha_hora).getTime()) <= 864e5;
        var sz = Math.round(Math.min(26, Math.max(11, 9 + Math.sqrt(Number(d.frp) || 1) * 2.6))); var ic = L.divIcon({ className: 'fg-rombo' + (rec ? ' rec' : ''), iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
        d._m = L.marker([d.lat, d.lon], { icon: ic, zIndexOffset: rec ? 200 : 0 }).bindPopup(popupDet(d)); d._m.addTo(E.capas.det);
      });
      reps.forEach(function (r) {
        var m = L.circleMarker([r.lat, r.lon], { radius: Math.min(20, 8 + Math.sqrt(Number(r.area_ha) || 0) * 3), color: '#fff', weight: 2.5, fillColor: color(r), fillOpacity: .95 });
        m.bindPopup(popup(r)); m.addTo(E.capas.rep); r._m = m;
      });
      resaltar();
      var pts = reps.map(function (r) { return [r.lat, r.lon]; }); if (pts.length && !E._enc && !E.mun) { E.mapa.fitBounds(pts, { maxZoom: 12, padding: [40, 40] }); E._enc = true; }
    }
    /* Indicadores */
    var crit = al.filter(function (a) { return a.niv === 'crit' || a.niv === 'alta'; }).length;
    var act = reps.filter(function (r) { return r.estado === 'Activo'; }).length;
    var d24 = dets.filter(function (d) { return Date.now() - new Date(d.fecha_hora).getTime() <= 864e5; }).length;
    var conf = reps.filter(function (r) { return estadoCruce(r).k === 'ok'; }).length, val = reps.filter(function (r) { return r.validado; }).length;
    var md = mediana(D.lat);
    el.querySelector('[data-r=kpis]').innerHTML =
      kpi('k-rojo', crit, 'Alertas por atender', 'críticas y altas') + kpi('k-rojo', act, 'Incendios activos', 'reportados por la comunidad') + kpi('k-mor', d24, 'Puntos de calor', 'últimas 24 h') +
      kpi('', reps.length, 'Reportes comunitarios', val + ' validados') + kpi('k-ver', reps.length ? Math.round(conf / reps.length * 100) + '%' : '—', 'Confirmados por satélite', conf + ' de ' + reps.length) +
      kpi('k-mor', D.sinRep.length, 'Detecciones sin reporte', 'por verificar en campo') + kpi('', md == null ? '—' : (md < 1 ? Math.round(md * 60) + ' min' : md.toFixed(1) + ' h'), 'Satélite → reporte', md == null ? 'sin casos aún' : 'mediana entre detección y reporte');
    var viv = el.querySelector('[data-r=vivo]'); if (viv) viv.innerHTML = '<i></i>' + (E.actualizado ? 'Satélite actualizado ' + hace(E.actualizado) : 'En vivo');
    /* Panel lateral */
    var h = '';
    Object.keys(E.fallas || {}).forEach(function (k) { h += '<div class="fg-aviso fg-av-' + k + '">La capa «' + esc(E.fallas[k]) + '» no respondió desde este navegador.</div>'; });
    if (E.err) h += '<div class="fg-aviso">' + esc(E.err) + '</div>';
    if (!sesion()) h += '<div class="fg-aviso">Sin sesión: solo se muestran reportes validados. Planeación puede ver y validar todos.</div>';
    if (E.vista === 'alertas') h += vistaAlertas(D);
    else if (E.vista === 'analisis') h += vistaAnalisis(D);
    else h += vistaProtocolo();
    lado.innerHTML = h;
    enlazarLado(lado, D); pintaLinea(D); medirZoom();
  }
  /* Resalta y encuadra el municipio o la vereda elegidos */
  function resaltar() {
    var L = window.__pgtL, m = E.mapa; if (!m || !L) return;
    var key = E.mun + '|' + E.ver, g = null, bb = null;
    if (E.ver) { g = (E.verGeo[E.mun] || []).filter(function (f) { return f.id === String(E.ver); })[0]; if (g) { var rr = g.rings; bb = g.bb; g = rr; } }
    else if (E.mun && munGeo) { var f = munGeo.filter(function (x) { return norm(x.attributes.MpNombre) === E.mun; })[0]; if (f) { g = f.geometry.rings; bb = f._bb; } }
    if (E._tk === key && E.capas.terr !== undefined) return;
    if (E.capas.terr) { m.removeLayer(E.capas.terr); E.capas.terr = null; }
    if (g) {
      E.capas.terr = L.polygon(g.map(function (rg) { return rg.map(function (p) { return [p[1], p[0]]; }); }), { color: '#ea580c', weight: 3, fill: true, fillColor: '#fb923c', fillOpacity: .08, interactive: false }).addTo(m);
      m.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [30, 30], animate: false }); E._tk = key;
    } else if (!E.mun && !E.ver) {
      if (munGeo && E._tk !== undefined) { var a = [1e9, 1e9, -1e9, -1e9]; munGeo.forEach(function (f) { if (f._bb) { a[0] = Math.min(a[0], f._bb[0]); a[1] = Math.min(a[1], f._bb[1]); a[2] = Math.max(a[2], f._bb[2]); a[3] = Math.max(a[3], f._bb[3]); } }); m.fitBounds([[a[1], a[0]], [a[3], a[2]]], { animate: false }); }
      E._tk = key; E.capas.terr = null;
    }
  }
  function vistaAlertas(D) {
    var al = D.al, h = '<div class="fg-nivs">' + [['todos', 'Todas'], ['crit', 'Críticas'], ['alta', 'Altas'], ['media', 'Medias'], ['baja', 'Bajas']].map(function (n) { var k = n[0], c = k === 'todos' ? al.length : al.filter(function (a) { return a.niv === k; }).length; return '<button data-n="' + k + '" class="' + (E.nivel === k ? 'on' : '') + '">' + n[1] + ' <b>' + c + '</b></button>'; }).join('') + '</div>';
    var lista = al.filter(function (a) { return E.nivel === 'todos' || a.niv === E.nivel; });
    if (!lista.length) return h + '<div class="fg-vacio"><b>Sin alertas</b><br>No hay alertas con estos filtros. El satélite se revisa cada 3 horas.</div>';
    lista.slice(0, 40).forEach(function (a, i) {
      var r = a.r, extra = '';
      if (a.tipo === 'rep') extra = (r.area_ha != null ? r.area_ha + ' ha · ' : '') + esc(r.origen || 'Reporte comunitario') + (a.c.c ? ' · satélite a ' + a.c.c.km.toFixed(1) + ' km' : '') + (r.validado ? '' : ' · sin validar');
      else extra = esc(a.d.fuente || 'CSV') + (a.d.frp ? ' · FRP ' + esc(a.d.frp) + ' MW' : '') + (a.d.confianza ? ' · confianza ' + esc(a.d.confianza) : '');
      h += '<div class="fg-al n-' + a.niv + '" data-al="' + i + '"><div class="fg-al-t"><span class="fg-niv">' + NIV[a.niv][0] + '</span><span class="fg-hace">' + hace(a.t) + '</span></div><h4>' + esc(a.tit) + '</h4><p>' + esc(a.mun || 'Municipio sin determinar') + (a.ver ? ' · ' + esc(a.ver) : '') + '</p><p class="fg-sm">' + extra + '</p>' +
        '<div class="fg-acc"><button data-ver="' + i + '">Ver en mapa</button><a href="https://www.google.com/maps?q=' + a.lat + ',' + a.lon + '" target="_blank" rel="noopener">Cómo llegar</a><button data-cp="' + i + '">Copiar coordenadas</button>' + (a.tipo === 'rep' && puedeValidar() && !r.validado ? '<button class="v" data-v="' + i + '">Validar</button>' : '') + '</div></div>';
    });
    if (lista.length > 40) h += '<div class="fg-vacio">Se muestran las 40 más prioritarias de ' + lista.length + '.</div>';
    D.lista = lista; return h;
  }
  function barras(filas, colores, max, lv) {
    return filas.map(function (f) { var tot = f.v.reduce(function (a, b) { return a + b; }, 0); return '<div class="fg-br" data-lv="' + (lv || '') + '" data-m="' + esc(f.id || '') + '"><span class="fg-br-n" title="' + esc(f.k) + '">' + esc(f.k) + '</span><div class="fg-br-b">' + f.v.map(function (v, i) { return v ? '<i style="width:' + (v / max * 100) + '%;background:' + colores[i] + '"></i>' : ''; }).join('') + '</div><b>' + tot + '</b></div>'; }).join('');
  }
  function nombreMunSel() { var f = (munGeo || []).filter(function (x) { return norm(x.attributes.MpNombre) === E.mun; })[0]; return f ? tit(f.attributes.MpNombre) : tit(E.mun); }
  function histTerr() {
    var H = E.hist; if (!H || !H.municipios) return null;
    var n = H.anios.length, v = new Array(n).fill(0), fs = E.mun ? H.municipios.filter(function (m) { return norm(m.nombre) === E.mun; }) : H.municipios;
    if (!fs.length) return null; fs.forEach(function (m) { m.ha.forEach(function (x, i) { v[i] += x || 0; }); });
    return { anios: H.anios, v: v };
  }
  function vistaAnalisis(D) {
    var nivel = E.ver ? 'ver' : E.mun ? 'mun' : 'caldas', mn = E.mun ? nombreMunSel() : '', vn = E.ver ? (verNombre(E.ver, E.mun) || (veredasDe(E.mun).filter(function (v) { return v.id === String(E.ver); })[0] || {}).nombre || '') : '';
    var h = '<div class="fg-bc"><a data-bc="c" class="' + (nivel === 'caldas' ? 'on' : '') + '">Caldas</a>' + (E.mun ? ' › <a data-bc="m" class="' + (nivel === 'mun' ? 'on' : '') + '">' + esc(mn) + '</a>' : '') + (E.ver ? ' › <a class="on">' + esc(vn) + '</a>' : '') + '</div>';
    /* Resumen del territorio */
    var act = D.reps.filter(function (r) { return r.estado === 'Activo'; }).length, ha = D.reps.reduce(function (a, r) { return a + (Number(r.area_ha) || 0); }, 0), conf = D.reps.filter(function (r) { return estadoCruce(r).k === 'ok'; }).length;
    h += '<div class="fg-card"><h3>Resumen · ' + esc(nivel === 'caldas' ? 'Caldas' : nivel === 'mun' ? mn : vn + ' (' + mn + ')') + '</h3><table class="fg-res"><tr><td>Reportes comunitarios</td><td>' + D.reps.length + '</td></tr><tr><td>Incendios activos</td><td>' + act + '</td></tr><tr><td>Área reportada</td><td>' + ha.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' ha</td></tr><tr><td>Puntos de calor en el periodo</td><td>' + D.dets.length + '</td></tr><tr><td>Detecciones sin reporte</td><td>' + D.sinRep.length + '</td></tr><tr><td>Reportes confirmados por satélite</td><td>' + conf + '</td></tr></table></div>';
    /* Dónde se concentra */
    if (nivel === 'caldas') {
      var por = {}, nom = {};
      var suma = function (k0, i) { var k = norm(k0) || '_s'; nom[k] = nom[k] || tit(k0) || 'Sin municipio'; (por[k] = por[k] || [0, 0])[i]++; };
      D.reps.forEach(function (r) { suma(nombreMun(r), 0); });
      D.dets.forEach(function (d) { suma(d._mun || (munGeo ? 'Fuera de Caldas' : ''), 1); });
      var filas = Object.keys(por).map(function (k) { return { k: nom[k], id: k, v: por[k] }; }).sort(function (a, b) { return (b.v[0] + b.v[1]) - (a.v[0] + a.v[1]); }).slice(0, 12);
      var mx = Math.max.apply(null, filas.map(function (f) { return f.v[0] + f.v[1]; }).concat([1]));
      h += '<div class="fg-card"><h3>Municipios con más actividad</h3><div class="fg-lg"><i style="background:#c2410c"></i>Reportes <i style="background:#7c3aed"></i>Puntos de calor</div>' + (filas.length ? barras(filas, ['#c2410c', '#7c3aed'], mx, 'mun') : '<div class="fg-vacio">Sin datos en el periodo.</div>') + '<p class="fg-sm">Toque un municipio para analizarlo; luego podrá bajar a sus veredas.</p></div>';
    } else if (nivel === 'mun') {
      if (!E.verGeo[E.mun]) h += '<div class="fg-card"><h3>Veredas con más actividad</h3><div class="fg-vacio">' + (E.errT ? esc(E.errT) : 'Cargando las veredas de ' + esc(mn) + '…') + '</div></div>';
      else {
        var pv = {}, sinV = 0;
        var sv = function (o, i) { var id = verDe(o, E.mun); if (!id) { sinV++; return; } (pv[id] = pv[id] || [0, 0])[i]++; };
        D.reps.forEach(function (r) { sv(r, 0); }); D.dets.forEach(function (d) { sv(d, 1); });
        var fv = Object.keys(pv).map(function (id) { return { k: verNombre(id, E.mun) || id, id: id, v: pv[id] }; }).sort(function (a, b) { return (b.v[0] + b.v[1]) - (a.v[0] + a.v[1]); }).slice(0, 12);
        var mv = Math.max.apply(null, fv.map(function (f) { return f.v[0] + f.v[1]; }).concat([1]));
        h += '<div class="fg-card"><h3>Veredas con más actividad</h3><div class="fg-lg"><i style="background:#c2410c"></i>Reportes <i style="background:#7c3aed"></i>Puntos de calor</div>' + (fv.length ? barras(fv, ['#c2410c', '#7c3aed'], mv, 'ver') : '<div class="fg-vacio">Sin actividad en las veredas en este periodo.</div>') + '<p class="fg-sm">Toque una vereda para analizarla.' + (sinV ? ' ' + sinV + ' registro(s) no caen dentro de ninguna vereda.' : '') + '</p></div>';
      }
    }
    h += '<div class="fg-card"><h3>' + (E.dias <= 1 ? 'Por hora (últimas 24 h)' : 'Por día') + '</h3>' + serieHtml(D) + '</div>';
    var est = { Activo: 0, Controlado: 0, Extinguido: 0 }; D.reps.forEach(function (r) { est[r.estado] = (est[r.estado] || 0) + 1; });
    h += '<div class="fg-card"><h3>Estado de los reportes</h3>' + barras([{ k: 'Activos', v: [est.Activo] }, { k: 'Controlados', v: [est.Controlado] }, { k: 'Extinguidos', v: [est.Extinguido] }], ['#dc2626'], Math.max(est.Activo, est.Controlado, est.Extinguido, 1)) + '</div>';
    /* MapBiomas Fuego solo para Caldas */
    if (E.hist === undefined) { E.hist = null; fetch('data/mapbiomas_fuego_caldas.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { E.hist = j; if (el && E.tab === 'mapa' && E.vista === 'analisis') pintarDatos(); }).catch(function () {}); }
    var T = histTerr();
    if (T) {
      var mxh = Math.max.apply(null, T.v.concat([1])), tot = T.v.reduce(function (a, b) { return a + b; }, 0), im = T.v.indexOf(mxh);
      h += '<div class="fg-card"><h3>Histórico de área quemada · MapBiomas Fuego</h3><div class="fg-serie fg-serie-h">' + T.v.map(function (v, i) { return '<div class="fg-col" title="' + T.anios[i] + ': ' + Math.round(v).toLocaleString('es-CO') + ' ha"><div class="fg-col-b"><i style="height:' + (v / mxh * 100) + '%;background:#c2410c"></i></div><span>' + (i % 5 === 0 ? T.anios[i] : '&nbsp;') + '</span></div>'; }).join('') + '</div><p class="fg-sm">' + (nivel === 'caldas' ? 'Caldas' : esc(mn)) + ': ' + Math.round(tot).toLocaleString('es-CO') + ' ha quemadas en ' + T.anios[0] + '–' + T.anios[T.anios.length - 1] + '; el año con más área fue ' + T.anios[im] + ' (' + Math.round(mxh).toLocaleString('es-CO') + ' ha).' + (nivel === 'ver' ? ' MapBiomas se calcula por municipio; aún no hay desglose por vereda.' : '') + ' Fuente: MapBiomas Fuego Colombia.</p></div>';
    }
    return h;
  }
  function serieHtml(D) {
    var horas = E.dias <= 1, n = horas ? 24 : Math.min(E.dias, 30), paso = horas ? 36e5 : 864e5, ahora = Date.now(), bins = [];
    for (var i = 0; i < n; i++) bins.push([0, 0]);
    var idx = function (t) { var k = n - 1 - Math.floor((ahora - new Date(t).getTime()) / paso); return k >= 0 && k < n ? k : -1; };
    D.reps.forEach(function (r) { var k = idx(r.fecha_hora); if (k >= 0) bins[k][0]++; }); D.dets.forEach(function (d) { var k = idx(d.fecha_hora); if (k >= 0) bins[k][1]++; });
    var mt = Math.max.apply(null, bins.map(function (b) { return b[0] + b[1]; }).concat([1]));
    var col = bins.map(function (b, i) {
      var f = new Date(ahora - (n - 1 - i) * paso), et = horas ? f.getHours() + ' h' : f.getDate() + '/' + (f.getMonth() + 1);
      return '<div class="fg-col" title="' + et + ': ' + b[1] + ' puntos de calor, ' + b[0] + ' reportes"><div class="fg-col-b"><i style="height:' + (b[0] / mt * 100) + '%;background:#fb923c"></i><i style="height:' + (b[1] / mt * 100) + '%;background:#a78bfa"></i></div><span>' + (i % Math.ceil(n / 8) === 0 ? et : '&nbsp;') + '</span></div>';
    }).join('');
    return '<div class="fg-serie">' + col + '</div>';
  }
  function pintaLinea(D) {
    var c = el && el.querySelector('[data-r=linea]'); if (!c) return;
    c.innerHTML = '<div class="fg-linea-t"><b>' + (E.dias <= 1 ? 'Actividad por hora' : 'Actividad por día') + '</b><span><i style="background:#a78bfa"></i>Puntos de calor <i style="background:#fb923c"></i>Reportes</span></div>' + serieHtml(D);
  }
  function medirZoom() {
    if (!el) return; var d = el.querySelector('.fg-dash'), k = el.querySelector('[data-r=kpis]'), m = el.querySelector('[data-r=map]'); if (!d || !k || !m) return;
    m.style.setProperty('--zt', Math.round(k.getBoundingClientRect().bottom - d.getBoundingClientRect().top + 8) + 'px');
  }
  window.addEventListener('resize', function () { medirZoom(); });
  function vistaProtocolo() {
    return '<div class="fg-card"><h3>Cómo se genera una alerta</h3><ol class="fg-ol"><li><b>Detecta el satélite.</b> NASA FIRMS (VIIRS y MODIS) se revisa cada 3 horas y los puntos de calor aparecen como rombos violetas.</li><li><b>Reporta la comunidad.</b> Cualquier persona registra el incendio en la app móvil (ubicación, foto, estado). Aparece como círculo.</li><li><b>Se cruzan.</b> Si coinciden en distancia y tiempo, el incendio queda «confirmado por satélite».</li><li><b>Se prioriza.</b> Las alertas se ordenan por nivel para atender primero lo más urgente.</li></ol></div>' +
      '<div class="fg-card"><h3>Niveles de alerta</h3><div class="fg-niv-l"><p><span class="fg-niv c">Crítica</span> Reporte activo y confirmado por satélite: movilizar de inmediato.</p><p><span class="fg-niv a">Alta</span> Reporte activo sin confirmar, o punto de calor de las últimas 24 h sin reporte: verificar y despachar.</p><p><span class="fg-niv m">Media</span> Punto de calor de más de 24 h sin reporte: verificar en campo.</p><p><span class="fg-niv b">Baja</span> Incendio controlado o extinguido: seguimiento.</p></div></div>' +
      '<div class="fg-card"><h3>Para reportar un incendio</h3><ol class="fg-ol"><li>Llame primero a la línea de emergencias <b>123</b> o al cuerpo de bomberos local.</li><li>Registre en la app: ubicación, foto del frente de fuego y estado.</li><li>No se acerque al fuego ni intente controlarlo sin entrenamiento.</li><li>Planeación valida el reporte para que sea oficial en el tablero.</li></ol></div>' +
      '<div class="fg-card"><h3>Parámetros actuales del cruce</h3><p class="fg-sm">Radio: ' + E.radio + ' km · Ventana: ± ' + E.horas + ' h. Cámbielos en «Ajustes de cruce».</p></div>';
  }
  function enlazarLado(lado, D) {
    lado.querySelectorAll('[data-n]').forEach(function (b) { b.onclick = function () { E.nivel = b.dataset.n; pintarDatos(); }; });
    lado.querySelectorAll('.fg-br[data-lv]').forEach(function (b) { if (!b.dataset.lv) return; b.onclick = function () { if (b.dataset.m === '_s' || b.dataset.m === 'fuera de caldas') return; if (b.dataset.lv === 'ver') E.ver = (E.ver === b.dataset.m ? '' : b.dataset.m); else { E.mun = (E.mun === b.dataset.m ? '' : b.dataset.m); E.ver = ''; cargaTerr(); } pintarDatos(); }; });
    lado.querySelectorAll('[data-bc]').forEach(function (b) { b.onclick = function () { if (b.dataset.bc === 'c') { E.mun = ''; E.ver = ''; } else E.ver = ''; pintarDatos(); }; });
    var lista = D.lista || [];
    lado.querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { var a = lista[b.dataset.ver]; if (!a || !E.mapa) return; E.mapa.setView([a.lat, a.lon], 14); var m = a.tipo === 'rep' ? a.r._m : a.d._m; if (m) m.openPopup(); }; });
    lado.querySelectorAll('[data-cp]').forEach(function (b) { b.onclick = function () { var a = lista[b.dataset.cp]; var t = a.lat.toFixed(5) + ', ' + a.lon.toFixed(5); try { navigator.clipboard.writeText(t); b.textContent = 'Copiado'; } catch (e) { b.textContent = t; } }; });
    lado.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { validar(lista[b.dataset.v].r); }; });
  }
  function popupDet(d) { return '<b>Punto de calor</b><br>' + esc(d.fuente || 'CSV') + (d._mun ? '<br>' + esc(d._mun) : '') + '<br>' + fmt(d.fecha_hora) + ' (' + hace(d.fecha_hora) + ')' + (d.frp ? '<br>FRP ' + esc(d.frp) + ' MW' : '') + (d.confianza ? '<br>Confianza ' + esc(d.confianza) : '') + '<br><i>Requiere verificación en campo</i>'; }
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
    var ult = anios[anios.length - 1];
    box.innerHTML = '<h2>Mapa de área quemada · MapBiomas Fuego</h2>' +
      '<div class="fg-hbar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0"><select data-r="hmod"><option value="anio">Año específico</option><option value="freq">Frecuencia de fuego ' + anios[0] + '–' + ult + '</option></select>' +
      '<input type="range" data-r="hanio" min="' + anios[0] + '" max="' + ult + '" value="' + ult + '" step="1" style="flex:1;min-width:160px"><b data-r="hlab">' + ult + '</b></div>' +
      '<div data-r="hmap" style="height:460px;border-radius:8px;overflow:hidden;position:relative"></div>' +
      '<div data-r="hleg" style="font-size:11.5px;color:#7c6a5d;margin:6px 0 14px"></div>' +
      '<h2>Área quemada anual en Caldas (ha)</h2>' + svg + '<p style="font-size:11.5px;color:#7c6a5d">Fuente: MapBiomas Fuego Colombia, Colección 1 (' + esc(H.generado || '') + '). Procesamiento: Plataforma de Gestión Territorial.</p>' + tabla;
    mapaHist(box);
  }
  async function mapaHist(box) {
    var L = window.__pgtL, cont = box.querySelector('[data-r=hmap]'); if (!cont) return;
    if (!L) { cont.innerHTML = '<div class="fg-vacio">El mapa no está disponible todavía. Abra Territorio una vez y vuelva a intentarlo.</div>'; return; }
    var meta = null; try { var r = await fetch('data/mapbiomas/meta.json', { cache: 'no-cache' }); if (r.ok) meta = await r.json(); } catch (e) {}
    if (!meta) { cont.innerHTML = '<div class="fg-vacio">Las imágenes del mapa histórico aún no están publicadas.</div>'; return; }
    if (E.hmapa) { try { E.hmapa.remove(); } catch (e) {} }
    var m = E.hmapa = L.map(cont).setView([5.28, -75.3], 9);
    m.__gcCentrado = true; if (window.__gcBase) window.__gcBase(L, { id: 'satellite' }, m); else L.tileLayer(FONDOS.sat[0], { maxZoom: 16, attribution: FONDOS.sat[1] }).addTo(m);
    m.attributionControl.addAttribution('MapBiomas Fuego Colombia (CC BY 4.0)');
    var cap = null, bounds = meta.bounds;
    var sel = box.querySelector('[data-r=hmod]'), sl = box.querySelector('[data-r=hanio]'), lab = box.querySelector('[data-r=hlab]'), leg = box.querySelector('[data-r=hleg]');
    function pinta() {
      if (cap) m.removeLayer(cap);
      var fr = sel.value === 'freq';
      sl.disabled = fr; lab.textContent = fr ? meta.anios[0] + '–' + meta.anios[meta.anios.length - 1] : sl.value;
      cap = L.imageOverlay('data/mapbiomas/' + (fr ? 'fuego_frecuencia' : 'fuego_' + sl.value) + '.png', bounds, { opacity: 0.9 }).addTo(m);
      leg.innerHTML = fr ? '<span style="color:#facc15">■</span> 1 vez &nbsp;<span style="color:#f97316">■</span> 2–3 veces &nbsp;<span style="color:#dc2626">■</span> 4–6 veces &nbsp;<span style="color:#7f1d1d">■</span> 7 o más. ' : '<span style="color:#dc2626">■</span> Área quemada en ' + sl.value + '. ';
      leg.innerHTML += 'Fuente: MapBiomas Fuego Colombia, Colección 1 (30 m); recorte a los municipios de Caldas.';
    }
    sel.onchange = pinta; sl.oninput = pinta; pinta();
    m.fitBounds(bounds);
    [100, 400, 1200].forEach(function (t) { setTimeout(function () { m.invalidateSize(); }, t); });
    try {
      await ensureMun();
      if (munGeo && E.hmapa === m) {
        /* Todo lo que está fuera de Caldas se atenúa y el mapa no se puede alejar de Caldas */
        var all = [], bb = [1e9, 1e9, -1e9, -1e9];
        munGeo.forEach(function (f) { if (!f.geometry || !f.geometry.rings) return; f.geometry.rings.forEach(function (rg) { all.push(rg.map(function (p) { return [p[1], p[0]]; })); }); if (f._bb) { bb[0] = Math.min(bb[0], f._bb[0]); bb[1] = Math.min(bb[1], f._bb[1]); bb[2] = Math.max(bb[2], f._bb[2]); bb[3] = Math.max(bb[3], f._bb[3]); } });
        L.polygon([[[-90, -180], [-90, 180], [90, 180], [90, -180]]].concat(all), { stroke: false, fillColor: '#f8fafc', fillOpacity: .88, interactive: false }).addTo(m);
        munGeo.forEach(function (f) { if (!f.geometry || !f.geometry.rings) return; L.polygon(f.geometry.rings.map(function (rg) { return rg.map(function (p) { return [p[1], p[0]]; }); }), { color: '#fde047', weight: 1.3, fill: true, fillOpacity: 0 }).bindTooltip(tit(f.attributes.MpNombre), { sticky: true }).addTo(m); });
        var cb = [[bb[1], bb[0]], [bb[3], bb[2]]]; m.fitBounds(cb); m.setMaxBounds(L.latLngBounds(cb).pad(0.25)); m.setMinZoom(Math.max(7, m.getZoom() - 1));
      }
    } catch (e) {}
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
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pgi-btn fg-btn'; b.textContent = 'Alerta temprana'; b.onclick = abrir;
    ref.parentNode.insertBefore(b, ref);
  }
  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
  window.__pgtFuego = { abrir: abrir, cruzar: cruzar };
})();
