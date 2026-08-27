-- Fase 4 — pagos.
--
-- Tres cambios, y el primero es el que importa:
--
--  1. Se ELIMINA Installment.status. El estado de una cuota (PAGADA,
--     VENCIDA, EN_REVISION, PENDIENTE) se deriva al leer, en derivePlan()
--     (src/lib/domain/payments.ts), a partir del vencimiento y de los pagos
--     confirmados. Un campo persistido depende de que un cron lo haya
--     actualizado, y la ventana de Vercel Cron es de ~1 hora: el semáforo
--     mentiría justo el día del vencimiento, que es el único que importa.
--     Los valores que había no se migran a ningún lado porque son
--     recalculables: no se pierde información.
--
--  2. Payment.transferDate: la fecha en que el pasajero transfirió, que NO
--     es createdAt (el comprobante se puede subir días después). Para las
--     filas existentes se rellena con la fecha de creación, que es la mejor
--     aproximación disponible, y recién después se marca NOT NULL.
--
--  3. Trip.paymentToleranceAmount: cuánto puede faltar para dar una cuota
--     por cubierta, por las comisiones de los bancos intermediarios.

-- 1 — el estado de la cuota deja de persistirse
DROP INDEX "Installment_status_dueDate_idx";
ALTER TABLE "Installment" DROP COLUMN "status";
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");
DROP TYPE "InstallmentStatus";

-- 2 — fecha de transferencia declarada por el pasajero
ALTER TABLE "Payment" ADD COLUMN "transferDate" DATE;
UPDATE "Payment" SET "transferDate" = "createdAt"::date WHERE "transferDate" IS NULL;
ALTER TABLE "Payment" ALTER COLUMN "transferDate" SET NOT NULL;

-- El medio de pago pasa a ser un código que se traduce en la interfaz, no
-- texto libre en español guardado en la base.
ALTER TABLE "Payment" ALTER COLUMN "method" SET DEFAULT 'TRANSFERENCIA';
UPDATE "Payment" SET "method" = 'TRANSFERENCIA' WHERE "method" = 'Transferencia bancaria';

-- 3 — tolerancia configurable por viaje
ALTER TABLE "Trip" ADD COLUMN "paymentToleranceAmount" DECIMAL(12,2) NOT NULL DEFAULT 1.00;
