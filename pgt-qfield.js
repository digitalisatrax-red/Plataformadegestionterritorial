/* Centro de campo: dirige las llamadas de QFieldCloud a la Edge Function «qfield» de Supabase (GitHub Pages no tiene servidor). */
(function () {
  var c = window.PGT_CONFIG || {};
  var base = (c.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/qfield';
  var f0 = window.fetch.bind(window);
  window.__pgtQf = function (accion) { return base + '/' + accion; };
  window.__pgtQfFetch = function (accion, o) {
    o = Object.assign({}, o); var h = Object.assign({}, o.headers || {});
    if (c.anonKey) { h.apikey = c.anonKey; h.authorization = 'Bearer ' + c.anonKey; }
    o.headers = h;
    return f0(base + '/' + accion, o).catch(function () {
      return new Response(JSON.stringify({ error: 'El puente con QFieldCloud no está activo todavía: falta publicar la función «qfield» en Supabase (supabase/functions/qfield/index.ts).' }), { status: 502, headers: { 'content-type': 'application/json' } });
    });
  };
})();
