import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";

/**
 * Shell de la interesada.
 *
 * Existe por una razón puntual: sin él, alguien sin sesión que entra a
 * `/mi-viaje` recibe un 500. La página llama a `requireSessionUser()`, que
 * tira `UnauthorizedError`, y sin nadie que lo atienda eso termina en la
 * pantalla de error genérica — cuando lo correcto es mandarla al login.
 *
 * Los grupos (pasajero) y (coordinador) resuelven lo mismo en sus layouts;
 * este lo hace igual para no tener dos formas distintas de contestar la misma
 * pregunta.
 *
 * NO decide nada más. Que una interesada no llegue a las pantallas internas no
 * lo impide este archivo: lo impide que no tenga TripMember, y eso lo hacen
 * cumplir los guards de cada servicio. Un layout que redirige por rol da una
 * falsa sensación de seguridad porque no protege Server Actions ni Route
 * Handlers.
 *
 * La identidad visual (serifa y paleta cálida) la pone la página, que es
 * también la que arma su encabezado: es una sola pantalla y partirla en dos
 * archivos sería ceremonia sin ganancia.
 */
export default async function InterestedLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return children;
}
