/* Tema general: logo de la Gobernación arriba y fuente de datos (CORPOCALDAS) abajo. */
(function () {
  var logoGob = null, logoCorp = null;
  function ajustar() {
    var hi = document.querySelector('.institutional-header .brand-lockup img'), fi = document.querySelector('.institutional-footer img');
    if (hi && fi && !hi.dataset.pgt) {
      logoCorp = hi.src; logoGob = fi.src;
      hi.src = logoGob; hi.alt = 'Gobernación de Caldas'; hi.dataset.pgt = '1'; hi.style.width = 'auto';
      fi.src = logoCorp; fi.alt = 'CORPOCALDAS'; fi.dataset.pgt = '1';
    }
    var st = document.querySelector('.product-name strong'); if (st && st.textContent !== 'Plataforma de Gestión Territorial') st.textContent = 'Plataforma de Gestión Territorial';
    var sp = document.querySelector('.product-name span'); if (sp && sp.textContent !== 'Información ambiental para decidir mejor') sp.textContent = 'Información ambiental para decidir mejor';
    var ft = document.querySelector('.institutional-footer'); if (ft && !ft.querySelector('.pgt-fuente')) {
      var d = ft.firstElementChild; var f = document.createElement('div'); f.className = 'pgt-fuente';
      f.innerHTML = '<span><b>Fuente de los datos:</b> CORPOCALDAS</span>';
      if (d && d.tagName === 'DIV' && !d.children.length) d.replaceWith(f); else ft.insertBefore(f, ft.firstChild);
    }
    document.querySelectorAll('.eyebrow').forEach(function (e) { if (/capas de corpocaldas/i.test(e.textContent)) e.style.display = 'none'; });
  }
  new MutationObserver(ajustar).observe(document.documentElement, { childList: true, subtree: true });
  ajustar();
})();
