# Estado del sistema

Última actualización: 27 de agosto de 2026, al terminar la fase 6.

Este documento es para dos personas: la dueña del sistema, y quien lo agarre dentro de seis meses sin haber estado en ninguna de las conversaciones. Dice qué hace, qué deliberadamente no hace, qué todavía no se probó de verdad, y qué cosas parecen errores pero no lo son.

---

## Qué hace

Este sistema organiza viajes grupales cerrados: grupos de alrededor de catorce personas más dos coordinadoras, con fechas fijas y un precio cerrado por persona. La coordinadora arma el viaje —itinerario, hoteles, lo que le cuesta a ella cada cosa— y el sistema le va mostrando cuánto le queda de margen mientras carga los precios de venta. Después invita a las pasajeras por mail: cada una entra con un link, elige su contraseña y completa sus propios datos —documento, pasaporte, contacto de emergencia, cobertura médica, si es celíaca o si necesita habitación accesible— sin que la coordinadora tenga que perseguirla por WhatsApp ni cargar nada a mano.

Desde la fase 7 el sistema toma el embudo antes: la página de Wix se queda como está, pero su botón de "más información" lleva a una pantalla pública donde una interesada deja sus datos y crea su cuenta. Las coordinadoras la ven aparecer en un listado, coordinan la charla por Zoom por fuera del sistema, y cuando decide venir la convierten en pasajera con un clic — sin volver a pedirle el nombre ni el teléfono, porque ya los cargó ella. Una interesada no ocupa cupo y no ve nada del sistema interno: solo la propuesta del viaje y qué tiene que hacer a continuación.

La otra mitad es la plata. Cada pasajera tiene un plan de cuotas con vencimientos; cuando transfiere, sube el comprobante y avisa desde su teléfono. La coordinadora revisa contra su extracto bancario y confirma o rechaza con un motivo. Un semáforo verde, amarillo o rojo muestra de un vistazo quién está al día y quién no, y el sistema manda solo los recordatorios de cuota y los avisos de pasaporte por vencer. Al final se descargan las planillas que pide el hotel: quiénes viajan, quién duerme con quién, y cómo viene la cobranza. Todo funciona en dos idiomas —español e inglés— y las pantallas de la pasajera están hechas para un teléfono, no para una computadora.

---

## Fuera de alcance, por decisión

No son cosas que faltaron: se decidieron y no se van a hacer sin volver a discutirlas.

### Pasarela de pago online

No hay Mercado Pago, Stripe ni nada parecido. Las pasajeras transfieren por su banco y suben el comprobante; una persona confirma cada pago mirando el extracto.

**Por qué:** son grupos de catorce personas con seis cuotas, o sea unos ochenta pagos en varios meses. Integrar una pasarela habría sumado comisiones sobre cada cuota, conciliación automática que igual hay que revisar a mano cuando algo no cierra, y un proveedor externo del que depender. Revisar ochenta comprobantes a lo largo de un año es trabajo, pero es poco trabajo.

**Si algún día se hace:** el modelo ya está preparado. `Payment` tiene los campos `provider` y `externalId` sin usar, esperando exactamente esto.

### Módulo de costos reales y rentabilidad

El sistema calcula el margen **presupuestado**: lo que la coordinadora estima que le va a costar contra lo que cobra. No registra lo que terminó gastando de verdad, ni compara presupuesto contra real, ni saca rentabilidad al cierre del viaje.

**Por qué:** eso es contabilidad, y la contabilidad de este negocio ya vive en otro lado. Duplicarla acá habría significado tener dos números distintos para la misma pregunta, y cuando divergen ninguno de los dos es la verdad.

### ~~No hay registro abierto~~ · REVERTIDA en la fase 7 (28/08/2026)

Hasta la fase 6, al sistema **solo se entraba por invitación**. Desde la fase 7 ya no: `/interes` es una pantalla **pública, sin sesión**, que crea una cuenta.

