// Edge Function «qfield»: puente entre la plataforma (GitHub Pages) y QFieldCloud.
// QFieldCloud no permite llamadas directas desde el navegador (CORS); esta función las hace en el servidor.
// Despliegue: Supabase → Edge Functions → Create a new function → nombre «qfield» → pegar este código → Deploy.
// Desactive «Verify JWT» o envíe la clave anon (la plataforma ya la envía).
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });
const API = 'https://app.qfield.cloud/api/v1';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const accion = new URL(req.url).pathname.split('/').pop();
  try {
    if (accion === 'upload') {
      const f = await req.formData();
      const pid = String(f.get('projectId') || '').trim(), tk = String(f.get('token') || '').trim(), file = f.get('file');
      if (!pid || tk.length < 10 || !(file instanceof File)) return J({ error: 'Proyecto, token o archivo no válido.' }, 400);
      const fd = new FormData(); fd.append('file', file, file.name);
      const r = await fetch(`${API}/files/${encodeURIComponent(pid)}/${encodeURIComponent(file.name)}/`, { method: 'POST', headers: { Authorization: `token ${tk}` }, body: fd });
      return r.ok ? J({ uploaded: true, file: { name: file.name, size: file.size } }) : J({ error: `QFieldCloud no aceptó el archivo (HTTP ${r.status}).` }, r.status);
    }
    const b = await req.json();
    const pid = String(b.projectId || '').trim(), tk = String(b.token || '').trim();
    if (!pid || tk.length < 10) return J({ error: 'Proyecto o token de QFieldCloud no válido.' }, 400);
    const h = { Authorization: `token ${tk}`, Accept: 'application/json' };
    const [p, fl] = await Promise.all([fetch(`${API}/projects/${encodeURIComponent(pid)}/`, { headers: h }), fetch(`${API}/files/${encodeURIComponent(pid)}/`, { headers: h })]);
    if (!p.ok) return J({ error: `QFieldCloud rechazó la conexión (HTTP ${p.status}). Revise el ID del proyecto y el token.` }, p.status);
    const o = await p.json(), files = fl.ok ? await fl.json() : [];
    return J({ connected: true, project: { id: o.id, name: o.name, owner: o.owner, description: o.description, updatedAt: o.updated_at },
      files: Array.isArray(files) ? files.slice(0, 100).map((x: any) => ({ name: x.name, size: x.size, updatedAt: x.updated_at, md5sum: x.md5sum })) : [] });
  } catch (e) { return J({ error: String((e as Error).message || e) }, 502); }
});
