# Pruebas automáticas — sistema de gestión

Verifican que los cálculos de dinero sigan dando lo que tienen que dar después de cada cambio.
La app es un único `index.html`: las pruebas **extraen las funciones por nombre** y las ejecutan
aisladas, con datos armados en cada test (los importes esperados están calculados a mano).

## Cómo correrlas
```
node --test
```
(desde `locaciones-repo`). Las pruebas de SQL (roles, portal de propietarios, auditoría) necesitan PGlite,
una base PostgreSQL de prueba en memoria; se instala una vez con `npm install --no-save @electric-sql/pglite`.
Sin eso se saltean y el resto corre igual. Duración: unos pocos segundos.

## Qué cubren
| Archivo | Cubre |
|---|---|
| `calculos.test.mjs` | total de un mes, reparto entre propietarios, excedente a meses siguientes, qué se ofrece cobrar de los extras, recibo al propietario (comisión, extras, servicios, rendición parcial, honorarios), rescisión, tablero de cobranza, teléfonos de WhatsApp, orden de listas, carga por páginas |
| `sql.test.mjs` | `mis_roles()`, `portal_propietario_datos()` y la auditoría (qué registra, secretos, permisos) |
| `saldos_sql.test.mjs` | el total de un mes calculado en la base es IDÉNTICO al de la pantalla (500 casos al azar) y `control_saldos()` encuentra los meses desfasados |
| `totales_automaticos.test.mjs` | la reparación única, los triggers de 15_totales_automaticos.sql y 400 operaciones al azar comparadas contra calcularTotal |
| `blindaje_saldos.test.mjs` | 16_blindaje_saldos.sql: la base pisa cualquier total/saldo viejo, se entera de cambios en contratos y cuentas de servicio, y el botón de reparación solo lo usa un administrador |

## Cuándo correrlas
Antes de cada subida a producción. También corren solas en GitHub (`.github/workflows/pruebas.yml`):
si fallan, aparece una ✗ roja junto al commit. No impiden que la página se publique, solo avisan.

## Cómo agregar una prueba
1. Elegir la función de `index.html` (se pide por nombre: `cargar('index.html', ['miFuncion', 'otraQueUsa'], { DB: ..., TODAY: ... })`).
2. Pasarle en el tercer parámetro las variables globales que usa.
3. Escribir el caso con el resultado esperado **calculado a mano**, no copiado de lo que da hoy.
4. Cuando se arregla un error, agregar primero la prueba que lo reproduce.

## Qué NO cubren
La pantalla (clics, estilos, impresión) ni la base real. Eso se sigue probando a ojo después de subir.
