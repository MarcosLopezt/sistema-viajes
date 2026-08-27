import "server-only";

import { prisma } from "@/lib/db/prisma";
import { requireCapability } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { auditMoney, recordAudit } from "./audit";
import { getFxSnapshot } from "./fx";
import { confirmUpload, createSignedDownloadUrl } from "./storage";
import {
  getPassengerForPayments,
  listPassengersForPayments,
  type PassengerForPayments,
} from "./passengers";
import {
  derivePlan,
  impute,
  lateDueDates,
  splitIntoInstallments,
  suggestDueDates,
  worstLight,
  MAX_INSTALLMENTS,
  type DerivedPlan,
  type PaymentInput,
  type PaymentLight,
} from "@/lib/domain/payments";
import {
  convert,
  deriveRate,
  equivalences,
  parseFxSnapshot,
  type Currency,
  type FxSnapshot,
} from "@/lib/domain/fx";
import { toDecimal, ZERO, roundToCents, sum } from "@/lib/domain/money";
import { toBusinessDate, toIsoDate } from "@/lib/validation/trip";
import type {
  ConfirmPaymentInput,
  DeclarePaymentInput,
  PaymentPlanInput,
  RefundInput,
  RejectPaymentInput,
  RevertPaymentInput,
} from "@/lib/validation/payment";

/**
 * Servicios de pagos: plan de cuotas, carga de comprobantes y revisión.
 *
 * ── Dos reglas estructurales ──────────────────────────────────────────────
 *
 * 1. Este módulo NO consulta `prisma.passenger` ni `prisma.person`. Todo lo
 *    que necesita saber de un pasajero se lo pide a `./passengers.ts`, que es
 *    el único lugar donde se aplica `passengerVisibilityFilter()`. Abrir una
 *    excepción "chica" acá sería exactamente cómo se rompe ese invariante.
 *
 * 2. Ninguna función acepta un identificador de identidad del cliente. Lo que
 *    llega es el id de un RECURSO (un pasajero, un pago) y se valida contra la
 *    sesión, siempre en el servidor.
 *
 * Los estados de las cuotas NO se leen de la base: se derivan con
 * `derivePlan()`, la misma función pura que usa el listado y la ficha.
 */

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "SIN_PRECIO"
      | "COORDINADOR"
      | "CANCELADO"
      | "PLAN_INMUTABLE"
      | "PLAN_EXISTENTE"
      | "REVISION_PENDIENTE"
      | "SIN_PLAN"
      | "CUOTA"
      | "ESTADO"
      | "TC_FALTANTE",
    /** Cuántas cuotas se reemplazarían. Alimenta el aviso de confirmación. */
    readonly installmentsAtRisk?: number,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/** Medio de pago. Hoy hay uno solo; se traduce en la interfaz. */
const METHOD_TRANSFER = "TRANSFERENCIA";

// ---------------------------- Lectura del plan -----------------------------

const PLAN_SELECT = {
  id: true,
  passengerId: true,
  totalAmount: true,
  currency: true,
  installmentCount: true,
  fxSnapshot: true,
  fxSnapshotDate: true,
  createdAt: true,
  installments: {
    orderBy: { number: "asc" as const },
    select: { id: true, number: true, dueDate: true, amount: true },
  },
  payments: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      installmentId: true,
      kind: true,
      status: true,
      amount: true,
      currency: true,
      fxRateUsed: true,
      amountInTripCurrency: true,
      transferDate: true,
      method: true,
      proofFileId: true,
      reviewedAt: true,
      notes: true,
      createdAt: true,
    },
  },
} as const;

