import { describe, expect, it } from "vitest";
import {
  personDraftSchema,
  personStrictSchema,
} from "@/lib/validation/person";
import { isPersonComplete, requiredFieldsFor } from "@/lib/domain/person";

/**
 * Los dos schemas de datos personales.
 *
 * El draft NUNCA rechaza: su trabajo es dejar persistir lo que haya, aunque
 * esté a medias o mal escrito. El estricto sí valida, y corre una sola vez, al
 * finalizar el registro.
 *
 * Confundirlos es el bug que arruina el formulario: si el autoguardado usara
 * el estricto, un mail a medio escribir haría fallar el guardado del paso
 * entero y el pasajero perdería todo lo demás.
 */

const COMPLETE = {
  fullName: "Ana Pérez",
  nationalityCountry: "Argentina",
  residenceCountry: "Argentina",
  residenceAddress: "Av. Siempreviva 742",
  residenceCity: "Buenos Aires",
  mobilePhone: "+54 9 11 5555 5555",
  documentNumber: "30123456",
  passportNumber: "AAF123456",
  passportExpiryDate: "2032-01-01",
  emergencyContactName: "Juan Pérez",
  emergencyContactPhone: "+54 9 11 4444 4444",
  medicalAssuranceCompany: "Cobertura SA",
  medicalAssuranceId: "POL-99881",
  medicalAssurancePhone: "+54 11 3333 3333",
  medicalAssuranceEmail: "asistencia@cobertura.example",
  hasDietaryRestrictions: false,
  hasMobilityRestrictions: false,
  medicalAssuranceFileId: "trips/abc/certificado.pdf",
  preferredLanguage: "ES" as const,
};

