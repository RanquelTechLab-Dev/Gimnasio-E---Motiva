# RANV2-04 Auth + roles admin/alumno

## Estado

RANV2-04 agrega el flujo base de autenticacion con Supabase Auth para email y contrasena.

No hay registro publico. Las cuentas se crean desde administracion o manualmente en Supabase hasta que exista el flujo admin versionado.

## Variables locales

El frontend usa variables publicas de Vite:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

No guardar `service_role`, passwords ni secrets en el repo.

## Admin inicial

Admin confirmado:

```text
e.motiva.gym@gmail.com
```

Pasos manuales para el bloque remoto/post-merge:

1. Crear usuario en Supabase Auth con email `e.motiva.gym@gmail.com`.
2. Usar una contrasena provisoria segura.
3. No guardar la contrasena en el repo, docs, chat ni logs.
4. Confirmar email segun la configuracion activa de Supabase Auth.
5. Crear o actualizar el perfil admin con SQL controlado.

SQL para ejecutar despues de crear el usuario Auth:

```sql
insert into public.profiles (
  id,
  role,
  first_name,
  last_name,
  email,
  active,
  receives_emails
)
select
  id,
  'admin'::public.user_role,
  'Carolina',
  'E-Motiva',
  lower(email),
  true,
  true
from auth.users
where lower(email) = 'e.motiva.gym@gmail.com'
on conflict (id) do update
set
  role = 'admin'::public.user_role,
  active = true,
  updated_at = now();
```

## Alumno inicial

La creacion de alumnos con contrasena provisoria queda para flujo admin/manual posterior.

Reglas:

- No hay registro publico.
- La contrasena provisoria no se guarda en Git.
- El profile de alumno debe quedar asociado al `auth.users.id`.
- El rol de alumno debe ser `student`.

## Guards

- Sin sesion: `/app` y `/admin` redirigen a `/login`.
- Con sesion `student`: `/app` permitido, `/admin` redirige a `/app`.
- Con sesion `admin`: `/admin` permitido.

## Limites honestos

- No se crea admin real en esta PR.
- No se ejecuta `db push` real en esta PR.
- La prueba funcional completa requiere `.env.local` local no trackeado y usuario Auth real.
- Recuperacion de contrasena avanzada queda fuera de alcance.