export interface PaymentRecord {
  id: string;
  installmentId: string | null;
  installmentNumber: number | null;
  kind: "PAGO" | "REEMBOLSO";
  status: "EN_REVISION" | "CONFIRMADO" | "RECHAZADO";
  /** Importe tal como lo declaró el pasajero, en SU moneda. */
  amount: string;
  currency: Currency;
  fxRateUsed: string | null;
  /** Importe imputado, en la moneda del viaje. */
  amountInTripCurrency: string;
  transferDate: Date;
  method: string;
  proofFileId: string | null;
  reviewedAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export interface SerializedInstallment {
  id: string;
  number: number;
  dueDate: Date;
  amount: string;
  paid: string;
  underReview: string;
  remaining: string;
  excess: string;
  state: string;
  overdue: boolean;
  hasPendingProof: boolean;
  daysUntilDue: number;
}

export interface PassengerPaymentPlan {
  planId: string;
  passengerId: string;
  passengerName: string | null;
  currency: Currency;
  totalAmount: string;
  paidTotal: string;
  underReviewTotal: string;
  refundedTotal: string;
  balance: string;
  credit: string;
  light: PaymentLight;
  frozen: boolean;
  overdueCount: number;
  installments: SerializedInstallment[];
  nextInstallment: SerializedInstallment | null;
  payments: PaymentRecord[];
  /**
   * Equivalencias del saldo en las otras dos monedas, con la fecha de la
   * cotización CONGELADA al crear el plan. No se recalculan: si se
   * recalcularan, la deuda del pasajero cambiaría sola de un día para el otro.
   */
  balanceEquivalences: { currency: Currency; amount: string }[];
  fxSnapshotDate: Date;
}

function serializeInstallment(
  installment: DerivedPlan["installments"][number],
): SerializedInstallment {
  return {
    id: installment.id,
    number: installment.number,
    dueDate: installment.dueDate,
    amount: installment.amount.toFixed(2),
    paid: installment.paid.toFixed(2),
    underReview: installment.underReview.toFixed(2),
    remaining: installment.remaining.toFixed(2),
    excess: installment.excess.toFixed(2),
    state: installment.state,
    overdue: installment.overdue,
    hasPendingProof: installment.hasPendingProof,
    daysUntilDue: installment.daysUntilDue,
  };
}

/** Filas de Prisma → entrada del motor puro. Decimal a string, una sola vez. */
function toPaymentInputs(
  payments: readonly {
    id: string;
    installmentId: string | null;
    kind: "PAGO" | "REEMBOLSO";
    status: "EN_REVISION" | "CONFIRMADO" | "RECHAZADO";
    amountInTripCurrency: { toString(): string };
  }[],
): PaymentInput[] {
  return payments.map((p) => ({
    id: p.id,
    installmentId: p.installmentId,
    kind: p.kind,
    status: p.status,
    amountInTripCurrency: p.amountInTripCurrency.toString(),
  }));
}

/**
 * El plan de un pasajero, con todo su estado ya derivado.
 *
 * Devuelve `null` si todavía no tiene plan: no es un error, es el estado
 * normal de alguien recién invitado.
 *
 * La autorización entra por `getPassengerForPayments`, que aplica el acceso de
 * lectura al pasajero. Un pasajero llega solo al suyo; el coordinador, a los
 * de su viaje.
 */
export async function getPaymentPlan(
  passengerId: string,
  now: Date = new Date(),
): Promise<PassengerPaymentPlan | null> {
  const passenger = await getPassengerForPayments(passengerId);

  const plan = await prisma.paymentPlan.findUnique({
    where: { passengerId },
    select: PLAN_SELECT,
  });

  if (!plan) return null;

  return buildPlanView(plan, passenger, now);
}

function buildPlanView(
  plan: {
    id: string;
    passengerId: string;
    totalAmount: { toString(): string };
    currency: Currency;
    fxSnapshot: unknown;
    fxSnapshotDate: Date;
    installments: {
      id: string;
      number: number;
      dueDate: Date;
      amount: { toString(): string };
    }[];
    payments: {
      id: string;
      installmentId: string | null;
      kind: "PAGO" | "REEMBOLSO";
      status: "EN_REVISION" | "CONFIRMADO" | "RECHAZADO";
      amount: { toString(): string };
      currency: Currency;
      fxRateUsed: { toString(): string } | null;
      amountInTripCurrency: { toString(): string };
      transferDate: Date;
      method: string;
      proofFileId: string | null;
      reviewedAt: Date | null;
      notes: string | null;
      createdAt: Date;
    }[];
  },
  passenger: PassengerForPayments,
  now: Date,
): PassengerPaymentPlan {
  // El plan de un pasajero CANCELADO se congela: no genera vencidas ni
  // recordatorios. Lo que ya pagó se sigue viendo, porque hay que devolvérselo.
  const frozen = passenger.status === "CANCELADO";

  const derived = derivePlan({
    totalAmount: plan.totalAmount.toString(),
    installments: plan.installments.map((i) => ({
      id: i.id,
      number: i.number,
      dueDate: i.dueDate,
      amount: i.amount.toString(),
    })),
    payments: toPaymentInputs(plan.payments),
    today: now,
    frozen,
    tolerance: passenger.trip.paymentToleranceAmount,
  });

  const numberOf = new Map(plan.installments.map((i) => [i.id, i.number]));
  const snapshot = parseFxSnapshot(plan.fxSnapshot);
  const balanceEq = equivalences(derived.balance, plan.currency, snapshot);

  return {
    planId: plan.id,
    passengerId: plan.passengerId,
    passengerName: passenger.fullName,
    currency: plan.currency,
    totalAmount: derived.totalAmount.toFixed(2),
    paidTotal: derived.paidTotal.toFixed(2),
    underReviewTotal: derived.underReviewTotal.toFixed(2),
    refundedTotal: derived.refundedTotal.toFixed(2),
    balance: derived.balance.toFixed(2),
    credit: derived.credit.toFixed(2),
    light: derived.light,
    frozen: derived.frozen,
    overdueCount: derived.overdueCount,
    installments: derived.installments.map(serializeInstallment),
    nextInstallment: derived.nextInstallment
      ? serializeInstallment(derived.nextInstallment)
      : null,
    payments: plan.payments.map((p) => ({
      id: p.id,
      installmentId: p.installmentId,
      installmentNumber: p.installmentId
        ? (numberOf.get(p.installmentId) ?? null)
        : null,
      kind: p.kind,
      status: p.status,
      amount: p.amount.toString(),
      currency: p.currency,
      fxRateUsed: p.fxRateUsed?.toString() ?? null,
      amountInTripCurrency: p.amountInTripCurrency.toString(),
      transferDate: p.transferDate,
      method: p.method,
      proofFileId: p.proofFileId,
      reviewedAt: p.reviewedAt,
      notes: p.notes,
      createdAt: p.createdAt,
    })),
    balanceEquivalences: balanceEq.values.map((v) => ({
      currency: v.currency,
      amount: v.amount.toFixed(2),
    })),
    fxSnapshotDate: plan.fxSnapshotDate,
  };
}

// -------------------------- Generación del plan ----------------------------

/** Precio congelado del pasajero: su override, o el de lista según el cuarto. */
function planTotalFor(passenger: PassengerForPayments): string {
  if (passenger.priceOverride !== null) return passenger.priceOverride;

  const listed =
    passenger.roomType === "SINGLE"
      ? passenger.trip.priceSingle
      : passenger.trip.priceDouble;

  if (listed === null) {
    throw new PaymentError(
      "El viaje todavía no tiene fijado el precio para este tipo de habitación.",
      "SIN_PRECIO",
    );
  }
  return listed;
}

export interface PlanPreviewLine {
  number: number;
  dueDate: string;
  amount: string;
  afterDeparture: boolean;
}

export interface PlanPreview {
  totalAmount: string;
  currency: Currency;
  installments: PlanPreviewLine[];
  /** Números de cuota que vencen después de la salida. */
  lateInstallments: number[];
  /** Un plan ya existente que esta generación reemplazaría. */
  existingInstallmentCount: number | null;
  /** Tiene pagos confirmados: el plan es inmutable. */
  locked: boolean;
  fxSnapshotDate: string;
  fxStale: boolean;
}

/**
 * Propuesta de plan: montos e importes sugeridos, sin escribir nada.
 *
 * Es lo que alimenta la pantalla del coordinador antes de guardar. Las fechas
 * son sugerencias editables; los montos, en cambio, son los que se van a
 * guardar, porque el reparto al centavo no es negociable.
 */
export async function previewPaymentPlan(
  passengerId: string,
  installmentCount: number,
  now: Date = new Date(),
): Promise<PlanPreview> {
  const passenger = await getPassengerForPayments(passengerId);
  await requireCapability(passenger.tripId, "payment:definePlan");
  assertPlannable(passenger);

  const total = planTotalFor(passenger);
  const amounts = splitIntoInstallments(total, installmentCount);
  const dates = suggestDueDates(
    installmentCount,
    now,
    passenger.trip.startDate,
  );

  const existing = await prisma.paymentPlan.findUnique({
    where: { passengerId },
    select: {
      _count: { select: { installments: true } },
      payments: { where: { status: "CONFIRMADO" }, select: { id: true } },
    },
  });

  const { snapshot, stale } = await getFxSnapshot();

  return {
    totalAmount: toDecimal(total).toFixed(2),
    currency: passenger.trip.currency,
    installments: dates.map((d, index) => ({
      number: d.number,
      dueDate: toIsoDate(d.dueDate),
      amount: amounts[index]!.toFixed(2),
      afterDeparture: d.afterDeparture,
    })),
    lateInstallments: dates.filter((d) => d.afterDeparture).map((d) => d.number),
    existingInstallmentCount: existing?._count.installments ?? null,
    locked: (existing?.payments.length ?? 0) > 0,
    fxSnapshotDate: toIsoDate(snapshot.date),
    fxStale: stale,
  };
}

function assertPlannable(passenger: PassengerForPayments): void {
  // Un coordinador carga sus datos como cualquiera, pero no paga: su
  // alojamiento entra como costo indirecto del viaje (decisión 2).
  if (passenger.isCoordinator) {
    throw new PaymentError(
      "Un coordinador no genera plan de pagos.",
      "COORDINADOR",
    );
  }
  if (passenger.status === "CANCELADO") {
    throw new PaymentError(
      "El pasajero está cancelado: su plan queda congelado.",
      "CANCELADO",
    );
  }
}

/**
 * Crea el plan de pagos de un pasajero, o lo reemplaza.
 *
 * ── Qué se congela y por qué ──────────────────────────────────────────────
 *
 * `totalAmount` y `fxSnapshot` se guardan al crear y no se vuelven a tocar.
 * Si el coordinador sube el precio del viaje después, a quien ya tiene plan no
 * se le reescribe la deuda: pactó un precio y ese es el suyo. Lo mismo con la
 * cotización — un saldo que cambia solo porque se movió el euro es un saldo en
 * el que nadie confía.
 *
 * ── Cuándo se puede reemplazar ────────────────────────────────────────────
 *
 * Con un pago CONFIRMADO, nunca: reescribir las cuotas debajo de plata que ya
 * entró deja una imputación sin sentido. Con un comprobante EN_REVISION,
 * tampoco: al borrar las cuotas ese pago quedaría colgado de la nada. Sin
 * ninguna de las dos cosas, se puede, con confirmación explícita del
 * coordinador (`replaceExisting`) y su entrada en AuditLog.
 */
export async function generatePaymentPlan(
  passengerId: string,
  input: PaymentPlanInput,
  now: Date = new Date(),
): Promise<{ planId: string; replaced: boolean }> {
  const passenger = await getPassengerForPayments(passengerId);
  const viewer = await requireCapability(
    passenger.tripId,
    "payment:definePlan",
  );
  assertPlannable(passenger);

  const total = planTotalFor(passenger);

  // Los importes NO se toman del cliente: se recalculan acá. Las fechas sí
  // son las que mandó el coordinador, porque son suyas para decidir.
  const amounts = splitIntoInstallments(total, input.installmentCount);

  const existing = await prisma.paymentPlan.findUnique({
    where: { passengerId },
    select: {
      id: true,
      totalAmount: true,
      installmentCount: true,
      payments: { select: { id: true, status: true } },
    },
  });

  if (existing) {
    const confirmed = existing.payments.filter(
      (p) => p.status === "CONFIRMADO",
    ).length;
    if (confirmed > 0) {
      throw new PaymentError(
        "Este plan ya tiene pagos confirmados y no se puede modificar.",
        "PLAN_INMUTABLE",
        existing.installmentCount,
      );
    }
    const inReview = existing.payments.filter(
      (p) => p.status === "EN_REVISION",
    ).length;
    if (inReview > 0) {
      throw new PaymentError(
        "Hay un comprobante esperando revisión. Resolvelo antes de regenerar el plan.",
        "REVISION_PENDIENTE",
        existing.installmentCount,
      );
    }
    if (!input.replaceExisting) {
      throw new PaymentError(
        `Este pasajero ya tiene un plan de ${existing.installmentCount} cuotas.`,
        "PLAN_EXISTENTE",
        existing.installmentCount,
      );
    }
  }

  const { snapshot } = await getFxSnapshot();
  const fxSnapshot = {
    base: "USD" as const,
    date: toIsoDate(snapshot.date),
    rates: snapshot.rates,
  };

  const installmentData = input.installments.map((cuota, index) => ({
    number: cuota.number,
    dueDate: toBusinessDate(cuota.dueDate),
    amount: amounts[index]!.toFixed(2),
  }));

  const planId = await prisma.$transaction(async (tx) => {
    if (existing) {
      // Las cuotas viejas se borran; los pagos RECHAZADOS quedan con
      // installmentId en null (onDelete: SetNull) y conservan su historia.
      await tx.installment.deleteMany({ where: { planId: existing.id } });
      await tx.paymentPlan.update({
        where: { id: existing.id },
        data: {
          totalAmount: toDecimal(total).toFixed(2),
          currency: passenger.trip.currency,
          installmentCount: input.installmentCount,
          fxSnapshot,
          fxSnapshotDate: snapshot.date,
          installments: { create: installmentData },
        },
      });
      return existing.id;
    }

    const created = await tx.paymentPlan.create({
      data: {
        passengerId,
        totalAmount: toDecimal(total).toFixed(2),
        currency: passenger.trip.currency,
        installmentCount: input.installmentCount,
        fxSnapshot,
        fxSnapshotDate: snapshot.date,
        installments: { create: installmentData },
      },
      select: { id: true },
    });
    return created.id;
  });

  const late = lateDueDates(
    installmentData.map((i) => ({ number: i.number, dueDate: i.dueDate })),
    passenger.trip.startDate,
  );

  await recordAudit(viewer.userId, [
    {
      entity: "PaymentPlan",
      entityId: planId,
      field: "totalAmount",
      oldValue: existing ? auditMoney(existing.totalAmount) : null,
      newValue: auditMoney(total),
    },
    {
      entity: "PaymentPlan",
      entityId: planId,
      field: "installmentCount",
      oldValue: existing ? String(existing.installmentCount) : null,
      newValue: String(input.installmentCount),
    },
    ...(late.length > 0
      ? [
          {
            entity: "PaymentPlan",
            entityId: planId,
            field: "cuotasDespuesDeLaSalida",
            oldValue: null,
            newValue: late.join(", "),
          },
        ]
      : []),
  ]);

  // `now` no interviene en lo que se guarda: las fechas las mandó el
  // coordinador. Se recibe igual para que los tests fijen el reloj sin
  // depender del día en que corren.
  void now;

  return { planId, replaced: existing !== null };
}

// ---------------------- Carga de un pago (pasajero) ------------------------

/**
 * El pasajero declara una transferencia y sube el comprobante.
 *
 * Declara importe, moneda y fecha. NO declara tipo de cambio: no tiene por qué
 * saber a cuánto le liquidó el banco, y si se lo preguntáramos pondría la
 * cotización de Google, que no es la que salió de su cuenta.
 *
 * Igual hace falta un `amountInTripCurrency` desde el minuto cero, porque es
 * lo que muestra el renglón "en revisión". Se calcula con la cotización del
 * día como PROVISORIO —queda claro en pantalla que está en revisión— y el
 * coordinador lo pisa con el TC real del extracto al confirmar. Ese momento
 * queda auditado.
 */
export async function declarePayment(
  passengerId: string,
  input: DeclarePaymentInput,
): Promise<{ paymentId: string }> {
  const passenger = await getPassengerForPayments(passengerId);

  // Sin capability: el pasajero carga lo suyo. `getPassengerForPayments` ya
  // resolvió que este pasajero es visible para el viewer; falta que sea el
  // propio, o un coordinador cargándolo en su nombre.
  if (!passenger.isOwnRecord) {
    await requireCapability(passenger.tripId, "payment:review");
  }

  if (passenger.status === "CANCELADO") {
    throw new PaymentError(
      "El plan está congelado: el pasajero está cancelado.",
      "CANCELADO",
    );
  }

  const plan = await prisma.paymentPlan.findUnique({
    where: { passengerId },
    select: {
      id: true,
      currency: true,
      installments: { select: { id: true } },
    },
  });

  if (!plan) {
    throw new PaymentError(
      "Todavía no hay un plan de pagos para este pasajero.",
      "SIN_PLAN",
    );
  }

  // La cuota tiene que ser de ESTE plan. Sin este chequeo se podría imputar
  // un pago a la cuota de otra persona pasando su id.
  if (!plan.installments.some((i) => i.id === input.installmentId)) {
    throw new PaymentError(
      "Esa cuota no pertenece a este plan de pagos.",
      "CUOTA",
    );
  }

  // El comprobante se verifica contra el bucket: tipo y tamaño reales, no los
  // que declaró el navegador al pedir la URL firmada.
  const proofPath = await confirmUpload(passengerId, input.proofFileId);

  const tripCurrency = plan.currency as Currency;
  let provisionalRate: string | null = null;
  let amountInTripCurrency = toDecimal(input.amount).toFixed(2);

  if (input.currency !== tripCurrency) {
    const { snapshot } = await getFxSnapshot();
    provisionalRate = deriveRate(snapshot, input.currency, tripCurrency)
      .toDecimalPlaces(8)
      .toFixed(8);
    amountInTripCurrency = convert(
      input.amount,
      input.currency,
      tripCurrency,
      snapshot,
    ).toFixed(2);
  }

  const payment = await prisma.payment.create({
    data: {
      planId: plan.id,
      installmentId: input.installmentId,
      kind: "PAGO",
      amount: input.amount,
      currency: input.currency,
      fxRateUsed: provisionalRate,
      amountInTripCurrency,
      transferDate: toBusinessDate(input.transferDate),
      method: METHOD_TRANSFER,
      proofFileId: proofPath,
      status: "EN_REVISION",
    },
    select: { id: true },
  });

  return { paymentId: payment.id };
}

// ----------------------------- Revisión ------------------------------------

export interface PendingReview {
  paymentId: string;
  passengerId: string;
  passengerName: string | null;
  installmentNumber: number | null;
  installmentAmount: string | null;
  installmentDueDate: Date | null;
  amount: string;
  currency: Currency;
  tripCurrency: Currency;
  /** Conversión provisoria con la cotización del día que se cargó. */
  provisionalAmountInTripCurrency: string;
  /** Cotización del día de HOY, como sugerencia para el campo de TC. */
  suggestedFxRate: string | null;
  transferDate: Date;
  proofFileId: string | null;
  createdAt: Date;
}

/**
 * Cola de comprobantes esperando revisión, de todo el viaje.
 *
 * Los nombres salen de `listPassengersForPayments`, no de una consulta a
 * Person desde acá.
 */
export async function listPendingReviews(
  tripId: string,
): Promise<PendingReview[]> {
  await requireCapability(tripId, "payment:review");

  const passengers = await listPassengersForPayments(tripId);
  const nameOf = new Map(passengers.map((p) => [p.id, p.fullName]));

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { currency: true },
  });

  const payments = await prisma.payment.findMany({
    where: {
      status: "EN_REVISION",
      plan: { passengerId: { in: passengers.map((p) => p.id) } },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amount: true,
      currency: true,
      amountInTripCurrency: true,
      transferDate: true,
      proofFileId: true,
      createdAt: true,
      plan: { select: { passengerId: true } },
      installment: { select: { number: true, amount: true, dueDate: true } },
    },
  });

  if (payments.length === 0) return [];

  // Una sola consulta de cotización para toda la cola, no una por fila.
  const { snapshot } = await getFxSnapshot();

  return payments.map((p) => ({
    paymentId: p.id,
    passengerId: p.plan.passengerId,
    passengerName: nameOf.get(p.plan.passengerId) ?? null,
    installmentNumber: p.installment?.number ?? null,
    installmentAmount: p.installment?.amount.toString() ?? null,
    installmentDueDate: p.installment?.dueDate ?? null,
    amount: p.amount.toString(),
    currency: p.currency as Currency,
    tripCurrency: trip.currency as Currency,
    provisionalAmountInTripCurrency: p.amountInTripCurrency.toString(),
    suggestedFxRate:
      p.currency === trip.currency
        ? null
        : suggestRate(snapshot, p.currency as Currency, trip.currency as Currency),
    transferDate: p.transferDate,
    proofFileId: p.proofFileId,
    createdAt: p.createdAt,
  }));
}