**Por qué cambió:** la fase 7 movió el alcance del sistema. Antes empezaba cuando la coordinadora invitaba a alguien que ya había decidido viajar; ahora empieza en el clic de "más información" de la página de Wix. Ese clic lo da una desconocida, y no hay a quién pedirle una invitación.

**Lo que hay que saber, y es lo importante de este párrafo:** `/interes` es **la primera y única superficie del sistema que crea usuarios sin invitación**. Es la puerta que antes no existía. Si algún día aparece una cuenta que nadie reconoce, este es el lugar por donde entró.

Lo que la acota:

- tiene que haber un viaje con `acceptingInterest` en true, y como máximo puede haber uno (lo garantiza un índice de Postgres, no una validación);
- rate limiting en tres capas: por IP, por mail y un **tope global diario** — las dos primeras se esquivan rotando IP y casilla, el tercero no;
- **la cuenta que crea nace sin ningún `TripMember`**, o sea sin acceso a nada del sistema interno. Convertirla en pasajera es un acto manual de la coordinadora.

### Y además

- No hay app móvil nativa. Es una web, pensada para el teléfono.
- No hay chat ni mensajería interna. Las comunicaciones son de la coordinadora al grupo, por mail.

---

## Construido pero NO verificado en condiciones reales

🔴 **Esto es lo más importante de todo el documento.** Lo que sigue está escrito, testeado y funcionando en desarrollo, pero nunca se ejerció contra el mundo real. No es lo mismo.

### Los mails nunca se mandaron a una casilla de verdad

El adaptador de Brevo está implementado y el sistema tiene dos modos: `console` (escribe el mail en la terminal) y `brevo` (lo manda de verdad). **Todo el desarrollo se hizo en modo `console`.** Ningún mail de este sistema llegó nunca a una casilla real.

Lo que eso significa concretamente:

- Las seis plantillas se ven bien **en un navegador**. Cómo se ven en Gmail, en Outlook o en el mail del iPhone es una incógnita: los clientes de mail rompen HTML de formas que ningún navegador reproduce. Las plantillas están hechas con tablas, estilos inline y 600px de ancho justamente por eso, pero eso es una precaución, no una verificación.
- No se sabe si caen en spam.
- No se probó el circuito completo: invitación → mail → link → canje.

Hay un comando para probarlo: `npm run email:test` manda las plantillas a una casilla que le indiques. **Hacer eso es el primer paso antes de usar el sistema con gente real.**

### La zona pública nunca recibió a nadie de verdad

`/interes` está construida, testeada y funcionando en desarrollo, pero **ninguna persona ajena al equipo la usó todavía**. Lo que no se ejerció:

- **El embudo completo**: clic en el botón de Wix → registro → mail a las coordinadoras → conversación por WhatsApp → conversión a pasajera. Cada tramo funciona por separado.
- **El mail de aviso de interesada nueva**, que es la séptima plantilla y comparte el destino de todas las demás: nunca llegó a una casilla real (ver arriba).
- **El botón de Wix**: hay que pegar la URL de `/interes` en la página, y eso todavía no se hizo. La URL está a la vista en el paso 6 del wizard.
- **El rate limiting bajo tráfico real.** El tope global diario es de 200 y está pensado como fusible, no como medida fina. Si una campaña de Instagram funciona muy bien, ese número se queda corto antes que cualquier otra cosa.

**Lo primero que hay que hacer antes de publicar el botón:** cargar los textos de marca desde el paso 6 del wizard. Sin ellos la pantalla muestra el nombre del viaje y el formulario, sin propuesta y sin decirle a la interesada qué sigue.

### Nunca corrió en Vercel

Todo el desarrollo fue local. La aplicación nunca se desplegó.

Lo que cambia en producción y no se puede ensayar en una máquina:

- **El proceso corre en UTC.** El código ya tiene esto en cuenta en los dos lugares donde importa (los vencimientos usan la zona del viaje, y las exportaciones se sellan con `formatDateTimeInZone`), pero está contemplado, no observado.
- **Cada request puede caer en una instancia distinta.** Por eso el rate limiting vive en la base y no en memoria. Tampoco está observado.
- **El cron dispara con hasta una hora de diferencia** respecto de la hora programada, en el plan gratuito. Todo el diseño de recordatorios asume esa ventana.
- **Los tiempos de arranque en frío** contra una base que también puede estar pausada por inactividad.

