import {
  roundToCents,
  sum,
  toDecimal,
  ZERO,
  type Decimal,
  type MoneyInput,
} from "./money";
import type { Currency } from "./fx";

/**
 * Motor de pagos: armado del plan de cuotas y derivación de su estado.
 *
 * Funciones puras. No conocen Prisma, ni React, ni la base. Reciben strings y
 * devuelven Decimals, y por eso se pueden testear exhaustivamente sin levantar
 * nada. Están en tests/domain/payments.test.ts.
 *
 * ── La decisión central de este módulo ────────────────────────────────────
 *
 * El estado de una cuota NO se guarda. Se DERIVA cada vez que se lee, a
 * partir de tres cosas: su vencimiento, los pagos confirmados que la cubren y
 * la fecha de hoy.
 *
 * El motivo no es purismo. Un campo `status` persistido depende de que un cron
 * lo haya actualizado, y Vercel Cron tiene una ventana de ejecución de ~1
 * hora. Eso significa que el día que una cuota vence —el único día en que el
 * semáforo realmente importa— el campo diría PENDIENTE durante un rato
 * indeterminado. Un semáforo que miente justo cuando hace falta es peor que no
 * tener semáforo. Derivado, no puede desincronizarse: no hay nada que
 * sincronizar.
 *
 * Lo único que sí se persiste sobre el paso del tiempo es `SentReminder`, y
 * solo responde "¿ya mandamos este aviso?", nunca "¿está vencida?".
 */

// --------------------------- Armado del plan -------------------------------

export const MIN_INSTALLMENTS = 1;
export const MAX_INSTALLMENTS = 6;

/** Días antes de la salida en que vence, por default, la última cuota. */
const DAYS_BEFORE_DEPARTURE = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normaliza a medianoche UTC: las fechas de negocio no tienen hora. */
export function atUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(atUtcMidnight(date).getTime() + days * MS_PER_DAY);
}

/** Días enteros de `from` a `to`. Negativo si `to` ya pasó. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (atUtcMidnight(to).getTime() - atUtcMidnight(from).getTime()) / MS_PER_DAY,
  );
}

export class PaymentPlanError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "CANTIDAD_CUOTAS"
      | "MONTO"
      | "INMUTABLE"
      | "SIN_PRECIO"
      | "COORDINADOR"
      | "CANCELADO",
  ) {
    super(message);
    this.name = "PaymentPlanError";
  }
}

/**
 * Reparte un total en N cuotas, al centavo, sin perder ni inventar plata.
 *
 * £3.499,43 en 3 cuotas da 1.166,476666… Ninguna forma de redondear las tres
 * por igual suma el total: 1.166,48 × 3 = 3.499,44 (un centavo de más),
 * 1.166,47 × 3 = 3.499,41 (dos de menos). La plata tiene que cerrar exacto, y
 * la única manera es que alguien absorba la diferencia.
 *
 * Absorbe la ÚLTIMA. Es la que está más lejos en el tiempo, la más fácil de
 * ajustar si algo cambia, y la que el pasajero mira cuando ya pagó el resto.
 * Que la diferencia caiga en la primera —la que se paga ahora, la que se
 * compara con lo que dijo el coordinador— sería peor.
 *
 * Invariante que el test verifica para N de 1 a 6 y para montos feos:
 * `sum(splitIntoInstallments(total, n)) === total`, exacto.
 */
export function splitIntoInstallments(
  total: MoneyInput,
  count: number,
): Decimal[] {
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    throw new PaymentPlanError(
      `La cantidad de cuotas debe ser un entero entre ${MIN_INSTALLMENTS} y ${MAX_INSTALLMENTS}, recibido: ${count}`,
      "CANTIDAD_CUOTAS",
    );
  }

  const amount = roundToCents(total);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new PaymentPlanError(
      `El monto total del plan debe ser positivo, recibido: ${String(total)}`,
      "MONTO",
    );
  }

  const base = amount.dividedBy(count).toDecimalPlaces(2);
  const head = Array.from({ length: count - 1 }, () => base);
  // La última NO se calcula: se despeja. Así el error de redondeo no se
  // acumula, queda acotado a esta cuota y la suma cierra por construcción.
  const last = amount.minus(base.times(count - 1));

  return [...head, last];
}

