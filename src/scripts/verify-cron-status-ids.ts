#!/usr/bin/env node

/**
 * Script para verificar que los cron_status se guarden con:
 * a) workflow_id real de Temporal 
 * b) schedule_id correcto que corresponda al schedule que los triggereó
 */

import { getSupabaseService } from '../temporal/services';

interface CronStatusRecord {
  id: string;
  workflow_id: string | null;
  schedule_id: string | null;
  activity_name: string | null;
  status: string;
  last_run: string | null;
  next_run: string | null;
  error_message: string | null;
  retry_count: number;
  site_id: string | null;
  created_at: string;
  updated_at: string;
}

async function verifyCronStatusIds() {
  console.log('🔍 Verificando IDs en cron_status...');
  console.log('='.repeat(50));
  
  try {
    const supabaseService = getSupabaseService();
    
    // Check connection
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.error('❌ No se puede conectar a la base de datos');
      return;
    }
    
    console.log('✅ Conectado a la base de datos');
    
    // Get all cron_status records using the public method
    const cronRecords = await supabaseService.fetchRecentCronStatus(20);
    
    if (!cronRecords || cronRecords.length === 0) {
      console.log('📋 No hay registros en cron_status');
      return;
    }
    
    console.log(`📊 Encontrados ${cronRecords.length} registros de cron_status (últimos 20)`);
    console.log('');
    
    // Analyze the records
    const analysis = {
      totalRecords: cronRecords.length,
      withWorkflowId: 0,
      withScheduleId: 0,
      withBothIds: 0,
      workflowIdPatterns: new Set<string>(),
      scheduleIdPatterns: new Set<string>(),
      activityNames: new Set<string>()
    };
    
    console.log('📋 ANÁLISIS DETALLADO:');
    console.log('-'.repeat(40));
    
    cronRecords.forEach((record: CronStatusRecord, index: number) => {
      console.log(`\n${index + 1}. Record ID: ${record.id}`);
      console.log(`   Activity: ${record.activity_name || 'NULL'}`);
      console.log(`   Status: ${record.status}`);
      console.log(`   Workflow ID: ${record.workflow_id || 'NULL'}`);
      console.log(`   Schedule ID: ${record.schedule_id || 'NULL'}`);
      console.log(`   Site ID: ${record.site_id || 'NULL'}`);
      console.log(`   Created: ${record.created_at}`);
      console.log(`   Last Run: ${record.last_run || 'NULL'}`);
      
      if (record.workflow_id) {
        analysis.withWorkflowId++;
        analysis.workflowIdPatterns.add(extractPattern(record.workflow_id));
      }
      
      if (record.schedule_id) {
        analysis.withScheduleId++;
        analysis.scheduleIdPatterns.add(extractPattern(record.schedule_id));
      }
      
      if (record.workflow_id && record.schedule_id) {
        analysis.withBothIds++;
      }
      
      if (record.activity_name) {
        analysis.activityNames.add(record.activity_name);
      }
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMEN DEL ANÁLISIS:');
    console.log('='.repeat(50));
    console.log(`Total de registros: ${analysis.totalRecords}`);
    console.log(`Con workflow_id: ${analysis.withWorkflowId} (${((analysis.withWorkflowId/analysis.totalRecords)*100).toFixed(1)}%)`);
    console.log(`Con schedule_id: ${analysis.withScheduleId} (${((analysis.withScheduleId/analysis.totalRecords)*100).toFixed(1)}%)`);
    console.log(`Con ambos IDs: ${analysis.withBothIds} (${((analysis.withBothIds/analysis.totalRecords)*100).toFixed(1)}%)`);
    
    console.log('\n📋 PATRONES DE WORKFLOW_ID:');
    analysis.workflowIdPatterns.forEach(pattern => {
      console.log(`   - ${pattern}`);
    });
    
    console.log('\n📋 PATRONES DE SCHEDULE_ID:');
    analysis.scheduleIdPatterns.forEach(pattern => {
      console.log(`   - ${pattern}`);
    });
    
    console.log('\n📋 TIPOS DE ACTIVIDADES:');
    analysis.activityNames.forEach(name => {
      console.log(`   - ${name}`);
    });
    
    // Check if we have the expected schedule IDs from defaultSchedules
    const expectedScheduleIds = [
      'central-schedule-activities',
      'sync-emails-schedule-manager'
    ];
    
    console.log('\n🎯 VERIFICACIÓN DE SCHEDULE_IDS ESPERADOS:');
    expectedScheduleIds.forEach(expectedId => {
      const found = cronRecords.some((record: CronStatusRecord) => 
        record.schedule_id === expectedId
      );
      console.log(`   ${found ? '✅' : '❌'} ${expectedId}: ${found ? 'ENCONTRADO' : 'NO ENCONTRADO'}`);
    });
    
    // Identify potential issues
    console.log('\n⚠️  POSIBLES PROBLEMAS IDENTIFICADOS:');
    
    if (analysis.withWorkflowId < analysis.totalRecords) {
      console.log(`   - ${analysis.totalRecords - analysis.withWorkflowId} registros sin workflow_id`);
    }
    
    if (analysis.withScheduleId < analysis.totalRecords) {
      console.log(`   - ${analysis.totalRecords - analysis.withScheduleId} registros sin schedule_id`);
    }
    
    // Check for custom workflow IDs vs real Temporal IDs
    const customWorkflowPatterns = Array.from(analysis.workflowIdPatterns).filter(pattern => 
      pattern.includes('${workflow-name}-${site-id}') || 
      pattern.includes('${workflow-name}-${site-id}-${timestamp}') ||
      pattern.includes('manual-generation')
    );
    
    if (customWorkflowPatterns.length > 0) {
      console.log(`   - Detectados posibles workflow_id generados manualmente (no de Temporal real):`);
      customWorkflowPatterns.forEach(pattern => {
        console.log(`     * ${pattern}`);
      });
    }
    
    const fallbackSchedulePatterns = Array.from(analysis.scheduleIdPatterns).filter(pattern => 
      pattern.includes('fallback') || 
      pattern.includes('${workflow-name}-${site-id}')
    );
    
    if (fallbackSchedulePatterns.length > 0) {
      console.log(`   - Detectados schedule_id usando fallback (no del schedule real):`);
      fallbackSchedulePatterns.forEach(pattern => {
        console.log(`     * ${pattern}`);
      });
    }
    
    console.log('\n✅ Verificación completada');
    
  } catch (error) {
    console.error('❌ Error durante la verificación:', error);
  }
}

function extractPattern(id: string): string {
  // Extract patterns from IDs to identify how they were generated
  if (id.match(/^[a-zA-Z-]+-[a-f0-9-]{36}-\d+$/)) {
    return '${workflow-name}-${site-id}-${timestamp}';
  }
  if (id.match(/^[a-zA-Z-]+-[a-f0-9-]{36}$/)) {
    return '${workflow-name}-${site-id}';
  }
  if (id.includes('fallback')) {
    return 'fallback generation';
  }
  if (id.match(/^[a-zA-Z-]+$/)) {
    return 'schedule name format';
  }
  if (id.match(/^\d+/)) {
    return 'timestamp-based';
  }
  return id.length > 50 ? 'long-id (possible Temporal real ID)' : 'custom format';
}

// Run the verification
if (require.main === module) {
  verifyCronStatusIds().catch(console.error);
}

export { verifyCronStatusIds };