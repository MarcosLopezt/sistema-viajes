-- Fase 5 — comunicaciones y automatización.
--
--  1. SentNotification: idempotencia de los avisos automáticos que NO cuelgan
--     de una cuota. Los recordatorios de pago siguen en SentReminder, que
--     tiene una FK real a Installment y por eso hereda el borrado en cascada;
--     los de pasaporte apuntan a un Passenger, así que van en su propia tabla
--     con su propia FK en vez de forzar una tabla polimórfica sin integridad
--     referencial. Mismo mecanismo, dos tablas, cada una con su FK.
--
--     El unique (kind, passengerId, tag) es lo que hace idempotente al cron:
--     dos corridas el mismo día chocan contra el índice en vez de mandar dos
--     mails.
--
--  2. Communication.includeCancelled: los pasajeros cancelados quedan afuera
--     salvo decisión explícita del coordinador.

CREATE TYPE "NotificationKind" AS ENUM ('ALERTA_PASAPORTE');

CREATE TABLE "SentNotification" (
    "id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "passengerId" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SentNotification_kind_passengerId_tag_key"
    ON "SentNotification"("kind", "passengerId", "tag");
CREATE INDEX "SentNotification_passengerId_idx"
    ON "SentNotification"("passengerId");

ALTER TABLE "SentNotification"
    ADD CONSTRAINT "SentNotification_passengerId_fkey"
    FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Communication"
    ADD COLUMN "includeCancelled" BOOLEAN NOT NULL DEFAULT false;
