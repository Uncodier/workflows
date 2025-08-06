#!/usr/bin/env node

/**
 * Script para comparar los IDs antes y después de la implementación
 */

import { getSupabaseService } from '../temporal/services';

interface CronStatusRecord {
  id: string;
  workflow_id: string | null;
  schedule_id: string | null;
  activity_name: string | null;
  status: string;
  created_at: string;
}

async function compareWorkflowIds() {
  console.log('🔍 Comparando IDs de workflow antes y después de la implementación...');
  console.log('='.repeat(70));
  
  try {
    const supabaseService = getSupabaseService();
    
    // Check connection
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.error('❌ No se puede conectar a la base de datos');
      return;
    }
    
    console.log('✅ Conectado a la base de datos');
    
    // Get recent cron_status records using the new public method
    const cronRecords = await supabaseService.fetchRecentCronStatus(10);
    
    if (!cronRecords || cronRecords.length === 0) {
      console.log('📋 No hay registros en cron_status');
      return;
    }
    
    console.log(`📊 Analizando ${cronRecords.length} registros más recientes:\\n`);
    
    const oldPatternRecords: CronStatusRecord[] = [];
    const newPatternRecords: CronStatusRecord[] = [];
    
    cronRecords.forEach((record: CronStatusRecord) => {
      if (!record.workflow_id) return;
      
      // Detect old pattern: workflow-name-site-id-timestamp (e.g., deep-research-uuid-timestamp)
      const isOldPattern = record.workflow_id.match(/^[a-zA-Z-]+-[a-f0-9-]{36}-\d+$/);
      
      // Detect new pattern: Real Temporal IDs are usually longer, more complex, and don't follow our custom pattern
      const isNewPattern = !isOldPattern && (
        record.workflow_id.length > 60 || 
        !record.workflow_id.includes('-' + record.workflow_id.split('-').slice(-1)[0]) || // No timestamp at end
        record.workflow_id.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/) // UUID format
      );
      
      if (isOldPattern) {
        oldPatternRecords.push(record);
      } else if (isNewPattern) {
        newPatternRecords.push(record);
      }
    });
    
    console.log('📋 ANÁLISIS DE PATRONES:');
    console.log('-'.repeat(40));
    
    console.log(`\\n🔴 PATRÓN ANTIGUO (generado manualmente): ${oldPatternRecords.length} registros`);
    oldPatternRecords.forEach((record, index) => {
      console.log(`   ${index + 1}. Workflow ID: ${record.workflow_id}`);
      console.log(`      Schedule ID: ${record.schedule_id || 'NULL'}`);
      console.log(`      Activity: ${record.activity_name}`);
      console.log(`      Created: ${record.created_at}`);
      console.log('');
    });
    
    console.log(`\\n🟢 PATRÓN NUEVO (ID real de Temporal): ${newPatternRecords.length} registros`);
    newPatternRecords.forEach((record, index) => {
      console.log(`   ${index + 1}. Workflow ID: ${record.workflow_id}`);
      console.log(`      Schedule ID: ${record.schedule_id || 'NULL'}`);
      console.log(`      Activity: ${record.activity_name}`);
      console.log(`      Created: ${record.created_at}`);
      console.log('');
    });
    
    console.log('\\n' + '='.repeat(70));
    console.log('📊 RESUMEN DE MEJORAS:');
    console.log('='.repeat(70));
    
    if (newPatternRecords.length > 0) {
      console.log('✅ ÉXITO: Se detectaron registros con IDs reales de Temporal!');
      console.log(`   - ${newPatternRecords.length} registros usan IDs reales de Temporal`);
      console.log(`   - Los IDs reales son únicos y trazables en el sistema Temporal`);
      
      const realScheduleIds = newPatternRecords.filter(r => 
        r.schedule_id && r.schedule_id !== 'manual-execution' && 
        !r.schedule_id.match(/^[a-zA-Z-]+-[a-f0-9-]{36}$/)
      );
      
      if (realScheduleIds.length > 0) {
        console.log(`   - ${realScheduleIds.length} registros tienen schedule_id reales`);
      } else {
        console.log('   - Los schedule_id muestran "manual-execution" (correcto para ejecuciones manuales)');
      }
    } else {
      console.log('⚠️  Aún no se detectaron registros con IDs reales de Temporal');
      console.log('   - Ejecuta un workflow actualizado para ver los cambios');
      console.log('   - Usa: npx tsx src/scripts/test-deep-research-fixed.ts');
    }
    
    if (oldPatternRecords.length > 0) {
      console.log(`\\n🔄 ${oldPatternRecords.length} registros antiguos siguen usando el patrón manual`);
      console.log('   - Estos se actualizarán gradualmente con nuevas ejecuciones');
    }
    
  } catch (error) {
    console.error('❌ Error durante la comparación:', error);
  }
}

// Ejecutar la comparación
if (require.main === module) {
  compareWorkflowIds().catch(console.error);
}

export { compareWorkflowIds };