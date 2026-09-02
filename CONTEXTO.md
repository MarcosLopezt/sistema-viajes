# Contexto de negocio

Le pertenece a este documento: el negocio detrás del sistema — quién es el
cliente, el embudo real, qué reemplazó, el glosario de negocio y las
decisiones de producto y sus porqués. Está en otro lado: la arquitectura y
las decisiones técnicas en [README.md](README.md), la deuda técnica y lo
todavía no verificado en [ESTADO.md](ESTADO.md), los invariantes que rigen
el código en [AGENTS.md](AGENTS.md).

---

## Quién es el cliente

Una escuela de viajes grupales espirituales. Dos coordinadoras. Viajes
cerrados de alrededor de catorce pasajeras cada uno, dos viajes por año
(mayo y octubre, aproximadamente), nunca simultáneos.

Esto último es una práctica del negocio, no una regla que el sistema
imponga: técnicamente pueden convivir dos `Trip` en estado `ABIERTO` al
mismo tiempo. Lo único que la base fuerza a que sea único es qué viaje
está **captando interesadas** (`Trip.acceptingInterest`, ver
[README §El índice que Prisma no conoce](README.md#trip_una_sola_captacion_abierta-un-índice-que-prisma-no-conoce)),
que es un recorte más chico que "un solo viaje a la vez".

## El embudo real, de punta a punta

```
Wix (afuera)
  → botón "más información"
  → /interes — registro público, sin sesión (adentro)
  → coordinación de la charla por WhatsApp (afuera)
  → reunión por Zoom (afuera)
  → paga la seña, sube el comprobante (adentro, fase 8)
  → la coordinadora la convierte en pasajera, con un clic (adentro)
  → completa sus datos en 3 pasos con autoguardado (adentro)
  → plan de cuotas, pagos y seguimiento (adentro)
  → viaje
```

Lo que pasa **fuera del sistema** y por qué:

- **La página de Wix.** El sistema no reemplaza el sitio de marketing.
  Las coordinadoras lo editan ellas mismas y van a seguir haciéndolo; el
  sistema solo es el destino de un botón.
- **La coordinación de la charla, por WhatsApp.** No hay un calendario ni
  una agenda de Zoom integrados. Es una conversación humana entre la
  coordinadora y la interesada, y así se decidió que quede.
- **La reunión por Zoom en sí.** Es donde se vende el viaje de verdad; el
  sistema no participa.

Todo lo demás —desde que alguien decide pagar la seña hasta que termina el
viaje— pasa dentro del sistema.

## Qué reemplazó el sistema

Antes: Google Forms para juntar datos, mails sueltos para avisos y
seguimiento, y una planilla para llevar la cuenta de quién pagó qué. Tres
herramientas separadas que no se hablaban entre sí, y que dependían de que
alguien copiara datos de una a la otra a mano.

Lo único que se mantiene tal cual es **Wix**: el sitio de marketing, que
las coordinadoras editan directamente y no depende de este sistema.

## Glosario

Con el significado que usa el negocio, no el nombre de la tabla o el campo
en el código.

| Término | Qué es para el negocio |
|---|---|
| **Interesada** | Alguien que llenó el formulario público después de ver el botón de Wix. Todavía no pagó nada ni se comprometió. No ocupa un lugar del viaje y no ve nada del sistema interno: solo la propuesta y qué sigue. |
| **Pasajera** | Una interesada que la coordinadora convirtió a mano, típicamente después de la charla por Zoom y de pagar la seña. Recién ahí tiene ficha completa, plan de cuotas y acceso a "mis pagos" / "mis datos". |
| **Coordinadora** | Quien arma el viaje: itinerario, hoteles, costos, precios; invita, revisa pagos, manda comunicaciones. Hay dos, y el rol es por viaje, no global: una coordinadora de un viaje puede viajar como pasajera en otro. |
| **Seña** | El pago inicial que hace una interesada para reservar su lugar, antes de convertirse en pasajera y antes de que exista ningún plan de cuotas. No reembolsable. Es la pieza que agrega la fase 8. |
| **Base doble / single** | El tipo de habitación: doble es compartida con otra pasajera, single es individual. Cada una tiene su propio precio de lista, y son la unidad sobre la que se arma todo el presupuesto. |
| **Costo directo** | Lo que depende de cuántas pasajeras haya: noches de hotel, traslados por persona. Se factura por base (doble o single). |
| **Costo indirecto** | Lo que NO depende del número de pasajeras: guías, gastos fijos del grupo, el alojamiento de las propias coordinadoras. Se prorratea entre las pasajeras facturables. |
| **Margen** | Precio de venta menos costo, calculado **sobre el precio de venta** (no es markup sobre el costo). Por pasajera es directo; el total depende de cuántas terminen en cada base y por eso siempre se declara junto con esa mezcla. |

## Decisiones de producto y por qué se tomaron

### La seña no es reembolsable

Está implementado en el código, no es solo una intención: la interesada
tiene que aceptar el texto de la condición de no reembolsable —completo,
en pantalla, no detrás de un link— antes de que el formulario de la seña
se pueda enviar.

### No reemplazar Wix

El sitio de marketing sigue siendo Wix, editado por las coordinadoras. El
sistema entra recién en el clic del botón. Construir un sitio de marketing
propio no estaba en el problema que había que resolver.

### Sin lista de espera

No hay ningún modelo de lista de espera en el schema. Si un viaje se llena,
no hay una cola formal esperando un lugar liberado dentro del sistema.

### La voz de marca es dato editable, no código

Los textos que la interesada y la pasajera leen —la propuesta del viaje, la
bienvenida, "qué sigue", la firma de los mails, la condición de no
reembolsable de la seña y las instrucciones de pago— viven como campos de
`Trip`, editables por las coordinadoras desde el wizard. Ningún cambio de
tono o de wording pasa por un deploy. El invariante correspondiente está en
[AGENTS.md](AGENTS.md).

### Pagos a cuentas distintas según el país

Las pasajeras transfieren a distintas cuentas bancarias según su país de
residencia, y eso se acuerda una por una — no hay una regla automática que
lo resuelva. Al momento de escribir este documento, el modelo de datos
**todavía no representa esa variación por país**: la migración de la fase
8 (sin commitear) agrega `Passenger.paymentInstructions` como texto libre
por pasajera, que sirve de override manual sobre las instrucciones por
defecto del viaje — un remiendo razonable, no un modelo de "cuenta por
país". Si esto se vuelve doloroso de mantener a mano, es una señal de que
conviene modelarlo de verdad.

## Restricciones del cliente

- **Presupuesto cero en infraestructura.** Por eso todo el stack elegido
  tiene plan gratuito: Supabase, Vercel, Brevo, GitHub Actions. Las
  decisiones de `max: 1` en el pool de conexiones, de no usar una pasarela
  de pago y de no correr los tests de integración contra un Postgres
  dedicado están todas aguas abajo de esta restricción.
- **Sin dominio propio todavía.** Consecuencia directa: los mails salen
  desde un dominio sin autenticar (sin DKIM/SPF propios), lo que aumenta el
  riesgo de que caigan en spam. Ver
  [ESTADO §Sin dominio propio](ESTADO.md#sin-dominio-propio-los-mails-pueden-caer-en-spam).