function suggestRate(
  snapshot: FxSnapshot,
  from: Currency,
  to: Currency,
): string {
  return deriveRate(snapshot, from, to).toDecimalPlaces(8).toFixed(8);
}

/** Resuelve el pasajero dueño de un pago, sin tocar Passenger desde acá. */
async function paymentContext(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      kind: true,
      amount: true,
      currency: true,
      fxRateUsed: true,
      amountInTripCurrency: true,
      installmentId: true,
      plan: { select: { id: true, passengerId: true, currency: true } },
    },
  });

  // 404, no 403: confirmarle a alguien que ese pago existe ya es información.
  if (!payment) throw new ForbiddenError();

  const passenger = await getPassengerForPayments(payment.plan.passengerId);
  return { payment, passenger };
}

export type ReviewOutcome = "APLICADO" | "YA_RESUELTO";

/**
 * Confirma un pago.
 *
 * ── Idempotencia ──────────────────────────────────────────────────────────
 *
 * Doble click, o dos coordinadores mirando la misma cola: la confirmación no
 * puede imputar el pago dos veces. Se resuelve en la BASE, con un UPDATE
 * condicionado al estado anterior:
 *
 *     UPDATE "Payment" SET status='CONFIRMADO' WHERE id=? AND status='EN_REVISION'
 *
 * Postgres serializa las dos ejecuciones sobre la fila: la segunda reevalúa el
 * WHERE después de que la primera commiteó, no encuentra nada y afecta 0
 * filas. No hace falta un lock explícito ni un chequeo previo en la aplicación
 * —que sería justamente el que tiene la ventana de carrera entre el SELECT y
 * el UPDATE—.
 *
 * Y hay una segunda razón por la que esto no puede duplicar plata: lo pagado
 * de una cuota no es un contador que se incrementa, es la SUMA de los pagos
 * confirmados, recalculada al leer. Aunque el UPDATE corriera dos veces, el
 * conjunto de pagos confirmados sería el mismo. El CAS existe para que no se
 * duplique el AuditLog ni se "desrechace" un pago ya rechazado.
 */
