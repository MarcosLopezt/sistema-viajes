import { tokenizePlainText } from "@/lib/domain/rich-text";

/**
 * Muestra un texto escrito por las coordinadoras.
 *
 * Respeta los saltos de línea y convierte las URLs en links. NUNCA interpreta
 * HTML: los trozos vienen de `tokenizePlainText()` como valores, y React los
 * escapa solo. No hay `dangerouslySetInnerHTML` en ninguna parte de este
 * camino, y no puede haberlo — el tokenizador devuelve datos, no marcado.
 *
 * Es lo que reemplaza al "texto enriquecido" que pedía la fase: lo único que
 * hacía falta de verdad era que el link al itinerario de Canva se pudiera
 * apretar. Ver el docblock de src/lib/domain/rich-text.ts.
 *
 * Server Component: no necesita interactividad y así no suma nada al bundle.
 */
export function PlainText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {tokenizePlainText(paragraph).map((token, i) =>
            token.kind === "link" ? (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noreferrer noopener"
                // `break-all` no es cosmético: un link de Canva son ~46
                // caracteres sin un solo espacio, y a 375px eso no entra en
                // la columna. Sin esto la página entera scrollea de costado,
                // que en un teléfono se siente como que está rota.
                className="text-primary [overflow-wrap:anywhere] underline underline-offset-4"
              >
                {token.value}
              </a>
            ) : (
              <span key={i}>{token.value}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
