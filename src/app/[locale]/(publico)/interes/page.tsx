import { getLocale, getTranslations } from "next-intl/server";
import { getClosedMessage, getPublicTrip } from "@/lib/services/interest";
import { PlainText } from "@/components/public/plain-text";
import { InterestForm } from "./interest-form";

/**
 * `/interes` — el destino del botón "más información" de Wix.
 *
 * Es la primera pantalla pública del sistema. Dos estados y nada más:
 *
 *  · hay un viaje aceptando  → la propuesta y el formulario;
 *  · no hay ninguno          → un mensaje editable por las coordinadoras.
 *
 * El segundo estado no es un error ni una página rota: entre dos viajes no hay
 * nada abierto, y eso pasa la mitad del año. Que se pueda escribir qué dice
 * es lo que evita que alguien caiga en un "no encontrado".
 *
 * Lo que se muestra del viaje sale de `getPublicTrip()`, que selecciona campo
 * por campo. No hay cupos, ni precios, ni fechas, ni una sola pasajera.
 */
export default async function InterestPage() {
  const locale = await getLocale();
  const t = await getTranslations("interest");

  const trip = await getPublicTrip(locale);

  if (!trip) {
    const custom = await getClosedMessage(locale);
    return (
      <div className="space-y-4 py-10">
        <h1 className="text-3xl">{t("closedTitle")}</h1>
        {/* El texto de ellas si lo escribieron; si no, el del catálogo. Que una
            escuela sin nada cargado vea algo razonable importa más que la voz
            de marca. */}
        <PlainText
          text={custom ?? t("closedFallback")}
          className="text-muted-foreground text-lg"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {t("eyebrow")}
        </p>
        <h1 className="text-4xl leading-tight">{trip.name}</h1>
      </header>

      {trip.infoForInterested ? (
        <PlainText text={trip.infoForInterested} className="text-lg" />
      ) : null}

      {/* El encabezado de esta sección lo pone InterestForm, que es quien
          sabe si todavía está pidiendo datos o ya los recibió. */}
      <div className="border-border border-t pt-8">
        <InterestForm />
      </div>
    </div>
  );
}