export interface SuggestedDueDate {
  number: number;
  dueDate: Date;
  /** La cuota vence después de que el viaje ya arrancó. */
  afterDeparture: boolean;
}

/**
 * Fechas de vencimiento sugeridas, repartidas entre hoy y la salida.
 *
 * La última apunta a una semana antes de la salida: cobrar el mismo día de
 * partir no le sirve a nadie. Las anteriores se reparten parejo en ese
 * intervalo.
 *
 * Son SUGERENCIAS: el coordinador las edita todas. Y si el viaje sale tan
 * pronto que no entran N cuotas antes de la salida, no se inventa nada ni se
 * falla: se separan un día entre sí y las que caen tarde vuelven marcadas con
 * `afterDeparture`, para que la pantalla lo advierta en vez de esconderlo.
 */
export function suggestDueDates(
  count: number,
  today: Date,
  tripStartDate: Date,
): SuggestedDueDate[] {
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    throw new PaymentPlanError(
      `La cantidad de cuotas debe ser un entero entre ${MIN_INSTALLMENTS} y ${MAX_INSTALLMENTS}, recibido: ${count}`,
      "CANTIDAD_CUOTAS",
    );
  }

  const from = atUtcMidnight(today);
  const start = atUtcMidnight(tripStartDate);
  const target = addDaysUtc(start, -DAYS_BEFORE_DEPARTURE);

  // Ancho útil de la ventana. Si el viaje ya salió o sale pasado mañana, es 0
  // y todas las cuotas caen consecutivas a partir de mañana.
  const span = Math.max(0, daysBetween(from, target));

  const dates: Date[] = [];
  let previous = from;

  for (let i = 1; i <= count; i += 1) {
    const offset = Math.round((span * i) / count);
    let candidate = addDaysUtc(from, offset);
    // Dos cuotas el mismo día no son dos cuotas. Con la ventana apretada se
    // separan un día, aun a costa de pasarse de la salida: eso se advierte.
    if (candidate.getTime() <= previous.getTime()) {
      candidate = addDaysUtc(previous, 1);
    }
    dates.push(candidate);
    previous = candidate;
  }

  return dates.map((dueDate, index) => ({
    number: index + 1,
    dueDate,
    afterDeparture: dueDate.getTime() >= start.getTime(),
  }));
}

/** Cuotas cuyo vencimiento cae después de la salida. Alimenta la advertencia. */
export function lateDueDates(
  dueDates: readonly { number: number; dueDate: Date }[],
  tripStartDate: Date,
): number[] {
  const start = atUtcMidnight(tripStartDate);
  return dueDates
    .filter((d) => atUtcMidnight(d.dueDate).getTime() >= start.getTime())
    .map((d) => d.number);
}

// ------------------------ Derivación del estado ----------------------------

export type InstallmentState =
  | "PAGADA"
  | "VENCIDA"
  | "EN_REVISION"
  | "PENDIENTE"
  /** El pasajero está CANCELADO: el plan quedó congelado. */
  | "CONGELADA";

export type PaymentLight = "VERDE" | "AMARILLO" | "ROJO" | "NEUTRO";

/** Días de anticipación con que una cuota próxima pone el semáforo en amarillo. */
export const SOON_DAYS = 7;

/** Tolerancia por default: una unidad de la moneda del viaje. */
export const DEFAULT_TOLERANCE = "1.00";

export interface InstallmentInput {
  id: string;
  number: number;
  dueDate: Date;
  amount: MoneyInput;
}

export interface PaymentInput {
  id: string;
  installmentId: string | null;
  kind: "PAGO" | "REEMBOLSO";
  status: "EN_REVISION" | "CONFIRMADO" | "RECHAZADO";
  /** Importe ya expresado en la moneda del viaje. */
  amountInTripCurrency: MoneyInput;
}

export interface DerivedInstallment {
  id: string;
  number: number;
  dueDate: Date;
  amount: Decimal;
  /** Suma de pagos CONFIRMADOS imputados a esta cuota. */
  paid: Decimal;
  /** Suma de pagos EN_REVISION imputados a esta cuota. */
  underReview: Decimal;
  /** Lo que falta para cubrirla. Cero si está saldada. */
  remaining: Decimal;
  /** Lo pagado de más en ESTA cuota. Queda como crédito, no se imputa solo. */
  excess: Decimal;
  state: InstallmentState;
  /** Vencida según la definición: sin cubrir y con el vencimiento pasado. */
  overdue: boolean;
  /** Tiene un comprobante esperando revisión. Convive con `overdue`. */
  hasPendingProof: boolean;
  /** Días hasta el vencimiento. Negativo si ya pasó. */
  daysUntilDue: number;
}

