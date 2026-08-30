import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderEmail,
  safeUrl,
  formatEmailDate,
} from "@/lib/email/layout";
import {
  communicationEmail,
  invitationEmail,
  newInterestEmail,
  passportAlertEmail,
  paymentConfirmedEmail,
  paymentReminderEmail,
  paymentRejectedEmail,
  TEMPLATES,
  type TemplateName,
} from "@/lib/email/templates";

/**
 * Las plantillas son funciones puras, así que se testean sin mandar nada.
 *
 * Lo que se verifica no es cómo se ve —eso se mira— sino lo que no se puede
 * ver revisando a ojo: que todas tengan texto plano, que ninguna use CSS que
 * los clientes de mail no entienden, y que nada de lo que escribe una persona
 * salga sin escapar.
 */

const footer = {
  tripName: "Londres, París y Roma",
  replyToName: "Coty",
  replyToEmail: "coty@ejemplo.test",
};

const SAMPLES: Record<TemplateName, () => { subject: string; html: string; text: string }> =
  {
    invitation: () =>
      invitationEmail("es", {
        tripName: "Londres, París y Roma",
        url: "https://viajes.test/es/invitacion/abc",
        expiresAt: new Date("2026-09-10T00:00:00.000Z"),
        coordinatorName: "Coty",
        footer,
      }),
    paymentReminder: () =>
      paymentReminderEmail("es", {
        tripName: "Londres, París y Roma",
        passengerName: "Ana",
        installmentNumber: 2,
        amount: "£ 1.330,00",
        dueDate: "15/08/2026",
        balance: "£ 2.660,00",
        overdue: true,
        url: "https://viajes.test/es/mis-pagos",
        footer,
      }),
    paymentConfirmed: () =>
      paymentConfirmedEmail("es", {
        tripName: "Londres, París y Roma",
        passengerName: "Ana",
        declaredAmount: "€ 2.330,00",
        imputedAmount: "£ 2.012,50",
        installmentNumber: 1,
        balance: "£ 1.977,50",
        url: "https://viajes.test/es/mis-pagos",
        footer,
      }),
    paymentRejected: () =>
      paymentRejectedEmail("es", {
        tripName: "Londres, París y Roma",
        passengerName: "Ana",
        declaredAmount: "£ 1.330,00",
        installmentNumber: 1,
        reason: "El comprobante está cortado y no se lee el importe.",
        url: "https://viajes.test/es/mis-pagos",
        footer,
      }),
    passportAlert: () =>
      passportAlertEmail("es", {
        tripName: "Londres, París y Roma",
        passengerName: "Carla",
        level: "BLOQUEANTE",
        expiryDate: "01/03/2027",
        minimumDate: "24/08/2027",
        tripEndDate: "24/05/2027",
        url: "https://viajes.test/es/mis-datos",
        footer,
      }),
    communication: () =>
      communicationEmail("es", {
        subject: "Últimos detalles",
        body: "Nos vemos el jueves.\nLlevá el pasaporte.",
        passengerName: "Ana",
        footer,
      }),
    newInterest: () =>
      newInterestEmail("es", {
        interestedName: "Lucía Méndez",
        interestedEmail: "lucia@ejemplo.test",
        residenceCountry: "Uruguay",
        phone: "+598 99 123 456",
        url: "https://viajes.test/es/viajes/abc/interesadas",
        footer,
      }),
  };

const NAMES = Object.keys(SAMPLES) as TemplateName[];

