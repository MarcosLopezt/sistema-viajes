-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "TripRole" AS ENUM ('COORDINADOR', 'PASAJERO');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ES', 'EN');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('GBP', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('BORRADOR', 'ABIERTO', 'CERRADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('DOBLE', 'SINGLE');

-- CreateEnum
CREATE TYPE "PassengerStatus" AS ENUM ('INVITADO', 'REGISTRADO', 'CONFIRMADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "DirectCostType" AS ENUM ('COMIDA', 'EVENTO', 'TRANSPORTE', 'OTRO');

-- CreateEnum
CREATE TYPE "IndirectCostType" AS ENUM ('CHARTER', 'TRANSFER', 'HOSPEDAJE_COORDINADOR', 'OTRO');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDIENTE', 'EN_REVISION', 'PAGADA', 'VENCIDA');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('EN_REVISION', 'CONFIRMADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAGO', 'REEMBOLSO');

-- CreateEnum
CREATE TYPE "CommunicationAudience" AS ENUM ('TODOS', 'SELECCION');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('BORRADOR', 'PROGRAMADA', 'ENVIANDO', 'ENVIADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "GlobalRole" NOT NULL DEFAULT 'USER',
    "personId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMember" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TripRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "minPassengers" INTEGER NOT NULL,
    "maxPassengers" INTEGER NOT NULL,
    "budgetedPassengers" INTEGER NOT NULL,
    "coordinatorCount" INTEGER NOT NULL DEFAULT 2,
    "status" "TripStatus" NOT NULL DEFAULT 'BORRADOR',
    "priceDouble" DECIMAL(12,2),
    "priceSingle" DECIMAL(12,2),
    "passportValidityMonths" INTEGER NOT NULL DEFAULT 3,
    "requireFullPassportValidity" BOOLEAN NOT NULL DEFAULT false,
    "reminderOffsetsDays" INTEGER[] DEFAULT ARRAY[-7, 1]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryStop" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ItineraryStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accommodation" (
    "id" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "hotelName" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,
    "pricePerNightDouble" DECIMAL(12,2) NOT NULL,
    "pricePerNightSingle" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Accommodation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectCost" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "stopId" UUID,
    "concept" TEXT NOT NULL,
    "amountPerPassenger" DECIMAL(12,2) NOT NULL,
    "type" "DirectCostType" NOT NULL,

    CONSTRAINT "DirectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndirectCost" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "concept" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "type" "IndirectCostType" NOT NULL,

    CONSTRAINT "IndirectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "fullName" TEXT,
    "nationalityCountry" TEXT,
    "residenceCountry" TEXT,
    "residenceAddress" TEXT,
    "residenceCity" TEXT,
    "mobilePhone" TEXT,
    "documentNumber" TEXT,
    "passportNumber" TEXT,
    "passportExpiryDate" DATE,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "medicalAssuranceCompany" TEXT,
    "medicalAssuranceId" TEXT,
    "medicalAssurancePhone" TEXT,
    "medicalAssuranceEmail" TEXT,
    "hasDietaryRestrictions" BOOLEAN NOT NULL DEFAULT false,
    "dietaryRestrictionsDetail" TEXT,
    "hasMobilityRestrictions" BOOLEAN NOT NULL DEFAULT false,
    "mobilityRestrictionsDetail" TEXT,
    "otherHealthNotes" TEXT,
    "medicalAssuranceFileId" TEXT,
    "preferredLanguage" "Language" NOT NULL DEFAULT 'ES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passenger" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "roomId" UUID,
    "status" "PassengerStatus" NOT NULL DEFAULT 'INVITADO',
    "isCoordinator" BOOLEAN NOT NULL DEFAULT false,
    "priceOverride" DECIMAL(12,2),
    "priceOverrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Passenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "fxSnapshot" JSONB NOT NULL,
    "fxSnapshotDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDIENTE',

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "installmentId" UUID,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAGO',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "fxRateUsed" DECIMAL(18,8),
    "amountInTripCurrency" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "proofFileId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'EN_REVISION',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentReminder" (
    "id" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "subjectEs" TEXT NOT NULL,
    "bodyEs" TEXT NOT NULL,
    "subjectEn" TEXT,
    "bodyEn" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "audience" "CommunicationAudience" NOT NULL DEFAULT 'TODOS',
    "status" "CommunicationStatus" NOT NULL DEFAULT 'BORRADOR',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationRecipient" (
    "id" UUID NOT NULL,
    "communicationId" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "lang" "Language" NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDIENTE',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "CommunicationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "base" "Currency" NOT NULL,
    "rates" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" UUID NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "TripMember_userId_idx" ON "TripMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TripMember_tripId_userId_key" ON "TripMember"("tripId", "userId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryStop_tripId_order_key" ON "ItineraryStop"("tripId", "order");

-- CreateIndex
CREATE INDEX "Accommodation_stopId_idx" ON "Accommodation"("stopId");

-- CreateIndex
CREATE INDEX "DirectCost_tripId_idx" ON "DirectCost"("tripId");

-- CreateIndex
CREATE INDEX "IndirectCost_tripId_idx" ON "IndirectCost"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_tripId_label_key" ON "Room"("tripId", "label");

-- CreateIndex
CREATE INDEX "Passenger_tripId_status_idx" ON "Passenger"("tripId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Passenger_tripId_personId_key" ON "Passenger"("tripId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlan_passengerId_key" ON "PaymentPlan"("passengerId");

-- CreateIndex
CREATE INDEX "Installment_status_dueDate_idx" ON "Installment"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_planId_number_key" ON "Installment"("planId", "number");

-- CreateIndex
CREATE INDEX "Payment_planId_idx" ON "Payment"("planId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SentReminder_installmentId_offsetDays_key" ON "SentReminder"("installmentId", "offsetDays");

-- CreateIndex
CREATE INDEX "Communication_tripId_status_idx" ON "Communication"("tripId", "status");

-- CreateIndex
CREATE INDEX "CommunicationRecipient_status_idx" ON "CommunicationRecipient"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationRecipient_communicationId_passengerId_key" ON "CommunicationRecipient"("communicationId", "passengerId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_tripId_idx" ON "Invitation"("tripId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "FxRate_base_date_idx" ON "FxRate"("base", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_date_base_key" ON "FxRate"("date", "base");

-- CreateIndex
CREATE INDEX "RateLimitHit_keyHash_createdAt_idx" ON "RateLimitHit"("keyHash", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitHit_createdAt_idx" ON "RateLimitHit"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryStop" ADD CONSTRAINT "ItineraryStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accommodation" ADD CONSTRAINT "Accommodation_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "ItineraryStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectCost" ADD CONSTRAINT "DirectCost_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectCost" ADD CONSTRAINT "DirectCost_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "ItineraryStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndirectCost" ADD CONSTRAINT "IndirectCost_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentReminder" ADD CONSTRAINT "SentReminder_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "Communication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