describe("personDraftSchema — el autoguardado nunca rechaza", () => {
  it("acepta un objeto completamente vacío", () => {
    expect(personDraftSchema.safeParse({}).success).toBe(true);
  });

  it("acepta un email a medio escribir", () => {
    // El caso exacto que rompería el formulario si se validara estricto.
    const result = personDraftSchema.safeParse({
      medicalAssuranceEmail: "ana@",
    });
    expect(result.success).toBe(true);
  });

  it("acepta un teléfono con letras", () => {
    expect(
      personDraftSchema.safeParse({ mobilePhone: "todavía no sé" }).success,
    ).toBe(true);
  });

  it("acepta una fecha vacía y la guarda como nula", () => {
    const result = personDraftSchema.safeParse({ passportExpiryDate: "" });
    expect(result.success).toBe(true);
    expect(result.data?.passportExpiryDate).toBeNull();
  });

  it("convierte los strings en blanco en null en vez de guardar espacios", () => {
    const result = personDraftSchema.safeParse({ fullName: "   " });
    expect(result.success).toBe(true);
    expect(result.data?.fullName).toBeNull();
  });

  it("recorta los espacios sobrantes", () => {
    const result = personDraftSchema.safeParse({ fullName: "  Ana Pérez  " });
    expect(result.data?.fullName).toBe("Ana Pérez");
  });

  it("acepta un formulario a medias, con unos campos sí y otros no", () => {
    const result = personDraftSchema.safeParse({
      fullName: "Ana",
      mobilePhone: "",
      medicalAssuranceEmail: "no-es-un-mail",
      passportExpiryDate: "2032-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("sí acota longitudes, para que nadie mande un megabyte", () => {
    // Es el único caso en que el draft rechaza, y no es por contenido.
    const result = personDraftSchema.safeParse({
      fullName: "x".repeat(5000),
    });
    expect(result.success).toBe(false);
  });
});

describe("personStrictSchema — al finalizar sí valida", () => {
  it("acepta una persona completa", () => {
    expect(personStrictSchema.safeParse(COMPLETE).success).toBe(true);
  });

  it("rechaza el email mal escrito que el draft aceptaba", () => {
    const result = personStrictSchema.safeParse({
      ...COMPLETE,
      medicalAssuranceEmail: "ana@",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un campo obligatorio vacío", () => {
    const result = personStrictSchema.safeParse({ ...COMPLETE, fullName: "" });
    expect(result.success).toBe(false);
  });

  it("exige el certificado de cobertura médica", () => {
    const result = personStrictSchema.safeParse({
      ...COMPLETE,
      medicalAssuranceFileId: "",
    });
    expect(result.success).toBe(false);
  });

  it("exige el detalle si declaró restricción alimentaria", () => {
    const result = personStrictSchema.safeParse({
      ...COMPLETE,
      hasDietaryRestrictions: true,
      dietaryRestrictionsDetail: null,
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.flatten().fieldErrors["dietaryRestrictionsDetail"],
    ).toBeDefined();
  });

  it("acepta el detalle cargado", () => {
    const result = personStrictSchema.safeParse({
      ...COMPLETE,
      hasDietaryRestrictions: true,
      dietaryRestrictionsDetail: "Celíaca: sin TACC.",
    });
    expect(result.success).toBe(true);
  });

  it("no exige el detalle si NO declaró la restricción", () => {
    // Pedirlo siempre obligaría a escribir "ninguna" para poder terminar.
    const result = personStrictSchema.safeParse({
      ...COMPLETE,
      hasDietaryRestrictions: false,
      dietaryRestrictionsDetail: null,
    });
    expect(result.success).toBe(true);
  });

  it("acepta que otherHealthNotes esté vacío", () => {
    expect(
      personStrictSchema.safeParse({ ...COMPLETE, otherHealthNotes: null })
        .success,
    ).toBe(true);
  });

  it("rechaza una fecha de pasaporte inexistente", () => {
    const result = personStrictSchema.safeParse({
      ...COMPLETE,
      passportExpiryDate: "2032-02-31",
    });
    expect(result.success).toBe(false);
  });

  it("trae mensajes humanos, no códigos", () => {
    const result = personStrictSchema.safeParse({ ...COMPLETE, fullName: "" });
    const message = result.error?.flatten().fieldErrors["fullName"]?.[0] ?? "";
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toMatch(/^[A-Z_]+$/);
  });
});

describe("el schema estricto y isPersonComplete no pueden divergir", () => {
  /**
   * Este test es un candado. `isPersonComplete` alimenta el % que ve el
   * pasajero y el gate de confirmación del coordinador; el schema estricto
   * valida el formulario. Si alguien agrega un campo obligatorio en un lado y
   * se olvida del otro, el pasajero llega al 100% y no puede terminar, o al
   * revés. Acá se rompe antes.
   */
  const toDomain = (input: Record<string, unknown>) => ({
    ...input,
    passportExpiryDate: input["passportExpiryDate"]
      ? new Date(`${String(input["passportExpiryDate"])}T00:00:00.000Z`)
      : null,
  });

  it("una persona que pasa el estricto está completa para el dominio", () => {
    expect(personStrictSchema.safeParse(COMPLETE).success).toBe(true);
    expect(isPersonComplete(toDomain(COMPLETE))).toBe(true);
  });

  it("quitar cualquier campo requerido rompe LOS DOS a la vez", () => {
    const required = requiredFieldsFor(toDomain(COMPLETE));

    for (const field of required) {
      const partial: Record<string, unknown> = { ...COMPLETE };
      partial[field] = field === "passportExpiryDate" ? "" : "";

      const strictOk = personStrictSchema.safeParse(partial).success;
      const domainOk = isPersonComplete(toDomain(partial));

      expect(
        strictOk,
        `el schema estricto acepta sin ${field} pero no debería`,
      ).toBe(false);
      expect(
        domainOk,
        `isPersonComplete acepta sin ${field} pero no debería`,
      ).toBe(false);
    }
  });

  it("los condicionales también coinciden en los dos lados", () => {
    const withRestriction = {
      ...COMPLETE,
      hasDietaryRestrictions: true,
      dietaryRestrictionsDetail: "",
    };

    expect(personStrictSchema.safeParse(withRestriction).success).toBe(false);
    expect(isPersonComplete(toDomain(withRestriction))).toBe(false);

    const filled = {
      ...withRestriction,
      dietaryRestrictionsDetail: "Sin TACC.",
    };
    expect(personStrictSchema.safeParse(filled).success).toBe(true);
    expect(isPersonComplete(toDomain(filled))).toBe(true);
  });
});
