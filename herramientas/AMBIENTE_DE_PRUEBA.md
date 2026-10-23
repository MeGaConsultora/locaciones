# Ambiente de prueba (staging) del sistema de gestión

Una copia del sistema, con **su propia base de datos de prueba**, para probar cambios
antes de llevarlos a producción. Nada de lo que se haga ahí toca datos reales.

```
locaciones-repo ──(node herramientas/build_staging.mjs)──► locaciones-staging-repo ──► GitHub Pages
 (código real)        cambia solo la copia                  /locaciones-staging/        (apunta a Supabase de PRUEBA)
```

URL de la copia de prueba: `https://megaconsultora.github.io/locaciones-staging/`

## A. Preparación (una sola vez)

1. **Proyecto de Supabase de prueba.** Crear un proyecto nuevo (ej. `megaconsultora-prueba`).
   Conviene crearlo en una **organización gratuita aparte**: dentro de la organización PRO un
   proyecto adicional se cobra aparte (verificarlo en Billing antes de crearlo).

2. **Copiar la estructura (sin datos).** Con las herramientas de PostgreSQL instaladas (`pg_dump` y `psql`):

   ```
   pg_dump --schema-only --no-owner --schema=public "postgresql://postgres:CLAVE_REAL@db.hpufcseedvdmcoamundr.supabase.co:5432/postgres" -f esquema.sql
   psql "postgresql://postgres:CLAVE_PRUEBA@db.REF_PRUEBA.supabase.co:5432/postgres" -f esquema.sql
   ```

   * Las claves de base de datos se ven en *Project Settings → Database*; se escriben solo en tu terminal.
   * Se deja el dump CON permisos (no usar `--no-privileges`) para que la prueba tenga los mismos
     REVOKE/GRANT y las mismas políticas que producción.
   * Si la conexión directa falla (usa IPv6), usar la cadena "Session pooler" de esa misma pantalla.
   * `esquema.sql` es solo estructura, pero conviene borrarlo al terminar.

3. **Storage.** Crear los buckets privados `contratos-archivos` y `servicios` en el proyecto de prueba y copiar
   las políticas de producción (listarlas con
   `select policyname, cmd, qual, with_check from pg_policies where schemaname='storage' and tablename='objects';`).

4. **Acceso.** En el proyecto de prueba: *Authentication → Users → Add user* (tu email) y después, en el SQL Editor:

   ```sql
   insert into public.usuarios (email, nombre, aprobado, admin, rol, user_id)
   values ('tu@email.com', 'Hugo', true, true, 'admin', 'UUID-DEL-USUARIO-RECIEN-CREADO');
   ```

   *Authentication → URL Configuration*: Site URL y Redirect URL = `https://megaconsultora.github.io/locaciones-staging/`.

5. **Datos de prueba.** NO copiar los datos reales (son personas reales). Cargar contratos, personas y pagos
   ficticios (se puede generar un script a medida una vez que la estructura esté cargada).

6. **Repositorio de la copia.** Crear en GitHub `MeGaConsultora/locaciones-staging`, clonarlo al lado de
   `locaciones-repo` con el nombre `locaciones-staging-repo` y activar GitHub Pages (rama `main`, carpeta raíz).

7. **Configuración local.** Copiar `herramientas/staging.config.example.json` a `herramientas/staging.config.json` y
   completar la URL y la clave **anon (pública)** del proyecto de prueba (*Project Settings → API*).
   Este archivo no se sube a git. El script rechaza la URL del proyecto real y cualquier clave que no sea la anon.

## B. Cada vez que se quiere probar un cambio

1. El cambio se hace en `locaciones-repo` **sin subirlo a producción**.
2. `node herramientas/build_staging.mjs` arma la copia en `locaciones-staging-repo`
   (la franja roja indica la versión: el commit y si hay "cambios sin subir").
3. Se sube `locaciones-staging-repo` (commit + push).
4. Se prueba en `…/locaciones-staging/`.
5. Si está bien, recién ahí se sube a producción. Los cambios de SQL se corren primero en el proyecto de
   prueba y después en el de producción.

## Qué hace la copia distinto

* Apunta a otro proyecto de Supabase (nunca al real).
* Todo lo que se guarda en el navegador lleva el prefijo `stg:`: prueba y producción comparten
  `megaconsultora.github.io`, y sin esto se pisarían las sesiones.
* Franja roja "AMBIENTE DE PRUEBA" y título `[PRUEBA]`.
* Sin instalación de la app (sin service worker ni manifiesto) y sin el selector "Ver como…".

## Lo que NO cubre todavía

* Los portales de inquilinos y propietarios (se puede replicar la misma técnica).
* Edge Functions y notificaciones push (no se copian).
* Los mails de Supabase Auth (recuperar contraseña, etc.) en el plan gratuito tienen límites.
