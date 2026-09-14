# MeGaConsultora — Gestión de Locaciones — Contexto del proyecto

## Proyecto
- **Admin app**: `index.html` de este repo — hosteado en `megaconsultora.github.io/locaciones/`
- **Portal inquilino**: repo separado `github.com/MeGaConsultora/inquilinos` — hosteado en `megaconsultora.github.io/inquilinos/`
- **Landing/raíz**: repo `github.com/MeGaConsultora/MeGaConsultora.github.io` — solo redirige a inquilinos o locaciones según el link
- **Backend**: Supabase, proyecto `hpufcseedvdmcoamundr` (nombre visible en dashboard: "Gestión de Alquileres")
- Admins actuales: **Hugo** (Meringi), **Gregorio** (Gardella) y **Paulina/Pauli** (Marconetti) — comparten a veces la misma IP/dispositivo de oficina
- El repo de GitHub es **público** — la clave `anon` de Supabase está a la vista en el código a propósito (es como está pensado Supabase: la seguridad real vive en las políticas RLS de la base, no en ocultar esa clave). La `service_role key` en cambio es secreta de verdad y **nunca** debe pegarse en el código del repo.

Este documento asume que quien lo lee **no tiene memoria de sesiones anteriores** — repite lo esencial y se va actualizando al final de cada sesión de trabajo con lo nuevo. Está pensado para poder retomar el trabajo desde cualquier máquina: se clona el repo, se lee este archivo, y con eso alcanza para ponerse al día.

---

## Flujo de trabajo entre máquinas
- El código vive en GitHub — cualquier máquina que necesite trabajar clona los 3 repos (`locaciones`, `inquilinos`, `MeGaConsultora.github.io`) y sincroniza con `git pull` / `git push`.
- **Regla clave**: terminar de trabajar en una máquina siempre implica pushear antes de cambiar a otra. `git pull` solo trae lo que ya está subido a GitHub, no lo que quedó pendiente localmente en otra compu.
- `CLAVES_SENSIBLES.txt` (WEBHOOK_SECRET, claves VAPID) **nunca se sube a GitHub** — se mantiene aparte, fuera de los repos.

---

## PARTE 1 — CONVENCIONES CLAVE DEL CÓDIGO
- `pagos_suministros.importe` = parte del inquilino; `.importe_propietario` = parte del propietario
- Campos legado `monto_xxx` en `pagos` (monto_epe, monto_agua, etc.) se zeroean una vez migrado el contrato al modelo de suministros nuevo (`pagos_suministros`) — si ves esos campos en 0 para un contrato, no es un error, es que ya migró
- `getEstado(c)`: rescindido > indefinido > vigente/vencido
- `rendido_prop_items` / `items_rendidos`: mapa `{monto, fecha}` por ítem — clave `'alquiler'` para el alquiler, `'srv-<tipo>-<suministro_id>'` para servicios (agua/EPE/etc.), `'extra-<id>'` para extras. El sistema de Recibo Propietario nunca vuelve a ofrecer lo ya rendido.
- `pagos_extras.cobrado`: flag real que indica si un extra a cargo del inquilino fue efectivamente cobrado
- `caja_movimientos.pago_id`: vincula un movimiento de Caja al pago que lo originó, para reversión en cascada
- `movimientos_pagos`: historial de recibos impresos — cada fila es un evento (recibo principal, Honorarios, RendidoDirectoPropietario). Al mostrar el Historial de Pagos se agrupan filas del mismo pago/momento en una sola tarjeta.

---

## PARTE 2 — LO ARMADO EN SESIONES ANTERIORES (PWA, push, seguridad, bugs financieros)

### PWA e inactividad
Las dos apps son instalables (manifest + service worker + íconos). El Service Worker **nunca cachea llamadas a Supabase** (excluye `supabase.co` explícitamente) — bug real corregido, mantener esa exclusión si se toca `sw.js`. Las dos apps cierran sesión sola tras 1 hora de inactividad (timer local, no toca tokens).

### Notificaciones push (portal inquilino)
Dos disparadores: noticia nueva (webhook → Edge Function `send-push-noticia`) y alquiler vencido (cron diario → `send-push-vencidos`). Protegidas con `WEBHOOK_SECRET` compartido (header `x-webhook-secret`) — el mismo valor exacto debe estar en las 2 Edge Functions, el Database Webhook y el Cron Job.

### Seguridad de la base de datos
RLS endurecido en ~24 tablas vía `es_admin_activo()`. Storage privado con URLs firmadas. Auto-registro sacado de la UI. Ver `sql_historial/` para el historial completo de scripts.

