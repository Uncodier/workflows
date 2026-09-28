# Salud observada de canales y ahorro de recursos de prospección

La configuración (`settings.channels`) y la salud observada son conceptos
distintos. La migración `supabase/migrations/20260928203000_channel_health.sql`
añade `channel_health_events` (eventos deduplicados) y `channel_health`
(snapshot por `site_id`, `email|whatsapp` y `inbound|outbound`). RLS está activo:
solo `service_role` puede leer estos datos y la escritura se canaliza por
funciones/triggers. No se guardan cuerpos de mensajes, correos, números ni
credenciales. No se cambian los flags `enabled` o `status` de los canales.

## Eventos y decisiones

- Salida: el trigger observa el resultado **persistido** en
  `messages.custom_data.delivery` después del envío. La clave única del
  mensaje impide contar dos veces reintentos/replays; un éxito posterior
  reemplaza una falla del mismo mensaje.
- Entrada WhatsApp/email: un mensaje entrante persistido con
  `origin_message_id` aporta un éxito de ingestión. La sincronización IMAP
  observa `settings.channels.email` cuando cambia `last_sync_attempt`, siempre
  que `sync_status` y `last_sync_error` den un resultado inequívoco. No se
  equipara una respuesta de IA con una entrega entrante del proveedor. No se
  registran fallas de webhooks que nunca llegaron al sistema: requieren
  instrumentación en la API que recibe al proveedor.
- Solo fallas categorizadas `auth` o `provider` afectan la salud. Destinatario
  inválido, falta de aprobación, templates y errores de contenido no apagan
  un canal ni alteran la fecha de la última falla atribuible. La clasificación
  desconocida queda como dato de diagnóstico.
- Los triggers solo aceptan observaciones cuando la escritura se hace con el
  rol SQL `service_role` (o el propietario `postgres`). Si la API receptora
  escribe como `authenticated`, no aportará evidencia de salida/entrada;
  debe integrarse por una ruta privilegiada y auditada, sin permitir que el
  cliente simule un éxito modificando `custom_data`.
- En 15 minutos: 2 fallas de autenticación, o al menos 5 fallas de proveedor
  con una tasa >=50%, dejan `unhealthy`; la primera falla atribuible deja
  `degraded`. Dos éxitos posteriores permiten recuperar `healthy`.
- Los workflows que consumen tokens/créditos solo pasan si existe **éxito
  real de salida dentro de las últimas 24 horas**, el snapshot es reciente,
  la configuración actual fue corroborada por ese éxito y el estado es
  `healthy`. `unknown`, `degraded`, `unhealthy` y ausencia de tráfico **no
  habilitan** nuevos trabajos caros. El filtro usa solo salida; salud de IMAP
  o recepción WhatsApp no demuestra capacidad de enviar.
- Una reconfiguración de identidad/credenciales reinicia solo el snapshot de
  salida; el historial permanece para auditoría y no sirve para habilitar la
  configuración nueva. Reintentos del mismo mensaje anterior al reinicio no
  habilitan las credenciales nuevas. Los campos rutinarios de sincronización no provocan
  ese reinicio. Si un envío iniciado **antes** de cambiar las credenciales
  completa **después** del cambio, los datos actuales de `messages` no permiten
  atribuirlo de forma fiable a la configuración anterior: para cerrar este
  margen habría que incluir un identificador de versión de credenciales en la
  ruta de envío y persistirlo junto al resultado.

La comprobación se hace antes de la selección con IA y antes de nuevas
verificaciones Reoon en seguimiento individual. Abarca prospección diaria,
calificación, generación de leads, cuentas estratégicas, ICP mining y las
búsquedas paginadas de ICP/dominio que se inicien directamente.
Los cambios en las secuencias de actividades están protegidos con `patched`
para no reinterpretar historiales antiguos de Temporal. Los mensajes ya
aprobados **no se bloquean**: pueden producir una señal real de recuperación.

## Orden de despliegue y límites

1. Aplicar la migración **antes** de desplegar los workers. El proyecto usa
   migrations versionadas y no las aplica en el workflow de GitHub Actions.
2. Comprobar en una base **aislada** que los triggers aceptan insert/update
   de mensajes y settings existentes; revisar permisos/RLS y capacidad de
   rollback. El guion `tests/channel-health-integration.sql` se ejecuta
   dentro de una transacción que termina en `ROLLBACK` y requiere una copia
   con al menos un sitio con settings; desactiva el trigger HTTP existente
   de `messages` **solo dentro de la transacción de la copia aislada** para
   evitar llamadas externas no reversibles. Comprobar concurrencia con dos
   sesiones independientes que entreguen mensajes al mismo canal mientras
   otra sesión reconfigura el sitio; validar de nuevo el estado agregado.
   El guion pasó en Postgres 17 efímero con el esquema mínimo de
   `tests/channel-health-schema-fixture.sql`; **todavía no se ha validado
   sobre una copia del esquema real de Supabase**. Las pruebas TypeScript,
   Jest y replay de Temporal no sustituyen esa comprobación. Dos sesiones
   simultáneas conservaron ambos eventos (`healthy:2:2`); reconfigurar durante
   un evento concurrente terminó en `unknown` sin borrar el historial. La
   prueba local también simula un `INSERT` como `authenticated`: el mensaje
   se persiste sin añadir un evento de salud falsificado.
   La migración no rellena salud histórica: inicialmente es
   `unknown`, por lo que los nuevos trabajos caros quedan pausados hasta
   una entrega real. Para habilitar un canal nuevo debe enviarse un mensaje
   aprobado o de prueba por la ruta de entrega existente y comprobar que
   `channel_health` muestra un éxito de salida reciente. Esto es intencional,
   no un falso fallo; sin esa prueba los flujos de captación no se inician.
3. Desplegar workers y verificar salud por canal y métrica de `BLOCKED`.
   Reproducir historiales antiguos con `scripts/replay-lead-follow-up-histories.js`
   antes de cualquier cambio masivo sobre ejecuciones existentes.

Esta protección evita iniciar nuevo gasto **en los workflows de este
repositorio**. No cubre agentes que consuman tokens directamente desde otra
aplicación, ni garantiza que un proveedor externo entregue un mensaje: `sent`
puede significar únicamente aceptación por su API. Para esos casos hay que
instrumentar la aplicación/API y la confirmación del proveedor con la misma
clave de idempotencia antes de elevarlos a salud verificada.