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
    var mb = [].slice.call(document.querySelectorAll('button')).filter(function (b) { return /manifiesto para qgis/i.test(b.textContent); })[0];
    if (mb && !document.querySelector('.pgt-campo-dl')) {
      var d2 = document.createElement('div'); d2.className = 'pgt-campo-dl';
      d2.innerHTML = '<b>Proyecto de campo listo · 3 módulos</b>1 · Ambiental, 2 · Social y 3 · Alertas de incendio, con formularios completos (municipio y vereda se llenan solos, foto, GPS). Descargue los dos archivos juntos, en la misma carpeta, y ábralos en QGIS o súbalos a su proyecto de QFieldCloud.<br><a href="data/qfield/Campo_Caldas.qgz" download>Campo_Caldas.qgz</a><a href="data/qfield/campo_caldas.gpkg" download class="sec">campo_caldas.gpkg</a>';
      mb.parentNode.insertBefore(d2, mb);
    }
    var tin = document.querySelector('input[placeholder="Token de QFieldCloud"]');
    if (tin && !tin.dataset.pgt) {
      tin.dataset.pgt = '1'; tin.placeholder = 'usuario:contraseña (o token de API)'; tin.autocomplete = 'off';
      var lb = tin.closest('label'); if (lb) { var tx = [].slice.call(lb.childNodes).filter(function (n) { return n.nodeType === 3 || (n.tagName === 'SPAN'); })[0]; if (tx) tx.textContent = 'Usuario y contraseña de QFieldCloud'; }
      var ayuda = document.createElement('div'); ayuda.className = 'pgt-ayuda';
      ayuda.innerHTML = 'Escriba <b>su_usuario:su_contraseña</b> de app.qfield.cloud, separados por dos puntos (ejemplo del formato: <i>digitalis:miClave</i>). Se usa solo para esta consulta y no se guarda. Su proyecto: <b>Campo_Caldas</b>.';
      (lb || tin).insertAdjacentElement('afterend', ayuda);
      var pin = document.querySelector('input[placeholder^="xxxxxxxx-xxxx"]');
      if (pin && !pin.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pin, '324901f0-6568-4d28-ad00-875afeae5781'); pin.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    document.querySelectorAll('.eyebrow').forEach(function (e) { if (/capas de corpocaldas/i.test(e.textContent)) e.style.display = 'none'; });
  }
  var ultAviso = null, tAviso = null;
  function aviso() {
    var n = document.querySelector('.notice-bar'); if (!n) return;
    var tx = n.textContent, tono = /\b(success|error|warning)\b/.exec(n.className);
    if (ultAviso === null) { ultAviso = tx; return; }
    if (tx !== ultAviso) { ultAviso = tx; if (tono) { n.classList.add('pgt-show'); clearTimeout(tAviso); tAviso = setTimeout(function () { n.classList.remove('pgt-show'); }, 12000); } }
  }
  new MutationObserver(function () { ajustar(); aviso(); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  ajustar(); aviso();
})();
