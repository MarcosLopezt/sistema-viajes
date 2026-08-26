import { describe, expect, it } from "vitest";
import {
  evaluatePersonCompleteness,
  isPersonComplete,
  requiredFieldsFor,
  type PersonCompletenessInput,
} from "@/lib/domain/person";

/** Persona con todos los campos incondicionales cargados y sin restricciones. */
function completePerson(
  overrides: Partial<PersonCompletenessInput> = {},
): PersonCompletenessInput {
  return {
    fullName: "Ana Pérez",
    nationalityCountry: "Argentina",
    residenceCountry: "Argentina",
    residenceAddress: "Av. Siempreviva 742",
    residenceCity: "Buenos Aires",
    mobilePhone: "+54 9 11 5555 5555",
    documentNumber: "30123456",
    passportNumber: "AAF123456",
    passportExpiryDate: new Date("2030-01-01T00:00:00.000Z"),
    emergencyContactName: "Juan Pérez",
    emergencyContactPhone: "+54 9 11 4444 4444",
    medicalAssuranceCompany: "Cobertura SA",
    medicalAssuranceId: "POL-99881",
    medicalAssurancePhone: "+54 11 3333 3333",
    medicalAssuranceEmail: "asistencia@cobertura.example",
    hasDietaryRestrictions: false,
    hasMobilityRestrictions: false,
    medicalAssuranceFileId: "trips/abc/certificado.pdf",
    ...overrides,
  };
}

describe("isPersonComplete", () => {
  it("acepta una persona con todo cargado", () => {
    expect(isPersonComplete(completePerson())).toBe(true);
  });

  it("acepta que otherHealthNotes esté vacío", () => {
    // Es el único campo verdaderamente opcional del formulario.
    expect(isPersonComplete(completePerson({ otherHealthNotes: null }))).toBe(
      true,
    );
  });

  it("exige el certificado de cobertura médica", () => {
    // Decisión explícita: sin el archivo no se puede confirmar al pasajero.
    const result = evaluatePersonCompleteness(
      completePerson({ medicalAssuranceFileId: null }),
    );
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("medicalAssuranceFileId");
    expect(result.firstIncompleteStep).toBe(3);
  });

  it("rechaza un string en blanco igual que un nulo", () => {
    // Un campo con espacios no es un campo completado.
    expect(isPersonComplete(completePerson({ fullName: "   " }))).toBe(false);
  });

  it("rechaza una fecha inválida", () => {
    expect(
      isPersonComplete(completePerson({ passportExpiryDate: new Date("x") })),
    ).toBe(false);
  });
});

describe("campos condicionales", () => {
  it("no pide el detalle si no declaró restricción alimentaria", () => {
    const person = completePerson({
      hasDietaryRestrictions: false,
      dietaryRestrictionsDetail: null,
    });
    expect(requiredFieldsFor(person)).not.toContain(
      "dietaryRestrictionsDetail",
    );
    expect(isPersonComplete(person)).toBe(true);
  });

  it("pide el detalle si declaró restricción alimentaria", () => {
    const person = completePerson({
      hasDietaryRestrictions: true,
      dietaryRestrictionsDetail: null,
    });
    expect(requiredFieldsFor(person)).toContain("dietaryRestrictionsDetail");
    expect(isPersonComplete(person)).toBe(false);
  });

  it("pide el detalle de movilidad si declaró restricción de movilidad", () => {
    const person = completePerson({
      hasMobilityRestrictions: true,
      mobilityRestrictionsDetail: null,
    });
    expect(isPersonComplete(person)).toBe(false);
    expect(
      isPersonComplete({
        ...person,
        mobilityRestrictionsDetail: "Usa bastón, evitar escaleras largas.",
      }),
    ).toBe(true);
  });

  it("suma ambos detalles cuando declaró las dos restricciones", () => {
    const required = requiredFieldsFor(
      completePerson({
        hasDietaryRestrictions: true,
        hasMobilityRestrictions: true,
      }),
    );
    expect(required).toContain("dietaryRestrictionsDetail");
    expect(required).toContain("mobilityRestrictionsDetail");
  });
});

describe("porcentaje de completitud", () => {
  it("da 100 cuando está completa", () => {
    expect(
      evaluatePersonCompleteness(completePerson()).completionPercentage,
    ).toBe(100);
  });

  it("da 0 para una persona recién creada", () => {
    const result = evaluatePersonCompleteness({});
    expect(result.completionPercentage).toBe(0);
    expect(result.firstIncompleteStep).toBe(1);
  });

  it("no supera 100 aunque haya campos opcionales cargados", () => {
    const result = evaluatePersonCompleteness(
      completePerson({ otherHealthNotes: "Nada para declarar." }),
    );
    expect(result.completionPercentage).toBe(100);
  });

  it("baja el porcentaje al declarar una restricción sin detallarla", () => {
    // Efecto deseado: tildar "tengo restricciones" agrega un campo requerido,
    // así que el avance retrocede hasta que lo complete.
    const before = evaluatePersonCompleteness(completePerson());
    const after = evaluatePersonCompleteness(
      completePerson({ hasDietaryRestrictions: true }),
    );
    expect(before.completionPercentage).toBe(100);
    expect(after.completionPercentage).toBeLessThan(100);
    expect(after.requiredCount).toBe(before.requiredCount + 1);
  });

  it("apunta al primer paso incompleto, no a cualquiera", () => {
    const result = evaluatePersonCompleteness(
      completePerson({
        residenceCity: null,
        medicalAssuranceId: null,
        medicalAssuranceFileId: null,
      }),
    );
    expect(result.firstIncompleteStep).toBe(1);
    expect(result.missing).toEqual([
      "residenceCity",
      "medicalAssuranceId",
      "medicalAssuranceFileId",
    ]);
  });

  it("el porcentaje y el gate de confirmación no se contradicen", () => {
    // La misma definición alimenta el % que ve el pasajero y el permiso de
    // confirmar que tiene el coordinador: 100% implica confirmable, siempre.
    const person = completePerson({ hasMobilityRestrictions: true });
    const partial = evaluatePersonCompleteness(person);
    expect(partial.completionPercentage).toBeLessThan(100);
    expect(isPersonComplete(person)).toBe(false);

    const finished = {
      ...person,
      mobilityRestrictionsDetail: "Silla de ruedas plegable.",
    };
    expect(evaluatePersonCompleteness(finished).completionPercentage).toBe(100);
    expect(isPersonComplete(finished)).toBe(true);
  });
});
