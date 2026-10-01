# Acceso a las vistas Planeación y Organizaciones

La vista **Ciudadanía** es pública. **Planeación** y **Organizaciones** son accesos distintos, cada uno con usuario y contraseña, validados contra Supabase (Authentication + tabla `perfiles`).

## Configuración (una sola vez)
1. En supabase.com cree un proyecto (plan gratuito).
2. **SQL Editor**: ejecute `supabase/acceso.sql` (crea `perfiles` con seguridad por filas).
3. **Authentication → Users → Add user**: cree cada usuario con su correo y contraseña. La contraseña solo la conoce quien la crea; no se guarda en este repositorio.
4. En el SQL Editor reemplace `CORREO_DEL_USUARIO@ejemplo.com` por el correo del usuario y ejecute el `insert` (rol `planeacion` u `organizaciones`).
5. **Project Settings → API**: copie *Project URL* y la clave *anon public* en `acceso-config.js`. Nunca use la clave `service_role`.

Mientras `acceso-config.js` esté vacío, las dos vistas permanecen bloqueadas.

## Qué controla
- Cada usuario ve solo las vistas para las que tiene fila en `perfiles`.
- «Catálogo completo» solo aparece en Planeación y Organizaciones.
- La sesión dura mientras la pestaña esté abierta.

## Alcance
El control es de interfaz: las capas de CORPOCALDAS son servicios públicos. Si más adelante se cargan datos sensibles, deben protegerse en Supabase (tablas con RLS), no en el HTML.
