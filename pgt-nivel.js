/* Niveles de acceso a los módulos principales.
   - Ciudadanía y Organizaciones: Territorio, Analizar, Resultados y «Mi reporte».
   - Planeación: todo lo anterior + Campo, Alerta temprana y Operaciones de campo. */
(function () {
  'use strict';
  var SOLO_PLANEACION = { 'Campo': 1 };
  function planeacion() { try { var s = JSON.parse(sessionStorage.getItem('pgt.sesion') || 'null'); return !!(s && s.exp > Date.now() && s.roles && s.roles.indexOf('planeacion') >= 0); } catch (e) { return false; } }
  function aplicar() {
    var ok = planeacion(), nav = document.querySelector('nav.main-nav'); if (!nav) return;
    var activa = null, terr = null;
    nav.querySelectorAll('.nav-item').forEach(function (b) {
      var t = (b.innerText || '').replace(/\d+$/, '').trim();
      if (t === 'Territorio') terr = b;
      if (SOLO_PLANEACION[t]) { b.style.display = ok ? '' : 'none'; if (!ok && b.classList.contains('active')) activa = b; }
    });
    if (activa && terr) terr.click();       // si estaba en un módulo que ya no puede ver, vuelve a Territorio
  }
  new MutationObserver(aplicar).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  aplicar();
})();

/* Analizar: trae las capas encendidas en Territorio (y las del catálogo marcadas «Analizar») al análisis.
   El panel solo ofrecía las capas de cada tipo de análisis; aquí se añaden como casillas y se incluyen al ejecutar. */
(function () {
  'use strict';
  var added = {}, off = {}, sig = '', t0 = 0;
  function visibles() { return window.__pgtVisibles || {}; }
  function extrasCat() { try { return (window.__pgtAnaCat ? window.__pgtAnaCat() : []).map(function (c) { c.queryable = true; c.official = true; return c; }); } catch (e) { return []; } }
  function candidatas() {
    var vis = visibles(), out = [];
    (window.__pgtCapas || []).forEach(function (c) {
      if (c && c.url && c.layerId != null && c.kind !== 'wms' && c.queryable !== false && vis[c.id] != null) out.push({ id: c.id, name: c.name, color: c.color, tipo: 'Territorio' });
    });
    extrasCat().forEach(function (c) { out.push({ id: c.id, name: c.name, color: c.color, tipo: 'Catálogo' }); });
    return out;
  }
  function fiberDe(el) { var k = Object.keys(el).filter(function (k) { return k.indexOf('__reactFiber$') === 0; })[0]; return k ? el[k] : null; }
  function hookNe() {
    var el = document.querySelector('.analysis-layer-picker'); if (!el) return null;
    var f = fiberDe(el);
    while (f) {
      for (var h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
        var n = h.next;
        if (typeof h.memoizedState === 'string' && /^[a-z0-9-]+$/.test(h.memoizedState) && n && Array.isArray(n.memoizedState) && n.queue && n.queue.dispatch &&
            n.memoizedState.every(function (x) { return typeof x === 'string'; })) return n;
      }
      f = f.return;
    }
    return null;
  }
  function pintar() {
    var pk = document.querySelector('.analysis-layer-picker'); if (!pk) return;
    var hk = hookNe(); if (!hk) return;
    var cands = candidatas(), ids = cands.map(function (c) { return c.id; }), sel = hk.memoizedState;
    // alta automática de las nuevas, baja de las que se apagaron
    var add = ids.filter(function (i) { return !off[i] && sel.indexOf(i) < 0; });
    add.forEach(function (i) { added[i] = 1; });
    var quitar = Object.keys(added).filter(function (i) { return ids.indexOf(i) < 0; });
    quitar.forEach(function (i) { delete added[i]; delete off[i]; });
    if (add.length || quitar.length) { hk.queue.dispatch(function (p) { return p.filter(function (i) { return quitar.indexOf(i) < 0; }).concat(add.filter(function (i) { return p.indexOf(i) < 0; })); }); return; }
    var s = ids.join(',') + '|' + sel.join(',') + '|' + cands.map(function (c) { return c.name; }).join(',');
    var bl = document.querySelector('.pgt-anat');
    if (bl && sig === s) return; sig = s;
    if (!bl) { bl = document.createElement('div'); bl.className = 'pgt-anat analysis-layer-picker'; pk.insertAdjacentElement('afterend', bl); bl.addEventListener('change', function (e) { var cb = e.target; if (!cb.dataset || !cb.dataset.id) return; var id = cb.dataset.id, on = cb.checked, h = hookNe(); if (on) delete off[id]; else off[id] = 1; if (h) h.queue.dispatch(function (p) { return on ? (p.indexOf(id) < 0 ? p.concat([id]) : p) : p.filter(function (i) { return i !== id; }); }); }); }
    bl.innerHTML = '<div class="section-title"><span>Capas encendidas en Territorio y del catálogo</span><b>' + cands.length + '</b></div>' +
      (cands.length ? cands.map(function (c) { return '<label><input type="checkbox" data-id="' + String(c.id).replace(/"/g, '&quot;') + '"' + (sel.indexOf(c.id) >= 0 ? ' checked' : '') + '><span class="layer-swatch" style="background:' + (c.color || '#64748b') + '"></span><span>' + String(c.name).replace(/[&<>]/g, '') + ' <small>· ' + c.tipo + '</small></span></label>'; }).join('')
        : '<p style="font-size:12px;color:#64748b;margin:6px 0">Encienda capas en Territorio, o márquelas «Analizar» en «Todas las capas», y aparecen aquí.</p>');
  }
  new MutationObserver(function () { var n = Date.now(); if (n - t0 < 250) return; t0 = n; try { pintar(); } catch (e) {} }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(function () { try { pintar(); } catch (e) {} }, 1000);
  /* Al ejecutar: que el buscador de capas del análisis también encuentre las del catálogo */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button'); if (!b || !/Ejecutar análisis/.test(b.textContent)) return;
    var ex = extrasCat(); if (!ex.length) return;
    var orig = Array.prototype.find;
    Array.prototype.find = function (fn) {
      var r = orig.apply(this, arguments);
      if (r === undefined && this.length && this[0] && this[0].official !== undefined && this[0].queryable !== undefined) { for (var i = 0; i < ex.length; i++) { try { if (fn(ex[i])) return ex[i]; } catch (x) {} } }
      return r;
    };
    setTimeout(function () { Array.prototype.find = orig; }, 0);
  }, true);
})();
