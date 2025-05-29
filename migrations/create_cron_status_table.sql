-- Crear tabla cron_status para control de actividades calendarizadas
-- Compatible con Temporal workflows, schedules y activities

CREATE TABLE IF NOT EXISTS cron_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Referencias conceptuales a Temporal (no FK reales)
    workflow_id TEXT, -- ID del workflow en Temporal
    schedule_id TEXT, -- ID del schedule en Temporal  
    activity_name TEXT, -- Nombre de la actividad/tarea
    
    -- Estado y control
    status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, cancelled
    last_run TIMESTAMP WITH TIME ZONE, -- Última ejecución
    next_run TIMESTAMP WITH TIME ZONE, -- Próxima ejecución programada
    
    -- Manejo de errores
    error_message TEXT, -- Mensaje de error si falla
    retry_count INTEGER DEFAULT 0, -- Número de reintentos
    
    -- Referencias del sistema
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_cron_status_workflow_id ON cron_status(workflow_id);
CREATE INDEX IF NOT EXISTS idx_cron_status_schedule_id ON cron_status(schedule_id);
CREATE INDEX IF NOT EXISTS idx_cron_status_status ON cron_status(status);
CREATE INDEX IF NOT EXISTS idx_cron_status_next_run ON cron_status(next_run);
CREATE INDEX IF NOT EXISTS idx_cron_status_site_id ON cron_status(site_id);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_cron_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_cron_status_updated_at
    BEFORE UPDATE ON cron_status
    FOR EACH ROW
    EXECUTE FUNCTION update_cron_status_updated_at();

-- Comentarios para documentación
COMMENT ON TABLE cron_status IS 'Control de actividades calendarizadas del sistema - Compatible con Temporal workflows';
COMMENT ON COLUMN cron_status.workflow_id IS 'ID del workflow en Temporal (referencia conceptual)';
COMMENT ON COLUMN cron_status.schedule_id IS 'ID del schedule en Temporal (referencia conceptual)';
COMMENT ON COLUMN cron_status.activity_name IS 'Nombre de la actividad o tarea programada';
COMMENT ON COLUMN cron_status.status IS 'Estado actual: pending, running, completed, failed, cancelled';
COMMENT ON COLUMN cron_status.last_run IS 'Timestamp de la última ejecución';
COMMENT ON COLUMN cron_status.next_run IS 'Timestamp de la próxima ejecución programada';
COMMENT ON COLUMN cron_status.error_message IS 'Mensaje de error en caso de fallo';
COMMENT ON COLUMN cron_status.retry_count IS 'Número de reintentos realizados'; 