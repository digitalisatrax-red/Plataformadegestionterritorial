/* Operaciones de campo · EN VIVO: reportes, alertas, guardabosques y chat de la app Incendios Caldas.
   Lee la misma base de datos (Supabase) con la sesión de Planeación y se actualiza sola cada 8 s. */
(function () {
  var CFG = window.PGT_CONFIG || {};
  var S = { tab: 'res', rep: [], al: [], msg: [], pos: [], nov: [], canal: 'general', t: 0, tim: null, mapa: null, caps: null, ok: false, err: '', busy: false, vistos: {}, root: null };
  var el = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sesion() { try { var s = JSON.parse(sessionStorage.getItem('pgt.sesion') || 'null'); if (s && s.exp > Date.now()) return s; } catch (e) {} return null; }
  function permitido() { var s = sesion(); return !!(s && s.roles && s.roles.indexOf('planeacion') >= 0); }
  function uid() { try { var p = sesion().tk.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).sub; } catch (e) { return null; } }
  function fmt(t) { try { return new Date(t).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return t || ''; } }
  function hace(t) { var m = Math.round((Date.now() - new Date(t)) / 60000); if (!isFinite(m)) return ''; if (m < 1) return 'ahora'; if (m < 60) return 'hace ' + m + ' min'; if (m < 1440) return 'hace ' + Math.round(m / 60) + ' h'; return 'hace ' + Math.round(m / 1440) + ' d'; }
  function url() { return String(CFG.supabaseUrl || '').replace(/\/+$/, ''); }
  function hdr(x) { var s = sesion(); var h = { apikey: CFG.anonKey, Authorization: 'Bearer ' + (s ? s.tk : CFG.anonKey) }; if (x) for (var k in x) h[k] = x[k]; return h; }

  async function q(tabla, orden, lim) {
    var r = await fetch(url() + '/rest/v1/' + tabla + '?select=*&order=' + orden + '.desc&limit=' + (lim || 500), { headers: hdr(), cache: 'no-store' });
    if (!r.ok) { var j = await r.json().catch(function () { return {}; }); throw new Error(tabla + ': ' + (j.message || ('HTTP ' + r.status))); }
    return r.json();
  }
  async function cargar() {
    if (S.busy || !sesion()) return; S.busy = true;
    try {
      var a = await Promise.all([q('reportes_incendio', 'fecha_hora', 500), q('alertas', 'created_at', 300), q('mensajes', 'created_at', 800), q('posiciones_guardabosque', 'updated_at', 100), q('novedades_guardabosque', 'created_at', 100)]);
      S.rep = a[0]; S.al = a[1]; S.msg = a[2].slice().reverse(); S.pos = a[3]; S.nov = a[4]; S.ok = true; S.err = ''; S.t = Date.now();
    } catch (e) { S.err = e.message; }
    S.busy = false; pintar();
  }

  var abiertas = function (a) { return ['nueva', 'asignada', 'en_camino'].indexOf(a.estado) >= 0; };
  function valid(r) { return r.rechazado ? 'rechazado' : r.validado ? 'validado' : 'pendiente'; }
  function est(r) { return String(r.estado || '').toLowerCase(); }
  function tag(t) { var c = { activo: '#c62828', controlado: '#b45309', extinguido: '#2e7d32', nueva: '#c62828', asignada: '#b45309', en_camino: '#0b5cab', verificada: '#2e7d32', descartada: '#6b7280', validado: '#2e7d32', pendiente: '#b45309', rechazado: '#6b7280', alta: '#c62828', media: '#b45309', baja: '#2e7d32' }[String(t).toLowerCase()] || '#6b7280'; return '<span class="pv-tag" style="--c:' + c + '">' + esc(t || '') + '</span>'; }

  /* ── Montaje dentro de «Operaciones de campo» ── */
  function montar(root) {
    if (root.querySelector('.pv-tabs')) return;
    var cab = root.querySelector('.fg-cab'), cont = root.querySelector('[data-r=cont]');
    if (!cab || !cont) return;
    var sub = root.querySelector('.fg-sub'); if (sub) sub.textContent = 'Reportes de la app de guardabosques y de QField en Caldas: incendios, alertas por verificar, posición del equipo y chat, actualizados en vivo.';
    var tabs = document.createElement('div'); tabs.className = 'pv-tabs';
    tabs.innerHTML = '<button type="button" data-v="vivo" class="on">En vivo · App de guardabosques</button><button type="button" data-v="qf">QField (ambiental y social)</button><span class="pv-est" data-r="est"></span><button type="button" class="pv-ref" data-r="ref">Actualizar</button>';
    var vivo = document.createElement('div'); vivo.className = 'pv-vivo'; vivo.setAttribute('data-r', 'vivo');
    cab.insertAdjacentElement('afterend', tabs); tabs.insertAdjacentElement('afterend', vivo);
    cont.style.display = 'none'; S.root = root; el = vivo;
    tabs.onclick = function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      tabs.querySelectorAll('[data-v]').forEach(function (x) { x.classList.toggle('on', x === b); });
      var v = b.dataset.v === 'vivo'; vivo.style.display = v ? '' : 'none'; cont.style.display = v ? 'none' : 'flex';
      if (!v) setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 60); else if (S.mapa) setTimeout(function () { S.mapa.invalidateSize(); }, 60);
    };
    tabs.querySelector('[data-r=ref]').onclick = function () { cargar(); };
    clearInterval(S.tim); S.tim = setInterval(function () { if (!document.body.contains(root)) { clearInterval(S.tim); S.mapa = null; S.caps = null; el = null; return; } if (!document.hidden) cargar(); }, 8000);
    pintar(); cargar();
  }

  function firma() { return S.tab + '|' + S.canal + '|' + S.err + '|' + JSON.stringify([S.rep.map(function (r) { return [r.id, r.estado, r.validado, r.rechazado]; }), S.al.map(function (a) { return [a.id, a.estado, a.asignado_nombre]; }), S.msg.map(function (m) { return m.id; }), S.pos.map(function (p) { return [p.user_id, p.updated_at]; }), S.nov.length]); }
  function pintar() {
    if (!el || !document.body.contains(el)) return;
    var est2 = S.root && S.root.querySelector('[data-r=est]'); if (est2) est2.innerHTML = S.err ? '<b style="color:#b45309">Sin conexión con la base: ' + esc(S.err) + '</b>' : (S.ok ? '<i class="pv-dot"></i> En vivo · actualizado ' + hace(S.t) : 'Conectando…');
    var fi = firma(); if (fi === S.fi && el.firstChild) return; S.fi = fi;
    var pend = S.rep.filter(function (r) { return valid(r) === 'pendiente'; }).length, al = S.al.filter(abiertas).length;
    var sosN = S.msg.filter(function (m) { return m.tipo === 'sos' && Date.now() - new Date(m.created_at) < 864e5; }).length;
    var sub = [['res', 'Resumen'], ['rep', 'Reportes' + (pend ? ' (' + pend + ')' : '')], ['al', 'Alertas' + (al ? ' (' + al + ')' : '')], ['chat', 'Chat' + (sosN ? ' · SOS ' + sosN : '')], ['eq', 'Equipo']];
    var keep = el.querySelector('.pv-ci') && document.activeElement === el.querySelector('.pv-ci') ? el.querySelector('.pv-ci').value : null;
    var body = S.tab === 'res' ? resumen() : S.tab === 'rep' ? reportes() : S.tab === 'al' ? alertas() : S.tab === 'chat' ? chat() : equipo();
    if (S.tab === 'chat' && keep !== null && el.querySelector('.pv-ci')) { /* el chat conserva lo escrito */ }
    var draft = el.querySelector('.pv-ci') ? el.querySelector('.pv-ci').value : '';
    el.innerHTML = '<div class="pv-sub">' + sub.map(function (s) { return '<button type="button" data-s="' + s[0] + '" class="' + (S.tab === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; }).join('') + '</div><div class="pv-body">' + body + '</div><div class="pv-pie">Fuente de datos: reportes de campo (app Incendios Caldas), QField y mensajes del equipo · Gobernación de Caldas</div>';
    el.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { S.tab = b.dataset.s; S.mapa = null; S.fi = ''; pintar(); if (S.tab === 'chat') { var l = el.querySelector('.pv-msgs'); if (l) l.scrollTop = l.scrollHeight; } }; });
    if (S.tab === 'res') mapa();
    if (S.tab === 'chat') {
      var ci = el.querySelector('.pv-ci'), ls = el.querySelector('.pv-msgs');
      if (ci) { ci.value = draft; ci.onkeydown = function (e) { if (e.key === 'Enter') enviar(); }; el.querySelector('[data-r=snd]').onclick = enviar; }
      if (ls) ls.scrollTop = ls.scrollHeight;
      el.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { S.canal = b.dataset.c; S.fi = ''; pintar(); }; });
    }
  }

  function kpi(n, t, a) { return '<div class="pv-k' + (a ? ' al' : '') + '"><b>' + n + '</b><span>' + t + '</span></div>'; }
  function resumen() {
    var act = S.rep.filter(function (r) { return est(r) === 'activo' && valid(r) !== 'rechazado'; }).length;
    var pen = S.rep.filter(function (r) { return valid(r) === 'pendiente'; }).length, al = S.al.filter(abiertas).length;
    var enc = S.pos.filter(function (p) { return Date.now() - new Date(p.updated_at) < 3600e3; }).length;
    var sos = S.msg.filter(function (m) { return m.tipo === 'sos' && Date.now() - new Date(m.created_at) < 864e5; }).length;
    var ha = S.rep.filter(function (r) { return valid(r) === 'validado'; }).reduce(function (s, r) { return s + (+r.area_ha || 0); }, 0);
    var ult = S.msg.slice(-5).reverse().map(function (m) { return '<div class="pv-li"><b>' + esc(m.autor_nombre || '') + '</b> <small>' + hace(m.created_at) + ' · #' + esc(m.canal) + '</small><div>' + (m.tipo === 'sos' ? '<b style="color:#c62828">SOS</b> ' : '') + esc(m.texto || (m.tipo === 'ubicacion' ? 'Compartió su ubicación' : '')) + '</div></div>'; }).join('') || '<div class="pv-vac">Sin mensajes todavía.</div>';
    return '<div class="pv-kpis">' + kpi(act, 'Incendios activos', act) + kpi(pen, 'Reportes por validar', pen) + kpi(al, 'Alertas abiertas', al) + kpi(enc, 'Guardabosques en campo (1 h)') + kpi(sos, 'SOS (24 h)', sos) + kpi(ha.toFixed(1), 'Área validada (ha)') + '</div>' +
      '<div class="pv-grid"><div class="pv-map" id="pvMap"></div><div class="pv-side"><h3>Últimos mensajes del equipo</h3>' + ult + '</div></div>';
  }
  function mapa() {
    var L = window.__pgtL || window.L, d = el.querySelector('#pvMap'); if (!L || !d) return;
    S.mapa = L.map(d, { zoomControl: true }).setView([5.3, -75.5], 9);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18, attribution: '© OpenStreetMap, CARTO' }).addTo(S.mapa);
    var dot = function (c, t) { return L.divIcon({ className: '', html: '<span class="pv-pin" style="background:' + c + '">' + t + '</span>', iconSize: [26, 26], iconAnchor: [13, 13] }); };
    var pts = [];
    S.rep.forEach(function (r) { if (r.lat == null || valid(r) === 'rechazado') return; pts.push([r.lat, r.lon]); L.marker([r.lat, r.lon], { icon: dot(est(r) === 'activo' ? '#c62828' : est(r) === 'controlado' ? '#d97706' : '#2e7d32', '🔥') }).bindPopup('<b>' + esc(r.municipio || '') + '</b> ' + esc(r.vereda || '') + '<br>' + tag(est(r)) + ' ' + tag(valid(r)) + '<br>' + fmt(r.fecha_hora) + '<br>' + esc(r.cobertura || '') + (r.area_ha ? ' · ' + r.area_ha + ' ha' : '') + '<br><small>Reportó: ' + esc(r.reportante || '') + '</small>').addTo(S.mapa); });
    S.al.filter(function (a) { return abiertas(a) && a.lat != null; }).forEach(function (a) { pts.push([a.lat, a.lon]); L.marker([a.lat, a.lon], { icon: dot('#d97706', '!') }).bindPopup('<b>' + esc(a.titulo || 'Alerta') + '</b><br>' + tag(a.estado) + ' ' + fmt(a.created_at)).addTo(S.mapa); });
    S.pos.forEach(function (p) { if (p.lat == null) return; L.marker([p.lat, p.lon], { icon: dot('#0b5cab', '●') }).bindTooltip(esc(p.nombre || 'Guardabosque') + ' · ' + hace(p.updated_at)).addTo(S.mapa); });
    if (pts.length) S.mapa.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
    [100, 500].forEach(function (t) { setTimeout(function () { if (S.mapa) S.mapa.invalidateSize(); }, t); });
  }
  function reportes() {
    var f = S.rep.slice().sort(function (a, b) { return new Date(b.fecha_hora) - new Date(a.fecha_hora); });
    return '<table class="pv-t"><thead><tr><th>Fecha</th><th>Lugar</th><th>Cobertura</th><th>ha</th><th>Estado</th><th>Validación</th><th>Reportó</th></tr></thead><tbody>' + (f.map(function (r) { return '<tr><td>' + fmt(r.fecha_hora) + '</td><td><b>' + esc(r.municipio || '') + '</b><br><small>' + esc(r.vereda || '') + '</small></td><td>' + esc(r.cobertura || '') + '</td><td>' + (r.area_ha == null ? '' : esc(r.area_ha)) + '</td><td>' + tag(est(r)) + '</td><td>' + tag(valid(r)) + '</td><td>' + esc(r.reportante || '') + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="pv-vac">Sin reportes.</td></tr>') + '</tbody></table>';
  }
  function alertas() {
    var f = S.al;
    return '<table class="pv-t"><thead><tr><th>Fecha</th><th>Fuente</th><th>Alerta</th><th>Municipio</th><th>Prioridad</th><th>Estado</th><th>Asignada a</th></tr></thead><tbody>' + (f.map(function (a) { return '<tr><td>' + fmt(a.created_at) + '</td><td>' + esc(a.fuente || '') + '</td><td><b>' + esc(a.titulo || '') + '</b><br><small>' + esc(a.descripcion || '') + '</small></td><td>' + esc(a.municipio || '') + '</td><td>' + tag(a.prioridad) + '</td><td>' + tag(a.estado) + '</td><td>' + esc(a.asignado_nombre || '—') + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="pv-vac">Sin alertas.</td></tr>') + '</tbody></table>';
  }
  function chat() {
    var cs = {}; S.msg.forEach(function (m) { cs[m.canal] = (cs[m.canal] || 0) + 1; }); if (!cs.general) cs.general = 0;
    var lista = Object.keys(cs).sort(function (a, b) { return a === 'general' ? -1 : b === 'general' ? 1 : a < b ? -1 : 1; });
    if (lista.indexOf(S.canal) < 0) S.canal = 'general';
    var ms = S.msg.filter(function (m) { return m.canal === S.canal; }), yo = uid();
    return '<div class="pv-chat"><div class="pv-chs">' + lista.map(function (c) { return '<button type="button" data-c="' + esc(c) + '" class="' + (c === S.canal ? 'on' : '') + '">#' + esc(c) + ' <b>' + cs[c] + '</b></button>'; }).join('') + '</div><div class="pv-msgs">' +
      (ms.map(function (m) { var mio = m.autor_id === yo; return '<div class="pv-m' + (mio ? ' mio' : '') + (m.tipo === 'sos' ? ' sos' : '') + '"><small>' + esc(m.autor_nombre || '') + ' · ' + fmt(m.created_at) + '</small><div>' + (m.tipo === 'sos' ? '<b>SOS</b> ' : '') + esc(m.texto || '') + (m.lat != null ? ' <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + m.lat + ',' + m.lon + '">📍 ver ubicación</a>' : '') + '</div></div>'; }).join('') || '<div class="pv-vac">Sin mensajes en este canal.</div>') + '</div>' +
      '<div class="pv-send"><input class="pv-ci" placeholder="Responder en #' + esc(S.canal) + ' como coordinación…" maxlength="500"><button type="button" class="pv-go" data-r="snd">Enviar</button></div></div>';
  }
  async function enviar() {
    var i = el.querySelector('.pv-ci'), t = i.value.trim(), s = sesion(), id = uid(); if (!t || !s || !id) return; i.value = '';
    var m = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)), canal: S.canal, autor_id: id, autor_nombre: (s.nombre || 'Planeación') + ' (coordinación)', tipo: 'texto', texto: t, created_at: new Date().toISOString() };
    S.msg.push(m); S.fi = ''; pintar();
    var r = await fetch(url() + '/rest/v1/mensajes', { method: 'POST', headers: hdr({ 'content-type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify(m) });
    if (!r.ok) { var j = await r.json().catch(function () { return {}; }); S.msg = S.msg.filter(function (x) { return x.id !== m.id; }); S.err = 'No se pudo enviar: ' + (j.message || r.status); pintar(); } else cargar();
  }
  function equipo() {
    var pos = S.pos.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
    return '<div class="pv-grid2"><div><h3>Guardabosques y técnicos</h3>' + (pos.map(function (p) { var vivo = Date.now() - new Date(p.updated_at) < 3600e3; return '<div class="pv-li"><b>' + esc(p.nombre || 'Guardabosque') + '</b> ' + (vivo ? '<span class="pv-tag" style="--c:#2e7d32">en campo</span>' : '<span class="pv-tag" style="--c:#6b7280">sin señal</span>') + '<br><small>' + hace(p.updated_at) + (p.lat != null ? ' · ' + (+p.lat).toFixed(4) + ', ' + (+p.lon).toFixed(4) : '') + '</small></div>'; }).join('') || '<div class="pv-vac">Aún no hay posiciones compartidas.</div>') + '</div><div><h3>Novedades de campo</h3>' + (S.nov.slice(0, 40).map(function (n) { return '<div class="pv-li"><b>' + esc(n.tipo || '') + '</b> ' + tag(n.prioridad) + '<br><small>' + esc(n.autor_nombre || '') + ' · ' + fmt(n.created_at) + '</small><div>' + esc(n.descripcion || '') + '</div></div>'; }).join('') || '<div class="pv-vac">Sin novedades.</div>') + '</div></div>';
  }

  /* ── Detecta cuándo se abre «Operaciones de campo» ── */
  new MutationObserver(function () {
    if (!permitido()) return;
    var r = document.querySelector('.pc-root'); if (r && !r.querySelector('.pv-tabs')) montar(r);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.__pgtVivo = { cargar: cargar };
})();
