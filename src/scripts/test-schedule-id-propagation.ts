#!/usr/bin/env tsx

/**
 * Script de prueba para verificar que el scheduleId se propaga correctamente
 * desde workflows padre hasta deepResearchWorkflow
 */

import { getTemporalClient } from '../temporal/client';
import { leadResearchWorkflow } from '../temporal/workflows/leadResearchWorkflow';
import { analyzeSiteWorkflow } from '../temporal/workflows/analyzeSiteWorkflow';

async function testScheduleIdPropagation() {
  console.log('🧪 Probando propagación de schedule ID desde workflows padre hacia deepResearchWorkflow...');
  console.log('='.repeat(80));
  
  try {
    const client = await getTemporalClient();
    const testSiteId = '6742acb19dac5b94a09f4ddc'; // Test site ID
    
    console.log('\n📋 TEST 1: leadResearchWorkflow (solo inicio - verificar logs)');
    console.log('-'.repeat(60));
    
    const leadResearchWorkflowId = `test-lead-research-schedule-${Date.now()}`;
    
    try {
      const leadResearchHandle = await client.workflow.start(leadResearchWorkflow, {
        workflowId: leadResearchWorkflowId,
        taskQueue: 'workflows',
        args: [{
          lead_id: '1', // Test lead ID
          site_id: testSiteId,
          userId: 'test-user',
          additionalData: {
            testMode: true,
            testDescription: 'Testing schedule ID propagation in leadResearchWorkflow'
          }
        }],
        // Simular que viene de un schedule
        memo: {
          scheduleId: 'test-lead-research-daily-schedule',
          scheduleName: 'daily-lead-research',
          testOrigin: 'schedule-propagation-test'
        }
      });
      
      console.log(`🚀 Lead Research Workflow iniciado: ${leadResearchHandle.workflowId}`);
      console.log(`📝 Verifica los logs del workflow para ver si muestra:`);
      console.log(`   - REAL Schedule ID: test-lead-research-daily-schedule`);
      console.log(`   - En deepResearchWorkflow debería mostrar: 'Using scheduleId from parent workflow: test-lead-research-daily-schedule'`);
      
      // No esperamos el resultado, solo lo iniciamos
      console.log(`✅ Workflow iniciado correctamente - revisar logs de Temporal`);
      
    } catch (error) {
      console.error(`❌ Error iniciando leadResearchWorkflow:`, error);
    }
    
    console.log('\n📋 TEST 2: analyzeSiteWorkflow (solo inicio - verificar logs)');
    console.log('-'.repeat(60));
    
    const analyzeSiteWorkflowId = `test-analyze-site-schedule-${Date.now()}`;
    
    try {
      const analyzeSiteHandle = await client.workflow.start(analyzeSiteWorkflow, {
        workflowId: analyzeSiteWorkflowId,
        taskQueue: 'workflows',
        args: [{
          site_id: testSiteId,
          userId: 'test-user',
          additionalData: {
            testMode: true,
            testDescription: 'Testing schedule ID propagation in analyzeSiteWorkflow'
          }
        }],
        // Simular que viene de un schedule
        memo: {
          scheduleId: 'test-analyze-site-weekly-schedule',
          scheduleName: 'weekly-site-analysis',
          testOrigin: 'schedule-propagation-test'
        }
      });
      
      console.log(`🚀 Analyze Site Workflow iniciado: ${analyzeSiteHandle.workflowId}`);
      console.log(`📝 Verifica los logs del workflow para ver si muestra:`);
      console.log(`   - REAL Schedule ID: test-analyze-site-weekly-schedule`);
      console.log(`   - En deepResearchWorkflow debería mostrar: 'Using scheduleId from parent workflow: test-analyze-site-weekly-schedule'`);
      
      // No esperamos el resultado, solo lo iniciamos
      console.log(`✅ Workflow iniciado correctamente - revisar logs de Temporal`);
      
    } catch (error) {
      console.error(`❌ Error iniciando analyzeSiteWorkflow:`, error);
    }
    
    console.log('\n🎉 Tests de propagación de schedule ID iniciados');
    console.log('📝 INSTRUCCIONES PARA VERIFICAR:');
    console.log('   1. Ve a la interfaz web de Temporal');
    console.log('   2. Busca los workflows que se iniciaron');
    console.log('   3. Revisa los logs de ejecución');
    console.log('   4. Busca líneas que contengan "REAL Schedule ID" y "Using scheduleId from parent workflow"');
    console.log('   5. Verifica que NO aparezca "manual-execution" en deepResearchWorkflow');
    console.log('\n📋 Workflows iniciados:');
    console.log(`   - ${leadResearchWorkflowId}`);
    console.log(`   - ${analyzeSiteWorkflowId}`);
    
  } catch (error) {
    console.error('❌ Error general en el test:', error);
  }
}

// Ejecutar el test si el script se ejecuta directamente
if (require.main === module) {
  testScheduleIdPropagation()
    .then(() => {
      console.log('\n✅ Script de test completado');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error en el script de test:', error);
      process.exit(1);
    });
}

export { testScheduleIdPropagation };
