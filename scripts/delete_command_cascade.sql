-- Script para borrar command y todos sus objetos relacionados
-- Usar este script cuando CASCADE no esté funcionando correctamente

-- Función para borrar un command y todos sus objetos relacionados
CREATE OR REPLACE FUNCTION delete_command_cascade(command_uuid UUID)
RETURNS JSON AS $$
DECLARE
    deleted_counts JSON;
    temp_count INTEGER;
BEGIN
    -- Inicializar el objeto JSON de conteos
    deleted_counts := '{}';
    
    -- Borrar de agent_assets
    DELETE FROM agent_assets WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{agent_assets}', temp_count::text::jsonb);
    
    -- Borrar de agent_memories
    DELETE FROM agent_memories WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{agent_memories}', temp_count::text::jsonb);
    
    -- Borrar de agents
    DELETE FROM agents WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{agents}', temp_count::text::jsonb);
    
    -- Borrar de analysis
    DELETE FROM analysis WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{analysis}', temp_count::text::jsonb);
    
    -- Borrar de assets
    DELETE FROM assets WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{assets}', temp_count::text::jsonb);
    
    -- Borrar de billing
    DELETE FROM billing WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{billing}', temp_count::text::jsonb);
    
    -- Borrar de campaign_requirements
    DELETE FROM campaign_requirements WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{campaign_requirements}', temp_count::text::jsonb);
    
    -- Borrar de campaign_segments
    DELETE FROM campaign_segments WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{campaign_segments}', temp_count::text::jsonb);
    
    -- Borrar de campaign_subtasks
    DELETE FROM campaign_subtasks WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{campaign_subtasks}', temp_count::text::jsonb);
    
    -- Borrar de campaigns
    DELETE FROM campaigns WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{campaigns}', temp_count::text::jsonb);
    
    -- Borrar de content
    DELETE FROM content WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{content}', temp_count::text::jsonb);
    
    -- Borrar de conversations
    DELETE FROM conversations WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{conversations}', temp_count::text::jsonb);
    
    -- Borrar de debug_logs
    DELETE FROM debug_logs WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{debug_logs}', temp_count::text::jsonb);
    
    -- Borrar de experiment_segments
    DELETE FROM experiment_segments WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{experiment_segments}', temp_count::text::jsonb);
    
    -- Borrar de experiments
    DELETE FROM experiments WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{experiments}', temp_count::text::jsonb);
    
    -- Borrar de external_resources
    DELETE FROM external_resources WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{external_resources}', temp_count::text::jsonb);
    
    -- Borrar de kpis
    DELETE FROM kpis WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{kpis}', temp_count::text::jsonb);
    
    -- Borrar de leads
    DELETE FROM leads WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{leads}', temp_count::text::jsonb);
    
    -- Borrar de messages
    DELETE FROM messages WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{messages}', temp_count::text::jsonb);
    
    -- Borrar de notifications
    DELETE FROM notifications WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{notifications}', temp_count::text::jsonb);
    
    -- Borrar de payments
    DELETE FROM payments WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{payments}', temp_count::text::jsonb);
    
    -- Borrar de profiles
    DELETE FROM profiles WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{profiles}', temp_count::text::jsonb);
    
    -- Borrar de requirement_segments
    DELETE FROM requirement_segments WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{requirement_segments}', temp_count::text::jsonb);
    
    -- Borrar de requirements
    DELETE FROM requirements WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{requirements}', temp_count::text::jsonb);
    
    -- Borrar de sales
    DELETE FROM sales WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{sales}', temp_count::text::jsonb);
    
    -- Borrar de segments
    DELETE FROM segments WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{segments}', temp_count::text::jsonb);
    
    -- Borrar de session_events
    DELETE FROM session_events WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{session_events}', temp_count::text::jsonb);
    
    -- Borrar de settings
    DELETE FROM settings WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{settings}', temp_count::text::jsonb);
    
    -- Borrar de sites
    DELETE FROM sites WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{sites}', temp_count::text::jsonb);
    
    -- Borrar de tasks
    DELETE FROM tasks WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{tasks}', temp_count::text::jsonb);
    
    -- Borrar de transactions
    DELETE FROM transactions WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{transactions}', temp_count::text::jsonb);
    
    -- Borrar de visitor_sessions
    DELETE FROM visitor_sessions WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{visitor_sessions}', temp_count::text::jsonb);
    
    -- Borrar de visitors
    DELETE FROM visitors WHERE command_id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{visitors}', temp_count::text::jsonb);
    
    -- Finalmente, borrar el command
    DELETE FROM commands WHERE id = command_uuid;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_counts := jsonb_set(deleted_counts::jsonb, '{commands}', temp_count::text::jsonb);
    
    RETURN deleted_counts;
END;
$$ LANGUAGE plpgsql;

-- Función simplificada para uso común
CREATE OR REPLACE FUNCTION delete_command_simple(command_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    result JSON;
BEGIN
    SELECT delete_command_cascade(command_uuid) INTO result;
    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error al borrar command %: %', command_uuid, SQLERRM;
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Comentarios de documentación
COMMENT ON FUNCTION delete_command_cascade(UUID) IS 'Borra un command y todos sus objetos relacionados. Retorna JSON con el conteo de registros borrados por tabla.';
COMMENT ON FUNCTION delete_command_simple(UUID) IS 'Versión simplificada para borrar un command y sus objetos relacionados. Retorna TRUE/FALSE.';

-- Ejemplos de uso:
-- SELECT delete_command_cascade('12345678-1234-1234-1234-123456789012');
-- SELECT delete_command_simple('12345678-1234-1234-1234-123456789012'); 