#!/usr/bin/env node
"use strict";
/**
 * Script de prueba para mostrar cómo usar workflowInfo() de Temporal
 */
Object.defineProperty(exports, "__esModule", { value: true });
const workflow_1 = require("@temporalio/workflow");
// Función de ejemplo que demuestra cómo obtener información del workflow
function exampleWorkflowInfoUsage() {
    try {
        // Obtener información del workflow actual
        const info = (0, workflow_1.workflowInfo)();
        console.log('📋 Información del workflow actual:');
        console.log('   - Workflow ID (real):', info.workflowId);
        console.log('   - Workflow Type:', info.workflowType);
        console.log('   - Run ID:', info.runId);
        console.log('   - Task Queue:', info.taskQueue);
        console.log('   - Namespace:', info.namespace);
        console.log('   - Start Time:', info.startTime);
        console.log('   - Execution Timeout:', info.executionTimeoutMs);
        console.log('   - Run Timeout:', info.runTimeoutMs);
        console.log('   - Task Timeout:', info.taskTimeoutMs);
        // Mostrar toda la información disponible
        console.log('\n🔍 Toda la información disponible:');
        console.log(JSON.stringify(info, null, 2));
        return {
            realWorkflowId: info.workflowId,
            workflowType: info.workflowType,
            runId: info.runId,
            scheduleInfo: info.parent || null // Información del parent si existe
        };
    }
    catch (error) {
        console.error('❌ Error al obtener información del workflow:', error);
        console.log('💡 Esto es normal cuando se ejecuta fuera del contexto de un workflow');
        return null;
    }
}
// Función que muestra cómo sería la implementación correcta
function correctCronStatusImplementation() {
    console.log('\n' + '='.repeat(60));
    console.log('💡 IMPLEMENTACIÓN CORRECTA para cron_status:');
    console.log('='.repeat(60));
    console.log(`
// ANTES (INCORRECTO) - IDs generados manualmente:
const workflowId = \`deep-research-\${site_id}-\${Date.now()}\`;
const scheduleId = options.additionalData?.scheduleType || \`deep-research-\${site_id}\`;

await saveCronStatusActivity({
  siteId: site_id,
  workflowId,        // ❌ ID generado manualmente
  scheduleId,        // ❌ Fallback manual  
  activityName: 'deepResearchWorkflow',
  status: 'RUNNING'
});

// DESPUÉS (CORRECTO) - IDs reales de Temporal:
import { workflowInfo } from '@temporalio/workflow';

const info = workflowInfo();
const realWorkflowId = info.workflowId;              // ✅ ID real de Temporal
const realScheduleId = extractScheduleId(info);      // ✅ Schedule ID real

await saveCronStatusActivity({
  siteId: site_id,
  workflowId: realWorkflowId,     // ✅ ID real de Temporal
  scheduleId: realScheduleId,     // ✅ Schedule ID real
  activityName: 'deepResearchWorkflow',
  status: 'RUNNING'
});

// Función helper para extraer schedule ID:
function extractScheduleId(workflowInfo: WorkflowInfo): string {
  // Si el workflow fue triggereado por un schedule, el ID estará disponible
  // en searchAttributes o memo
  const searchAttributes = workflowInfo.searchAttributes;
  const scheduleId = searchAttributes?.['TemporalScheduledById'];
  
  return scheduleId || 'manual-execution';
}
`);
}
// Ejecutar las funciones de ejemplo
console.log('🧪 PROBANDO workflowInfo()...');
exampleWorkflowInfoUsage();
correctCronStatusImplementation();
