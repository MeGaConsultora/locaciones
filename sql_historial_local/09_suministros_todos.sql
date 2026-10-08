-- Permite que un suministro del contrato se "descuente" o se "rinda" a TODOS
-- los propietarios (repartido según el % de participación de cada uno),
-- en vez de a uno solo. Hasta ahora esos dos datos eran un único
-- propietario_persona_id / descuenta_persona_id.
-- Correr a mano en el SQL Editor de Supabase ANTES de usar la opción
-- "Todos (proporcional)" en Contratos > Suministros.
ALTER TABLE contrato_suministros
  ADD COLUMN IF NOT EXISTS descuenta_todos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rinde_todos boolean NOT NULL DEFAULT false;
