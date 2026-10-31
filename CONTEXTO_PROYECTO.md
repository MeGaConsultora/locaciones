# MeGaConsultora — Gestión de Locaciones — Contexto del proyecto

## Proyecto
- **Admin app**: `index.html` de este repo — hosteado en `megaconsultora.github.io/locaciones/`
- **Portal inquilino**: repo separado `github.com/MeGaConsultora/inquilinos` — hosteado en `megaconsultora.github.io/inquilinos/`
- **Portal propietario** (solo lectura, ver Parte 6): repo `github.com/MeGaConsultora/propietarios` — hosteado en `megaconsultora.github.io/propietarios/`
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

## PARTE 4 — SESIÓN 2026-09-14 (2): Recibos Propietarios — año/mes por defecto + pestaña "Ya emitidos" con pago a Caja

### Qué se hizo
1. `populateRecibosAnios()` ahora precarga año y mes actuales en los selects de Recibos Propietarios (antes quedaban siempre en "-- Año --"/"-- Mes --"), mismo patrón que ya usaba `populateInformeAnios()`.
2. El panel de Recibos Propietarios se dividió en 2 sub-pestañas (mismo patrón que las sub-pestañas de Caja, `showCajaSubtab`): **"Pendientes de emitir"** (lo que ya había) y **"Ya emitidos"** (nueva).
3. "Ya emitidos" (`renderRecibosEmitidos()`) lista, para el período elegido, los recibos ya impresos con su saldo pendiente de pagarle al propietario. El estado "pagado" **no se guarda como flag aparte**: se deriva siempre de la suma de `caja_movimientos` con `categoria = 'Pago a propietario'` vinculados a ese `pago_id` (y `persona_id` en contratos con más de un propietario) — mismo criterio que ya usa el proyecto (`caja_movimientos.pago_id`) para poder revertir en cascada sin duplicar estado.
4. Nueva columna `caja_movimientos.persona_id` (nullable, `REFERENCES personas(id)`) — script en `locaciones/sql_historial_local/07_pago_propietario_caja.sql`, **hay que correrlo a mano en el SQL Editor de Supabase** antes de usar la función en producción.
5. `marcarPagoPropietario(pagoId, personaId)` registra un egreso en Caja (categoría "Pago a propietario") por el medio elegido; `revertirPagoPropietario(cajaMovimientoId)` lo borra. Se agregó también "Pago a propietario" como categoría fija del combo manual de "Nuevo movimiento" en Caja.

### ⚠️ Riesgo conocido (no resuelto en esta sesión)
`revertirCobro()` borra **todos** los `caja_movimientos` de un `pago_id` sin filtrar por categoría (`sbDeleteWhere('caja_movimientos', 'pago_id=eq.'+p.id)`) al revertir el cobro del inquilino — mismo patrón que ya afecta hoy a "Honorarios". Si ya se registró un "Pago a propietario" sobre ese mismo `pago_id` y después se revierte el cobro del inquilino, ese egreso se borra también de arrastre. Es un caso borde poco frecuente (revertir un cobro después de haber pagado ya al propietario), pero conviene tenerlo presente si se toca `revertirCobro` en el futuro.

---

## PARTE 5 — SESIÓN 2026-09-21: Gestión de Pago — separar fecha de cálculo de mora vs. fecha real del cobro

### Qué se hizo
El campo `gp-fecha-pago` (dentro del recuadro de Interés punitorio) se usaba para DOS cosas a la vez: calcular los días de mora, y quedar grabado como la fecha real del cobro en `movimientos_pagos.fecha`, `caja_movimientos.fecha` y el "Fecha de pago" impreso en el recibo. Si un admin lo corría para atrás para cobrarle menos interés al inquilino, sin querer también archivaba el pago bajo esa fecha vieja — invisible en cualquier búsqueda por fecha real. Caso real: Carnevale-García, pago del 19/09 quedó grabado como 01/09 (`movimientos_pagos` id 1155, `caja_movimientos` id 428 — corregidos a mano en Supabase esa vez).

Se separaron en dos campos independientes en la solapa "Ingresar Pago":
- `gp-fecha-pago` (dentro del recuadro amarillo, re-etiquetado "Calcular mora hasta") — sigue siendo *solo* para el cálculo de intereses, sin cambios de comportamiento.
- `gp-fecha-cobro` (nuevo, siempre visible, arriba de todo, default hoy) — es el único que ahora alimenta `fechaMovimiento` en `_confirmarCobroInquilinoImpl` (antes leía `gp-fecha-pago`), o sea la fecha que queda en Caja, historial y recibo.

