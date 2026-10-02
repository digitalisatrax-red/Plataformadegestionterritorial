/* Visualización de operaciones de campo: puntos reportados desde QField (QFieldCloud) en un visor propio y en Alerta temprana. */
(function () {
  var CFG = window.PGT_CONFIG || {};
  var PID = '324901f0-6568-4d28-ad00-875afeae5781';
  var MOD = {
    alerta: { n: 'Alertas de incendio', c: '#dc2626', t: 'reportes_incendio' },
    ambiental: { n: 'Ambiental', c: '#16a34a', t: 'ambiental' },
    social: { n: 'Social', c: '#2563eb', t: 'social' }
  };
  var OCULTOS = { fid: 1, geom: 1, contacto: 1, nombre_referencia: 1, foto: 1, lat: 1, lon: 1 };
  var S = { cred: null, pts: [], err: '', cargando: false, quien: '', actualizado: 0, mod: { alerta: true, ambiental: true, social: true }, mun: '', dias: 90, mapa: null, capa: null, base: null, sel: null };
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
  function segundoPlano() { if (!S.actualizado || Date.now() - S.actualizado > 120000) cargar().catch(function () {}); }

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
  function punto(b) {
    if (!b || b.length < 21 || b[0] !== 0x47 || b[1] !== 0x50) return null;
    var fl = b[3], env = [0, 32, 48, 48, 64][(fl >> 1) & 7] || 0, i = 8 + env, le = b[i] === 1, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var tp = dv.getUint32(i + 1, le) % 1000; if (tp !== 1) return null;
    var x = dv.getFloat64(i + 5, le), y = dv.getFloat64(i + 13, le);
    return isFinite(x) && isFinite(y) && (x || y) ? { lon: x, lat: y } : null;
  }
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
    Object.keys(MOD).forEach(function (k) {
      tabla(db, MOD[k].t).forEach(function (r) {
        var g = punto(r.geom), lat = g ? g.lat : numero(r.lat), lon = g ? g.lon : numero(r.lon);
        if (lat === null || lon === null || (lat === 0 && lon === 0)) return;
        var f = r.fecha_hora ? new Date(String(r.fecha_hora).replace(' ', 'T')) : null;
        if (f && isNaN(f)) f = null;
        pts.push({ mod: k, id: 'qf-' + MOD[k].t + '-' + r.fid, fid: r.fid, lat: lat, lon: lon, fecha: f ? f.getTime() : 0, municipio: r.municipio || '', vereda: r.vereda || '', sitio: r.sitio || '', reg: r.registrador || r.reportante || '', foto: r.foto || '', r: r });
      });
    });
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
  window.__pgtCampo = {
    conectado: function () { return !!S.cred; },
    cargar: function () { return S.cred ? (S.cargando || (S.actualizado && Date.now() - S.actualizado < 90000 ? Promise.resolve() : cargar())) : Promise.resolve(); },
    alertas: function (dias) {
      var lim = Date.now() - (dias || 9999) * 864e5;
      return S.pts.filter(function (p) { return p.mod === 'alerta' && (!p.fecha || p.fecha >= lim); }).map(function (p) {
        var r = p.r, e = String(r.estado || 'Activo');
        return { id: p.id, origen: 'qfield', nivel: 'tecnico', reportante: p.reg, fecha_hora: new Date(p.fecha || Date.now()).toISOString(), municipio: p.municipio, vereda: p.vereda, sitio: p.sitio, cobertura: r.cobertura, tipo_fuego: r.tipo_fuego, area_ha: numero(r.area_ha), estado: ['Activo', 'Controlado', 'Extinguido'].indexOf(e) >= 0 ? e : 'Activo', causa_probable: r.causa_probable, afectacion: r.afectacion, observaciones: r.observaciones, fotos: [], lat: p.lat, lon: p.lon, validado: !!r.validado && r.validado !== '0' && r.validado !== 0, _qfield: true };
      });
    }
  };

  /* ── Visor ──────────────────────────────────────────── */
  function filtrados() {
    var lim = Date.now() - S.dias * 864e5;
    return S.pts.filter(function (p) { return S.mod[p.mod] && (!S.mun || p.municipio === S.mun) && (!S.dias || !p.fecha || p.fecha >= lim); });
  }
  function abrir() {
    if (el || !permitido()) return;
    el = document.createElement('div'); el.className = 'fg-root pc-root';
    el.innerHTML = '<div class="fg-cab"><div><span class="fg-ey">Operaciones de campo</span><h1>Visualización de operaciones de campo · Caldas</h1><div class="fg-sub">Puntos reportados desde QField (módulos Ambiental, Social y Alertas). Las alertas de incendio también alimentan Alerta temprana.</div></div><button class="fg-x" aria-label="Cerrar">×</button></div>' +
      '<div data-r="cont" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
    document.body.appendChild(el);
    el.querySelector('.fg-x').onclick = cerrar;
    pintar();
    if (S.cred) window.__pgtCampo.cargar().then(pintar, pintar);
  }
  function cerrar() { if (!el) return; if (S.mapa) { S.mapa.remove(); S.mapa = null; S.capa = null; } el.remove(); el = null; }

  function pintar() {
    if (!el) return;
    var c = el.querySelector('[data-r=cont]');
    if (S.mapa) { S.mapa.remove(); S.mapa = null; S.capa = null; }
    if (!S.cred) {
      c.innerHTML = '<div class="pc-login"><h2>Conectar con QFieldCloud</h2><p>Para ver los puntos hay que leer el proyecto de campo. Las credenciales se usan solo en esta sesión del navegador y no se guardan. Si ya pulsó «Verificar conexión» en la pestaña Campo, esta ventana se conecta sola.</p>' +
        '<label>ID del proyecto<input data-r="pid" value="' + PID + '"></label><label>Usuario:contraseña (o token de API)<input data-r="tk" type="password" autocomplete="off" placeholder="usuario:contraseña"></label>' +
        '<button class="pc-go" data-r="go">Conectar y cargar puntos</button><div class="pc-err" data-r="er">' + esc(S.err) + '</div></div>';
      c.querySelector('[data-r=go]').onclick = async function () {
        var pid = c.querySelector('[data-r=pid]').value.trim(), tk = c.querySelector('[data-r=tk]').value.trim(), er = c.querySelector('[data-r=er]');
        if (!pid || tk.length < 3) { er.textContent = 'Escriba el ID del proyecto y las credenciales.'; return; }
        this.disabled = true; this.textContent = 'Cargando…'; S.cred = { projectId: pid, token: tk };
        try { await cargar(); pintar(); } catch (e) { S.cred = null; pintar(); }
      };
      return;
    }
    if (S.cargando && !S.pts.length) { c.innerHTML = '<div class="fg-vacio">Leyendo el proyecto de campo…</div>'; S.cargando.then(pintar, pintar); return; }
    var muns = {}; S.pts.forEach(function (p) { if (p.municipio) muns[p.municipio] = 1; });
    c.innerHTML = '<div class="fg-ctl">' +
      Object.keys(MOD).map(function (k) { return '<label style="flex-direction:row;align-items:center;gap:6px;font-size:12.5px;color:#2b1d14"><input type="checkbox" data-m="' + k + '"' + (S.mod[k] ? ' checked' : '') + '><i class="pc-dot" style="background:' + MOD[k].c + '"></i>' + MOD[k].n + '</label>'; }).join('') +
      '<label>Municipio<select data-r="mun"><option value="">Todos</option>' + Object.keys(muns).sort().map(function (m) { return '<option' + (m === S.mun ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
      '<label>Periodo<select data-r="dias">' + [[7, '7 días'], [30, '30 días'], [90, '90 días'], [365, '1 año'], [0, 'Todo']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.dias ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="pgi-btn" data-r="ref" style="height:32px">Actualizar</button><span class="fg-sub" data-r="est"></span></div>' +
      '<div class="fg-cuerpo"><div class="fg-mapa"><div data-r="map"></div></div><div class="fg-lado" data-r="lado"></div></div>';
    c.querySelectorAll('[data-m]').forEach(function (i) { i.onchange = function () { S.mod[i.dataset.m] = i.checked; datos(); }; });
    c.querySelector('[data-r=mun]').onchange = function () { S.mun = this.value; datos(); };
    c.querySelector('[data-r=dias]').onchange = function () { S.dias = Number(this.value); datos(); };
    c.querySelector('[data-r=ref]').onclick = function () { var b = this; b.disabled = true; b.textContent = 'Actualizando…'; cargar().then(pintar, pintar); };
    mapa(); datos(true);
  }
  function mapa() {
    var L = window.__pgtL, cont = el.querySelector('[data-r=map]');
    if (!L) { cont.innerHTML = '<div class="fg-vacio">El mapa no está disponible todavía. Cierre esta ventana, abra Territorio y vuelva a intentarlo.</div>'; return; }
    S.mapa = L.map(cont).setView([5.28, -75.3], 9);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri' }).addTo(S.mapa);
    S.capa = L.layerGroup().addTo(S.mapa);
    [100, 400, 1200].forEach(function (t) { setTimeout(function () { if (S.mapa) S.mapa.invalidateSize(); }, t); });
  }
  function filas(p) {
    var h = '';
    Object.keys(p.r).forEach(function (k) { var v = p.r[k]; if (OCULTOS[k] || v === null || v === '' || v === undefined) return; if (k === 'fecha_hora') return; else if (k === 'validado') v = v && v !== '0' ? 'Sí' : 'No'; else if (k === 'origen') return; h += '<tr><td>' + esc(k.replace(/_/g, ' ')) + '</td><td>' + esc(v) + '</td></tr>'; });
    return h;
  }
  function popup(p) {
    return '<div class="pc-pop"><b style="color:' + MOD[p.mod].c + '">' + MOD[p.mod].n + '</b> · ' + esc(fmt(p.fecha)) + '<div class="pc-lug">' + esc([p.sitio, p.vereda, tit(p.municipio)].filter(Boolean).join(' · ')) + '</div><table>' + filas(p) + '</table>' +
      (p.foto ? '<button class="pgi-btn pc-foto" data-f="' + esc(p.foto) + '">Ver foto</button>' : '') + '<div class="pc-note">Reportó: ' + esc(p.reg || '—') + '</div></div>';
  }
  async function foto(btn) {
    var n = btn.dataset.f; btn.disabled = true; btn.textContent = 'Cargando foto…';
    try {
      var res = await window.__pgtQfFetch('file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: S.cred.projectId, token: S.cred.token, name: n }) });
      if (!res.ok) throw new Error();
      var u = URL.createObjectURL(await res.blob()), im = document.createElement('img'); im.src = u; im.style.cssText = 'max-width:100%;border-radius:6px;margin-top:6px'; btn.replaceWith(im);
    } catch (e) { btn.textContent = 'No se pudo cargar la foto'; }
  }
  function datos(ajustar) {
    if (!el) return;
    var L = window.__pgtL, ps = filtrados(), lado = el.querySelector('[data-r=lado]');
    if (S.mapa && L) {
      S.capa.clearLayers(); var pts = [];
      ps.forEach(function (p) {
        var m = L.circleMarker([p.lat, p.lon], { radius: p.mod === 'alerta' ? 9 : 7, color: '#fff', weight: 1.5, fillColor: MOD[p.mod].c, fillOpacity: .92 }).addTo(S.capa);
        m.bindPopup(popup(p), { maxWidth: 320 }); m.on('popupopen', function (e) { var b = e.popup.getElement().querySelector('.pc-foto'); if (b) b.onclick = function () { foto(b); }; }); p._m = m; pts.push([p.lat, p.lon]);
      });
      if (ajustar && pts.length) S.mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
    }
    var est = el.querySelector('[data-r=est]'); if (est) est.textContent = S.actualizado ? 'Proyecto leído ' + fmt(S.actualizado) + (S.quien ? ' · ' + S.quien : '') : '';
    var cnt = { alerta: 0, ambiental: 0, social: 0 }; ps.forEach(function (p) { cnt[p.mod]++; });
    var lista = ps.slice().sort(function (a, b) { return b.fecha - a.fecha; }).slice(0, 200);
    lado.innerHTML = '<div class="fg-kpis">' + Object.keys(MOD).map(function (k) { return '<div class="fg-kpi"><b style="color:' + MOD[k].c + '">' + cnt[k] + '</b><span>' + MOD[k].n + '</span></div>'; }).join('') + '</div>' +
      (S.err ? '<div class="pc-err">' + esc(S.err) + '</div>' : '') +
      (ps.length ? '' : '<div class="fg-vacio">No hay puntos con estos filtros. Los registros aparecen cuando se sincronizan desde QField (botón de sincronizar en el proyecto).</div>') +
      lista.map(function (p, i) { return '<div class="fg-item pc-it" data-i="' + i + '"><div><i class="pc-dot" style="background:' + MOD[p.mod].c + '"></i><b>' + MOD[p.mod].n + '</b> <span class="fg-tag">' + esc(fmt(p.fecha)) + '</span></div><div class="fg-sub">' + esc([p.sitio, p.vereda, tit(p.municipio)].filter(Boolean).join(' · ') || 'Sin ubicación descrita') + '</div></div>'; }).join('');
    lado.querySelectorAll('.pc-it').forEach(function (d) { d.onclick = function () { var p = lista[Number(d.dataset.i)]; if (p && p._m && S.mapa) { S.mapa.setView([p.lat, p.lon], Math.max(S.mapa.getZoom(), 14)); p._m.openPopup(); } }; });
  }

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