export async function confirmPayment(
  input: ConfirmPaymentInput,
): Promise<ReviewOutcome> {
  const { payment, passenger } = await paymentContext(input.paymentId);
  const viewer = await requireCapability(passenger.tripId, "payment:review");

  if (payment.kind !== "PAGO") {
    throw new PaymentError("Un reembolso no se confirma acá.", "ESTADO");
  }

  const tripCurrency = payment.plan.currency as Currency;
  const paymentCurrency = payment.currency as Currency;

  // La necesidad del TC se decide contra la moneda REAL del pago guardada en
  // la base, no contra lo que venga en el input.
  if (paymentCurrency !== tripCurrency && input.fxRateUsed === null) {
    throw new PaymentError(
      "El pago está en otra moneda: ingresá el tipo de cambio del extracto.",
      "TC_FALTANTE",
    );
  }

  const fxRateUsed =
    paymentCurrency === tripCurrency ? null : input.fxRateUsed;
  const imputed = impute(
    payment.amount.toString(),
    paymentCurrency,
    tripCurrency,
    fxRateUsed,
  );

  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: "EN_REVISION" },
    data: {
      status: "CONFIRMADO",
      fxRateUsed,
      amountInTripCurrency: imputed.toFixed(2),
      reviewedById: viewer.userId,
      reviewedAt: new Date(),
      notes: input.notes,
    },
  });

  // Alguien llegó primero. No es un error: el resultado que el usuario quería
  // ya está. Se corta acá para no duplicar la auditoría.
  if (count === 0) return "YA_RESUELTO";

  await recordAudit(viewer.userId, [
    {
      entity: "Payment",
      entityId: payment.id,
      field: "status",
      oldValue: "EN_REVISION",
      newValue: "CONFIRMADO",
    },
    {
      entity: "Payment",
      entityId: payment.id,
      field: "fxRateUsed",
      oldValue: auditMoney(payment.fxRateUsed),
      newValue: auditMoney(fxRateUsed),
    },
    {
      entity: "Payment",
      entityId: payment.id,
      field: "amountInTripCurrency",
      oldValue: auditMoney(payment.amountInTripCurrency),
      newValue: auditMoney(imputed),
    },
  ]);

  return "APLICADO";
}