El checklist para desplegarlo está en [DEPLOY.md](DEPLOY.md), con una sección final de verificación. Está escrito con cuidado, pero también está sin ejercer.

---

## Deuda técnica conocida

### La suite de integración tarda 17 minutos

211 tests contra la base real de Supabase. La causa **no es el código**: los tests comparten un pool de una sola conexión (`max: 1`), así que las consultas de un mismo caso se serializan y cada una paga un viaje de ida y vuelta por la red. Lo que se mide es latencia, no lentitud.

**Solución conocida, no aplicada:** correrlos contra un Postgres local en Docker bajaría el tiempo un orden de magnitud.

**Por qué no se hizo:** hoy 17 minutos es tolerable. Con el doble de tests no lo va a ser. Si te encontrás evitando correr la suite porque tarda, ese es el momento.

### ~~La restauración completa del backup no se probó~~ · RESUELTA el 27/08/2026

El backup guarda tres piezas, y **las tres están verificadas**:

- ✅ **Storage.** Se subieron objetos al bucket real, se respaldaron, se borraron, se restauraron y se volvieron a bajar para comparar: idénticos byte a byte.
- ✅ **Datos (`public.sql`).** Restaurados contra un Postgres 17 limpio en Docker: 22 tablas, cero errores.
- ✅ **Cuentas de Auth.** Restauradas con el paso 4 del procedimiento: 6 de 6 usuarios, con el mail confirmado, con los `id` cruzando contra `public."User"`, y con los hashes de contraseña **idénticos al origen** (mismo `md5()` de todos concatenados). Correr el paso dos veces no duplica nada.

Queda una sola cosa que no se puede probar fuera de Supabase: **el inicio de sesión de punta a punta**, porque lo resuelve GoTrue y GoTrue solo corre dentro de Supabase. Lo que sí está demostrado es todo lo que el login necesita para funcionar.

