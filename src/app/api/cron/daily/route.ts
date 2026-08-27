import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { purgeExpiredRateLimitHits } from "@/lib/auth/rate-limit";
import { getFxSnapshot } from "@/lib/services/fx";
import { processScheduledCommunications } from "@/lib/services/communications";
import {
  sendPassportAlerts,
  sendPaymentReminders,
  type TaskBudget,
} from "@/lib/services/reminders";

/**
 * Cron diario.
 *
 * ── Autenticación ─────────────────────────────────────────────────────────
 *
 * `Authorization: Bearer <CRON_SECRET>`, comparado en tiempo constante. Sin
 * cabecera o con un secreto que no coincide, 401 y no se toca nada. Es la
 * única autorización de todo el camino: las tareas de abajo corren sin sesión
 * y no vuelven a preguntar quién las llamó, así que este chequeo es la puerta.
 *
 * ── Por qué POST y no GET ────────────────────────────────────────────────
 *
 * Manda mails y escribe en la base. Un GET es cacheable, lo dispara un
 * prefetch del navegador y aparece entero —con el secreto— en cualquier log de
 * accesos que registre la URL. Vercel Cron soporta POST.
 *
 * ── Ninguna tarea puede tumbar a las otras ───────────────────────────────
 *
 * Cada una corre en su propio try/catch. Si la API de cotizaciones está caída,
 * los recordatorios salen igual; si una comunicación tiene un destinatario
 * roto, la purga de rate limiting se hace igual. La respuesta dice qué hizo
 * cada una y cuál falló, porque el resumen es lo único que alguien va a mirar
 * cuando quiera saber si el cron está sano.
 *
 * ── Corte y retome ───────────────────────────────────────────────────────
 *
 * Vercel Hobby corta las funciones a los ~10 s. Nada de esto asume que
 * termina: hay un presupuesto de mails y un instante límite, y lo que queda a
 * medio hacer vuelve a aparecer mañana porque su marca no se llegó a escribir.
 * `remaining: true` en el resumen es información, no un error.
 */

/** Margen contra el corte de la plataforma. */
const RUN_BUDGET_MS = 8_000;

/**
 * Tope de mails por corrida.
 *
 * El free tier de Brevo son 300 por día, y este grupo son 14 pasajeros: el
 * límite real es el tiempo, no la cuota. El número está para que un error de
 * datos —mil cuotas vencidas por una migración mal hecha— no se convierta en
 * mil mails antes de que alguien lo note.
 */
const MAX_EMAILS_PER_RUN = 60;

export const dynamic = "force-dynamic";

interface TaskReport {
  task: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const startedAt = Date.now();
  const deadline = startedAt + RUN_BUDGET_MS;
  const now = new Date();
  const tasks: TaskReport[] = [];

  /** Presupuesto restante para la tarea que sigue. */
  let emailsLeft = MAX_EMAILS_PER_RUN;
  const budget = (): TaskBudget => ({ maxEmails: emailsLeft, deadline });

  // 1 — Cotizaciones. Va primero porque el resto puede mostrar importes.
  await run(tasks, "cotizaciones", async () => {
    const { snapshot, stale } = await getFxSnapshot({ refresh: true });
    return { date: snapshot.date.toISOString().slice(0, 10), stale };
  });

  // 2 — Recordatorios de pago.
  await run(tasks, "recordatorios", async () => {
    const result = await sendPaymentReminders(now, budget());
    emailsLeft -= result.sent;
    return result;
  });

  // 3 — Alertas de pasaporte.
  await run(tasks, "pasaportes", async () => {
    const result = await sendPassportAlerts(now, budget());
    emailsLeft -= result.sent;
    return result;
  });

  // 4 — Comunicaciones programadas y las que quedaron a medio mandar.
  await run(tasks, "comunicaciones", async () => {
    const result = await processScheduledCommunications(now, budget());
    emailsLeft -= result.sent;
    return result;
  });

  // 5 — Purga del rate limiting. Deuda de la fase 1: la función ya existía,
  //     le faltaba quién la llamara.
  await run(tasks, "rateLimit", async () => ({
    purged: await purgeExpiredRateLimitHits(),
  }));

  const failed = tasks.filter((task) => !task.ok);

  return NextResponse.json(
    {
      // `ok` es sobre el cron, no sobre cada tarea: que una falle no invalida
      // la corrida. El detalle está abajo.
      ok: failed.length === 0,
      ranAt: now.toISOString(),
      durationMs: Date.now() - startedAt,
      emailsSent: MAX_EMAILS_PER_RUN - emailsLeft,
      tasks,
    },
    // 200 aunque una tarea falle: un 500 haría que Vercel reintente la corrida
    // entera, incluidas las tareas que sí anduvieron. Lo que falló se retoma
    // mañana por su cuenta.
    { status: 200 },
  );
}

async function run(
  tasks: TaskReport[],
  name: string,
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    tasks.push({ task: name, ok: true, detail: await task() });
  } catch (error) {
    console.error(`[cron] falló ${name}: ${(error as Error).message}`);
    tasks.push({ task: name, ok: false, error: (error as Error).message });
  }
}

/**
 * Compara el secreto en tiempo constante.
 *
 * Con `===`, el tiempo de la comparación depende de cuántos caracteres
 * coinciden desde el principio, y eso alcanza para adivinar el secreto de a un
 * byte por vez. `timingSafeEqual` exige longitudes iguales, así que primero se
 * compara el largo —que no es secreto— y recién después el contenido.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  // Sin secreto configurado NO se abre el endpoint: se cierra. Un cron sin
  // proteger es un botón de "mandar mails a todos" en internet.
  if (!secret) {
    console.error("[cron] falta CRON_SECRET: el endpoint queda cerrado.");
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Un GET al endpoint no ejecuta nada.
 *
 * Existe solo para que abrir la URL en el navegador diga algo claro en vez de
 * un 405 que parece un despliegue roto.
 */
export function GET() {
  return NextResponse.json(
    { error: "Este endpoint se invoca con POST y CRON_SECRET." },
    { status: 405 },
  );
}
