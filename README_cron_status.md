# Tabla cron_status - Control de Actividades Calendarizadas

## Descripción

La tabla `cron_status` está diseñada para llevar el control de actividades calendarizadas en el sistema, proporcionando una interfaz simplificada para monitorear workflows, schedules y activities de Temporal sin requerir una integración estricta.

## Estructura de la Tabla

```sql
CREATE TABLE cron_status (
    id UUID PRIMARY KEY,
    workflow_id TEXT,           -- ID del workflow en Temporal
    schedule_id TEXT,           -- ID del schedule en Temporal  
    activity_name TEXT,         -- Nombre de la actividad/tarea
    status TEXT DEFAULT 'pending', -- Estado actual
    last_run TIMESTAMP WITH TIME ZONE,
    next_run TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    site_id UUID REFERENCES sites(id),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
);
```

## Estados Disponibles

- **pending**: Actividad programada pero no ejecutada
- **running**: Actividad en ejecución
- **completed**: Actividad completada exitosamente
- **failed**: Actividad falló en su ejecución
- **cancelled**: Actividad cancelada

## Casos de Uso

### 1. Monitoreo de Workflows
```sql
-- Consultar estado de workflows activos
SELECT workflow_id, activity_name, status, last_run, next_run
FROM cron_status 
WHERE status IN ('pending', 'running')
ORDER BY next_run ASC;
```

### 2. Seguimiento de Errores
```sql
-- Actividades que han fallado
SELECT workflow_id, activity_name, error_message, retry_count
FROM cron_status 
WHERE status = 'failed'
ORDER BY updated_at DESC;
```

### 3. Programación de Próximas Ejecuciones
```sql
-- Actividades próximas a ejecutarse
SELECT workflow_id, activity_name, next_run
FROM cron_status 
WHERE status = 'pending' 
  AND next_run <= NOW() + INTERVAL '1 hour'
ORDER BY next_run ASC;
```

## Integración con Temporal

### Conceptos Mapeados

- **workflow_id**: Corresponde al ID único del workflow en Temporal
- **schedule_id**: Corresponde al ID del schedule que ejecuta el workflow
- **activity_name**: Nombre descriptivo de la actividad o función específica

### Ejemplo de Uso

```javascript
// Ejemplo de actualización desde un workflow de Temporal
async function updateCronStatus(workflowId, scheduleId, activityName, status) {
    const { data, error } = await supabase
        .from('cron_status')
        .upsert({
            workflow_id: workflowId,
            schedule_id: scheduleId,
            activity_name: activityName,
            status: status,
            last_run: status === 'completed' ? new Date() : null,
            updated_at: new Date()
        });
    
    return { data, error };
}
```

## Ventajas del Diseño

1. **Simplicidad**: No requiere campos complejos de Temporal
2. **Flexibilidad**: Permite referencias conceptuales sin FK estrictas
3. **Escalabilidad**: Índices optimizados para consultas frecuentes
4. **Mantenimiento**: Trigger automático para updated_at
5. **Monitoreo**: Estados claros para dashboard y alertas

## Consultas Útiles

### Dashboard de Estado General
```sql
SELECT 
    status,
    COUNT(*) as count,
    MAX(updated_at) as last_update
FROM cron_status 
GROUP BY status;
```

### Actividades con Más Reintentos
```sql
SELECT 
    workflow_id,
    activity_name,
    retry_count,
    error_message
FROM cron_status 
WHERE retry_count > 3
ORDER BY retry_count DESC;
```

### Próximas Ejecuciones por Sitio
```sql
SELECT 
    s.name as site_name,
    cs.activity_name,
    cs.next_run
FROM cron_status cs
JOIN sites s ON cs.site_id = s.id
WHERE cs.status = 'pending'
  AND cs.next_run IS NOT NULL
ORDER BY cs.next_run ASC;
```

## Mantenimiento

La tabla incluye un trigger automático que actualiza el campo `updated_at` en cada modificación, facilitando el seguimiento de cambios sin intervención manual. 