/**
 * Rechaza un pago. El motivo es obligatorio y se le notifica al pasajero.
 *
 * "Rechazado" a secas no es información: es alguien mirando su plata sin saber
 * si tiene que volver a transferir, mandar otro comprobante o llamar por
 * teléfono.
 */
export async function rejectPayment(
  input: RejectPaymentInput,
): Promise<ReviewOutcome> {
  const { payment, passenger } = await paymentContext(input.paymentId);
  const viewer = await requireCapability(passenger.tripId, "payment:review");

  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: "EN_REVISION" },
    data: {
      status: "RECHAZADO",
      reviewedById: viewer.userId,
      reviewedAt: new Date(),
      notes: input.reason,
    },
  });

  if (count === 0) return "YA_RESUELTO";

  await recordAudit(viewer.userId, [
    {
      entity: "Payment",
      entityId: payment.id,
      field: "status",
      oldValue: "EN_REVISION",
      newValue: "RECHAZADO",
    },
    {
      entity: "Payment",
      entityId: payment.id,
      field: "motivoRechazo",
      oldValue: null,
      newValue: input.reason,
    },
  ]);

  return "APLICADO";
}

/**
 * Deshace una confirmación hecha por error.
 *
 * Decisión tomada: se puede, con motivo obligatorio y AuditLog. La alternativa
 * purista —dejar la confirmación quieta y compensar con un asiento inverso— es
 * más limpia contablemente, pero le pide a alguien que apretó el botón
 * equivocado a las once de la noche que entienda partida doble para arreglarlo.
 *
 * El pago vuelve a EN_REVISION, no a un limbo: reaparece en la cola y alguien
 * lo tiene que resolver. El TC y el importe imputado se limpian, porque eran
 * parte de la decisión que se está deshaciendo; el importe queda con la
 * conversión provisoria para que el renglón no muestre un cero engañoso.
 *
 * La reversión también es idempotente: mismo UPDATE condicionado.
 */
