-- Arreglos previos a la fase 5.
--
--  A. Trip.timezone — qué día es "hoy" al decidir si una cuota está vencida.
--
--     derivePlan() comparaba `dueDate < new Date()`. En Vercel el proceso
--     corre en UTC: a las 22:00 del 26 en Buenos Aires ya son las 01:00 del 27
--     en UTC, así que la cuota del 26 aparecía vencida tres horas antes de que
--     terminara el día del pasajero. Ahora todas las comparaciones son entre
--     FECHAS DE CALENDARIO resueltas en esta zona.
--
--  B. Payment.fxRateSource — si el TC lo tipeó el coordinador mirando el
--     extracto (INGRESADO) o quedó la cotización del día que precargó el
--     sistema (SUGERIDO). Son cosas distintas al conciliar.
--
--     Las filas anteriores quedan en NULL. La lectura es inequívoca:
--       fxRateUsed IS NULL                          → no hubo conversión
--       fxRateUsed IS NOT NULL AND fxRateSource IS NULL → anterior a este campo
--     No se rellenan con un valor inventado: no sabemos cuál de los dos fue.

-- A
ALTER TABLE "Trip"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

-- B
CREATE TYPE "FxRateSource" AS ENUM ('SUGERIDO', 'INGRESADO');
ALTER TABLE "Payment" ADD COLUMN "fxRateSource" "FxRateSource";
