-- Fase 7 — la interesada y la zona pública.
--
-- Es la primera fase que cambia el ALCANCE del sistema y no solo lo completa:
-- aparece un actor nuevo (la interesada) y una superficie sin sesión.
--
--  1. Person: los campos del formulario que la escuela ya usaba y el sistema
--     no tenía. Tres son obligatorios de negocio (birthDate,
--     passportIssuingCountry, emergencyContactRelationship) pero nullable en
--     la base, como TODAS las columnas de Person: el formulario son 3 pasos
--     con autoguardado y una fila a medio completar tiene que persistir. La
--     obligatoriedad vive en isPersonComplete().
--
--     psychTreatment y anxietyOrPanic son datos de salud mental. Lo que los
--     protege no es esta migración: es que no estén en COORDINATOR_EDITABLE
--     (no llegan a AuditLog) y el test que recorre las tres exportaciones.
--
--  2. Interest: el embudo. NO ocupa cupo y NO tiene TripMember — el porqué
--     está en el docblock del modelo, y es lo que hace que los guards que ya
--     existen fallen cerrado sin tocarles una línea.
--
--  3. Trip: acceptingInterest y los textos de marca, que son dato y no código.
--
--  4. El índice parcial del final, que es la parte que Prisma no sabe escribir.


-- CreateEnum
CREATE TYPE "InterestStatus" AS ENUM ('REGISTRADA', 'EN_CONVERSACION', 'CONVERTIDA', 'DESCARTADA');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "acceptingInterest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closedMessageEn" TEXT,
ADD COLUMN     "closedMessageEs" TEXT,
ADD COLUMN     "emailSignatureEn" TEXT,
ADD COLUMN     "emailSignatureEs" TEXT,
ADD COLUMN     "infoForInterestedEn" TEXT,
ADD COLUMN     "infoForInterestedEs" TEXT,
ADD COLUMN     "nextStepMessageEn" TEXT,
ADD COLUMN     "nextStepMessageEs" TEXT,
ADD COLUMN     "welcomeMessageEn" TEXT,
ADD COLUMN     "welcomeMessageEs" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "additionalInfo" TEXT,
ADD COLUMN     "anxietyOrPanic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "anxietyOrPanicDetail" TEXT,
ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "emergencyContactRelationship" TEXT,
ADD COLUMN     "passportIssuingCountry" TEXT,
ADD COLUMN     "profession" TEXT,
ADD COLUMN     "psychTreatment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "psychTreatmentDetail" TEXT,
ADD COLUMN     "takesMedication" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "takesMedicationDetail" TEXT;

-- CreateTable
CREATE TABLE "Interest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "status" "InterestStatus" NOT NULL DEFAULT 'REGISTRADA',
    "meetingDone" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Interest_tripId_status_idx" ON "Interest"("tripId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_userId_tripId_key" ON "Interest"("userId", "tripId");

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- COMO MÁXIMO UN VIAJE ACEPTANDO INTERESADAS
-- ---------------------------------------------------------------------------
--
-- Índice único PARCIAL sobre una expresión constante: como todas las filas con
-- acceptingInterest = true producen la misma clave (TRUE), la segunda choca.
-- Las filas en false no entran al índice, así que puede haber cuantos viajes
-- cerrados se quiera.
--
-- Va acá y no solo en el servicio a propósito. Una validación en código
-- ("¿ya hay otro abierto?" y después el UPDATE) pierde contra dos requests
-- simultáneos: las dos leen que no hay ninguno y las dos escriben. El día que
-- eso pase, las interesadas se reparten entre dos viajes y nadie se entera
-- hasta que falta media lista. El servicio igual chequea antes, pero solo para
-- dar un mensaje legible: LA VERDAD ES ESTE ÍNDICE.
--
-- Prisma no sabe expresar índices parciales, así que esta línea es la razón
-- por la que la migración se escribe a mano y no sale entera de `migrate dev`.
CREATE UNIQUE INDEX "Trip_una_sola_captacion_abierta"
    ON "Trip" ((TRUE))
    WHERE "acceptingInterest";