export async function revertPayment(
  input: RevertPaymentInput,
): Promise<ReviewOutcome> {
  const { payment, passenger } = await paymentContext(input.paymentId);
  const viewer = await requireCapability(passenger.tripId, "payment:review");

  const tripCurrency = payment.plan.currency as Currency;
  const paymentCurrency = payment.currency as Currency;

  let provisional = payment.amount.toString();
  let provisionalRate: string | null = null;
  if (paymentCurrency !== tripCurrency) {
    const { snapshot } = await getFxSnapshot();
    provisionalRate = suggestRate(snapshot, paymentCurrency, tripCurrency);
    provisional = convert(
      payment.amount.toString(),
      paymentCurrency,
      tripCurrency,
      snapshot,
    ).toFixed(2);
  }

  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: "CONFIRMADO" },
    data: {
      status: "EN_REVISION",
      fxRateUsed: provisionalRate,
      amountInTripCurrency: toDecimal(provisional).toFixed(2),
      reviewedById: null,
      reviewedAt: null,
      notes: input.reason,
    },
  });

  if (count === 0) return "YA_RESUELTO";

  await recordAudit(viewer.userId, [
    {
      entity: "Payment",
      entityId: payment.id,
      field: "status",
      oldValue: "CONFIRMADO",
      newValue: "EN_REVISION",
    },
    {
      entity: "Payment",
      entityId: payment.id,
      field: "motivoReversion",
      oldValue: null,
      newValue: input.reason,
    },
    {
      entity: "Payment",
      entityId: payment.id,
      field: "amountInTripCurrency",
      oldValue: auditMoney(payment.amountInTripCurrency),
      newValue: auditMoney(provisional),
    },
  ]);

  return "APLICADO";
}

