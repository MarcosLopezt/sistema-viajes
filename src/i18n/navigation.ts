import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Wrappers de navegación que conservan el idioma activo.
 *
 * Usá SIEMPRE estos en lugar de `next/link` y `next/navigation`: los de Next
 * no agregan el prefijo de locale y mandan al usuario al idioma por defecto.
 */
const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

/**
 * `redirect` va con anotación de tipo explícita a propósito.
 *
 * TypeScript solo trata una llamada como punto final inalcanzable si el
 * invocado es una función con retorno `never` declarado o un `const` con
 * anotación explícita. Sacada de un destructuring pelado se pierde esa
 * propiedad, y entonces todo `redirect()` al final de una Server Action da
 * "Function lacks ending return statement".
 */
export const redirect: typeof navigation.redirect = navigation.redirect;
export const permanentRedirect: typeof navigation.permanentRedirect =
  navigation.permanentRedirect;
