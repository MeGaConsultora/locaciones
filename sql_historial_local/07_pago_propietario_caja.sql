-- Permite identificar a qué propietario corresponde un egreso de Caja
-- cuando el contrato tiene más de un propietario (ver "Pago a propietario"
-- en la pestaña "Ya emitidos" de Recibos Propietarios).
-- Correr a mano en el SQL Editor de Supabase.
ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES personas(id);
