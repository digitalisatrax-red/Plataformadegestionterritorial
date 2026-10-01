/* Plataforma de Gestión Territorial · Resultados como reporte narrativo (estilo Global Forest Watch).
   Fuente de datos: data/gfw_caldas.json (Global Forest Watch, Colombia, v20260427; municipios de Caldas) y
   los resultados del análisis de capas de CORPOCALDAS que ya calcula la plataforma. */
(function () {
  'use strict';
  var COL = { perdida: '#d6336c', bosque: '#6a9c2f', primario: '#0e5235', emis: '#e08a1e', remo: '#2e8b57', neto: '#2b6cb0', gris: '#9aa8a2' };
  var CAUSAS = {
    'Permanent agriculture': ['Agricultura permanente', '#d9822b'], 'Shifting cultivation': ['Agricultura migratoria', '#e6b422'],
    'Logging': ['Aprovechamiento forestal', '#8c564b'], 'Hard commodities': ['Minería y materias primas', '#7f7f7f'],
    'Settlements & Infrastructure': ['Asentamientos e infraestructura', '#9467bd'], 'Other natural disturbances': ['Otras perturbaciones naturales', '#4e79a7'],
    'Wildfire': ['Incendios forestales', '#d62728'], 'Commodity driven deforestation': ['Deforestación por productos básicos', '#bd6b1f']
  };
  var G = null, cargando = null, S = { umbral: 30, ambito: 'area' }, firma = '', muniCache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sinTilde(t) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function nf(v, d) { return (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('es-CO', { maximumFractionDigits: d == null ? 0 : d }) : '—'; }
  function kha(v) { return v >= 10000 ? nf(v / 1000, 1) + ' kha' : nf(v, 0) + ' ha'; }
  function sum(a) { return (a || []).reduce(function (x, y) { return x + (y || 0); }, 0); }
  function datos() {
    if (G) return Promise.resolve(G);
    if (!cargando) cargando = fetch('data/gfw_caldas.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { G = j; return j; });
    return cargando;
  }

  /* ── Área de interés → municipios ──────────────────── */
  function aEsri(geo) {
    var polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' ? geo.coordinates : [], rings = [];
    function ar(r) { var s = 0; for (var i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]); return s; }  // >0 horario
    polys.forEach(function (p) { p.forEach(function (r, i) { var h = ar(r) > 0; rings.push(h === (i === 0) ? r : r.slice().reverse()); }); });
    return { rings: rings, spatialReference: { wkid: 4326 } };
  }
  async function municipiosDelArea() {
    var nombre = (window.__pgtNombre && window.__pgtNombre()) || '', aoi = window.__pgtGetAoi && window.__pgtGetAoi();
    var m = /^Municipio de (.+)$/.exec(nombre) || /^Vereda .+\(([^)]+)\)\s*$/.exec(nombre);
    if (m) return [m[1]];
    if (!aoi) return [];
    var key = nombre + '|' + JSON.stringify(aoi.geometry).length;
    if (muniCache[key]) return muniCache[key];
    var body = new URLSearchParams({ f: 'json', where: '1=1', geometry: JSON.stringify(aEsri(aoi.geometry)), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'MpNombre', returnGeometry: 'false' });
    var r = await fetch('https://swappweb.corpocaldas.gov.co/waserver/rest/services/CartografiaBase/MapServer/9/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body });
    var j = await r.json(); if (j.error) throw new Error(j.error.message || 'No se pudo identificar el municipio.');
    var nombres = (j.features || []).map(function (f) { return f.attributes.MpNombre; }).filter(Boolean);
    muniCache[key] = nombres; return nombres;
  }
  function buscar(nombre) {
    var k = sinTilde(nombre), ks = Object.keys(G.municipios);
    for (var i = 0; i < ks.length; i++) if (sinTilde(ks[i]) === k) return ks[i];
    return null;
  }

  /* ── Combinar entidades (suma de municipios) ───────── */
  function sumarArr(a, b) { return a.map(function (v, i) { return (v || 0) + (b[i] || 0); }); }
  function combinar(lista) {
    if (lista.length === 1) return lista[0];
    var o = { area_ha: 0, perdida: {}, primaria: null, causas: {}, causas_primaria: {}, carbono: {} };
    lista.forEach(function (e) {
      o.area_ha += e.area_ha || 0;
      Object.keys(e.perdida).forEach(function (t) {
        var p = e.perdida[t], q = o.perdida[t];
        if (!q) o.perdida[t] = { ext2000: p.ext2000, ext2010: p.ext2010, anual: p.anual.slice() };
        else { q.ext2000 += p.ext2000; q.ext2010 += p.ext2010; q.anual = sumarArr(q.anual, p.anual); }
      });
      if (e.primaria) o.primaria = o.primaria ? { area_ha: o.primaria.area_ha + e.primaria.area_ha, anual: sumarArr(o.primaria.anual, e.primaria.anual) } : { area_ha: e.primaria.area_ha, anual: e.primaria.anual.slice() };
      Object.keys(e.causas).forEach(function (d) { o.causas[d] = o.causas[d] || {}; Object.keys(e.causas[d]).forEach(function (y) { o.causas[d][y] = (o.causas[d][y] || 0) + e.causas[d][y]; }); });
      Object.keys(e.carbono).forEach(function (t) {
        var p = e.carbono[t], q = o.carbono[t];
        if (!q) o.carbono[t] = JSON.parse(JSON.stringify(p));
        else { ['ext2000', 'stock_mgc', 'emis_anual', 'remo_anual', 'neto_anual'].forEach(function (k) { q[k] += p[k]; }); q.emis = sumarArr(q.emis, p.emis); q.dens_mgc_ha = q.ext2000 ? Math.round(q.stock_mgc / q.ext2000) : 0; }
      });
    });
    return o;
  }

  /* ── Gráficos SVG ──────────────────────────────────── */
  function nice(max) { if (max <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function barras(vals, anios, color, unidad, opt) {
    opt = opt || {};
    var W = 760, H = 250, ml = 52, mb = 26, mt = 12, mr = 8, mx = nice(Math.max.apply(null, vals.map(function (v) { return v || 0; }).concat([1]))), n = vals.length, bw = (W - ml - mr) / n, h = '';
    for (var t = 0; t <= 4; t++) {
      var v = mx / 4 * t, y = mt + (H - mt - mb) * (1 - t / 4);
      h += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y + '" y2="' + y + '" class="g-grid"/><text x="' + (ml - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="g-ax">' + nf(v, v < 10 && v > 0 ? 1 : 0) + '</text>';
    }
    var imax = vals.indexOf(Math.max.apply(null, vals)), prom = sum(vals) / (n || 1);
    vals.forEach(function (v, i) {
      var hh = (H - mt - mb) * ((v || 0) / mx), x = ml + i * bw + bw * 0.14;
      h += '<rect x="' + x.toFixed(1) + '" y="' + (H - mb - hh).toFixed(1) + '" width="' + (bw * 0.72).toFixed(1) + '" height="' + Math.max(0, hh).toFixed(1) + '" fill="' + color + '" opacity="' + (i === imax ? 1 : 0.78) + '"><title>' + anios[i] + ': ' + nf(v, 1) + ' ' + unidad + '</title></rect>';
      if (i % (n > 20 ? 4 : 2) === 0 || i === n - 1) h += '<text x="' + (x + bw * 0.36).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="g-ax">' + anios[i] + '</text>';
    });
    var yp = mt + (H - mt - mb) * (1 - prom / mx);
    if (opt.promedio !== false) h += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + yp.toFixed(1) + '" y2="' + yp.toFixed(1) + '" class="g-prom"/><text x="' + (W - mr) + '" y="' + (yp - 4).toFixed(1) + '" text-anchor="end" class="g-ax g-pt">promedio ' + nf(prom, 0) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="g-svg" role="img">' + h + '</svg>';
  }
  function apiladas(series, anios, unidad) {
    var W = 760, H = 260, ml = 52, mb = 26, mt = 12, mr = 8, n = anios.length, tot = anios.map(function (a, i) { return series.reduce(function (s, x) { return s + (x.vals[i] || 0); }, 0); }), mx = nice(Math.max.apply(null, tot.concat([1]))), bw = (W - ml - mr) / n, h = '';
    for (var t = 0; t <= 4; t++) { var y = mt + (H - mt - mb) * (1 - t / 4); h += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y + '" y2="' + y + '" class="g-grid"/><text x="' + (ml - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="g-ax">' + nf(mx / 4 * t, 0) + '</text>'; }
    anios.forEach(function (a, i) {
      var base = H - mb, x = ml + i * bw + bw * 0.14;
      series.forEach(function (s) {
        var v = s.vals[i] || 0; if (!v) return; var hh = (H - mt - mb) * v / mx; base -= hh;
        h += '<rect x="' + x.toFixed(1) + '" y="' + base.toFixed(1) + '" width="' + (bw * 0.72).toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + s.color + '"><title>' + a + ' · ' + esc(s.nombre) + ': ' + nf(v, 0) + ' ' + unidad + '</title></rect>';
      });
      if (i % (n > 20 ? 4 : 2) === 0 || i === n - 1) h += '<text x="' + (x + bw * 0.36).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="g-ax">' + a + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="g-svg" role="img">' + h + '</svg>';
  }
  function hbarras(items, color, fmtv) {
    var mx = Math.max.apply(null, items.map(function (x) { return x.v; }).concat([1e-9]));
    return '<div class="g-hb">' + items.map(function (x) {
      return '<div class="g-hbr"><span class="g-hbl">' + esc(x.t) + '</span><span class="g-hbt"><i style="width:' + Math.max(1.5, x.v / mx * 100) + '%;background:' + (x.c || color) + '"></i></span><b>' + fmtv(x.v) + '</b></div>';
    }).join('') + '</div>';
  }

  /* ── Secciones ─────────────────────────────────────── */
  var REF = {
    hansen: 'Hansen, M. C., Potapov, P. V., Moore, R., Hancher, M., Turubanova, S. A., Tyukavina, A., Thau, D., Stehman, S. V., Goetz, S. J., Loveland, T. R., Kommareddy, A., Egorov, A., Chini, L., Justice, C. O., & Townshend, J. R. G. (2013). High-resolution global maps of 21st-century forest cover change. Science, 342(6160), 850–853. https://doi.org/10.1126/science.1244693',
    turu: 'Turubanova, S., Potapov, P. V., Tyukavina, A., & Hansen, M. C. (2018). Ongoing primary forest loss in Brazil, Democratic Republic of the Congo, and Indonesia. Environmental Research Letters, 13(7), Artículo 074028. https://doi.org/10.1088/1748-9326/aacd1c',
    sims: 'Sims, M., Stanimirova, R., Raichuk, A., Neumann, M., et al. (2025). Global drivers of forest loss at 1 km resolution. Environmental Research Letters, 20(7), Artículo 074027. https://doi.org/10.1088/1748-9326/add606',
    harris: 'Harris, N. L., Gibbs, D. A., Baccini, A., et al. (2021). Global maps of twenty-first century forest carbon fluxes. Nature Climate Change, 11, 234–240. https://doi.org/10.1038/s41558-020-00976-6',
    gibbs: 'Gibbs, D. A., Rose, M., et al. (2025). Revised and updated geospatial monitoring of 21st century forest carbon fluxes. Earth System Science Data, 17(3), 1217–1243. https://essd.copernicus.org/articles/17/1217/2025/',
    gadm: 'GADM. (2022). Global Administrative Areas, versión 4.1 [Base de datos]. https://gadm.org/',
    cc: 'CORPOCALDAS. (2026). Servicios de mapas ArcGIS REST de la Corporación Autónoma Regional de Caldas [Conjunto de datos]. https://swappweb.corpocaldas.gov.co/waserver/rest/services'
  };

  function seccion(id, tit, kicker, cuerpo) { return '<section class="g-sec" id="g-' + id + '"><div class="g-kick">' + kicker + '</div><h2>' + tit + '</h2>' + cuerpo + '</section>'; }
  function kpi(t, v, s, c) { return '<div class="g-kpi" style="border-top-color:' + (c || COL.bosque) + '"><span>' + t + '</span><b>' + v + '</b><em>' + (s || '') + '</em></div>'; }

  function cuerpoReporte(E, nombre, nota, ref) {
    var u = String(S.umbral), P = E.perdida[u] || E.perdida['30'], anios = []; for (var a = 2001; a <= 2025; a++) anios.push(a);
    var out = '', tot = sum(P.anual), imax = P.anual.indexOf(Math.max.apply(null, P.anual)), pc = P.ext2000 ? tot / P.ext2000 * 100 : 0, pp = E.area_ha ? P.ext2000 / E.area_ha * 100 : 0;
    var primeros = sum(P.anual.slice(0, 5)) / 5, ultimos = sum(P.anual.slice(-5)) / 5, tend = primeros ? (ultimos - primeros) / primeros * 100 : 0;
    var rest = P.ext2000 - tot;
    var ref0 = ref && ref.caldas ? ref.caldas : null;

    // Resumen
    out += '<div class="g-resumen"><p class="g-lead">En <b>' + esc(nombre) + '</b> había <b>' + kha(P.ext2000) + '</b> de cobertura arbórea en el año 2000, el <b>' + nf(pp, 0) + ' %</b> de su superficie (' + nf(E.area_ha, 0) + ' ha), con umbral de dosel de ' + u + ' %. Entre 2001 y 2025 se perdieron <b>' + nf(tot, 0) + ' ha</b> (' + nf(pc, 1) + ' % de esa cobertura)' +
      (P.anual[imax] ? ', con el máximo en <b>' + anios[imax] + '</b> (' + nf(P.anual[imax], 0) + ' ha)' : '') + '. (Hansen et al., 2013)</p>' +
      '<div class="g-kpis">' + kpi('Cobertura arbórea 2000', kha(P.ext2000), nf(pp, 0) + ' % del territorio') + kpi('Cobertura arbórea 2010', kha(P.ext2010), nf(E.area_ha ? P.ext2010 / E.area_ha * 100 : 0, 0) + ' % del territorio') +
      kpi('Pérdida 2001–2025', nf(tot, 0) + ' ha', nf(pc, 1) + ' % de la cobertura 2000', COL.perdida) + kpi('Pérdida media anual', nf(tot / 25, 0) + ' ha', 'por año', COL.perdida) +
      (E.primaria ? kpi('Pérdida de bosque primario húmedo', nf(sum(E.primaria.anual), 0) + ' ha', '2002–2025 · dosel ≥ 30 %', COL.primario) : '') + '</div></div>';

    // Cobertura
    out += seccion('cobertura', 'Cobertura arbórea', 'Sección 1',
      '<p>La cobertura arbórea incluye toda vegetación de más de 5 m de altura, ya sea bosque natural o plantaciones. Con umbral de ' + u + ' %, la cobertura pasó de <b>' + kha(P.ext2000) + '</b> en 2000 a <b>' + kha(P.ext2010) + '</b> en 2010 y se estima en <b>' + kha(Math.max(0, rest)) + '</b> en 2025 al descontar la pérdida acumulada, sin considerar ganancia de cobertura. (Hansen et al., 2013)</p>' +
      hbarras([{ t: 'Año 2000', v: P.ext2000, c: COL.bosque }, { t: 'Año 2010', v: P.ext2010, c: COL.bosque }, { t: '2025 (estimada)', v: Math.max(0, rest), c: '#b7d28a' }, { t: 'Superficie total', v: E.area_ha, c: COL.gris }], COL.bosque, function (v) { return kha(v); }) +
      '<div class="g-fuente">Fuente: Global Forest Watch, conjunto de datos de cobertura arbórea (Hansen et al., 2013), versión ' + esc(G.version) + '. Límites: GADM 4.1.</div>');

    // Pérdida anual
    out += seccion('perdida', 'Pérdida anual de cobertura arbórea', 'Sección 2',
      '<p>La pérdida anual alcanzó su valor más alto en <b>' + anios[imax] + '</b>, con <b>' + nf(P.anual[imax], 0) + ' ha</b>. En el último quinquenio (2021–2025) el promedio fue de <b>' + nf(ultimos, 0) + ' ha/año</b>, ' + (tend >= 0 ? 'un ' + nf(tend, 0) + ' % mayor' : 'un ' + nf(-tend, 0) + ' % menor') + ' que en 2001–2005 (' + nf(primeros, 0) + ' ha/año). Pérdida no equivale a deforestación: incluye aprovechamiento, incendios, enfermedades y perturbaciones naturales. (Hansen et al., 2013)</p>' +
      barras(P.anual, anios, COL.perdida, 'ha') + '<div class="g-fuente">Hectáreas de pérdida de cobertura arbórea por año, umbral de dosel ' + u + ' %. Fuente: Hansen et al. (2013), v' + esc(G.version.replace('v', '')) + '.</div>');

    // Primario
    if (E.primaria) {
      var an2 = anios.slice(1), sp = sum(E.primaria.anual), im = E.primaria.anual.indexOf(Math.max.apply(null, E.primaria.anual));
      out += seccion('primario', 'Pérdida de bosque primario húmedo', 'Sección 3',
        (sp > 0 ? '<p>Entre 2002 y 2025 se perdieron <b>' + nf(sp, 0) + ' ha</b> de bosque primario húmedo tropical (dosel ≥ 30 %), con el máximo en <b>' + an2[im] + '</b> (' + nf(E.primaria.anual[im], 0) + ' ha). Este bosque, sin intervención humana reciente, almacena más carbono y biodiversidad que el secundario. (Turubanova et al., 2018)</p>' + barras(E.primaria.anual, an2, COL.primario, 'ha')
          : '<p>No se registra pérdida de bosque primario húmedo en el periodo 2002–2025 para esta área. (Turubanova et al., 2018)</p>') + '<div class="g-fuente">Fuente: Turubanova et al. (2018), actualizado en Global Forest Watch, v' + esc(G.version.replace('v', '')) + '.</div>');
    }

    // Causas
    var ds = Object.keys(E.causas), tcausa = ds.map(function (d) { var s = 0; Object.keys(E.causas[d]).forEach(function (y) { s += E.causas[d][y] || 0; }); return { d: d, v: s }; }).sort(function (a, b) { return b.v - a.v; });
    var totc = sum(tcausa.map(function (x) { return x.v; }));
    if (totc > 0) {
      var top = tcausa[0], nm = (CAUSAS[top.d] || [top.d])[0];
      out += seccion('causas', 'Causas dominantes de la pérdida', 'Sección 4',
        '<p>La causa dominante de la pérdida de cobertura arbórea (2001–2025, dosel ≥ 30 %) fue <b>' + esc(nm.toLowerCase()) + '</b>, con <b>' + nf(top.v, 0) + ' ha</b> (' + nf(top.v / totc * 100, 0) + ' % del total atribuido). La clasificación asigna a cada píxel perdido su causa principal en un mapa de 1 km de resolución, por lo que debe leerse como orientación regional y no como diagnóstico predio a predio. (Sims et al., 2025)</p>' +
        '<div class="g-dos"><div>' + hbarras(tcausa.map(function (x) { var c = CAUSAS[x.d] || [x.d, COL.gris]; return { t: c[0], v: x.v, c: c[1] }; }), COL.gris, function (v) { return nf(v, 0) + ' ha'; }) + '</div></div>' +
        apiladas(tcausa.map(function (x) { var c = CAUSAS[x.d] || [x.d, COL.gris]; return { nombre: c[0], color: c[1], vals: anios.map(function (y) { return E.causas[x.d][String(y)] || 0; }) }; }), anios, 'ha') +
        '<div class="g-fuente">Fuente: Sims et al. (2025), vía Global Forest Watch. Hectáreas de pérdida por causa dominante y año.</div>');
    }

    // Carbono
    var C = E.carbono['30'];
    if (C) {
      var neto = C.neto_anual, sumi = neto < 0;
      out += seccion('carbono', 'Carbono forestal', 'Sección 5',
        '<p>El carbono almacenado en la biomasa viva sobre el suelo en 2000 era de <b>' + nf(C.stock_mgc / 1e6, 1) + ' Mt C</b> (' + nf(C.dens_mgc_ha, 0) + ' t C/ha, dosel ≥ 30 %). Entre 2001 y 2025 los bosques emitieron en promedio <b>' + nf(C.emis_anual / 1000, 1) + ' kt CO₂e/año</b> y removieron <b>' + nf(C.remo_anual / 1000, 1) + ' kt CO₂e/año</b>; el flujo neto es de <b>' + nf(neto / 1000, 1) + ' kt CO₂e/año</b>, por lo que el área funciona como ' + (sumi ? '<b>sumidero</b> neto de carbono' : '<b>fuente</b> neta de carbono') + '. (Gibbs et al., 2025; Harris et al., 2021)</p>' +
        '<div class="g-kpis">' + kpi('Carbono 2000', nf(C.stock_mgc / 1e6, 1) + ' Mt C', nf(C.dens_mgc_ha, 0) + ' t C/ha', COL.bosque) + kpi('Emisiones brutas', nf(C.emis_anual / 1000, 1) + ' kt CO₂e/año', 'promedio 2001–2025', COL.emis) + kpi('Remociones brutas', nf(C.remo_anual / 1000, 1) + ' kt CO₂e/año', 'promedio 2001–2025', COL.remo) + kpi('Flujo neto', nf(neto / 1000, 1) + ' kt CO₂e/año', sumi ? 'sumidero' : 'fuente', COL.neto) + '</div>' +
        '<h3>Emisiones anuales de gases de efecto invernadero (Mg CO₂e)</h3>' + barras(C.emis, anios, COL.emis, 'Mg CO₂e') +
        '<div class="g-fuente">Fuente: Gibbs et al. (2025) y Harris et al. (2021), vía Global Forest Watch.</div>');
    }
    return out;
  }

  function seccionCapas() {
    var Fe = (window.__pgtRes && window.__pgtRes()) || [];
    var cuerpo;
    if (!Fe.length) cuerpo = '<p>Aún no se ha ejecutado el análisis de capas. En <b>Analizar</b> elige las capas de CORPOCALDAS y pulsa «Ejecutar análisis»; los resultados aparecerán aquí. (CORPOCALDAS, 2026)</p>';
    else {
      var ok = Fe.filter(function (x) { return !x.error; });
      var mapa = ok.map(function (x) { var s = x.stats || {}; var v = s.areaHa > 0 ? s.areaHa : s.lengthKm > 0 ? s.lengthKm : s.featureCount; var u = s.areaHa > 0 ? 'ha' : s.lengthKm > 0 ? 'km' : 'elementos'; return { t: x.layer.name, v: v, u: u, n: s.featureCount, c: x.layer.color }; });
      cuerpo = '<p>El área de interés intersecta <b>' + ok.filter(function (x) { return x.stats && x.stats.featureCount > 0; }).length + ' de ' + ok.length + '</b> capas analizadas de CORPOCALDAS. Las medidas corresponden a la porción de cada capa dentro del área seleccionada: hectáreas para polígonos, kilómetros para líneas y número de elementos para puntos. (CORPOCALDAS, 2026)</p>' +
        '<table class="g-tab"><thead><tr><th>Capa</th><th>Elementos</th><th>Medida</th></tr></thead><tbody>' + mapa.map(function (m) { return '<tr><td><i style="background:' + esc(m.c || COL.gris) + '"></i>' + esc(m.t) + '</td><td class="n">' + nf(m.n, 0) + '</td><td class="n">' + nf(m.v, 1) + ' ' + m.u + '</td></tr>'; }).join('') + '</tbody></table>' +
        (Fe.length > ok.length ? '<p class="g-nota">' + (Fe.length - ok.length) + ' capa(s) no respondieron y no se incluyen.</p>' : '');
    }
    return seccion('capas', 'Capas de CORPOCALDAS en el área', 'Sección 6', cuerpo + '<div class="g-fuente">Fuente: servicios ArcGIS REST de CORPOCALDAS, consulta del ' + new Date().toLocaleDateString('es-CO') + '.</div>');
  }

  function cierre() {
    return seccion('lectura', 'Cómo leer estos datos', 'Notas',
      '<p>«Pérdida de cobertura arbórea» indica remoción o mortalidad de vegetación de más de 5 m, por cualquier causa; no equivale a deforestación. Los valores dependen del umbral de densidad de dosel elegido y se reportan a escala municipal con los límites administrativos de GADM, que pueden diferir de la cartografía oficial de CORPOCALDAS. Los datos corresponden a un procesamiento global de 30 m de resolución y deben contrastarse con información local antes de tomar decisiones. (Hansen et al., 2013; GADM, 2022)</p>') +
      '<section class="g-sec g-refs" id="g-fuentes"><div class="g-kick">Referencias</div><h2>Fuentes</h2>' + ['hansen', 'turu', 'sims', 'harris', 'gibbs', 'gadm', 'cc'].map(function (k) { return '<p class="g-ref">' + esc(REF[k]) + '</p>'; }).join('') + '</section>';
  }

  /* ── Montaje ───────────────────────────────────────── */
  async function pintar(root) {
    var nombre = (window.__pgtNombre && window.__pgtNombre()) || '', aoi = window.__pgtGetAoi && window.__pgtGetAoi();
    var Fe = (window.__pgtRes && window.__pgtRes()) || [];
    var f = [nombre, !!aoi, S.umbral, S.ambito, Fe.length, Fe.map(function (x) { return x.layer.id + (x.stats ? x.stats.featureCount : 'e'); }).join(',')].join('|');
    if (f === firma && root.firstChild) return;
    firma = f;
    root.removeAttribute('data-nombre');
    var cab = '<header class="g-cab"><div><div class="g-bread" data-r="bread">Colombia › Caldas</div><h1 data-r="tit">Cobertura arbórea y pérdida</h1><div class="g-sub">Reporte construido con datos de Global Forest Watch y capas de CORPOCALDAS</div></div>' +
      '<div class="g-ctl"><label>Ámbito<select data-r="ambito"><option value="area"' + (S.ambito === 'area' ? ' selected' : '') + '>Área de interés</option><option value="caldas"' + (S.ambito === 'caldas' ? ' selected' : '') + '>Departamento de Caldas</option><option value="colombia"' + (S.ambito === 'colombia' ? ' selected' : '') + '>Colombia</option></select></label>' +
      '<label>Densidad de dosel<select data-r="umbral">' + [10, 20, 30, 50, 75].map(function (t) { return '<option value="' + t + '"' + (t === S.umbral ? ' selected' : '') + '>≥ ' + t + ' %</option>'; }).join('') + '</select></label>' +
      '<button type="button" data-r="pdf">Descargar PDF</button></div></header>';
    var cuerpo = '', ok = false;
    try {
      await datos();
      var E, nm, nota = '';
      if (S.ambito === 'colombia') { E = G.colombia; nm = 'Colombia'; ok = true; }
      else if (S.ambito === 'caldas') { E = G.caldas; nm = 'el departamento de Caldas'; ok = true; }
      else if (!aoi) {
        cuerpo = '<section class="g-vacio"><h2>Define un área de interés</h2><p>Elige un municipio, vereda, archivo o dibujo en <b>Territorio</b> (Paso 1) para ver su reporte de cobertura arbórea, pérdida, causas y carbono. Mientras tanto puedes consultar el departamento o el país con el selector «Ámbito».</p></section>';
      } else {
        var nombres = await municipiosDelArea(), claves = nombres.map(buscar).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; });
        if (!claves.length) cuerpo = '<section class="g-vacio"><h2>Sin datos para esta área</h2><p>No se identificó ningún municipio de Caldas dentro del área seleccionada, por lo que no hay cifras de Global Forest Watch para mostrar.</p></section>';
        else {
          E = combinar(claves.map(function (k) { return G.municipios[k]; })); nm = claves.length === 1 ? claves[0] : claves.length + ' municipios (' + claves.join(', ') + ')'; ok = true;
          if (!/^Municipio de /.test(nombre)) nota = 'Las cifras de Global Forest Watch se publican por municipio: corresponden ' + (claves.length === 1 ? 'al municipio de ' + claves[0] : 'a los municipios que toca el área') + ' completo, no solo al área dibujada o seleccionada.';
        }
      }
      if (ok) {
        cuerpo = (nota ? '<div class="g-aviso">' + esc(nota) + '</div>' : '') + cuerpoReporte(E, nm, nota, { caldas: G.caldas }) + seccionCapas() + cierre();
        root.setAttribute('data-nombre', nm);
      }
    } catch (e) { cuerpo = '<section class="g-vacio"><h2>No se pudo cargar el reporte</h2><p>' + esc(e.message) + '</p></section>'; }
    root.innerHTML = cab + '<nav class="g-nav">' + (ok ? ['cobertura', 'perdida', 'primario', 'causas', 'carbono', 'capas', 'fuentes'].filter(function (i) { return root.innerHTML === '' || true; }).map(function (i) { return '<a href="#g-' + i + '" data-g="' + i + '">' + { cobertura: 'Cobertura', perdida: 'Pérdida anual', primario: 'Bosque primario', causas: 'Causas', carbono: 'Carbono', capas: 'Capas CORPOCALDAS', fuentes: 'Fuentes' }[i] + '</a>'; }).join('') : '') + '</nav><div class="g-body">' + cuerpo + '</div>';
    var tit = root.querySelector('[data-r=tit]'), br = root.querySelector('[data-r=bread]');
    if (ok && root.getAttribute('data-nombre')) { tit.textContent = 'Cobertura arbórea y pérdida en ' + root.getAttribute('data-nombre'); br.textContent = S.ambito === 'colombia' ? 'Colombia' : S.ambito === 'caldas' ? 'Colombia › Caldas' : 'Colombia › Caldas › ' + root.getAttribute('data-nombre'); }
    Array.prototype.forEach.call(root.querySelectorAll('.g-nav a'), function (a) {
      if (!root.querySelector(a.getAttribute('href'))) a.remove();
      else a.onclick = function (e) { e.preventDefault(); root.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    });
    root.querySelector('[data-r=umbral]').onchange = function (e) { S.umbral = +e.target.value; firma = ''; pintar(root); };
    root.querySelector('[data-r=ambito]').onchange = function (e) { S.ambito = e.target.value; firma = ''; pintar(root); };
    root.querySelector('[data-r=pdf]').onclick = function () { pdf(root); };
  }
  function pdf(root) {
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    var clon = root.cloneNode(true); ['[data-r=pdf]', '.g-ctl', '.g-nav'].forEach(function (s) { var n = clon.querySelector(s); if (n) n.remove(); });
    var css = new URL('pgt-gfw.css', location.href).href;
    var d = f.contentWindow.document; d.open(); d.write('<!doctype html><html><head><meta charset="utf-8"><title>Reporte territorial</title><link rel="stylesheet" href="' + css + '"><style>body{background:#fff;margin:0}.g-root{max-width:none;padding:0 6px}.g-sec{page-break-inside:avoid}@page{margin:12mm}</style></head><body>' + clon.outerHTML + '</body></html>'); d.close();
    var go = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 4000); };
    var l = d.querySelector('link'); if (l) { l.onload = function () { setTimeout(go, 200); }; l.onerror = go; } else setTimeout(go, 600);
  }

  var pendiente = false;
  function revisar() {
    var main = document.querySelector('main.dashboard-page');
    if (!main) { firma = ''; return; }
    var root = main.querySelector('.g-root');
    if (!root) { root = document.createElement('div'); root.className = 'g-root'; main.appendChild(root); main.classList.add('pgt-res'); firma = ''; }
    if (pendiente) return; pendiente = true;
    setTimeout(function () { pendiente = false; pintar(root); }, 120);
  }
  new MutationObserver(revisar).observe(document.documentElement, { childList: true, subtree: true });
})();
