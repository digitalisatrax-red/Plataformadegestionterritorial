// ============================================================
//  CONFIGURACIÓN — edita solo este archivo
//  Supabase → Project Settings → API:
//    "Project URL"  y  "anon public key" (la anon key es pública por diseño;
//    la seguridad la dan las políticas RLS de supabase_schema.sql).
//  Mientras estén vacías, la app corre en MODO DEMO (datos solo en el celular).
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://vhhfcnuchlxmrzymqaph.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_GqdlBUSD0my5J1SGKJXu1Q_ipTqbERa",   // clave pública (publishable); la seguridad la dan las políticas RLS

  // Nombres de tablas / bucket (cámbialos si ya existen con otro nombre)
  TABLA_REPORTES: "reportes_incendio",
  TABLA_NOVEDADES: "novedades_guardabosque",
  TABLA_ALERTAS: "alertas",
  TABLA_MENSAJES: "mensajes",
  TABLA_POSICIONES: "posiciones_guardabosque",
  TABLA_FIRMS: "detecciones_calor",
  TABLA_PERFILES: "perfiles",
  BUCKET_FOTOS: "fotos-incendios",

  // Mapa: centro y zoom iniciales (Caldas)
  MAPA_CENTRO: [5.2, -75.35],
  MAPA_ZOOM: 9,

  // Intervalo (segundos) de envío de posición del guardabosque
  INTERVALO_POSICION: 60,

  // Capas WMS externas opcionales (p. ej. Corpocaldas). Ejemplo:
  // { nombre: "Áreas SINAP", url: "https://.../wms", capas: "sinap", formato: "image/png" }
  WMS: []
};