### Pendiente de mejora anotado, sin resolver
Mismo patrón dual (fecha de cálculo vs. fecha de registro) puede existir en otros lados que usan `calcularIntereses()` — no se auditó el resto de la app en esta sesión, solo la pantalla de Ingresar Pago que fue el caso reportado.

---

## PARTE 6 — PORTAL DE PROPIETARIOS (nuevo, solo lectura)

Repo nuevo `MeGaConsultora/propietarios` → `megaconsultora.github.io/propietarios/`. Mismo Supabase, mismo estilo que el portal de inquilinos (se armó copiando su CSS y su manejo de login/contraseña temporal/inactividad de 1 hora). Claves de sesión propias en localStorage (`prop_token`, `prop_email`, `prop_refresh_token`) porque las tres apps comparten origen.

**Qué ve el propietario, por contrato:** tarjetas de encabezado (Total percibido, Próximo vencimiento, Vencimiento del contrato, Próxima actualización) y un detalle mensual con dos pasos: *Cobro al inquilino* (pagó / parcial / pendiente / vencido / próximo) y *Abonado a vos* (abonado / abonado parcial / cobrado directo / pendiente de abono / esperando cobro). A propósito NO se muestra el paso "rendido / recibo emitido" (es un control interno).

**Seguridad:** no se abrió ninguna tabla con RLS. Una única función `portal_propietario_datos()` (SECURITY DEFINER, `sql_historial_local/10_portal_propietarios.sql`) devuelve un JSON solo con lo del propietario logueado (usuario con `rol='propietario'`, `aprobado`, vinculado a su `persona_id`): sus contratos con su % (`contrato_personas.pct_alquiler`), los pagos de esos contratos, los movimientos "Pago a propietario" de ESA persona, y si hubo cobro directo. Probada en una Postgres local (PGlite) con propietarios, inquilino, usuario sin aprobar y sin sesión: cada uno ve solo lo suyo. Ejecutable solo por `authenticated`.

**Definiciones (réplica de la lógica del admin):**
- *Pagó el mes*: `pagado_importe + créditos al inquilino >= importe_alquiler` (mismo criterio que "alquiler cubierto" en Recibos Propietarios). Mes sin alquiler cargado → "—".
- *Abonado*: suma de `caja_movimientos` con `categoria='Pago a propietario'` de ese `pago_id` y esa persona (en contratos de un solo propietario, `persona_id` null). "Parcial" si es menor al neto rendido (alquiler − comisión ± extras/servicios, igual que "Ya emitidos").
- *Cobrado directo*: fila `recibos_propietario_emitidos.via_caja=false` (varios propietarios) o `rendido_prop_items` con `recibo_prop_emitido` falso (uno solo). Se cuenta como bruto: alquiler + servicios que se rinden.
- *Total percibido* = abonado por MeGa + cobrado directo (ARS) y, aparte, cada otra moneda (ej. USD).
- Constante `ABONOS_DESDE = '2026-09'` en el portal: el registro de "Pago a propietario" empezó en septiembre 2026, así que los meses anteriores sin abono cargado dicen "Sin registro" en vez de "pendiente de abono". Si se cargan abonos viejos, se muestran igual.

**Alta de un propietario (admin):** Clientes → ficha de la persona → "🔑 Acceso al portal de propietarios" (aparece si es propietario en algún contrato). Crea el usuario de Supabase Auth con contraseña temporal + fila en `usuarios` (`rol='propietario'`) y muestra el mensaje para WhatsApp. En la solapa Usuarios aparece el rol "Propietario" y "Reenviar acceso" con el link correcto. Si la persona ya tiene usuario vinculado (inquilino, admin…), no hace falta crear otro: entra con el mismo email (ver "Varios roles" abajo). Si el email ya tiene un usuario SIN persona vinculada (típico: el admin), "Crear acceso" ofrece vincularlo a la persona sin tocar su rol ni su contraseña; si está vinculado a otra persona, lo rechaza. El portal muestra los meses hasta el siguiente al actual (las cuotas futuras pre-generadas por el admin no se listan).

