# Tareas

Le pertenece a este documento: el backlog accionable, con responsable y
próximo paso concreto. Está en otro lado: la deuda técnica en
[ESTADO.md](ESTADO.md) (acá se linkea, no se copia), el checklist completo
de puesta en producción en [DEPLOY.md](DEPLOY.md), el detalle de cada fase
cerrada en [PROGRESO.md](PROGRESO.md).

Responsables: **[DEV]** lo hace Claude Code · **[USUARIO]** lo hace Pablo
(deploy, Brevo, GitHub, Docker) · **[CLIENTE]** lo hacen Laura y Lorena
(textos de marca, dominio). Un tag combinado (ej. **[USUARIO/DEV]**) marca
algo que necesita una decisión del usuario antes de que el DEV lo pueda
implementar — no es una cuarta categoría, es que ninguna de las tres solas
alcanza.

---

## Pendientes

Agrupadas por responsable, ordenadas por qué bloquea a qué — no por
importancia.

### [USUARIO/DEV]

- **El cron de Vercel responde 405 — el sistema nunca manda recordatorios,
  ni avisos de pasaporte, ni purga rate limiting.** Postergado a pedido del
  cliente (2026-09-08): total, sin Brevo configurado todavía no saldría
  ningún mail igual. Anotado para no arrancar de cero cuando se retome.
  - **La causa, ya diagnosticada:** Vercel invoca los crons con **GET**
    (`/docs/cron-jobs`, verificado en la documentación), pero
    `src/app/api/cron/daily/route.ts` solo exporta `POST`. Un GET real
    devuelve 405 sin ejecutar nada y sin ninguna alerta visible.
    `vercel.json` está bien (path, schedule, y el endpoint valida
    `CRON_SECRET` en tiempo constante) — el problema es solo el verbo.
  - **Por qué el código está en POST a propósito, y por qué ese argumento
    no aplica:** el docblock de la ruta dice que un GET expondría el
    secreto en los logs de acceso. Es un argumento correcto en general,
    pero no acá: el secreto viaja en la cabecera `Authorization`, no en
    la URL.
  - **La suite no lo detecta:** `tests/integration/cron.test.ts` llama a
    `POST` directamente, y tiene un test que afirma que "un GET no ejecuta
    nada" — que sigue siendo cierto pero ya no es lo que importa en
    producción.
  - **Opciones para resolver, sin decidir todavía:** exportar un `GET` que
    delegue en la misma función que `POST`, o dejar el código como está y
    disparar el cron desde otro lado (otro servicio, un webhook externo).
    Requiere decisión del usuario, no es una corrección obvia — de ahí el
    tag combinado.
  - **La consecuencia que no es obvia, y por eso se anota aparte:** sin el
    cron corriendo, tampoco corre ningún keep-alive contra la base.
    Supabase puede pausar un proyecto por inactividad en el plan gratuito.
    **Si en algún momento el sistema aparece caído sin ninguna explicación
    visible, este es el primer lugar donde mirar** — antes de sospechar de
    un bug nuevo.

### [DEV]

- **Preparar la demo guiada** del sistema para mostrarle a Laura y Lorena.
  Depende de que haya, al menos, un primer paso de los textos de marca
  reales cargados (ver más abajo, [CLIENTE]).

### [USUARIO] — Pablo

- **Pushear los commits locales.** El branch está adelantado respecto de
  `origin/main`; conviene sincronizar antes de que se acumulen más.
- **Deploy a Vercel por primera vez.** Nunca corrió en producción. Checklist
  completo en [DEPLOY.md §3](DEPLOY.md#3--vercel). Bloqueado por: nada
  técnico, pero tiene más sentido después de cerrar la fase 8.
- **Probar Brevo contra una casilla real** con `npm run email:test`. Todo
  el desarrollo se hizo en modo `console`; ningún mail de este sistema
  llegó nunca a una casilla de verdad. Ver
  [ESTADO §Los mails nunca se mandaron a una casilla de verdad](ESTADO.md#los-mails-nunca-se-mandaron-a-una-casilla-de-verdad).
- **Pegar la URL de `/interes` en el botón de Wix.** Todavía no se hizo.
  Bloqueado por: que las coordinadoras carguen los textos de marca primero
  (ver [CLIENTE]) — sin ellos la pantalla pública queda sin propuesta y sin
  decirle a la interesada qué sigue.
- **Correr el workflow de backup a mano una vez** (*Actions → Backup
  semanal → Run workflow*) y confirmar que termina en verde. Checklist en
  [DEPLOY.md §4](DEPLOY.md#4--github-backups).
- **Guardar la `BACKUP_PASSPHRASE` fuera de GitHub**, en un gestor de
  contraseñas. Sin ella los backups son irrecuperables.

### [CLIENTE] — Laura y Lorena

- **Cargar los textos reales de marca** desde el paso 6 del wizard:
  propuesta del viaje, bienvenida, "qué sigue", firma de los mails, y —
  nuevo en la fase 8 — la condición de no reembolsable de la seña y las
  instrucciones de pago. Es el primer paso antes de publicar el botón de
  Wix: sin estos textos la pantalla pública muestra el formulario pelado.
- **Conseguir un dominio propio**, cuando el presupuesto lo permita. Hoy
  los mails salen sin DKIM/SPF autenticados, lo que aumenta el riesgo de
  caer en spam. Ver [CONTEXTO §Restricciones del cliente](CONTEXTO.md#restricciones-del-cliente).

---

## Completadas

Resumidas por fase. Detalle completo, con commits y hallazgos, en
[PROGRESO.md](PROGRESO.md).

- **Fase 8 — la seña.** Ya commiteada (`a2d11df Fase 8 completa`, más
  ajustes en `006bbce` y `4a26b5f`). El punto anterior de este documento
  decía lo contrario; estaba desactualizado.
- **Ocho cambios pedidos por el cliente (2026-09-08/09), sin fase
  asignada todavía:** guardado por paso que nunca avanza en silencio si
  falla (y el mismo bug en el wizard de presupuesto); botón Atrás en el
  wizard (ya existía); link del hotel; fechas del itinerario acotadas al
  viaje; "Siguiente" guarda las filas a medio cargar; renombre de
  "Costos por pasajero"; el tipo de habitación lo elige la pasajera, no
  la coordinadora al convertir; y se sacó el número de póliza del
  sistema. Tres commits, `npm run verify` completo en verde (252 tests de
  integración). Detalle en el historial de sesión de esas fechas si hace
  falta releerlo — no quedó en [PROGRESO.md](PROGRESO.md) porque el
  cliente no dijo "fase aprobada".
- **Fase 7** — la interesada y la zona pública: registro sin sesión,
  aislamiento por ausencia de `TripMember`, textos de marca como dato.
- **Fase 6** — cierre: exportaciones a Excel, backup completo (datos +
  cuentas + Storage), panel de administración, límites entre capas
  verificados por el linter.
- **Fase 5** — comunicaciones y automatización: cron diario, recordatorios
  idempotentes, plantillas en es/en, envío masivo por lotes.
- **Fase 4** — pagos: plan de cuotas, revisión de comprobantes, semáforo,
  estado derivado al leer.
- **Fase 3** — pasajeros e invitaciones: alta con token hasheado, registro
  en 3 pasos, subida de archivos, habitaciones.
- **Fase 2** — motor de cálculo puro y wizard de presupuesto de 5 pasos.
- **Fase 1** — fundaciones: modelo de datos, autorización con tres roles,
  i18n, mail, backups.