export interface DerivePlanInput {
  totalAmount: MoneyInput;
  installments: readonly InstallmentInput[];
  payments: readonly PaymentInput[];
  /** Hoy. Se inyecta para poder testear los bordes. */
  today: Date;
  /**
   * El plan de un pasajero CANCELADO se congela: no genera vencidas ni
   * recordatorios. La plata que ya entró se sigue viendo.
   */
  frozen?: boolean;
  /** Tolerancia al cubrir una cuota. Default: 1 unidad de la moneda. */
  tolerance?: MoneyInput;
}

export interface DerivedPlan {
  totalAmount: Decimal;
  installments: DerivedInstallment[];
  frozen: boolean;
  /** Suma de PAGOS confirmados del plan, imputados o no. */
  paidTotal: Decimal;
  /** Suma de pagos EN_REVISION. Es lo que el coordinador tiene en la cola. */
  underReviewTotal: Decimal;
  /** Reembolsos confirmados. No alteran el estado de ninguna cuota. */
  refundedTotal: Decimal;
  /** `totalAmount − paidTotal`. Cero si ya está todo cubierto. */
  balance: Decimal;
  /** Excedente acumulado. Visible, nunca imputado automáticamente. */
  credit: Decimal;
  /** Primera cuota sin saldar. `null` si no queda ninguna. */
  nextInstallment: DerivedInstallment | null;
  light: PaymentLight;
  overdueCount: number;
}

function amountsOf(
  payments: readonly PaymentInput[],
  predicate: (p: PaymentInput) => boolean,
): Decimal {
  return sum(
    payments
      .filter(predicate)
      .map((p) => toDecimal(p.amountInTripCurrency).toString()),
  );
}

/**
 * Estado completo de un plan de pagos, derivado en el momento de leer.
 *
 * Una cuota está PAGADA cuando lo confirmado alcanza su monto con una
 * tolerancia: la comisión que cobra el banco intermediario hace que lleguen
 * £1.329,20 de una cuota de £1.330, y perseguir esos 80 peniques cuesta más
 * de lo que valen. La tolerancia aplica solo por defecto (falta plata), nunca
 * al revés: lo que entra de más es crédito, exacto, hasta el último centavo.
 */
