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