describe("todas las plantillas", () => {
  it("existen las siete", () => {
    // Seis hasta la fase 6; la séptima es el aviso de interesada nueva.
    expect(NAMES).toHaveLength(7);
    expect(Object.keys(TEMPLATES).sort()).toEqual(NAMES.sort());
  });

  for (const name of NAMES) {
    describe(name, () => {
      const rendered = SAMPLES[name]();

      it("tiene asunto, HTML y texto plano", () => {
        expect(rendered.subject.trim().length).toBeGreaterThan(0);
        expect(rendered.html).toContain("<!doctype html>");
        // El texto plano no es opcional: sin él el mail puntúa peor en los
        // filtros de spam y no lo lee un lector de pantalla.
        expect(rendered.text.trim().length).toBeGreaterThan(0);
      });

      it("maqueta con tablas y estilos inline, no con CSS moderno", () => {
        expect(rendered.html).toContain("<table");
        // Nada de esto sobrevive en Outlook ni en la vista web de Gmail.
        expect(rendered.html).not.toMatch(/<style[\s>]/i);
        expect(rendered.html).not.toMatch(/class="/);
        expect(rendered.html).not.toMatch(/display:\s*(flex|grid)/i);
        expect(rendered.html).not.toMatch(/\bvar\(--/);
        expect(rendered.html).not.toMatch(/oklch\(/);
      });

      it("respeta el ancho máximo de 600px", () => {
        expect(rendered.html).toContain("width:600px");
      });

      it("el pie identifica el viaje y a quién responder", () => {
        expect(rendered.html).toContain("Londres");
        expect(rendered.text).toContain("Londres");
        expect(rendered.text).toContain("coty@ejemplo.test");
      });

      it("está en los dos idiomas", () => {
        // Se renderiza en inglés con los mismos datos: si una plantilla no
        // tuviera la traducción, saldría en español o tiraría.
        const english = (
          TEMPLATES[name] as (lang: "en", data: never) => typeof rendered
        )("en", getData(name) as never);
        expect(english.subject.trim().length).toBeGreaterThan(0);
        expect(english.html).toContain('<html lang="en"');
      });
    });
  }
});

/** Los mismos datos de `SAMPLES`, para volver a renderizar en inglés. */
function getData(name: TemplateName): unknown {
  const captured: Record<TemplateName, unknown> = {
    invitation: {
      tripName: "Londres, París y Roma",
      url: "https://viajes.test/en/invitacion/abc",
      expiresAt: new Date("2026-09-10T00:00:00.000Z"),
      coordinatorName: "Coty",
      footer,
    },
    paymentReminder: {
      tripName: "Londres, París y Roma",
      passengerName: "Ana",
      installmentNumber: 2,
      amount: "£ 1,330.00",
      dueDate: "15/08/2026",
      balance: "£ 2,660.00",
      overdue: false,
      url: "https://viajes.test/en/mis-pagos",
      footer,
    },
    paymentConfirmed: {
      tripName: "Londres, París y Roma",
      passengerName: "Ana",
      declaredAmount: "£ 1,330.00",
      imputedAmount: null,
      installmentNumber: 1,
      balance: "£ 0.00",
      url: "https://viajes.test/en/mis-pagos",
      footer,
    },
    paymentRejected: {
      tripName: "Londres, París y Roma",
      passengerName: "Ana",
      declaredAmount: "£ 1,330.00",
      installmentNumber: 1,
      reason: "The receipt is cropped.",
      url: "https://viajes.test/en/mis-pagos",
      footer,
    },
    passportAlert: {
      tripName: "Londres, París y Roma",
      passengerName: "Carla",
      level: "ADVERTENCIA",
      expiryDate: null,
      minimumDate: "24/08/2027",
      tripEndDate: "24/05/2027",
      url: "https://viajes.test/en/mis-datos",
      footer,
    },
    communication: {
      subject: "Final details",
      body: "See you on Thursday.",
      passengerName: "Ana",
      footer,
    },
    newInterest: {
      interestedName: "Lucía Méndez",
      interestedEmail: "lucia@ejemplo.test",
      residenceCountry: "Uruguay",
      // Sin teléfono: es opcional en el formulario público, y la fila tiene
      // que decir "no lo dejó" en vez de quedar vacía.
      phone: null,
      url: "https://viajes.test/en/viajes/abc/interesadas",
      footer,
    },
  };
  return captured[name];
}

// -------------------------------- Escapes ----------------------------------

describe("nada de lo que escribe una persona sale sin escapar", () => {
  it("el cuerpo de una comunicación no se interpreta como HTML", () => {
    const rendered = communicationEmail("es", {
      subject: "Aviso",
      body: '<script>alert(1)</script> y <b>negrita</b>',
      passengerName: null,
      footer,
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<b>negrita</b>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("el nombre del pasajero tampoco", () => {
    const rendered = communicationEmail("es", {
      subject: "Aviso",
      body: "Hola",
      passengerName: '"><img src=x onerror=alert(1)>',
      footer,
    });
    expect(rendered.html).not.toContain("<img");
  });

  it("el motivo de un rechazo tampoco", () => {
    const rendered = paymentRejectedEmail("es", {
      tripName: "Viaje",
      passengerName: null,
      declaredAmount: "£ 10,00",
      installmentNumber: 1,
      reason: "<iframe src='evil'></iframe>",
      url: "https://viajes.test/es/mis-pagos",
      footer,
    });
    expect(rendered.html).not.toContain("<iframe");
  });

  it("los saltos de línea del cuerpo se respetan", () => {
    const rendered = communicationEmail("es", {
      subject: "Aviso",
      body: "Primera línea\nSegunda línea",
      passengerName: null,
      footer,
    });
    expect(rendered.html).toContain("Primera línea<br />Segunda línea");
    expect(rendered.text).toContain("Primera línea\nSegunda línea");
  });

  it("escapeHtml cubre las cinco entidades", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("safeUrl", () => {
  it("deja pasar http y https", () => {
    expect(safeUrl("https://viajes.test/x")).toBe("https://viajes.test/x");
    expect(safeUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });

  /**
   * Un `javascript:` en un `href` de mail lo bloquean casi todos los clientes
   * modernos. Casi. No es algo que convenga delegar.
   */
  it("neutraliza cualquier otro esquema", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>")).toBe("#");
    expect(safeUrl("  JAVASCRIPT:alert(1)")).toBe("#");
    expect(safeUrl("")).toBe("#");
  });

  it("escapa las comillas de una URL que igual pasa", () => {
    expect(safeUrl('https://viajes.test/"onmouseover="x')).not.toContain('"');
  });
});

describe("el link va dos veces: como botón y como texto", () => {
  it("porque los clientes de mail rompen botones", () => {
    const rendered = renderEmail({
      lang: "es",
      subject: "x",
      footer,
      blocks: [
        { kind: "button", label: "Entrar", url: "https://viajes.test/entrar" },
      ],
    });

    const matches = rendered.html.match(/https:\/\/viajes\.test\/entrar/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
    // Y en el texto plano, la URL sola: ahí no hay botón que valga.
    expect(rendered.text).toContain("https://viajes.test/entrar");
  });
});

describe("formatEmailDate", () => {
  it("usa dd/mm/aaaa en los dos idiomas", () => {
    // El público es rioplatense: el mm/dd de en-US sería una fuente silenciosa
    // de errores de lectura.
    expect(formatEmailDate(new Date("2026-08-26T00:00:00.000Z"))).toBe(
      "26/08/2026",
    );
    expect(formatEmailDate("2026-01-05")).toBe("05/01/2026");
  });
});

// ------------------------ Recordatorio: tono y datos -----------------------

describe("recordatorio de pago", () => {
  it("cambia el tono si la cuota ya venció, no los datos", () => {
    const base = {
      tripName: "Viaje",
      passengerName: "Ana",
      installmentNumber: 2,
      amount: "£ 1.330,00",
      dueDate: "15/08/2026",
      balance: "£ 2.660,00",
      url: "https://viajes.test/es/mis-pagos",
      footer,
    };

    const soon = paymentReminderEmail("es", { ...base, overdue: false });
    const late = paymentReminderEmail("es", { ...base, overdue: true });

    expect(soon.subject).not.toBe(late.subject);
    expect(late.subject).toContain("vencida");
    // Los dos llevan el importe y el vencimiento: lo que cambia es cómo se
    // dice, no qué se dice.
    for (const mail of [soon, late]) {
      expect(mail.text).toContain("£ 1.330,00");
      expect(mail.text).toContain("15/08/2026");
    }
  });
});

describe("pago confirmado", () => {
  it("muestra el equivalente solo si hubo conversión", () => {
    const withFx = paymentConfirmedEmail("es", {
      tripName: "Viaje",
      passengerName: "Ana",
      declaredAmount: "€ 2.330,00",
      imputedAmount: "£ 2.012,50",
      installmentNumber: 1,
      balance: "£ 0,00",
      url: "https://viajes.test/es/mis-pagos",
      footer,
    });
    expect(withFx.text).toContain("£ 2.012,50");

    const sameCurrency = paymentConfirmedEmail("es", {
      tripName: "Viaje",
      passengerName: "Ana",
      declaredAmount: "£ 1.330,00",
      imputedAmount: null,
      installmentNumber: 1,
      balance: "£ 0,00",
      url: "https://viajes.test/es/mis-pagos",
      footer,
    });
    // "£1.330 = £1.330" es ruido que hace dudar de si algo se convirtió mal.
    expect(sameCurrency.text).not.toContain("Equivalente");
  });
});

describe("pago rechazado", () => {
  it("el motivo va destacado, no escondido en un párrafo", () => {
    const rendered = paymentRejectedEmail("es", {
      tripName: "Viaje",
      passengerName: "Ana",
      declaredAmount: "£ 1.330,00",
      installmentNumber: 1,
      reason: "El comprobante está cortado.",
      url: "https://viajes.test/es/mis-pagos",
      footer,
    });

    expect(rendered.html).toContain("El comprobante está cortado.");
    // En texto plano se cita, para que se distinga del resto del mensaje.
    expect(rendered.text).toContain("> El comprobante está cortado.");
  });
});
