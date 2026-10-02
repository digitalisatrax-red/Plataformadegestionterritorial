/* Tema general: logo de la Gobernación arriba, fuente de datos (CORPOCALDAS) abajo y barra de indicadores. */
(function () {
  var CFG = window.PGT_CONFIG || {}, SB = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  var logoGob = null, logoCorp = null, K = { calor24: null, calor7: null, activos: null, act: '' };
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
      f.innerHTML = '<span><b>Fuente de los datos:</b> CORPOCALDAS · Corporación Autónoma Regional de Caldas — servicios geográficos oficiales (<a href="https://swappweb.corpocaldas.gov.co/waserver/rest/services" target="_blank" rel="noopener">swappweb.corpocaldas.gov.co</a>). Puntos de calor: NASA FIRMS · Histórico de fuego: MapBiomas Colombia.</span>';
      if (d && d.tagName === 'DIV' && !d.children.length) d.replaceWith(f); else ft.insertBefore(f, ft.firstChild);
    }
    var nb = document.querySelector('.notice-bar'); if (nb && !nb.querySelector('.pgt-kpis')) { var k = document.createElement('div'); k.className = 'pgt-kpis'; nb.insertBefore(k, nb.firstChild); pintarK(); }
  }
  function fmt(n) { return n == null ? '—' : String(n); }
  function pintarK() {
    var c = document.querySelector('.pgt-kpis'); if (!c) return;
    c.innerHTML = '<div class="pgt-kpi m"><b>' + fmt(K.calor24) + '</b><span>Puntos de calor · 24 h</span></div>' +
      '<div class="pgt-kpi m"><b>' + fmt(K.calor7) + '</b><span>Puntos de calor · 7 días</span></div>' +
      '<div class="pgt-kpi r"><b>' + fmt(K.activos) + '</b><span>Incendios activos validados</span></div>' +
      '<div class="pgt-kpi"><b>27</b><span>Municipios de Caldas</span></div>' +
      '<div class="pgt-kpi a"><b>' + ((window.__pgtCapas || []).length || 9) + '</b><span>Capas oficiales</span></div>' +
      (K.act ? '<div class="pgt-kpi" style="border-left-color:#9ca3af"><b style="font-size:14px;padding:4px 0">' + K.act + '</b><span>Satélite actualizado</span></div>' : '');
  }
  async function datos() {
    try {
      var r = await fetch('data/firms_caldas.json?t=' + Math.floor(Date.now() / 600000)); if (r.ok) {
        var j = await r.json(), ahora = Date.now(), p = j.puntos || [];
        K.calor24 = p.filter(function (x) { return ahora - new Date(x.fecha_hora).getTime() <= 864e5; }).length;
        K.calor7 = p.filter(function (x) { return ahora - new Date(x.fecha_hora).getTime() <= 7 * 864e5; }).length;
        if (j.actualizado) { var h = (ahora - new Date(j.actualizado).getTime()) / 36e5; K.act = h < 1 ? 'hace minutos' : h < 48 ? 'hace ' + Math.round(h) + ' h' : 'hace ' + Math.round(h / 24) + ' d'; }
      }
    } catch (e) {}
    try {
      if (SB && CFG.anonKey) {
        var q = await fetch(SB + '/rest/v1/reportes_incendio?select=id&estado=eq.Activo&validado=eq.true', { headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + CFG.anonKey, Prefer: 'count=exact', Range: '0-0' } });
        var cr = q.headers.get('content-range'); if (q.ok && cr) K.activos = Number(cr.split('/')[1]);
      }
    } catch (e) {}
    pintarK();
  }
  new MutationObserver(ajustar).observe(document.documentElement, { childList: true, subtree: true });
  ajustar(); datos(); setInterval(datos, 300000);
})();