La prueba dejó al descubierto algo que conviene saber antes de una emergencia: **un Postgres pelado no tiene el schema `auth`** —lo crea Supabase—, y el dump de cuentas es `--data-only`. Restaurar contra algo que no sea un proyecto Supabase falla con `relation "auth.users" does not exist`. El detalle está en [README §Backups](README.md#la-restauración-completa-probada).

### La página pública manda al navegador el catálogo de traducciones entero

`/interes` es una pantalla **sin sesión**, y como toda página de la aplicación recibe el catálogo completo de `src/messages/*.json` en el HTML. Eso incluye los rótulos del panel de coordinación: «Margen por pasajero», «Costo indirecto», «Cola de revisión».

**Lo que NO pasa, y está verificado:** no se filtra ningún **dato** del viaje. Ni precios, ni cupos, ni fechas, ni nombres de pasajeras. Lo que viaja son las etiquetas de la interfaz, no los valores. La página lee el viaje con `getPublicTrip()`, que selecciona campo por campo.

**Qué se ve entonces:** los nombres de las funciones internas del sistema, para quien abra el código fuente de la página. Es divulgación de estructura, no de datos.

**Por qué está así:** es el comportamiento por defecto de `next-intl` y aplica a **todas** las páginas, no solo a esta. No lo introdujo la fase 7; lo que cambió es que ahora una de esas páginas es pública.

**Cómo se arregla, si alguna vez importa:** pasarle a `NextIntlClientProvider` solo los namespaces que cada página usa, en vez del catálogo entero. Es un cambio transversal a todas las pantallas y por eso no se hizo dentro de la fase 7.

### Retención de datos de interesadas que nunca se convirtieron

Cuando alguien se anota en `/interes`, el sistema le crea una **cuenta y una `Person`** con su nombre, país y teléfono. Si esa persona nunca se convierte en pasajera —porque la descartaron, o porque no volvió a escribir— esas filas **quedan para siempre**. No hay borrado, ni automático ni a mano.

**Por qué está así:** la fase 7 tenía que resolver el embudo, y un módulo de retención es un tema propio (¿a los cuántos meses?, ¿lo decide una persona o un cron?, ¿se avisa antes?). Meterlo a último momento habría sido peor que dejarlo escrito acá.

**Por qué importa igual, y no es lo mismo que el resto de los datos del sistema:** todas las demás personas de la base tienen una relación comercial con el cliente — pagaron, o al menos fueron invitadas a un viaje concreto. Una interesada `DESCARTADA` no tuvo ninguna. Son datos personales de gente que preguntó una vez y se fue.

**El volumen es chico** (unas decenas por año, con dos viajes anuales), así que no es urgente. Pero es una decisión que alguien tiene que tomar, no un olvido.

### Sin dominio propio, los mails pueden caer en spam

Si el sistema manda desde una dirección de un dominio que no está autenticado, Gmail y Outlook lo tratan con desconfianza. No es un problema del código: es cómo funciona el correo.

**Qué hace falta:** un dominio propio, y cargar los registros DKIM y SPF que indica Brevo en el DNS de ese dominio. Está en [DEPLOY.md](DEPLOY.md), paso 2.

**Mientras tanto:** el sistema está diseñado para que un mail perdido no rompa nada. Todo lo que se avisa por mail está también en la pantalla de la pasajera, y el link de invitación se muestra en pantalla al crearla, para mandarlo por WhatsApp. Eso es una mitigación, no una solución.

---

## Decisiones que parecen errores y no lo son

Si llegaste acá con ganas de limpiar el código, leé esto primero. Cada una de estas cosas se ve rara, y cada una está así por una razón que costó encontrar.

### 1. Una cuota vencida se calcula al leer, no se guarda

`Installment` **no tiene columna de estado**. Que una cuota esté PAGADA, VENCIDA, EN_REVISION o PENDIENTE se deriva cada vez que se lee, en `derivePlan()`.

**Por qué no un campo:** un campo guardado depende de que un proceso lo haya actualizado. El cron de Vercel dispara con hasta una hora de ventana, así que el semáforo mentiría justo el día del vencimiento — el único día que importa.

**Lo que se guarda sí es `SentReminder`**, y contesta una pregunta distinta: "¿ya mandamos este aviso?", nunca "¿está vencida?".

### 2. `max: 1` en el pool de conexiones, escrito en código

Sí, uno. Y sí, va en `lib/db/prisma.ts` y no en la URL.

**Por qué en código:** Prisma 7 dejó de traer su motor propio y ahora habla con Postgres a través del driver `pg`. Los parámetros `?pgbouncer=true&connection_limit=1` de la connection string eran directivas del motor de Prisma. **`pg` no los conoce**: los parsea como propiedades sueltas sin significado y los ignora. El pool queda en el default de `pg`, que es 10 — por instancia.

**Por qué uno:** en Vercel cada instancia concurrente abriría hasta diez conexiones contra un pooler de Supabase que en el plan gratuito admite pocas decenas en total. El síntoma aparece solo bajo concurrencia, que es la peor forma de enterarse.

Si "arreglás" esto subiendo el número o moviéndolo a la URL, el sistema va a andar perfecto en desarrollo y va a fallar de forma intermitente en producción. `npm run check:db` verifica que el límite efectivo sea el que se espera.

### 3. `decimal.js`, no `Prisma.Decimal`

Todo el dinero pasa por `decimal.js`. Nunca por `number`, y nunca por `Prisma.Decimal` en código que comparten el cliente y el servidor.

**Por qué no `number`:** es un float. `0.1 + 0.2` no da `0.3`, y con plata eso es inaceptable.

**Por qué no `Prisma.Decimal`, que ya viene incluido:** arrastra `node:process`. Si un módulo que lo importa termina en el bundle del navegador, el build rompe. Y como `lib/domain/` está pensado justamente para poder usarse desde componentes del navegador, la regla es absoluta.

`npm run check:layers` verifica que `lib/domain/` no importe nada del servidor, así que si intentás cambiar esto el chequeo te lo va a decir.

### 4. `CalendarDate` es un tipo propio, y `derivePlan()` no acepta `Date`

Hay un tipo `CalendarDate` en `lib/domain/calendar.ts` que es, literalmente, un string tipo `"2026-08-26"`.

**Por qué no usar `Date`:** un `Date` es un instante, no un día. A las 22:00 del 26 en Buenos Aires ya es el 27 en UTC, así que una cuota que vence el 26 aparecía vencida **tres horas antes de que terminara el día de la pasajera**.

**Por qué no sumar tres horas y listo:** porque eso es parchar el síntoma. La solución fue dejar de trabajar con instantes: el instante se convierte a día **una sola vez**, en la capa de servicios, usando la zona del viaje. De ahí para adentro todo son días de calendario.

Por eso `derivePlan()` y `suggestDueDates()` rechazan `Date` a propósito. No es una molestia: es la barrera que impide que el bug vuelva.

### 5. El escritor de `.xlsx` es propio y no comprime

`lib/domain/xlsx.ts` escribe archivos de Excel desde cero, sin librerías, y arma el ZIP **sin comprimir**.

**Por qué sin librería:** un `.xlsx` es un ZIP con unos pocos XML adentro. Para lo que hace falta —una hoja, encabezados en negrita, anchos de columna— son doscientas líneas, contra un megabyte de dependencia y sus transitivas para tres pantallas.

**Por qué sin comprimir:** comprimir requiere `node:zlib`, y eso convertiría al módulo en código de servidor: dejaría de ser puro, no podría vivir en `lib/domain/` y `check:layers` lo rechazaría con razón. El costo es tamaño —un listado de cincuenta pasajeras pesa 60 KB en vez de 8— y para un adjunto de mail eso no es nada.

Si algún día hay que exportar decenas de miles de filas, ese es el momento de agregar compresión, y ahí el módulo se muda a `lib/services/`.

### 6. `Passenger` y `Person` se tocan desde un solo archivo

Toda consulta a esas dos tablas pasa por `lib/services/passengers.ts`, que aplica `passengerVisibilityFilter()`.

**Por qué:** ahí viven los datos personales —pasaportes, contactos de emergencia, información de salud— y el filtro es lo que hace que una pasajera se vea solo a sí misma. Si cada endpoint armara su propio `where`, alcanzaría con que uno se olvidara del filtro para exponer las fichas de todo el grupo. Con un solo módulo, esa clase de error tiene un solo lugar donde poder ocurrir.

El filtro además **falla cerrado**: para alguien sin acceso devuelve una condición imposible en vez de un `where` vacío. Si por error se omitiera el guard, la consulta trae cero filas en lugar de traerlas todas.

**Hay exactamente una excepción**, en `lib/auth/passenger-bootstrap.ts`, y está en su propio archivo para que se pueda verificar de un vistazo. Existe porque `passengers.ts` necesita saber quién está mirando, y averiguarlo exige leer la tabla: es circular. Esa función no decide nada y solo devuelve ids. Si algún día necesita devolver un dato que no sea un id, dejó de ser una excepción de arranque y hay que rediscutirla.

`npm run check:layers` hace cumplir esta regla.

---

## Por dónde empezar si acabás de llegar

1. **[README.md](README.md)** — el porqué de cada decisión, con detalle.
2. **[AGENTS.md](AGENTS.md)** — los invariantes, en una página.
3. **[README §Arquitectura](README.md#arquitectura)** — el árbol y las reglas entre capas.
4. `npm run verify` — si eso pasa, no rompiste nada. Tarda unos veinte minutos por la suite de integración.

Y antes de "simplificar" algo que se ve raro: buscá el comentario que lo explica. Casi todo lo que parece innecesario en este código tiene tres líneas arriba diciendo qué pasó la vez que no estaba.