// ------------------------------ Reembolso ----------------------------------

/**
 * Registra un reembolso.
 *
 * Cuelga del PaymentPlan y NO de una cuota (decisión 6): no altera el estado
 * de ninguna. Devolverle plata a alguien no "descobra" la cuota 2; son dos
 * hechos distintos y mezclarlos haría que una cuota saldada volviera a
 * aparecer como pendiente.
 */
export async function registerRefund(
  passengerId: string,
  input: RefundInput,
): Promise<{ paymentId: string }> {
  const passenger = await getPassengerForPayments(passengerId);
  const viewer = await requireCapability(passenger.tripId, "payment:review");

  const plan = await prisma.paymentPlan.findUnique({
    where: { passengerId },
    select: { id: true, currency: true },
  });
  if (!plan) {
    throw new PaymentError("Este pasajero no tiene plan de pagos.", "SIN_PLAN");
  }

  const payment = await prisma.payment.create({
    data: {
      planId: plan.id,
      installmentId: null,
      kind: "REEMBOLSO",
      amount: input.amount,
      currency: plan.currency,
      amountInTripCurrency: toDecimal(input.amount).toFixed(2),
      transferDate: toBusinessDate(input.transferDate),
      method: METHOD_TRANSFER,
      status: "CONFIRMADO",
      reviewedById: viewer.userId,
      reviewedAt: new Date(),
      notes: input.reason,
    },
    select: { id: true },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Payment",
      entityId: payment.id,
      field: "reembolso",
      oldValue: null,
      newValue: `${toDecimal(input.amount).toFixed(2)} ${plan.currency} · ${input.reason}`,
    },
  ]);

  return { paymentId: payment.id };
}

// -------------------------- Vista del coordinador --------------------------

