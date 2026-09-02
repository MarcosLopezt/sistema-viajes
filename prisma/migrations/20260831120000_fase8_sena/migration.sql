-- Fase 8 — la seña.
--
-- El embudo real es: Wix → registro como interesada → Zoom (fuera del
-- sistema) → seña → conversión a pasajera. La fase 7 dejó la conversión
-- manual y sin seña; esta la mete en el medio.
--
--  1. Trip: el monto de la seña, los defaults del plan con seña, la condición
--     de no reembolsable y las instrucciones de pago. Los dos textos son
--     DATO, como el resto de los textos de marca: los escriben las
--     coordinadoras y cambiarles una coma no puede ser un deploy.
--
--  2. Passenger.paymentInstructions: el override por pasajera. Las cuentas
--     bancarias se acuerdan una por una según el país de residencia, así que
--     el texto del viaje es apenas un default razonable.
--
--  3. DepositProof: la seña MIENTRAS ES UNA PROMESA.
--
--     Un Payment cuelga de un PaymentPlan, que cuelga de un Passenger. La
--     seña se paga ANTES de la conversión, cuando no existe ninguna de las
--     tres cosas. Hacer Payment.planId nullable habría convertido a la seña
--     en el "pago suelto" que el negocio prohíbe: no imputado a ninguna
--     cuota y visible como crédito en derivePlan().
--
--     Entonces vive acá, y se convierte en Payment recién cuando existe el
--     plan que la puede alojar. `paymentId` es esa materialización y es
--     ÚNICO: la seña no se puede imputar dos veces porque lo impide un
--     índice, no una validación.
--
--  4. El índice parcial del final, que es la parte que Prisma no sabe
--     escribir. Segundo del sistema, con la misma advertencia que el primero.


-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "defaultInstallmentCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "depositAmount" DECIMAL(12,2),
ADD COLUMN     "depositTermsEn" TEXT,
ADD COLUMN     "depositTermsEs" TEXT,
ADD COLUMN     "installmentIntervalMonths" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "paymentInstructionsEn" TEXT,
ADD COLUMN     "paymentInstructionsEs" TEXT;

-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "paymentInstructions" TEXT;

-- CreateTable
CREATE TABLE "DepositProof" (
    "id" UUID NOT NULL,
    "interestId" UUID NOT NULL,
    "passengerId" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "fxRateUsed" DECIMAL(18,8),
    "fxRateSource" "FxRateSource",
    "amountInTripCurrency" DECIMAL(12,2) NOT NULL,
    "transferDate" DATE NOT NULL,
    "proofFileId" TEXT NOT NULL,
    "acceptedTermsText" TEXT NOT NULL,
    "acceptedTermsLang" "Language" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "shownAmount" DECIMAL(12,2) NOT NULL,
    "shownCurrency" "Currency" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'EN_REVISION',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositProof_passengerId_key" ON "DepositProof"("passengerId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositProof_paymentId_key" ON "DepositProof"("paymentId");

-- CreateIndex
CREATE INDEX "DepositProof_interestId_status_idx" ON "DepositProof"("interestId", "status");

-- AddForeignKey
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "Interest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- COMO MÁXIMO UNA SEÑA VIGENTE POR INTERESADA
-- ---------------------------------------------------------------------------
--
-- "Vigente" es todo lo que no está RECHAZADO. Las rechazadas se acumulan a
-- propósito: volver a subir después de un rechazo no puede borrar el rastro
-- de por qué la rechazaron, que es justamente lo que la interesada va a
-- preguntar. Es el mismo criterio con el que Invitation conserva las filas
-- revocadas en vez de borrarlas.
--
-- Va como índice y no como validación en el servicio por la misma razón que
-- "Trip_una_sola_captacion_abierta": un chequeo previo pierde contra dos
-- requests simultáneos —doble click en un teléfono con mala señal es el caso
-- normal, no el raro— y el resultado serían dos comprobantes vigentes para la
-- misma persona, que es exactamente lo que la revisión no sabe resolver.
--
-- ⚠️ Prisma NO conoce este índice: no sabe expresar índices parciales. La
-- consecuencia práctica es que `prisma migrate dev` lo va a ver como drift y
-- va a proponer un DROP en la próxima migración. NO se lo aceptes: borrá esa
-- línea del SQL generado. La misma nota está en el docblock del modelo, en
-- AGENTS.md y en README §Arquitectura, y ya aplicaba al índice de la fase 7.
CREATE UNIQUE INDEX "DepositProof_una_vigente_por_interesada"
    ON "DepositProof" ("interestId")
    WHERE "status" <> 'RECHAZADO';
