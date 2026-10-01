/* Plataforma de Gestión Territorial · acceso por perfil (Planeación / Organizaciones) y selección por vereda.
   - Ciudadanía: público, sin acceso.
   - Planeación y Organizaciones: usuario y contraseña validados contra Supabase Auth; el perfil sale de la tabla `perfiles`.
   La contraseña nunca se guarda: solo se envía a Supabase y se conserva la sesión (token) en esta pestaña. */
(function () {
  var CFG = window.PGT_CONFIG || {};
  var SKEY = 'pgt.sesion';
  var VISTAS = { planeacion: 'Planeación', organizaciones: 'Organizaciones' };

  function url() { return String(CFG.supabaseUrl || '').trim().replace(/\/+$/, ''); }
  function configurado() { return /^https:\/\/[^\s/]+$/.test(url()) && !!String(CFG.anonKey || '').trim(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ── Sesión ─────────────────────────────────────────── */
  function leer() {
    try { var s = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); if (s && s.exp > Date.now()) return s; } catch (e) {}
    return null;
  }
  function guardar(s) { try { sessionStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {} }
  function borrar() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }

  async function iniciar(correo, clave) {
    var h = { apikey: CFG.anonKey, 'content-type': 'application/json' };
    var r = await fetch(url() + '/auth/v1/token?grant_type=password', { method: 'POST', headers: h, body: JSON.stringify({ email: correo, password: clave }) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.access_token) throw new Error(r.status === 400 || r.status === 401 ? 'Correo o contraseña incorrectos.' : (j.msg || j.error_description || 'No fue posible iniciar sesión (HTTP ' + r.status + ').'));
    var p = await fetch(url() + '/rest/v1/perfiles?select=rol,nombre,organizacion&user_id=eq.' + encodeURIComponent(j.user.id), { headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + j.access_token } });
    if (!p.ok) throw new Error('No se pudo leer el perfil (tabla «perfiles»). Revise supabase/acceso.sql.');
    var filas = await p.json();
    var roles = filas.map(function (f) { return f.rol; }).filter(function (x) { return VISTAS[x]; });
    var s = { correo: correo, nombre: (filas[0] && filas[0].nombre) || correo, roles: roles, exp: Date.now() + Math.min(j.expires_in || 3600, 8 * 3600) * 1000 };
    guardar(s); return s;
  }

  /* ── Ventana de acceso ──────────────────────────────── */
  var modal = null;
  function cerrarModal() { if (modal) { modal.remove(); modal = null; } }
  function abrirLogin(vista, alExito) {
    cerrarModal();
    modal = document.createElement('div'); modal.className = 'pgt-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    var sinConfig = !configurado();
    modal.innerHTML =
      '<form class="pgt-card" autocomplete="on">' +
      '<span class="eyebrow">Acceso restringido</span><h2>Vista ' + esc(VISTAS[vista]) + '</h2>' +
      '<p>Esta vista requiere usuario y contraseña. Los perfiles se administran en la base de datos de la plataforma.</p>' +
      (sinConfig ? '<div class="pgt-msg warn on">La base de datos de accesos aún no está conectada (falta configurar <b>acceso-config.js</b>). Por ahora solo está disponible la vista Ciudadanía.</div>' : '') +
      '<label>Correo electrónico<input name="correo" type="email" autocomplete="username" required' + (sinConfig ? ' disabled' : '') + '></label>' +
      '<label>Contraseña<input name="clave" type="password" autocomplete="current-password" required' + (sinConfig ? ' disabled' : '') + '></label>' +
      '<div class="pgt-msg err" data-r="msg"></div>' +
      '<div class="pgt-fila"><button type="button" data-a="cancelar">Cancelar</button><button type="submit" class="pgt-pri"' + (sinConfig ? ' disabled' : '') + '>Entrar</button></div>' +
      '</form>';
    document.body.appendChild(modal);
    var f = modal.querySelector('form'), msg = modal.querySelector('[data-r=msg]');
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrarModal(); });
    modal.querySelector('[data-a=cancelar]').onclick = cerrarModal;
    if (!sinConfig) setTimeout(function () { f.correo.focus(); }, 30);
    f.onsubmit = async function (e) {
      e.preventDefault();
      var b = f.querySelector('.pgt-pri'); b.disabled = true; b.textContent = 'Verificando…'; msg.className = 'pgt-msg err';
      try {
        var s = await iniciar(f.correo.value.trim(), f.clave.value);
        f.clave.value = '';
        if (s.roles.indexOf(vista) === -1) {
          borrar();
          throw new Error('Su usuario no tiene acceso a la vista ' + VISTAS[vista] + '.');
        }
        cerrarModal(); pintarSesion(); alExito(s);
      } catch (x) { msg.textContent = x.message; msg.classList.add('on'); b.disabled = false; b.textContent = 'Entrar'; }
    };
  }

  /* ── Puente con el selector «Vista» del tablero ─────── */
  window.__pgtVista = function (v, poner) {
    window.__pgtPoner = poner;
    if (v === 'general') { poner(v); pintarSesion(); return; }
    var s = leer();
    if (s && s.roles.indexOf(v) !== -1) { poner(v); pintarSesion(); return; }
    abrirLogin(v, function () { poner(v); });
  };
  function salir() { borrar(); if (window.__pgtPoner) window.__pgtPoner('general'); pintarSesion(); }
  function pintarSesion() {
    var sel = document.querySelector('select option[value=planeacion]');
    sel = sel && sel.parentNode; if (!sel) return;
    var chip = document.querySelector('.pgt-sesion'), s = leer();
    if (!s) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('span'); chip.className = 'pgt-sesion'; sel.parentNode.appendChild(chip); }
    var html = esc(s.nombre) + ' · <button type="button">Salir</button>';
    if (chip.getAttribute('data-h') !== html) {
      chip.setAttribute('data-h', html); chip.innerHTML = html;
      chip.querySelector('button').onclick = salir;
    }
  }

  /* ── Selección por vereda (pestaña Municipio) ───────── */
  var BASE = 'https://swappweb.corpocaldas.gov.co/waserver/rest/services/CartografiaBase/MapServer/10/query';
  var veredas = null;
  function norm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  async function cargarVeredas() {
    if (veredas) return veredas;
    var out = [], off = 0;
    for (;;) {
      var q = new URLSearchParams({ where: '1=1', outFields: 'ID_VEREDA,NOMBRE,MUNICIPIO', returnGeometry: 'false', orderByFields: 'NOMBRE', resultOffset: String(off), resultRecordCount: '1000', f: 'json' });
      var r = await fetch(BASE + '?' + q); if (!r.ok) throw new Error('El servicio de veredas respondió HTTP ' + r.status + '.');
      var j = await r.json(); if (j.error) throw new Error(j.error.message || 'Error consultando veredas.');
      var fs = j.features || []; out = out.concat(fs.map(function (f) { return f.attributes; }));
      if (!j.exceededTransferLimit || !fs.length) break; off += fs.length;
    }
    veredas = out; return out;
  }
  async function geometriaVereda(id) {
    var donde = typeof id === 'number' ? 'ID_VEREDA=' + id : "ID_VEREDA='" + String(id).replace(/'/g, "''") + "'";
    var body = new URLSearchParams({ where: donde, outFields: 'ID_VEREDA,NOMBRE,MUNICIPIO', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson' });
    var r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body });
    if (!r.ok) throw new Error('El servicio de veredas respondió HTTP ' + r.status + '.');
    var j = await r.json(); if (j.error) throw new Error(j.error.message || 'Error consultando la vereda.');
    if (!j.features || !j.features[0]) throw new Error('No se encontró la geometría de la vereda.');
    return j.features[0];
  }
  function montarVereda() {
    var contenido = document.querySelector('.scope-content');
    var bloque = document.querySelector('.pgt-vereda');
    var selMun = contenido && Array.prototype.find.call(contenido.querySelectorAll('select'), function (s) { return !s.closest('.pgt-vereda') && /^[A-ZÁÉÍÓÚ]/.test((s.options[0] || {}).text || ''); });
    if (!selMun) { if (bloque) bloque.remove(); return; }
    if (bloque) return;
    bloque = document.createElement('div'); bloque.className = 'pgt-vereda';
    bloque.innerHTML = '<label>Vereda (opcional)<select data-r="ver" disabled><option>Cargando veredas…</option></select></label>' +
      '<button type="button" class="primary-button" data-a="usar" disabled>Usar límite de la vereda</button><div class="pgt-nota" data-r="nota"></div>';
    contenido.appendChild(bloque);
    var ver = bloque.querySelector('[data-r=ver]'), usar = bloque.querySelector('[data-a=usar]'), nota = bloque.querySelector('[data-r=nota]');
    function llenar() {
      cargarVeredas().then(function (lista) {
        var m = norm(selMun.value || selMun.options[selMun.selectedIndex].text);
        var del = lista.filter(function (v) { return norm(v.MUNICIPIO) === m; }).sort(function (a, b) { return String(a.NOMBRE).localeCompare(String(b.NOMBRE), 'es'); });
        ver.innerHTML = del.length ? del.map(function (v, i) { return '<option value="' + i + '">' + esc(v.NOMBRE) + '</option>'; }).join('') : '<option>Sin veredas registradas</option>';
        ver.disabled = usar.disabled = !del.length; ver._lista = del; nota.textContent = del.length ? del.length + ' veredas en ' + selMun.value + '.' : '';
      }).catch(function (e) { ver.innerHTML = '<option>No disponible</option>'; nota.textContent = e.message; });
    }
    selMun.addEventListener('change', llenar); llenar();
    usar.onclick = async function () {
      var v = ver._lista && ver._lista[+ver.value]; if (!v) return;
      usar.disabled = true; var t = usar.textContent; usar.textContent = 'Consultando…';
      try {
        var f = await geometriaVereda(v.ID_VEREDA);
        if (!window.__pgtAoi) throw new Error('El visor aún no está listo.');
        window.__pgtAoi(f, 'Vereda ' + v.NOMBRE + ' (' + selMun.value + ')');
      } catch (e) { nota.textContent = e.message; }
      usar.disabled = false; usar.textContent = t;
    };
  }

  new MutationObserver(function () { montarVereda(); pintarSesion(); }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarModal(); });
})();
