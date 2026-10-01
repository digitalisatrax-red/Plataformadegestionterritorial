/* Conexión pública a la base de datos de accesos (Supabase).
   Complete con los datos de SU proyecto: Supabase → Project Settings → API.
   - supabaseUrl: "Project URL"   (https://xxxx.supabase.co)
   - anonKey:     clave "anon public"  (es pública por diseño; NUNCA ponga aquí la service_role)
   Mientras estén vacíos, las vistas Planeación y Organizaciones permanecen bloqueadas. */
window.PGT_CONFIG = {
  supabaseUrl: "",
  anonKey: ""
};
