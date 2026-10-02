// Edge Function «qfield»: puente entre la plataforma (GitHub Pages) y QFieldCloud.
// QFieldCloud no permite llamadas directas desde el navegador (CORS); esta función las hace en el servidor.
// Despliegue: Supabase → Edge Functions → Create a new function → nombre «qfield» → pegar este código → Deploy.
// Desactive «Verify JWT» o envíe la clave anon (la plataforma ya la envía).
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });
const API = 'https://app.qfield.cloud/api/v1';
// El campo «token» acepta el token de API o «usuario:contraseña» de QFieldCloud (se usa solo para iniciar sesión en esa solicitud y no se guarda).
async function resolverToken(t: string): Promise<string> {
  const i = t.indexOf(':');
  if (i < 1) return t;
  const r = await fetch(`${API}/auth/login/`, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ username: t.slice(0, i).trim(), password: t.slice(i + 1) }) });
  if (!r.ok) throw new Error(`QFieldCloud no aceptó el usuario o la contraseña (HTTP ${r.status}).`);
  const j = await r.json(); if (!j.token) throw new Error('QFieldCloud no devolvió un token.'); return String(j.token);
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const accion = new URL(req.url).pathname.split('/').pop();
  try {
    if (accion === 'upload') {
      const f = await req.formData();
      const pid = String(f.get('projectId') || '').trim(), tk0 = String(f.get('token') || '').trim(), file = f.get('file');
      if (!pid || tk0.length < 3 || !(file instanceof File)) return J({ error: 'Proyecto, credenciales o archivo no válido.' }, 400);
      const tk = await resolverToken(tk0);
      const fd = new FormData(); fd.append('file', file, file.name);
      const r = await fetch(`${API}/files/${encodeURIComponent(pid)}/${encodeURIComponent(file.name)}/`, { method: 'POST', headers: { Authorization: `token ${tk}` }, body: fd });
      return r.ok ? J({ uploaded: true, file: { name: file.name, size: file.size } }) : J({ error: `QFieldCloud no aceptó el archivo (HTTP ${r.status}).` }, r.status);
    }
    const b = await req.json();
    if (accion === 'file') {
      // Descarga un archivo del proyecto (p. ej. campo_caldas.gpkg o una foto) y lo entrega como binario.
      const pid0 = String(b.projectId || '').trim(), tk1 = String(b.token || '').trim(), nombre = String(b.name || '').trim();
      if (!pid0 || tk1.length < 3 || !nombre || nombre.includes('..')) return J({ error: 'Proyecto, credenciales o nombre de archivo no válidos.' }, 400);
      const tk2 = await resolverToken(tk1);
      const fr = await fetch(`${API}/files/${encodeURIComponent(pid0)}/${nombre.split('/').map(encodeURIComponent).join('/')}/`, { headers: { Authorization: `token ${tk2}` } });
      if (!fr.ok) return J({ error: `QFieldCloud no entregó «${nombre}» (HTTP ${fr.status}).` }, fr.status);
      return new Response(fr.body, { status: 200, headers: { ...CORS, 'content-type': fr.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' } });
    }
    if (accion === 'delta') {
      // Crea un registro nuevo en una capa del proyecto, como si lo hubiera enviado QField al sincronizar.
      const pid1 = String(b.projectId || '').trim(), tk3 = String(b.token || '').trim(), capa = String(b.layer || ''), g = b.geometry, at = b.attributes || {};
      const PREF: Record<string, [string, string]> = { ambiental: ['1___', '1 · Ambiental'], social: ['2___', '2 · Social'], alerta: ['3___', '3 · Alertas de incendio'] };
      if (!pid1 || tk3.length < 3 || !PREF[capa] || !Array.isArray(g) || g.length !== 2 || !isFinite(g[0]) || !isFinite(g[1])) return J({ error: 'Faltan datos del reporte (capa, ubicación o credenciales).' }, 400);
      const tk4 = await resolverToken(tk3), H4 = { Authorization: `token ${tk4}`, Accept: 'application/json' };
      const pk = await fetch(`${API}/packages/${encodeURIComponent(pid1)}/latest/`, { headers: H4 });
      if (!pk.ok) return J({ error: `No se pudo leer el paquete del proyecto (HTTP ${pk.status}).` }, pk.status);
      const pj = await pk.json(), lid = Object.keys(pj.layers || {}).find((k) => k.startsWith(PREF[capa][0]));
      if (!lid || !pj.package_id) return J({ error: 'No se encontró la capa en el paquete del proyecto.' }, 400);
      const U = () => crypto.randomUUID(), did = U(), exp = String(pj.package_id);
      const attrs: Record<string, unknown> = { fid: null, ...at, lat: g[1], lon: g[0] };
      const delta = { version: '1.0', id: did, projectId: pid1, files: [], deltas: [{ uuid: U(), clientId: U(), exportId: exp, localPk: '1', localLayerId: lid, localLayerCrs: 'EPSG:4326', localLayerName: PREF[capa][1], sourcePk: '', sourceLayerId: lid, method: 'create', new: { geometry: `Point (${g[0]} ${g[1]})`, attributes: attrs } }] };
      const fd = new FormData(); fd.append('file', new Blob([JSON.stringify(delta)], { type: 'application/json' }), 'delta.json');
      const r4 = await fetch(`${API}/deltas/${encodeURIComponent(pid1)}/`, { method: 'POST', headers: { Authorization: `token ${tk4}` }, body: fd });
      const t4 = await r4.text();
      if (!r4.ok) return J({ error: `QFieldCloud no aceptó el reporte (HTTP ${r4.status}). ${t4.slice(0, 300)}` }, r4.status);
      let estado = 'enviado', detalle = '';
      for (let i = 0; i < 10; i++) {
        await new Promise((ok) => setTimeout(ok, 1500));
        const dl = await fetch(`${API}/deltas/${encodeURIComponent(pid1)}/`, { headers: H4 });
        if (!dl.ok) continue;
        const arr = await dl.json(), me = Array.isArray(arr) ? arr.find((x: any) => String(x.deltafile_id) === did || String(x.content?.uuid) === delta.deltas[0].uuid) : null;
        if (me) { estado = String(me.last_status || me.status); detalle = String(me.last_feedback?.msg || ''); if (/applied|error|conflict|not_applied/i.test(estado)) break; }
      }
      return J({ ok: /applied/i.test(estado) && !/not_applied/i.test(estado), estado, detalle, deltaId: did });
    }
    const pid = String(b.projectId || '').trim(), tk0 = String(b.token || '').trim();
    if (!pid || tk0.length < 3) return J({ error: 'Proyecto o credenciales de QFieldCloud no válidos.' }, 400);
    const tk = await resolverToken(tk0);
    const h = { Authorization: `token ${tk}`, Accept: 'application/json' };
    const [p, fl] = await Promise.all([fetch(`${API}/projects/${encodeURIComponent(pid)}/`, { headers: h }), fetch(`${API}/files/${encodeURIComponent(pid)}/`, { headers: h })]);
    if (!p.ok) return J({ error: `QFieldCloud rechazó la conexión (HTTP ${p.status}). Revise el ID del proyecto y el token.` }, p.status);
    const o = await p.json(), files = fl.ok ? await fl.json() : [];
    return J({ connected: true, project: { id: o.id, name: o.name, owner: o.owner, description: o.description, updatedAt: o.updated_at },
      files: Array.isArray(files) ? files.slice(0, 100).map((x: any) => ({ name: x.name, size: x.size, updatedAt: x.updated_at, md5sum: x.md5sum })) : [] });
  } catch (e) { return J({ error: String((e as Error).message || e) }, 401); }
});