export interface TripPaymentRow {
  passengerId: string;
  fullName: string | null;
  status: string;
  light: PaymentLight;
  hasPlan: boolean;
  totalAmount: string;
  paidTotal: string;
  balance: string;
  underReviewTotal: string;
  credit: string;
  overdueCount: number;
  nextDueDate: Date | null;
  nextInstallmentNumber: number | null;
}

export interface TripPaymentsOverview {
  currency: Currency;
  rows: TripPaymentRow[];
  /** Suma de lo confirmado en todo el viaje. */
  collected: string;
  /** Suma de los totales de los planes generados. */
  expected: string;
  /** Plata esperando revisión. */
  underReview: string;
  passengersWithoutPlan: number;
  light: PaymentLight;
  pendingReviewCount: number;
}

/**
 * Estado de pagos de todo el viaje.
 *
 * El semáforo de cada fila sale de la MISMA `derivePlan()` que usa la ficha
 * individual. Si el listado tuviera su propio cálculo, tarde o temprano
 * mostraría verde donde la ficha muestra rojo y nadie sabría a cuál creerle.
 */
export async function getTripPaymentsOverview(
  tripId: string,
  now: Date = new Date(),
): Promise<TripPaymentsOverview> {
  await requireCapability(tripId, "payment:review");

  const [trip, passengers] = await Promise.all([
    prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { currency: true, paymentToleranceAmount: true },
    }),
    listPassengersForPayments(tripId),
  ]);

  const plans = await prisma.paymentPlan.findMany({
    where: { passengerId: { in: passengers.map((p) => p.id) } },
    select: {
      passengerId: true,
      totalAmount: true,
      installments: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, dueDate: true, amount: true },
      },
      payments: {
        select: {
          id: true,
          installmentId: true,
          kind: true,
          status: true,
          amountInTripCurrency: true,
        },
      },
    },
  });

  const planOf = new Map(plans.map((p) => [p.passengerId, p]));
  const tolerance = trip.paymentToleranceAmount.toString();

  const rows: TripPaymentRow[] = passengers.map((passenger) => {
    const plan = planOf.get(passenger.id);

    if (!plan) {
      return {
        passengerId: passenger.id,
        fullName: passenger.fullName,
        status: passenger.status,
        light: "NEUTRO" as const,
        hasPlan: false,
        totalAmount: "0.00",
        paidTotal: "0.00",
        balance: "0.00",
        underReviewTotal: "0.00",
        credit: "0.00",
        overdueCount: 0,
        nextDueDate: null,
        nextInstallmentNumber: null,
      };
    }

    const derived = derivePlan({
      totalAmount: plan.totalAmount.toString(),
      installments: plan.installments.map((i) => ({
        id: i.id,
        number: i.number,
        dueDate: i.dueDate,
        amount: i.amount.toString(),
      })),
      payments: toPaymentInputs(plan.payments),
      today: now,
      frozen: passenger.status === "CANCELADO",
      tolerance,
    });

    return {
      passengerId: passenger.id,
      fullName: passenger.fullName,
      status: passenger.status,
      light: derived.light,
      hasPlan: true,
      totalAmount: derived.totalAmount.toFixed(2),
      paidTotal: derived.paidTotal.toFixed(2),
      balance: derived.balance.toFixed(2),
      underReviewTotal: derived.underReviewTotal.toFixed(2),
      credit: derived.credit.toFixed(2),
      overdueCount: derived.overdueCount,
      nextDueDate: derived.nextInstallment?.dueDate ?? null,
      nextInstallmentNumber: derived.nextInstallment?.number ?? null,
    };
  });

  const withPlan = rows.filter((r) => r.hasPlan);

  return {
    currency: trip.currency as Currency,
    rows,
    collected: roundToCents(sum(withPlan.map((r) => r.paidTotal))).toFixed(2),
    expected: roundToCents(sum(withPlan.map((r) => r.totalAmount))).toFixed(2),
    underReview: roundToCents(
      sum(withPlan.map((r) => r.underReviewTotal)),
    ).toFixed(2),
    passengersWithoutPlan: rows.filter(
      (r) => !r.hasPlan && r.status !== "CANCELADO",
    ).length,
    light: worstLight(withPlan.map((r) => r.light)),
    pendingReviewCount: withPlan.filter((r) =>
      toDecimal(r.underReviewTotal).greaterThan(ZERO),
    ).length,
  };
}

// ------------------------------ Comprobantes -------------------------------

/**
 * URL temporal para ver un comprobante.
 *
 * La autorización la impone `createSignedDownloadUrl`, que exige acceso de
 * lectura al PASAJERO dueño del archivo y verifica que la path caiga dentro de
 * su carpeta. Un pasajero pidiendo el comprobante de otro no llega ni a
 * generar la URL.
 */
export async function getProofUrl(paymentId: string): Promise<string> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { proofFileId: true, plan: { select: { passengerId: true } } },
  });

  if (!payment?.proofFileId) throw new ForbiddenError();

  return createSignedDownloadUrl(payment.plan.passengerId, payment.proofFileId);
}

export { MAX_INSTALLMENTS };
export type { PaymentLight };
