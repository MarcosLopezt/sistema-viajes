import { z } from "zod";
import { isRealIsoDate } from "./date";

/**
 * Validación de los datos personales.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HAY DOS SCHEMAS, Y NO SON INTERCAMBIABLES
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  personDraftSchema   Para el AUTOGUARDADO. Acepta todo: campos vacíos, a
 *                      medio escribir, mal formados. Su trabajo es dejar
 *                      persistir lo que haya.
 *
 *  personStrictSchema  Para FINALIZAR el registro. Exige todo lo obligatorio
 *                      y valida formato.
 *
 * Usar el estricto para autoguardar es el error que arruina el formulario:
 * el pasajero escribe "ana@" en el campo de mail, el autoguardado rechaza el
 * lote entero, falla en silencio, y cuando cierra la pestaña pierde los ocho
 * campos que sí había completado. El draft NUNCA rechaza.
 *
 * Por eso el draft no tiene un solo `.min()`, `.email()` ni `.refine()`: solo
 * normaliza (recorta espacios, convierte "" en null) y acota longitudes para
 * que nadie mande un megabyte en un campo de texto.
 */

/** Texto libre para el draft: normaliza y acota, nunca rechaza por contenido. */
const draftText = (max = 300) =>
  z
    .string()
    .max(max)
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    })
    .nullable()
    .optional();

/**
 * Fecha para el draft.
 * Un `<input type="date">` a medio completar manda "", y eso tiene que poder
 * guardarse como null en lugar de tirar el paso entero.
 */
const draftDate = z
  .string()
  .max(10)
  .transform((value) => (value.trim() === "" ? null : value.trim()))
  .nullable()
  .optional();

export const personDraftSchema = z.object({
  fullName: draftText(200),
  nationalityCountry: draftText(100),
  residenceCountry: draftText(100),
  residenceAddress: draftText(300),
  residenceCity: draftText(120),
  mobilePhone: draftText(40),
  documentNumber: draftText(40),
  passportNumber: draftText(40),
  passportExpiryDate: draftDate,

  emergencyContactName: draftText(200),
  emergencyContactPhone: draftText(40),
  medicalAssuranceCompany: draftText(200),
  medicalAssuranceId: draftText(80),
  medicalAssurancePhone: draftText(40),
  medicalAssuranceEmail: draftText(200),

  hasDietaryRestrictions: z.boolean().optional(),
  dietaryRestrictionsDetail: draftText(1000),
  hasMobilityRestrictions: z.boolean().optional(),
  mobilityRestrictionsDetail: draftText(1000),
  otherHealthNotes: draftText(1000),

  preferredLanguage: z.enum(["ES", "EN"]).optional(),
});

export type PersonDraftInput = z.infer<typeof personDraftSchema>;

// ---------------------------------------------------------------------------

/** Texto obligatorio, con mensaje humano. */
const required = (message: string, max = 300) =>
  z.string().trim().min(1, message).max(max);

/**
 * Teléfono. Se pide el código de país porque el grupo viaja al exterior y un
 * número sin código no sirve para una emergencia desde Roma.
 */
const phone = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .max(40)
    .regex(
      /^\+?[\d\s()-]{7,}$/,
      "Escribí el teléfono con código de país, por ejemplo +54 9 11 1234 5678.",
    );

const isoDateRequired = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "Cargá la fecha de vencimiento de tu pasaporte.",
  )
  // `isRealIsoDate` y no `!isNaN(new Date(...))`: JS desborda 31/02 a marzo
  // en silencio en vez de rechazarla. Ver src/lib/validation/date.ts.
  .refine(isRealIsoDate, "Esa fecha no existe. Revisala.");

/**
 * Validación estricta, para cuando el pasajero da por terminado el registro.
 *
 * Los campos de detalle son condicionales: solo se exigen si la persona
 * declaró tener la restricción. Pedirlos siempre obligaría a escribir
 * "ninguna" para poder terminar.
 *
 * Este schema y `isPersonComplete()` tienen que coincidir en QUÉ es
 * obligatorio. Un test lo verifica campo por campo
 * (tests/domain/person-validation.test.ts): si alguien agrega un campo en un
 * lado y se olvida del otro, falla.
 */
export const personStrictSchema = z
  .object({
    fullName: required("Poné tu nombre y apellido como figura en el pasaporte.", 200),
    nationalityCountry: required("Poné tu nacionalidad.", 100),
    residenceCountry: required("Poné el país donde vivís.", 100),
    residenceAddress: required("Poné tu dirección.", 300),
    residenceCity: required("Poné la ciudad donde vivís.", 120),
    mobilePhone: phone("Poné tu celular."),
    documentNumber: required("Poné tu número de documento.", 40),
    passportNumber: required("Poné el número de tu pasaporte.", 40),
    passportExpiryDate: isoDateRequired,

    emergencyContactName: required(
      "Poné el nombre de alguien a quien llamar en una emergencia.",
      200,
    ),
    emergencyContactPhone: phone("Poné el teléfono de tu contacto de emergencia."),
    medicalAssuranceCompany: required(
      "Poné el nombre de tu cobertura médica.",
      200,
    ),
    medicalAssuranceId: required("Poné tu número de socio o de póliza.", 80),
    medicalAssurancePhone: phone("Poné el teléfono de asistencia de tu cobertura."),
    medicalAssuranceEmail: z.email(
      "Escribí un email válido, con arroba.",
    ),

    hasDietaryRestrictions: z.boolean(),
    dietaryRestrictionsDetail: z.string().trim().max(1000).nullable().optional(),
    hasMobilityRestrictions: z.boolean(),
    mobilityRestrictionsDetail: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional(),
    otherHealthNotes: z.string().trim().max(1000).nullable().optional(),

    medicalAssuranceFileId: required(
      "Subí el certificado o la credencial de tu cobertura médica.",
      500,
    ),

    preferredLanguage: z.enum(["ES", "EN"]),
  })
  .refine(
    (data) =>
      !data.hasDietaryRestrictions ||
      (data.dietaryRestrictionsDetail ?? "").trim().length > 0,
    {
      message: "Contanos cuál es la restricción para avisarle a los hoteles.",
      path: ["dietaryRestrictionsDetail"],
    },
  )
  .refine(
    (data) =>
      !data.hasMobilityRestrictions ||
      (data.mobilityRestrictionsDetail ?? "").trim().length > 0,
    {
      message:
        "Contanos qué necesitás para poder organizar los traslados y las visitas.",
      path: ["mobilityRestrictionsDetail"],
    },
  );

export type PersonStrictInput = z.infer<typeof personStrictSchema>;

/** Qué campos toca cada paso del formulario, para validar de a un paso. */
export const PERSON_STEP_FIELDS = {
  1: [
    "fullName",
    "nationalityCountry",
    "residenceCountry",
    "residenceAddress",
    "residenceCity",
    "mobilePhone",
    "documentNumber",
    "passportNumber",
    "passportExpiryDate",
    "preferredLanguage",
  ],
  2: [
    "emergencyContactName",
    "emergencyContactPhone",
    "medicalAssuranceCompany",
    "medicalAssuranceId",
    "medicalAssurancePhone",
    "medicalAssuranceEmail",
    "hasDietaryRestrictions",
    "dietaryRestrictionsDetail",
    "hasMobilityRestrictions",
    "mobilityRestrictionsDetail",
    "otherHealthNotes",
  ],
  3: ["medicalAssuranceFileId"],
} as const satisfies Record<1 | 2 | 3, readonly string[]>;
