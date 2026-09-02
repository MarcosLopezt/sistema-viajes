# Tareas

Le pertenece a este documento: el backlog accionable, con responsable y
próximo paso concreto. Está en otro lado: la deuda técnica en
[ESTADO.md](ESTADO.md) (acá se linkea, no se copia), el checklist completo
de puesta en producción en [DEPLOY.md](DEPLOY.md), el detalle de cada fase
cerrada en [PROGRESO.md](PROGRESO.md).

Responsables: **[DEV]** lo hace Claude Code · **[USUARIO]** lo hace Pablo
(deploy, Brevo, GitHub, Docker) · **[CLIENTE]** lo hacen Laura y Lorena
(textos de marca, dominio).

---

## Pendientes

Agrupadas por responsable, ordenadas por qué bloquea a qué — no por
importancia.

### [DEV]

- **Cerrar la fase 8.** El working tree tiene, sin commitear: la migración
  `20260831120000_fase8_sena`, el motor y servicio de depósitos
  (`src/lib/services/deposits.ts`), la validación, la ruta
  `/api/senas/[depositId]`, y —a diferencia de lo que se venía asumiendo—
  también las dos pantallas ya escritas y conectadas: la cola de depósitos
  del coordinador y el formulario de seña de la interesada. Falta correr
  `npm run verify` sobre todo eso y confirmar con hechos, no con memoria,
  que compila y pasa antes de commitear. Ver la nota en
  [SESION.md](SESION.md).
- **Preparar la demo guiada** del sistema para mostrarle a Laura y Lorena.
  Depende de que la fase 8 esté cerrada y de que haya, al menos, un primer
  paso de los textos de marca reales cargados (ver más abajo, [CLIENTE]).

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

## En curso

- **Fase 8 — la seña.** Motor, servicio, validación, migración y ruta de
  API escritos; también las dos pantallas (cola de revisión del
  coordinador, formulario de la interesada) y los campos nuevos del
  wizard para configurar monto y condiciones. Nada de esto está
  commiteado todavía. Próximo paso: `npm run verify`. Detalle en
  [SESION.md](SESION.md).

---

## Completadas

Resumidas por fase. Detalle completo, con commits y hallazgos, en
[PROGRESO.md](PROGRESO.md).

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
