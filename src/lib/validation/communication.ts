import { z } from "zod";
import { isRealIsoDate } from "./date";

/**
 * Validación de las comunicaciones del coordinador.
 *
 * Como en el resto del sistema, el mismo schema corre en el formulario y en la
 * Server Action. Acá importa especialmente: el asunto y el cuerpo son texto
 * libre que va a salir por mail a catorce personas, y el largo máximo no es
 * una formalidad —un cuerpo de un megabyte multiplicado por catorce
 * destinatarios es una factura de Brevo y un timeout—.
 */

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

const subject = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Escribí ${label}.`)
    .max(MAX_SUBJECT, `${label} no puede pasar de ${MAX_SUBJECT} caracteres.`);

const body = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Escribí ${label}.`)
    .max(MAX_BODY, `${label} no puede pasar de ${MAX_BODY} caracteres.`);

/**
 * Los campos en inglés son opcionales y pueden llegar vacíos.
 *
 * La regla de negocio —hay versión en inglés solo si el asunto Y el cuerpo
 * están completos— NO se valida acá: si el schema exigiera los dos juntos, el
 * autoguardado de un borrador a medio escribir fallaría. Se resuelve al
 * enviar, en `hasEnglishVersion()` del servicio, que es también lo que decide
 * el idioma de cada destinatario.
 */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

export const communicationDraftSchema = z.object({
  subjectEs: subject("el asunto"),
  bodyEs: body("el mensaje"),
  subjectEn: optionalText(MAX_SUBJECT),
  bodyEn: optionalText(MAX_BODY),
  audience: z.enum(["TODOS", "SELECCION"]).default("TODOS"),
  /**
   * Ids de Passenger cuando la audiencia es SELECCION. Se validan contra el
   * viaje en el servicio: que llegue un id acá no significa nada.
   */
  passengerIds: z.array(z.uuid()).default([]),
  /**
   * Incluir a los pasajeros cancelados. Default `false` a propósito: mandarle
   * "cargá tus datos" a alguien que se bajó del viaje es peor que no mandarle
   * nada, así que incluirlos tiene que ser una decisión, no un descuido.
   */
  includeCancelled: z.boolean().default(false),
});

export type CommunicationDraftInput = z.infer<typeof communicationDraftSchema>;

/** Fecha y hora de un envío programado, en la zona horaria del viaje. */
export const scheduleSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí la fecha del envío.")
    .refine(isRealIsoDate, "Esa fecha no existe."),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Elegí la hora del envío."),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const MAX_SUBJECT_LENGTH = MAX_SUBJECT;
export const MAX_BODY_LENGTH = MAX_BODY;
