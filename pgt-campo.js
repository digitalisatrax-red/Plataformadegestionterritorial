/* Visualización de operaciones de campo: puntos reportados desde QField (QFieldCloud) en un visor propio y en Alerta temprana. */
(function () {
  var CFG = window.PGT_CONFIG || {};
  var PID = '324901f0-6568-4d28-ad00-875afeae5781';
  var MOD = {
    alerta: { n: 'Alertas de incendio', c: '#dc2626', t: 'reportes_incendio' },
    ambiental: { n: 'Ambiental', c: '#16a34a', t: 'ambiental' },
    social: { n: 'Social', c: '#2563eb', t: 'social' }
  };
  var PAL = ['#9333ea', '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#ea580c', '#0d9488', '#7c3aed'];
  function addMod(k, n, t, ext) { if (!MOD[k]) { MOD[k] = { n: n, c: PAL[Object.keys(MOD).length % PAL.length], t: t, dyn: true, ext: !!ext }; S.mod[k] = true; } return MOD[k]; }
  var OCULTOS = { fid: 1, geom: 1, geometry: 1, contacto: 1, nombre_referencia: 1, foto: 1, lat: 1, lon: 1 };
  var S = { ext: [], extPts: [], sync: '', cred: null, pts: [], err: '', cargando: false, quien: '', actualizado: 0, mod: { alerta: true, ambiental: true, social: true }, mun: '', dias: 90, mapa: null, capa: null, base: null, sel: null };
  var el = null, SQL = null, SQLp = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sesion() { try { var s = JSON.parse(sessionStorage.getItem('pgt.sesion') || 'null'); if (s && s.exp > Date.now()) return s; } catch (e) {} return null; }
  function permitido() { var s = sesion(); return !!(s && s.roles && s.roles.indexOf('planeacion') >= 0); }
  function fmt(t) { try { return new Date(t).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return t; } }
  function tit(s) { return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }); }

  /* ── Credenciales: solo en memoria, se capturan al «Verificar conexión» de la pestaña Campo ── */
  if (window.__pgtQfFetch) {
    var f0 = window.__pgtQfFetch;
    window.__pgtQfFetch = function (accion, o) {
      var p = f0(accion, o);
      if (accion === 'status') {
        var b = null; try { b = typeof (o && o.body) === 'string' ? JSON.parse(o.body) : null; } catch (e) {}
        if (b && b.projectId && b.token) p.then(function (r) { return r.clone().json(); }).then(function (j) {
          if (j && j.connected) { S.cred = { projectId: b.projectId, token: b.token }; S.quien = (j.project && j.project.name) || ''; segundoPlano(); }
        }).catch(function () {});
      }
      return p;
    };
  }
  function segundoPlano() { if (!S.actualizado || Date.now() - S.actualizado > 120000) cargar().then(function () { return sincronizar(); }).catch(function () {}); }

  /* ── GeoPackage ─────────────────────────────────────── */
  function motor() {
    if (SQL) return Promise.resolve(SQL);
    if (SQLp) return SQLp;
    SQLp = new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = 'vendor/sql-wasm.js?v=1';
      s.onload = function () { window.initSqlJs({ locateFile: function (f) { return 'vendor/' + f + '?v=1'; } }).then(function (q) { SQL = q; ok(q); }, ko); };
      s.onerror = function () { SQLp = null; ko(new Error('No se pudo cargar el lector de GeoPackage.')); };
      document.head.appendChild(s);
    });
    return SQLp;
  }
  /* WKB → geometría GeoJSON (puntos, líneas, polígonos y sus versiones múltiples) */
  function wkb(dv, o) {
    var le = dv.getUint8(o) === 1, t = dv.getUint32(o + 1, le); o += 5;
    var tp = (t & 0xFFFF) % 1000, k1 = Math.floor((t & 0xFFFF) / 1000), dim = 2 + ((t & 0x80000000) || k1 === 1 || k1 === 3 ? 1 : 0) + ((t & 0x40000000) || k1 >= 2 ? 1 : 0);
    if (t & 0x20000000) o += 4;
    function pt() { var c = [dv.getFloat64(o, le), dv.getFloat64(o + 8, le)]; o += 8 * dim; return c; }
    function ring() { var n = dv.getUint32(o, le); o += 4; var r = []; for (var k = 0; k < n; k++) r.push(pt()); return r; }
    if (tp === 1) return { g: { type: 'Point', coordinates: pt() }, o: o };
    if (tp === 2) return { g: { type: 'LineString', coordinates: ring() }, o: o };
    if (tp === 3) { var n = dv.getUint32(o, le); o += 4; var rs = []; for (var k = 0; k < n; k++) rs.push(ring()); return { g: { type: 'Polygon', coordinates: rs }, o: o }; }
    if (tp >= 4 && tp <= 6) {
      var m = dv.getUint32(o, le); o += 4; var parts = [];
      for (var q = 0; q < m; q++) { var r = wkb(dv, o); parts.push(r.g.coordinates); o = r.o; }
      return { g: { type: ['MultiPoint', 'MultiLineString', 'MultiPolygon'][tp - 4], coordinates: parts }, o: o };
    }
    return null;
  }
  function geom(b) {
    try {
      if (!b || b.length < 21 || b[0] !== 0x47 || b[1] !== 0x50) return null;
      var fl = b[3], env = [0, 32, 48, 48, 64][(fl >> 1) & 7] || 0, dv = new DataView(b.buffer, b.byteOffset, b.byteLength), r = wkb(dv, 8 + env);
      return r ? r.g : null;
    } catch (e) { return null; }
  }
  function centro(g) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    (function rec(a) { if (typeof a[0] === 'number') { if (a[0] < x0) x0 = a[0]; if (a[0] > x1) x1 = a[0]; if (a[1] < y0) y0 = a[1]; if (a[1] > y1) y1 = a[1]; } else a.forEach(rec); })(g.coordinates);
    return x0 > x1 ? null : { lon: (x0 + x1) / 2, lat: (y0 + y1) / 2 };
  }
  function punto(b) { var g = geom(b); if (!g || g.type !== 'Point') return null; var c = g.coordinates; return isFinite(c[0]) && isFinite(c[1]) && (c[0] || c[1]) ? { lon: c[0], lat: c[1] } : null; }
  function tabla(db, t) {
    var out = [], r;
    try { r = db.exec('SELECT * FROM "' + t + '"'); } catch (e) { return out; }
    if (!r.length) return out;
    var cols = r[0].columns;
    r[0].values.forEach(function (v) { var o = {}; cols.forEach(function (c, k) { o[c] = v[k]; }); out.push(o); });
    return out;
  }
  function numero(x) { var n = Number(x); return isFinite(n) && x !== null && x !== '' ? n : null; }
  function normalizar(db) {
    var pts = [];
    ['alerta', 'ambiental', 'social'].forEach(function (k) {
      tabla(db, MOD[k].t).forEach(function (r) {
        var g = punto(r.geom), lat = g ? g.lat : numero(r.lat), lon = g ? g.lon : numero(r.lon);
        if (lat === null || lon === null || (lat === 0 && lon === 0)) return;
        var f = r.fecha_hora ? new Date(String(r.fecha_hora).replace(' ', 'T')) : null;
        if (f && isNaN(f)) f = null;
        pts.push({ mod: k, id: 'qf-' + MOD[k].t + '-' + r.fid, fid: r.fid, lat: lat, lon: lon, fecha: f ? f.getTime() : 0, municipio: r.municipio || '', vereda: r.vereda || '', sitio: r.sitio || '', reg: r.registrador || r.reportante || '', foto: r.foto || '', r: r });
      });
    });
    /* Cualquier otra capa que se agregue al proyecto de QField aparece sola como una categoría nueva */
    var ref = { municipios: 1, veredas: 1, ambiental: 1, social: 1, reportes_incendio: 1 };
    try {
      var cs = db.exec("SELECT table_name FROM gpkg_contents WHERE data_type='features'");
      (cs.length ? cs[0].values : []).forEach(function (v) {
        var t = v[0]; if (ref[t] || /^(gpkg_|rtree_|sqlite_)/.test(t)) return;
        var filas = tabla(db, t); if (!filas.length || filas.length > 3000) return;
        var k = 'x_' + t; if (!MOD[k]) addMod(k, tit(t.replace(/_/g, ' ')), t);
        filas.forEach(function (r) {
          var g = geom(r.geom), c = g && centro(g); if (!c) return;
          var f = r.fecha_hora || r.fecha ? new Date(String(r.fecha_hora || r.fecha).replace(' ', 'T')) : null; if (f && isNaN(f)) f = null;
          pts.push({ mod: k, id: 'qf-' + t + '-' + r.fid, fid: r.fid, lat: c.lat, lon: c.lon, geo: g, fecha: f ? f.getTime() : 0, municipio: r.municipio || '', vereda: r.vereda || '', sitio: r.sitio || r.nombre || '', reg: r.registrador || '', foto: r.foto || '', r: r });
        });
      });
    } catch (e) {}
    return pts;
  }
  async function cargar() {
    if (!S.cred) throw new Error('Sin conexión');
    if (S.cargando) return S.cargando;
    S.cargando = (async function () {
      S.err = '';
      try {
        var res = await window.__pgtQfFetch('file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: S.cred.projectId, token: S.cred.token, name: 'campo_caldas.gpkg' }) });
        if (!res.ok) { var m = ''; try { m = (await res.json()).error; } catch (e) {} if (res.status === 401 || res.status === 403) S.cred = null; throw new Error(m || 'No se pudo leer el proyecto (HTTP ' + res.status + ').'); }
        var buf = new Uint8Array(await res.arrayBuffer()), q = await motor(), db = new q.Database(buf);
        try { S.pts = normalizar(db); } finally { db.close(); }
        S.actualizado = Date.now();
      } catch (e) { S.err = e.message || String(e); throw e; }
      finally { S.cargando = false; }
    })();
    return S.cargando;
  }

  /* ── Puente hacia Alerta temprana ───────────────────── */
  function fila(p) {
    var r = p.r, e = String(r.estado || 'Activo');
    return { id: p.id, qfield_ref: p.id, origen: 'qfield', nivel: 'tecnico', reportante: p.reg || null, fecha_hora: new Date(p.fecha || Date.now()).toISOString(), municipio: p.municipio || null, vereda: p.vereda || null, sitio: p.sitio || null, cobertura: r.cobertura || null, tipo_fuego: r.tipo_fuego || null, area_ha: numero(r.area_ha), estado: ['Activo', 'Controlado', 'Extinguido'].indexOf(e) >= 0 ? e : 'Activo', causa_probable: r.causa_probable || null, afectacion: r.afectacion || null, observaciones: r.observaciones || null, lat: p.lat, lon: p.lon };
  }
  /* Con sesión de Planeación, las alertas de QField se copian a la base de datos: así llegan a Alerta temprana sin tener que conectar QField cada vez. */
  async function sincronizar() {
    var s = sesion(), SB = (CFG.supabaseUrl || '').replace(/\/$/, '');
    var al = S.pts.filter(function (p) { return p.mod === 'alerta'; });
    if (!s || !s.tk || !permitido() || !al.length || !SB) { S.sync = ''; return; }
    try {
      var cuerpo = al.map(fila).map(function (o) { delete o.id; return o; });
      var res = await fetch(SB + '/rest/v1/reportes_incendio?on_conflict=qfield_ref', { method: 'POST', headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + s.tk, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(cuerpo) });
      S.sync = res.ok ? 'ok' : (res.status === 400 || res.status === 404 ? 'migracion' : 'error ' + res.status);
    } catch (e) { S.sync = 'error'; }
  }
  window.__pgtCampo = {
    conectado: function () { return !!S.cred; },
    abrir: function () { abrir(); },
    cargar: function () { return S.cred ? (S.cargando || (S.actualizado && Date.now() - S.actualizado < 90000 ? Promise.resolve() : cargar())) : Promise.resolve(); },
    alertas: function (dias, yaSincronizadas) {
      var lim = Date.now() - (dias || 9999) * 864e5, ya = yaSincronizadas || {};
      return S.pts.filter(function (p) { return p.mod === 'alerta' && !ya[p.id] && (!p.fecha || p.fecha >= lim); }).map(function (p) { var o = fila(p); o._qfield = true; o.validado = !!p.r.validado && p.r.validado !== '0'; o.fotos = []; return o; });
    }
  };

  /* ── Visor ──────────────────────────────────────────── */
  var ROT = { fecha_hora: 'Fecha y hora', registrador: 'Registró', reportante: 'Reportó', tipo_registro: 'Tipo de registro', estado_conservacion: 'Estado de conservación', especie_o_grupo: 'Especie o grupo', n_individuos: 'N.º de individuos', tipo_agua: 'Tipo de agua', calidad_agua: 'Calidad del agua', presion_principal: 'Presión principal', otras_presiones: 'Otras presiones', area_ha: 'Área (ha)', area_protegida: 'Área protegida', accion_recomendada: 'Acción recomendada', tipo_actor: 'Tipo de actor', n_personas: 'N.º de personas', actividad_economica: 'Actividad económica', acceso_agua: 'Acceso al agua', usa_fuego: 'Usa fuego', motivo_fuego: 'Motivo del fuego', conoce_protocolo: 'Conoce el protocolo', percepcion_riesgo: 'Percepción del riesgo', necesidad_principal: 'Necesidad principal', tipo_fuego: 'Tipo de fuego', causa_probable: 'Causa probable', afectacion: 'Afectación' };
  var ICO = { alerta: '<path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-.4-1.800-1-2.500 3 1.500 5 4.500 5 7.500a7 7 0 0 1-14 0c0-6 5-8 7-14z"/>', ambiental: '<path d="M20 4C9 4 4 9 4 15c0 2 1 4 1 4s1-1 2-1c6 0 13-3 13-14zM4 21c2-6 6-9 11-11"/>', social: '<circle cx="9" cy="8" r="3.500"/><circle cx="17" cy="9" r="2.500"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6zM16 14c3 0 6 1.500 6 5h-4"/>' };
  ICO.capa = '<path d="M12 3 2 8l10 5 10-5zM2 12l10 5 10-5M2 16l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2"/>';
  function ico(k, sz) { return '<svg viewBox="0 0 24 24" width="' + (sz || 16) + '" height="' + (sz || 16) + '" fill="currentColor" aria-hidden="true">' + (ICO[k] || ICO.capa) + '</svg>'; }
  function hace(t) {
    if (!t) return '';
    var m = Math.round((Date.now() - t) / 6e4); if (m < 1) return 'ahora'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60); if (h < 36) return 'hace ' + h + ' h'; var d = Math.round(h / 24); return d < 60 ? 'hace ' + d + ' días' : fmt(t);
  }
  function titulo(p) {
    var r = p.r;
    if (p.mod === 'alerta') return (r.tipo_fuego ? 'Incendio · ' + r.tipo_fuego : 'Alerta de incendio');
    if (p.mod === 'ambiental') return r.tipo_registro ? 'Registro ambiental · ' + r.tipo_registro : 'Registro ambiental';
    if (p.mod === 'social') return r.tipo_actor ? 'Encuesta social · ' + r.tipo_actor : 'Encuesta social';
    var nom = r.nombre || r.name || r.NOMBRE || r.Name || r.titulo || r.tipo; return MOD[p.mod].n + (nom ? ' · ' + nom : '');
  }
  function lugar(p) { return [p.sitio, p.vereda, tit(p.municipio)].filter(Boolean).join(' · ') || (MOD[p.mod].dyn ? 'Capa: ' + MOD[p.mod].n : 'Sin ubicación descrita'); }
  function todos() { return S.pts.concat(S.extPts || []); }
  function filtrados() {
    var lim = Date.now() - S.dias * 864e5, q = (S.q || '').toLowerCase();
    return todos().filter(function (p) { return S.mod[p.mod] && (!S.mun || p.municipio === S.mun) && (!S.dias || !p.fecha || p.fecha >= lim) && (!q || (titulo(p) + ' ' + lugar(p) + ' ' + p.reg).toLowerCase().indexOf(q) >= 0); });
  }
  function abrir() {
    if (el || !permitido()) return;
    el = document.createElement('div'); el.className = 'fg-root pc-root';
    el.innerHTML = '<div class="fg-cab"><div><span class="fg-ey">Operaciones de campo</span><h1>Lo que se está reportando en el territorio</h1><div class="fg-sub">Registros hechos con QField en Caldas: alertas de incendio, observaciones ambientales y encuestas sociales.</div></div><button class="fg-x" aria-label="Cerrar">×</button></div>' +
      '<div data-r="cont" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
    document.body.appendChild(el);
    el.querySelector('.fg-x').onclick = cerrar;
    pintar();
    if (S.cred) window.__pgtCampo.cargar().then(function () { return sincronizar(); }).then(pintar, pintar);
    S.tim = setInterval(function () { if (el && S.cred && !S.cargando) cargar().then(sincronizar).then(function () { if (el) datos(); }, function () {}); }, 120000);
  }
  function cerrar() { clearInterval(S.tim); if (!el) return; try { if (S.mapa) { S.mapa.closePopup(); S.mapa.remove(); } } catch (e) {} S.mapa = null; S.capa = null; el.remove(); el = null; }

  function pintar() {
    if (!el) return;
    var c = el.querySelector('[data-r=cont]');
    try { if (S.mapa) { S.mapa.closePopup(); S.mapa.remove(); } } catch (e) {} S.mapa = null; S.capa = null;
    if (!S.cred && !S.omitir) {
      c.innerHTML = '<div class="pc-login"><div class="pc-badges">' + ['alerta', 'ambiental', 'social'].map(function (k) { return '<span style="background:' + MOD[k].c + '">' + ico(k, 22) + '</span>'; }).join('') + '</div><h2>Conecte el proyecto de campo</h2>' +
        '<p>Escriba el usuario y la contraseña de QFieldCloud para traer los registros. No se guardan: solo se usan mientras esta ventana del navegador esté abierta.</p>' +
        '<p class="pc-tip">Atajo: si en la pestaña <b>Campo</b> ya pulsó «Verificar conexión», este visor se conecta solo.</p>' +
        '<label>Usuario y contraseña<input data-r="tk" type="password" autocomplete="off" placeholder="usuario:contraseña"></label>' +
        '<details><summary>Opciones avanzadas</summary><label>ID del proyecto<input data-r="pid" value="' + PID + '"></label></details>' +
        '<button class="pc-go" data-r="go">Conectar y ver los puntos</button><div class="pc-err" data-r="er">' + esc(S.err) + '</div><button type="button" class="pc-lnk" data-r="om">Solo quiero ver mis propias capas (sin QField)</button></div>';
      var go = async function () {
        var b = c.querySelector('[data-r=go]'), pid = c.querySelector('[data-r=pid]').value.trim(), tk = c.querySelector('[data-r=tk]').value.trim(), er = c.querySelector('[data-r=er]');
        if (tk.length < 3) { er.textContent = 'Escriba usuario:contraseña (separados por dos puntos).'; return; }
        b.disabled = true; b.textContent = 'Cargando…'; S.cred = { projectId: pid, token: tk };
        try { await cargar(); await sincronizar(); pintar(); } catch (e) { S.cred = null; pintar(); }
      };
      c.querySelector('[data-r=om]').onclick = function () { S.omitir = true; pintar(); };
      c.querySelector('[data-r=go]').onclick = go; c.querySelector('[data-r=tk]').onkeydown = function (e) { if (e.key === 'Enter') go(); };
      return;
    }
    if (S.cred && S.cargando && !S.pts.length) { c.innerHTML = '<div class="fg-vacio">Leyendo el proyecto de campo…</div>'; S.cargando.then(pintar, pintar); return; }
    var muns = {}; S.pts.forEach(function (p) { if (p.municipio) muns[p.municipio] = 1; });
    var cnt = {}; Object.keys(MOD).forEach(function (k) { cnt[k] = todos().filter(function (p) { return p.mod === k; }).length; });
    c.innerHTML = '<div class="pc-bar"><div class="pc-chips">' +
      Object.keys(MOD).filter(function (k) { return !MOD[k].dyn || cnt[k] || MOD[k].ext; }).map(function (k) { return '<button type="button" class="pc-chip' + (S.mod[k] ? ' on' : '') + '" data-m="' + k + '" style="--c:' + MOD[k].c + '">' + ico(k, 15) + '<span>' + MOD[k].n + '</span><b>' + cnt[k] + '</b>' + (MOD[k].ext ? '<i class="pc-x" data-del="' + k + '" title="Quitar capa">×</i>' : '') + '</button>'; }).join('') + '<button type="button" class="pc-chip pc-add" data-r="add" style="--c:#15803d">+ Añadir capa</button></div>' +
      '<div class="pc-fil"><input type="search" data-r="q" placeholder="Buscar vereda, sitio o persona…" value="' + esc(S.q || '') + '"><select data-r="mun"><option value="">Todos los municipios</option>' + Object.keys(muns).sort().map(function (m) { return '<option value="' + esc(m) + '"' + (m === S.mun ? ' selected' : '') + '>' + esc(tit(m)) + '</option>'; }).join('') + '</select>' +
      '<select data-r="dias">' + [[7, 'Últimos 7 días'], [30, 'Últimos 30 días'], [90, 'Últimos 90 días'], [365, 'Último año'], [0, 'Todo el tiempo']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.dias ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="pgi-btn" data-r="ref">' + (S.cred ? '↻ Actualizar' : 'Conectar QField') + '</button></div></div><div class="pc-est" data-r="est"></div>' +
      '<div class="fg-cuerpo"><div class="fg-mapa"><div data-r="map"></div><div class="pc-base"><button data-b="sat" class="on">Satélite</button><button data-b="map">Mapa</button></div></div><div class="fg-lado" data-r="lado"></div></div>';
    c.querySelector('[data-r=add]').onclick = dialogo;
    c.querySelectorAll('[data-del]').forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); quitar(x.dataset.del); }; });
    c.querySelectorAll('[data-m]').forEach(function (i) { i.onclick = function () { S.mod[i.dataset.m] = !S.mod[i.dataset.m]; i.classList.toggle('on', S.mod[i.dataset.m]); datos(true); }; });
    c.querySelector('[data-r=q]').oninput = function () { S.q = this.value; datos(); };
    c.querySelector('[data-r=mun]').onchange = function () { S.mun = this.value; datos(true); };
    c.querySelector('[data-r=dias]').onchange = function () { S.dias = Number(this.value); datos(true); };
    c.querySelector('[data-r=ref]').onclick = function () { var b = this; if (!S.cred) { S.omitir = false; pintar(); return; } b.disabled = true; b.textContent = 'Actualizando…'; cargar().then(sincronizar).then(pintar, pintar); };
    c.querySelectorAll('[data-b]').forEach(function (b) { b.onclick = function () { S.fondo = b.dataset.b; c.querySelectorAll('[data-b]').forEach(function (x) { x.classList.toggle('on', x === b); }); fondo(); }; });
    mapa(); datos(true);
  }
  var TILES = { sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', map: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}' };
  function fondo() { var L = window.__pgtL; if (!S.mapa || !L) return; if (S.base) S.mapa.removeLayer(S.base); S.base = L.tileLayer(TILES[S.fondo || 'sat'], { maxZoom: 18, attribution: 'Esri' }).addTo(S.mapa); S.base.bringToBack(); }
  function mapa() {
    var L = window.__pgtL, cont = el.querySelector('[data-r=map]');
    if (!L) { cont.innerHTML = '<div class="fg-vacio">El mapa no está disponible todavía. Cierre esta ventana, abra Territorio y vuelva a intentarlo.</div>'; return; }
    S.mapa = L.map(cont).setView([5.28, -75.3], 9); S.base = null; fondo();
    S.capa = L.layerGroup().addTo(S.mapa);
    [100, 400, 1200].forEach(function (t) { setTimeout(function () { if (S.mapa) S.mapa.invalidateSize(); }, t); });
  }
  function popup(p) {
    var h = '', r = p.r;
    Object.keys(r).forEach(function (k) {
      var v = r[k]; if (OCULTOS[k] || k === 'fecha_hora' || k === 'origen' || k === 'nivel' || k === 'municipio' || k === 'vereda' || k === 'sitio' || v === null || v === '' || v === undefined) return;
      if (k === 'validado' || k === 'consentimiento') v = v && v !== '0' ? 'Sí' : 'No';
      h += '<div class="pc-f"><span>' + esc(ROT[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '))) + '</span><b>' + esc(v) + '</b></div>';
    });
    return '<div class="pc-pop"><div class="pc-ph" style="background:' + MOD[p.mod].c + '">' + ico(p.mod, 18) + '<div><b>' + esc(titulo(p)) + '</b><small>' + esc(fmt(p.fecha)) + ' · ' + esc(hace(p.fecha)) + '</small></div></div><div class="pc-pb"><div class="pc-lug">' + esc(lugar(p)) + '</div>' + (h || '<div class="pc-note">Sin más datos.</div>') +
      (p.foto ? '<div class="pc-fotoc" data-f="' + esc(p.foto) + '"><button type="button" class="pgi-btn pc-foto">Ver foto</button></div>' : '') + '<div class="pc-note">Registró: ' + esc(p.reg || '—') + '</div><a class="pc-ruta" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + p.lat + ',' + p.lon + '">Cómo llegar</a></div></div>';
  }
  async function foto(box) {
    var n = box.dataset.f; box.innerHTML = '<span class="pc-note">Cargando foto…</span>';
    try {
      var res = await window.__pgtQfFetch('file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: S.cred.projectId, token: S.cred.token, name: n }) });
      if (!res.ok) throw new Error();
      var u = URL.createObjectURL(await res.blob()); box.innerHTML = '<a href="' + u + '" target="_blank"><img src="' + u + '" alt="Foto del registro"></a>';
    } catch (e) { box.innerHTML = '<span class="pc-note">No se pudo cargar la foto.</span>'; }
  }
  function pin(p) { var L = window.__pgtL; return L.divIcon({ className: 'pc-pin', html: '<span style="background:' + MOD[p.mod].c + '">' + ico(p.mod, 15) + '</span>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] }); }
  function datos(ajustar) {
    if (!el) return;
    var L = window.__pgtL, ps = filtrados(), lado = el.querySelector('[data-r=lado]');
    if (S.mapa && L) {
      S.capa.clearLayers(); var pts = [];
      ps.forEach(function (p) {
        var m = p.geo && p.geo.type !== 'Point' && p.geo.type !== 'MultiPoint' ? L.geoJSON(p.geo, { style: { color: MOD[p.mod].c, weight: 3, fillOpacity: .25 } }).addTo(S.capa) : L.marker([p.lat, p.lon], { icon: pin(p) }).addTo(S.capa);
        m.bindPopup(popup(p), { maxWidth: 330, minWidth: 250 }); m.on('popupopen', function (e) { var b = e.popup.getElement().querySelector('.pc-fotoc'); if (b) b.querySelector('button').onclick = function () { foto(b); }; }); p._m = m; pts.push([p.lat, p.lon]); if (!m.openPopup) m.openPopup = function () { m.eachLayer(function (l) { l.openPopup && l.openPopup([p.lat, p.lon]); }); };
      });
      if (ajustar && pts.length) S.mapa.fitBounds(pts, { padding: [50, 50], maxZoom: 13 });
    }
    var est = el.querySelector('[data-r=est]');
    if (est) {
      var nA = S.pts.filter(function (p) { return p.mod === 'alerta'; }).length;
      est.innerHTML = (S.actualizado ? 'Actualizado ' + esc(hace(S.actualizado)) + (S.quien ? ' · proyecto ' + esc(S.quien) : '') : '') +
        (S.sync === 'ok' && nA ? ' · <b class="pc-ok">' + nA + ' alerta' + (nA === 1 ? '' : 's') + ' de incendio enviada' + (nA === 1 ? '' : 's') + ' a Alerta temprana</b>' : '') +
        (S.sync === 'migracion' ? ' · <b class="pc-aviso">Falta preparar la base de datos para enviar las alertas a Alerta temprana</b>' : '') + (S.sync.indexOf('error') === 0 ? ' · <b class="pc-aviso">No se pudieron enviar las alertas a Alerta temprana (' + esc(S.sync) + ')</b>' : '');
    }
    var lista = ps.slice().sort(function (a, b) { return b.fecha - a.fecha; }).slice(0, 200);
    lado.innerHTML = (S.err ? '<div class="pc-err">' + esc(S.err) + '</div>' : '') +
      (ps.length ? '<div class="pc-cnt">' + ps.length + ' registro' + (ps.length === 1 ? '' : 's') + '</div>' : '<div class="pc-vacio">' + (S.pts.length ? 'Ningún registro coincide con estos filtros.' : 'Aún no hay registros. Aparecen aquí cuando se sincronizan desde QField (botón de sincronizar en el teléfono).') + '</div>') +
      lista.map(function (p, i) { return '<div class="pc-it" data-i="' + i + '" style="--c:' + MOD[p.mod].c + '"><span class="pc-ic">' + ico(p.mod, 18) + '</span><div class="pc-tx"><b>' + esc(titulo(p)) + '</b><span>' + esc(lugar(p)) + '</span><small>' + esc(hace(p.fecha)) + (p.reg ? ' · ' + esc(p.reg) : '') + '</small></div></div>'; }).join('');
    lado.querySelectorAll('.pc-it').forEach(function (d) { d.onclick = function () { var p = lista[Number(d.dataset.i)]; if (p && p._m && S.mapa) { S.mapa.setView([p.lat, p.lon], Math.max(S.mapa.getZoom(), 14)); p._m.openPopup(); } }; });
  }

  /* ── Capas propias (archivo o enlace) ─────────────────── */
  var LS = 'pgt.campo.capas';
  function guardarCapas() { try { localStorage.setItem(LS, JSON.stringify(S.ext.filter(function (x) { return x.url; }).map(function (x) { return { k: x.k, n: x.n, c: x.c, url: x.url }; }))); } catch (e) {} }
  function csv(txt) {
    var ls = txt.replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); }); if (ls.length < 2) throw new Error('El CSV está vacío.');
    var sep = (ls[0].match(/;/g) || []).length > (ls[0].match(/,/g) || []).length ? ';' : ',';
    function cortar(l) { var o = [], c = '', q = false; for (var i = 0; i < l.length; i++) { var ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { c += '"'; i++; } else q = !q; } else if (ch === sep && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; }
    var h = cortar(ls[0]).map(function (x) { return x.trim(); }), low = h.map(function (x) { return x.toLowerCase(); });
    function col(ns) { for (var i = 0; i < ns.length; i++) { var k = low.indexOf(ns[i]); if (k >= 0) return k; } return -1; }
    var iy = col(['lat', 'latitude', 'latitud', 'y']), ix = col(['lon', 'lng', 'long', 'longitude', 'longitud', 'x']);
    if (iy < 0 || ix < 0) throw new Error('El CSV necesita columnas de latitud y longitud (lat/lon, latitud/longitud, x/y).');
    var fs = [];
    ls.slice(1).forEach(function (l) { var v = cortar(l), la = parseFloat(String(v[iy]).replace(',', '.')), lo = parseFloat(String(v[ix]).replace(',', '.')); if (!isFinite(la) || !isFinite(lo)) return; var pr = {}; h.forEach(function (n, k) { if (k !== iy && k !== ix) pr[n] = v[k]; }); fs.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: pr }); });
    return { type: 'FeatureCollection', features: fs };
  }
  function aGeo(j) {
    if (j.type === 'FeatureCollection') return j;
    if (j.type === 'Feature') return { type: 'FeatureCollection', features: [j] };
    if (j.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: j, properties: {} }] };
    throw new Error('El archivo no es un GeoJSON válido.');
  }
  function agregarCapa(k, nombre, color, fc, url) {
    var ex = S.ext.filter(function (x) { return x.k === k; })[0];
    if (!ex) { S.ext.push({ k: k, n: nombre, c: color, url: url || '' }); }
    var m = addMod(k, nombre, k, true); if (color) m.c = color; S.mod[k] = true;
    S.extPts = S.extPts.filter(function (p) { return p.mod !== k; });
    var n = 0;
    (fc.features || []).slice(0, 5000).forEach(function (f, i) {
      var g = f.geometry; if (!g || !g.coordinates) return; var c = centro(g); if (!c || !isFinite(c.lat) || !isFinite(c.lon)) return;
      var r = f.properties || {}, fe = r.fecha_hora || r.fecha || r.date; var t = fe ? new Date(fe).getTime() : 0;
      S.extPts.push({ mod: k, id: k + '-' + i, fid: i, lat: c.lat, lon: c.lon, geo: g, fecha: isNaN(t) ? 0 : t, municipio: r.municipio || r.MUNICIPIO || '', vereda: r.vereda || '', sitio: r.sitio || r.nombre || r.NOMBRE || r.name || '', reg: '', foto: '', r: r }); n++;
    });
    if (!n) throw new Error('No se encontraron elementos con ubicación en esa capa.');
    guardarCapas(); return n;
  }
  async function desdeUrl(url) {
    var u = url.trim();
    if (/\/(FeatureServer|MapServer)\/\d+\/?$/i.test(u)) u = u.replace(/\/$/, '') + '/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=3000';
    var res = await fetch(u); if (!res.ok) throw new Error('El servidor respondió HTTP ' + res.status + '.');
    var tx = await res.text(), j; try { j = JSON.parse(tx); } catch (e) { return csv(tx); }
    if (j.error) throw new Error((j.error.message || 'El servicio devolvió un error') + '.');
    return aGeo(j);
  }
  function quitar(k) { S.ext = S.ext.filter(function (x) { return x.k !== k; }); S.extPts = S.extPts.filter(function (p) { return p.mod !== k; }); delete MOD[k]; delete S.mod[k]; guardarCapas(); pintar(); }
  function dialogo() {
    var d = document.createElement('div'); d.className = 'pc-dlg';
    d.innerHTML = '<div class="pc-box"><h3>Añadir una capa al visor</h3><p>Suba un archivo o pegue un enlace. Se dibuja sobre el mapa junto con los registros de campo.</p>' +
      '<label>Nombre de la capa<input data-r="n" placeholder="Ej.: Nacimientos de agua"></label><label>Color<input data-r="c" type="color" value="#9333ea"></label>' +
      '<label>Archivo <small>(GeoJSON o CSV con latitud y longitud)</small><input data-r="f" type="file" accept=".geojson,.json,.csv,.txt"></label>' +
      '<label>… o enlace <small>(GeoJSON, CSV o capa de ArcGIS REST: …/FeatureServer/0)</small><input data-r="u" placeholder="https://…"></label>' +
      '<div class="pc-err" data-r="e"></div><div class="pc-acc"><button type="button" class="pgi-btn" data-r="x">Cancelar</button><button type="button" class="pc-go" data-r="ok">Añadir capa</button></div></div>';
    el.appendChild(d);
    d.querySelector('[data-r=x]').onclick = function () { d.remove(); };
    d.querySelector('[data-r=ok]').onclick = async function () {
      var b = this, e = d.querySelector('[data-r=e]'), nom = d.querySelector('[data-r=n]').value.trim(), col = d.querySelector('[data-r=c]').value, f = d.querySelector('[data-r=f]').files[0], u = d.querySelector('[data-r=u]').value.trim();
      if (!f && !u) { e.textContent = 'Elija un archivo o pegue un enlace.'; return; }
      nom = nom || (f ? f.name.replace(/\.[^.]+$/, '') : 'Capa propia'); b.disabled = true; b.textContent = 'Cargando…'; e.textContent = '';
      try {
        var fc;
        if (f) { var tx = await f.text(); try { fc = aGeo(JSON.parse(tx)); } catch (x) { if (x instanceof SyntaxError) fc = csv(tx); else throw x; } } else fc = await desdeUrl(u);
        var k = 'e_' + nom.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + (S.ext.length + 1);
        agregarCapa(k, nom, col, fc, f ? '' : u); d.remove(); pintar();
      } catch (x) { e.textContent = 'No se pudo añadir la capa: ' + (x.message || x) + (u && !f ? ' (Si el enlace no permite accesos externos, descargue el archivo y súbalo.)' : ''); b.disabled = false; b.textContent = 'Añadir capa'; }
    };
  }
  function restaurar() {
    var l = []; try { l = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) {}
    l.forEach(function (x) { if (MOD[x.k] || !x.url) return; desdeUrl(x.url).then(function (fc) { agregarCapa(x.k, x.n, x.c, fc, x.url); if (el) pintar(); }, function () {}); });
  }
  restaurar();

  /* ── Botón ──────────────────────────────────────────── */
  function montar() {
    var ex = document.querySelector('.pc-btn');
    if (!permitido()) { if (ex) ex.remove(); if (el) cerrar(); return; }
    if (ex) return;
    var ref = document.querySelector('.fg-btn') || document.querySelector('.pgi-btn'); if (!ref) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pgi-btn pc-btn'; b.textContent = 'Operaciones de campo'; b.onclick = abrir;
    ref.parentNode.insertBefore(b, ref.nextSibling);
  }
  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
  window.__pgtCampoAbrir = abrir;
})();
