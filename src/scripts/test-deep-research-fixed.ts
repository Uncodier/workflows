#!/usr/bin/env node

/**
 * Script de prueba para verificar que deepResearchWorkflow ahora usa IDs reales de Temporal
 */

import { TemporalToolExecutor } from '../temporal/client/temporalToolExecutor';

async function testDeepResearchWithRealIds() {
  console.log('🧪 Probando deepResearchWorkflow con IDs reales de Temporal...');
  console.log('='.repeat(60));
  
  try {
    const executor = new TemporalToolExecutor();
    
    const testSiteId = '9be0a6a2-5567-41bf-ad06-cb4014f0faf2'; // Site ID conocido
    const testTopic = 'Testing real workflow IDs implementation';
    
    console.log(`📋 Ejecutando deepResearchWorkflow...`);
    console.log(`   - Site ID: ${testSiteId}`);
    console.log(`   - Topic: ${testTopic}`);
    console.log(`   - Timestamp: ${new Date().toISOString()}`);
    
    const result = await executor.executeTool({
      toolName: 'deepResearchWorkflow',
      args: {
        site_id: testSiteId,
        research_topic: testTopic,
        additionalData: {
          testMode: true,
          implementationTest: 'real-workflow-ids'
        }
      },
      apiConfig: {
        endpoint: {
          url: '/api/deep-research',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      }
    });
    
    console.log('\n📊 RESULTADO:');
    console.log('Success:', result.success);
    
    if (result.success) {
      console.log('✅ Workflow ejecutado exitosamente!');
      console.log('📋 Data:', JSON.stringify(result.data, null, 2));
    } else {
      console.log('❌ Workflow falló:', result.error);
    }
    
    console.log('\n💡 Ahora puedes verificar en la base de datos:');
    console.log('   - Los workflow_id deberían ser IDs reales de Temporal (largos)');
    console.log('   - Los schedule_id deberían ser "manual-execution" (ya que este es un test manual)');
    console.log('   - Ejecuta el script verify-cron-status-ids.ts para ver los cambios');
    
  } catch (error) {
    console.error('❌ Error al ejecutar test:', error);
  }
}

// Ejecutar el test
if (require.main === module) {
  testDeepResearchWithRealIds().catch(console.error);
}

export { testDeepResearchWithRealIds };