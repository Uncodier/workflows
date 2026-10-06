# Verificación de correo de workflows (AKS)

La implementación actual está en `src/temporal/activities/validateEmailActivities.ts`.
`validateContactInformation` en `src/temporal/activities/apiActivities.ts` invoca
esa actividad. Los workers usan `REOON_API_KEY` del secreto `worker-env` en AKS.
No se usa NeverBounce, el antiguo endpoint de agentes ni SMTP directo desde el
worker. La [API de Reoon](https://www.reoon.com/email-verifier/api/) recibe
verificaciones individuales mediante HTTPS con `mode=power`.

> `docs/EMAIL_VALIDATION_IMPLEMENTATION.md` y
> `docs/EMAIL_VALIDATION_RENDER_DEPLOYMENT.md` describen integraciones antiguas;
> no deben emplearse como guía para esta instalación de AKS.

## Política de resultados

En las nuevas ejecuciones de minado ICP, los correos obtenidos de Finder o
IcyPeas no se revalidan con Reoon: se conservan los controles de formato y el
rechazo de estados explícitamente inválidos. Solo el fallback de correo generado
con IA requiere esa verificación en historiales antiguos. Las nuevas ejecuciones
ICP ya no invocan ese fallback: tras agotar los proveedores sin correo ni teléfono
utilizable, guardan el resultado sin contacto y pasan al siguiente candidato.
El generador y el validador siguen disponibles para otros usos. Véase la política
y compatibilidad Temporal en
[ICP_MINING_CONFIGURATION.md](./ICP_MINING_CONFIGURATION.md#provider-only-contacts-in-new-icp-executions).
Esto no desactiva el validador compartido ni los controles de outreach.

| Resultado Power Mode | Tratamiento |
| --- | --- |
| `safe`, `role_account` | Válidos solo si Reoon informa `is_deliverable=true`. Las cuentas compartidas requieren valoración comercial aparte. |
| `invalid`, `disabled`, `spamtrap`, `disposable` | No se envía correo. El workflow puede invalidar el correo/lead según sus otros canales. |
| `catch_all`, `inbox_full`, `unknown`, respuesta contradictoria o estado no reconocido | Inconcluso: ni se confirma el buzón ni se invalida el lead. |
| HTTP 403, otros errores de red o timeout | No verificado. Se registra código HTTP/categoría, nunca la URL ni la respuesta completa. |

Tras un HTTP 403 se consulta el saldo de forma acotada. Si la cuenta confirma
ambos saldos en cero, el resultado se etiqueta `NO_CREDITS` y se evita volver
a llamar al endpoint individual durante un minuto en ese proceso. Si el saldo
no es cero o la consulta falla, sigue siendo un HTTP 403 de causa desconocida.

Las ejecuciones **nuevas** de `leadFollowUpWorkflow` fallan de forma no
reintentable si la verificación resulta inconclusa o falla; no generan
mensajes por la ruta *fail-open*. Una validación `invalid` no equivale a una
interrupción del proveedor. `power` puede tardar más de un minuto: el timeout
HTTP es de 90 s; la actividad Temporal admite 10 minutos y hasta 3 intentos
**solo si la actividad lanza una excepción** (`success:false` es un resultado).

`leadFollowUpWorkflow` únicamente **crea mensajes pendientes**;
`sendApprovedMessagesWorkflow` maneja el envío posteriormente. No se debe
inferir que se enviaron correos solo porque el workflow avanzó.

## Compatibilidad y recuperación

Historiales iniciados antes del cambio *fail-open* guardaron las actividades
`saveCronStatusActivity(FAILED)` y `logWorkflowExecutionActivity(FAILED)`.
Historiales posteriores avanzaron sin esas actividades. La nueva rama se
protege con el marcador `lead-follow-up-contact-validation-fail-closed-v1`;
en ausencia de marcador se conservan las dos secuencias históricas según el
inicio del workflow. Esto **no** es una orden de reiniciarlos masivamente.

Prueba offline, con historial JSON de fuente de confianza:

```bash
node scripts/replay-lead-follow-up-histories.js /ruta/segura/history.json
```

Si depende de su ID, guárdelo en `/ruta/segura/history.json.workflow-id`.
Los historiales pueden contener PII: almacénelos fuera del repositorio y no
los suba a Git. Antes de desplegar, pruebe varios historiales abiertos y
completados, tanto anteriores como posteriores al cambio. No cancele ni
reinicie workflows sin inventario de sus actividades y mensajes.

## Operaciones pendientes

- Los logs antiguos ya expusieron la clave Reoon en URLs de Axios. **Rote la
  clave** en Reoon, actualice `worker-env`/configuración gestionada, reinicie
  los workers coordinadamente y restrinja acceso a logs históricos. El código
  no puede borrar logs antiguos ni emitir una clave nueva.
- Reoon desaconseja usar continuamente más de cinco hilos en el endpoint
  individual. La concurrencia de workers no garantiza ese límite entre pods:
  considere un limitador compartido o el endpoint bulk antes de aumentar carga.
- El 28-09-2026 la cuenta respondía `active` con cero créditos diarios e
  instantáneos. Obtener créditos es una operación de cuenta; la documentación
  no permite atribuir con certeza los HTTP 403 a ese saldo.