**Varios roles en un mismo usuario ("Ver como…"):** los roles se detectan por los DATOS con la función `mis_roles()` (`sql_historial_local/11_mis_roles.sql`): *admin* = `es_admin_activo()`; *propietario* = su `persona_id` figura como propietaria en `contrato_personas`; *inquilino* = figura como inquilina en `contrato_personas` o en `contratos.inquilino_id`. El campo `usuarios.rol` ya no decide el acceso al portal de propietarios (esa función también se redefine en el script 11: basta ser usuario aprobado cuya persona sea propietaria). Los portales de inquilinos y propietarios consultan `mis_roles()` al cargar y, si hay más de un rol, muestran en el encabezado un selector "Ver como…". El cambio de portal **no pide login**: los tres portales comparten origen, así que se copia el token de acceso a las claves del portal de destino (`inq_*`, `prop_*`, `sb_*` + `sb_uid` sacado del JWT) y se navega. Se pasa el token de acceso y el token de renovación se MUEVE (se copia al destino y se borra del origen), así nunca lo usan dos apps a la vez; si solo se pasaba el de acceso, la sesión del destino se caía al vencer (~1 hora: "Sesión expirada" en pleno trabajo, detectado oct 2026). Si el destino tenía otro token de renovación (de otro usuario), se pisa. "Salir" cierra además las sesiones de los otros portales si son del mismo email. Si `mis_roles()` no responde (script sin correr), los portales se comportan como antes (vale el `rol` guardado). El sistema de gestión también tiene el selector "Ver como…" en el encabezado (`cargarSelectorPortal`/`cambiarPortal` en `locaciones/index.html`, mismo mecanismo y mismas claves) y su "Salir" (y el cierre por inactividad) cierra las sesiones de los otros portales del mismo email. Verificado en producción (oct 2026): se puede ir y volver entre Propietario y Administración. **Cierre por inactividad compartido:** los tres sistemas guardan la última actividad en `localStorage` (`mega_ultima_actividad`) y solo cierran sesión si ninguna pestaña ni portal tuvo actividad en 1 hora (antes, una pestaña olvidada hacía "Salir" y borraba la sesión compartida, sacándote de la pestaña donde trabajabas).

**Configuración manual necesaria (una vez):**
1. Correr `10_portal_propietarios.sql` en el SQL Editor de Supabase.
2. Supabase → Authentication → URL Configuration → Redirect URLs: agregar `https://megaconsultora.github.io/propietarios/` (para que "¿Olvidaste tu contraseña?" vuelva al portal correcto; si no, el link cae en el portal de inquilinos). **Hecho** (oct 2026).
3. Si al crear un acceso falla por una restricción de `usuarios.rol`, hay que permitir el valor `propietario` (no se pudo verificar desde acá si existe un CHECK).

---

## PARTE 6B — AMBIENTE DE PRUEBA (STAGING)
Copia del sistema de gestión con su propia base de Supabase de prueba, para probar cambios antes de producción. El script `herramientas/build_staging.mjs` arma la copia desde esta carpeta (otra URL de Supabase, prefijo `stg:` en el almacenamiento del navegador porque comparte origen con producción, franja roja, sin service worker ni selector "Ver como…"). Rechaza la URL del proyecto real y toda clave que no sea la anon. Pasos de preparación y de uso: `herramientas/AMBIENTE_DE_PRUEBA.md`. Estado: el script está listo y probado; falta que Hugo cree el proyecto de Supabase de prueba, el repo `locaciones-staging` y `herramientas/staging.config.json`.

---

## PARTE 6C — PRUEBAS AUTOMÁTICAS
Carpeta `pruebas/` en `locaciones-repo` y en `propietarios-repo` (ver su README). Se corren con `node --test`; extraen las funciones de cálculo de `index.html` y las prueban con datos armados a mano (total del mes, reparto entre propietarios, cascada de excedentes, recibo al propietario, cobranza, rescisión; el portal: total a cobrar y estados). `sql.test.mjs` prueba mis_roles, portal_propietario_datos y la auditoría en PGlite (`npm install --no-save @electric-sql/pglite`). Regla de trabajo: correr `node --test` ANTES de pedir confirmación para subir; si algo falla, no se sube. Al corregir un error, escribir primero la prueba que lo reproduce. También corren en GitHub Actions en cada push (avisan con ✗, no frenan Pages).

---

