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