### Bugs financieros corregidos (todos verificados como resueltos)
1. `montoEsteMovimiento` no incluía interés punitorio
2. `recalcularFilaPago` descartaba resultado vacío de la base al borrar el último extra
3. `guardarExtraGP` no recibía `pagoId` explícito (corregido en 9 lugares)
4. Reparto proporcional de "pago directo al propietario" no restaba el numerador
5. Historial de Pagos sumaba dos veces la misma plata al agrupar filas
6. `window._gpPropietarioId` sin validar/resetear entre contratos

### Historia vieja: "sesión expirada"
Causa: `doLogin()` no guardaba `refresh_token`. Corregido + access token expiry subido a 24hs. No volvió a reportarse desde entonces.

---

## PARTE 3 — SESIÓN 2026-09-14: repaso de código + fix de seguridad

### Repos verificados
Se clonaron localmente los 3 repos y se confirmó que `locaciones` e `inquilinos` estaban 100% al día respecto al último paquete de traspaso (diferencias de bytes en algunos íconos eran solo recompresión, contenido visual idéntico).

### Repaso general de código — hallazgos
**App de gestión (`locaciones`)**: buen estado, sin bugs nuevos. El problema es de escala: un solo archivo de ~16.700 líneas y +300 funciones sin dividir en módulos. Funciones puntuales muy grandes (`_confirmarCobroInquilinoImpl` ~594 líneas). `loadAll()` recarga toda la base en cada guardado (22 lugares) — no es un problema hoy, pero puede sentirse lento a futuro con más historial. Notas de texto libre insertadas sin sanitizar (riesgo bajo, solo lo ven admins logueados).

**Portal (`inquilinos`)**: código prolijo, buenos estados de carga y mensajes de error. Hallazgos menores: lógica de cálculo (vencimientos, importes) duplicada literalmente desde `locaciones` — riesgo de que se desincronicen si se cambia una regla en un solo lado. Tabla de pagos con scroll horizontal en celular (no ideal para el uso principal, que es desde el teléfono). Mensajes de error de login genéricos (no distingue credenciales incorrectas de problema de conexión).

**Pendientes de mejora anotados, sin resolver todavía:**
- Dividir `locaciones/index.html` en módulos (pagos, contratos, caja, informes) — la mejora de mayor impacto, requiere una sesión dedicada
- Achicar las funciones más grandes
- Evitar recargar toda la base en cada guardado
- Adaptar la tabla de pagos del portal a vista de tarjetas en celular
- Diferenciar mensajes de error de login
- Sanitizar texto libre antes de insertarlo en el DOM

### 🔴 Vulnerabilidad de seguridad encontrada y corregida
El formulario de auto-registro (`doRegistro`) se había sacado de la interfaz del portal en una sesión anterior, pero **la función seguía en el código JS** y la política de `INSERT` de la tabla `usuarios` no la bloqueaba del todo: permitía insertar una fila con `persona_id` de **cualquier persona** (vinculándose a un contrato ajeno) y `aprobado: true`, sin pasar por ningún admin. El trigger que blindaba la tabla (`proteger_columnas_usuarios`) solo corría en `UPDATE`, no en `INSERT`, así que no lo tapaba.

**Corrección aplicada (`sql_historial/06_fix_insert_usuarios.sql`, ya corrido en Supabase y verificado):**
1. Política de `INSERT` en `usuarios` ahora exige, para no-admins: `user_id` propio, `persona_id is null`, `aprobado is distinct from true`.
2. El trigger `proteger_columnas_usuarios` ahora corre en `INSERT OR UPDATE` (antes solo `UPDATE`), como blindaje extra.
3. `doRegistro` y `vincularPorDNI` (código muerto sin UI que las dispare) se eliminaron directamente de `inquilinos/index.html` — commit `04679f3`, ya pusheado.

**Verificado en producción**: la política y el trigger quedaron confirmados con consultas a `pg_policies` y `pg_trigger` después de aplicar el script.

---

## PARTE 4 — PENDIENTES / TEMAS ABIERTOS
- Dividir `locaciones/index.html` en módulos (ver Parte 3)
- Optimizar `loadAll()` para no recargar toda la base en cada guardado
- Mejorar responsive de la tabla de pagos del portal en celular
- Auditoría de Storage: revisar si hay otros buckets además de `contratos-archivos` y `servicios`
- Rate limiting de Supabase Auth (no revisado)
- Revisión más exhaustiva de código en busca de otros endpoints sueltos sin RLS bien pensado
- Si aparece algún total viejo que no cierre en algún contrato con "directo al propietario", comparar `pagos.total` guardado contra la suma real armada con SQL