## PARTE 6D — TOTALES Y SALDOS CALCULADOS EN LA BASE
El total, el saldo y el estado de cada mes (`pagos.total / saldo / pagado`) los mantiene la base sola con la MISMA regla que usa la pantalla (calcularTotal / recalcularFilaPago): total = alquiler + servicios + extras; saldo = total − pagado_importe (nunca negativo); estado = SI si saldo 0, PARCIAL si hay algo abonado, si no queda como estaba. `14_control_saldos.sql`: funciones de solo lectura `total_calculado_pago(id)` y `control_saldos()` (lista los meses cuyo total/saldo guardado no coincide con el calculado; debe devolver 0 filas). `15_totales_automaticos.sql`: reparación única + triggers que recalculan el mes al cambiar alquiler, montos viejos de servicios, lo abonado, extras o importes por cuenta (los meses RESCINDIDO no se tocan). Antes del 15 había 96 meses desfasados (oct 2026): 55 con el total guardado viejo y el saldo bien, 39 de noviembre 2026 con servicios contados de más, 1 de marzo con un extra cobrado fuera del sistema y 1 de 2023 con $363 cobrados un mes tarde; se corrigieron a mano los dos últimos antes de correr el 15. Pruebas: `pruebas/saldos_sql.test.mjs` (el cálculo de la base es idéntico al de la pantalla en 500 casos al azar) y `pruebas/totales_automaticos.test.mjs` (reparación, triggers y 400 operaciones al azar contra calcularTotal). Si alguna vez se cambia calcularTotal en index.html hay que cambiar también total_calculado_pago en SQL: esas pruebas avisan si dejan de coincidir. Los cambios de la reparación quedaron en la auditoría con valor anterior y nuevo. `16_blindaje_saldos.sql` cierra los huecos: el trigger de pagos corrige cualquier total/saldo mal escrito (la pantalla puede guardar valores viejos y la base los pisa con el calculado), hay triggers sobre contrato_suministros (cambio de tipo/borrado) y contratos (alta/baja/cambio de hoja), y `recalcular_todos_los_pagos()` (solo admin) repara de una vez. En la app, para administradores, un botón rojo en el encabezado ("⚠ N meses con saldo desfasado") aparece si control_saldos() devuelve filas (se revisa al cargar, como mucho cada 10 minutos) y repara con un clic; si las funciones no existen en la base no muestra nada. Prueba: `pruebas/blindaje_saldos.test.mjs`.

---

## PARTE 6E — PANTALLA DE CONTRATO: VISTA NUEVA (oct 2026)
La ficha del contrato (`openContrato`) tiene dos vistas. La CLÁSICA es el código de siempre (no se tocó). La NUEVA (`openContratoNuevo`, arranca por defecto) se agregó al lado: barra de acciones en una línea (Actualizar, Editar, Acceso, Regenerar, Duplicar, Rescindir/Revertir rescisión, Eliminar; Historial y Proyectar alquiler ya no tienen botón en la vista nueva, las funciones `imprimirHistorial` y `abrirProyectarContrato` siguen en el código y se usan desde la clásica), ficha con barra de vigencia y tarjetas (saldo, total acumulado, alquiler actual), franja de honorarios, secciones plegables (Contrato y firma —abierta si la firma está incompleta—, Extras generales, Notas) y los meses como **Tira** de colores o **Tabla** (la tabla es la de siempre, armada en `renderGrilla`; la tira sale de los mismos valores). Al tocar un mes de la Tira se despliega al pie su detalle (alquiler, servicios, extras generales y del mes, total, abonado, saldo, estado, adjuntos) con tres botones que abren la Gestión de Pago de siempre en su solapa (Cargar / Modificar = s1, Ingresar pago = s2, Recibo propietario = s3) y un "Eliminar mes"; tocarlo de nuevo lo cierra. En la Tabla, tocar una fila sigue abriendo directo la Gestión de Pago. Al abrir un contrato arranca elegido y desplegado el mes corriente (si el contrato no lo tiene, el último anterior a hoy). La Tira usa el mes corriente como referencia (`cnPartirMeses`): los meses ANTERIORES quedan tras el botón "Meses anteriores (N)", EXCEPTO los que tienen deuda (saldo > 0, sin contar rescindidos ni centavos), que se ven siempre; los meses SIGUIENTES se ven solo si ya tienen algún importe cargado (alquiler, servicios o extras del inquilino; los rescindidos no cuentan), el resto queda tras "Meses siguientes (N)". Si el contrato no tiene el mes corriente (no empezó o ya terminó) la referencia es su primer o último mes. La franja de Honorarios pendientes va justo debajo de Notas (a la vista, cerca de la Tira). La barra de avance de la vigencia ("Vence en N días") va arriba de la Tira; la tarjeta "Saldo pendiente" aclara cuánto es de meses anteriores al corriente. La Tabla muestra todos los meses siempre. Los extras del detalle del mes se pintan por tipo guardado (`pagos_extras.tipo`): `credito` en verde y `debito` en rojo, tanto del inquilino (crédito = descuento, resta; débito = cargo, suma) como del propietario (crédito suma a lo que cobra; débito lo resta); las celdas "Extras gral./mes" muestran el neto con signo (rojo = suma al inquilino, verde = lo descuenta). Reusa las funciones existentes (editar, rescindir, notas, firma, grilla): solo cambia la presentación; no toca cálculos ni base de datos. La ficha del contrato (propietarios, inquilinos, garantes, tipo, actualización, inmueble) es SOLO INFORMATIVA en las dos vistas: nombres sin enlace de edición y sin ✕ ni "Asignar inmueble" ("Sin inmueble" si no tiene); todo eso se edita únicamente desde "Editar contrato". La sección plegable "Suministros y extras generales" lista TODOS los suministros del contrato (EPE, agua, internet… y los de tipo Otro, rotulados "Extra general"), con % inquilino/propietario, a quién descuenta, a quién rinde y monto fijo (`cnSuministrosHtml`), en solo lectura; se edita desde "Editar contrato". El inmueble de un contrato ya NO se puede quitar con una ✕ desde la ficha (ni en la vista nueva ni en la clásica): se quita solo desde "Editar contrato" (botón "✕ Quitar"); si el contrato no tiene inmueble, la ficha sigue ofreciendo "＋ Asignar inmueble". La preferencia se guarda en el navegador (`localStorage.mega_vista_contrato` = 'clasica' | 'nueva', y `mega_vista_meses` = 'tira' | 'tabla'); el interruptor está arriba a la derecha de cada vista. Para volver al estado anterior al rediseño: etiqueta de git `antes-rediseno-contrato` (commit 64454e9) o `git revert` del commit del rediseño. Pruebas: `pruebas/contrato_vista.test.mjs`.