export function derivePlan(input: DerivePlanInput): DerivedPlan {
  const {
    installments,
    payments,
    today,
    frozen = false,
    tolerance = DEFAULT_TOLERANCE,
  } = input;

  const totalAmount = roundToCents(input.totalAmount);
  const slack = toDecimal(tolerance);
  const todayUtc = atUtcMidnight(today);

  const confirmedPayments = payments.filter(
    (p) => p.kind === "PAGO" && p.status === "CONFIRMADO",
  );
  const reviewPayments = payments.filter(
    (p) => p.kind === "PAGO" && p.status === "EN_REVISION",
  );

  const derived: DerivedInstallment[] = [...installments]
    .sort((a, b) => a.number - b.number)
    .map((installment) => {
      const amount = roundToCents(installment.amount);
      const paid = amountsOf(
        confirmedPayments,
        (p) => p.installmentId === installment.id,
      );
      const underReview = amountsOf(
        reviewPayments,
        (p) => p.installmentId === installment.id,
      );

      const covered = paid.greaterThanOrEqualTo(amount.minus(slack));
      const daysUntilDue = daysBetween(todayUtc, installment.dueDate);
      // La definición, tal cual: sin pago confirmado que la cubra Y vencida.
      // Un comprobante en revisión NO la limpia: todavía no entró la plata.
      const overdue = !covered && !frozen && daysUntilDue < 0;
      const hasPendingProof = underReview.greaterThan(0);

      const state: InstallmentState = covered
        ? "PAGADA"
        : frozen
          ? "CONGELADA"
          : overdue
            ? "VENCIDA"
            : hasPendingProof
              ? "EN_REVISION"
              : "PENDIENTE";

      return {
        id: installment.id,
        number: installment.number,
        dueDate: atUtcMidnight(installment.dueDate),
        amount,
        paid: roundToCents(paid),
        underReview: roundToCents(underReview),
        remaining: covered ? ZERO : roundToCents(amount.minus(paid)),
        excess: paid.greaterThan(amount)
          ? roundToCents(paid.minus(amount))
          : ZERO,
        state,
        overdue,
        hasPendingProof,
        daysUntilDue,
      };
    });

  const paidTotal = roundToCents(amountsOf(confirmedPayments, () => true));
  const underReviewTotal = roundToCents(amountsOf(reviewPayments, () => true));
  const refundedTotal = roundToCents(
    amountsOf(
      payments,
      (p) => p.kind === "REEMBOLSO" && p.status === "CONFIRMADO",
    ),
  );

  // Crédito: lo pagado de más en cada cuota, más lo confirmado que entró sin
  // imputar a ninguna. Se muestra y se acumula; imputarlo a la cuota que sigue
  // es una decisión del coordinador, no un automatismo.
  const unallocated = amountsOf(
    confirmedPayments,
    (p) => p.installmentId === null,
  );
  const credit = roundToCents(
    sum(derived.map((i) => i.excess.toString())).plus(unallocated),
  );

  const balance = paidTotal.greaterThanOrEqualTo(totalAmount)
    ? ZERO
    : roundToCents(totalAmount.minus(paidTotal));

  const pending = derived.filter((i) => i.state !== "PAGADA");
  const overdueCount = derived.filter((i) => i.overdue).length;

  const soon = pending.some(
    (i) => i.daysUntilDue >= 0 && i.daysUntilDue <= SOON_DAYS,
  );
  const anyUnderReview = derived.some((i) => i.hasPendingProof);

  const light: PaymentLight = frozen
    ? "NEUTRO"
    : overdueCount > 0
      ? "ROJO"
      : anyUnderReview || soon
        ? "AMARILLO"
        : "VERDE";

  return {
    totalAmount,
    installments: derived,
    frozen,
    paidTotal,
    underReviewTotal,
    refundedTotal,
    balance,
    credit,
    nextInstallment: pending[0] ?? null,
    light,
    overdueCount,
  };
}

/**
 * Semáforo de un viaje entero, a partir del de cada pasajero.
 *
 * Es la MISMA función que alimenta la ficha individual: el listado no
 * recalcula nada por su cuenta. Si fueran dos implementaciones, el listado
 * mostraría verde y la ficha rojo, y nadie sabría cuál creer.
 */
export function worstLight(lights: readonly PaymentLight[]): PaymentLight {
  if (lights.some((l) => l === "ROJO")) return "ROJO";
  if (lights.some((l) => l === "AMARILLO")) return "AMARILLO";
  if (lights.some((l) => l === "VERDE")) return "VERDE";
  return "NEUTRO";
}

// ------------------------------ Imputación ---------------------------------

/**
 * Importe imputado en la moneda del viaje.
 *
 * Si el pasajero pagó en la moneda del viaje no hay conversión ni tipo de
 * cambio: el importe es el que declaró. Si pagó en otra, el coordinador
 * ingresa el TC REAL del extracto bancario —no la cotización del día, que es
 * apenas una sugerencia— y el sistema hace la cuenta. La cotización de
 * mercado y lo que efectivamente liquidó el banco no son el mismo número, y
 * el que importa para la imputación es el segundo.
 */
export function impute(
  amount: MoneyInput,
  paymentCurrency: Currency,
  tripCurrency: Currency,
  fxRateUsed: MoneyInput | null,
): Decimal {
  if (paymentCurrency === tripCurrency) {
    return roundToCents(amount);
  }
  if (fxRateUsed === null || fxRateUsed === undefined) {
    throw new PaymentPlanError(
      "Falta el tipo de cambio: el pago está en otra moneda que el viaje.",
      "MONTO",
    );
  }
  const rate = toDecimal(fxRateUsed);
  if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) {
    throw new PaymentPlanError(
      `Tipo de cambio inválido: ${String(fxRateUsed)}`,
      "MONTO",
    );
  }
  return roundToCents(toDecimal(amount).times(rate));
}