---

## PARTE 6F — BORRADOS Y CAJA (oct 2026)
En la base solo cascadean al borrar un mes (pagos): pagos_extras, pagos_pdf, movimientos_pagos y pagos_suministros. `caja_movimientos` y `recibos_propietario_emitidos` tienen pago_id pero SIN clave foránea hacia pagos (verificado con pg_constraint): no se borran solos ni se protegen, lo decide la app. Reglas actuales: (1) revertir un cobro del inquilino (revertirItem / revertirCobro) borra sus movimientos de Caja con `borrarMovimientosCajaDelCobro`, que NUNCA toca los de categoría "Pago a propietario" (esos solo se revierten desde "Ya emitidos"); (2) "Eliminar mes" avisa si el mes tiene pagos al propietario o recibos emitidos (`textoAvisoRendicion`, se elige continuar o cancelar), y al continuar borra Caja, las rendiciones emitidas y el mes; (3) "Eliminar contrato" avisa lo mismo, borra las rendiciones emitidas pero DEJA los movimientos de Caja (el dinero ya se movió; sus conceptos ya llevan el nombre del contrato); (4) rescindir no borra meses posteriores que tengan cobros, movimientos de Caja o recibos emitidos: los lista para revisar a mano. La auditoría (13) guarda la fila completa de cada borrado de Caja. Pruebas: `pruebas/borrados.test.mjs`.

---

## PARTE 7 — PENDIENTES / TEMAS ABIERTOS
- DECIDIDO (oct 2026): la regla del total de un mes vive en DOS lugares (calcularTotal en index.html y total_calculado_pago en SQL) a propósito; las pruebas (saldos_sql.test.mjs) avisan si divergen. Pasar a una sola regla (que la pantalla lea el valor de la base) queda como opción SOLO si la regla empieza a cambiar seguido o reaparecen desfases.
- Ambiente de prueba (staging): herramienta lista en herramientas/, sin usar; ver PARTE 6B.
- Dividir locaciones/index.html en módulos (ver Parte 3): evaluado, sin hacer.
- Portal de propietarios: sin PWA/notificaciones push todavía (el de inquilinos sí); evaluar avisarles cuando se les abona un alquiler
- Dividir `locaciones/index.html` en módulos (ver Parte 3)
- Optimizar `loadAll()` para no recargar toda la base en cada guardado
- Mejorar responsive de la tabla de pagos del portal en celular
- Auditoría de Storage: revisar si hay otros buckets además de `contratos-archivos` y `servicios`
- Rate limiting de Supabase Auth (no revisado)
- Revisión más exhaustiva de código en busca de otros endpoints sueltos sin RLS bien pensado
- Si aparece algún total viejo que no cierre en algún contrato con "directo al propietario", comparar `pagos.total` guardado contra la suma real armada con SQL
- `revertirCobro()` puede borrar de arrastre un "Pago a propietario" ya registrado si comparte `pago_id` (ver Parte 4) — evaluar si conviene filtrar por categoría en ese borrado
