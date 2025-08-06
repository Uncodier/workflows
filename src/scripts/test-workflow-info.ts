#!/usr/bin/env node

/**
 * Script de prueba para verificar la función workflowInfo de Temporal
 */

// Intentar importar workflowInfo
try {
  // Prueba 1: Importar directamente
  console.log('🔍 Buscando workflowInfo en @temporalio/workflow...');
  const temporal = require('@temporalio/workflow');
  
  console.log('📋 Funciones disponibles en @temporalio/workflow:');
  const functions = Object.keys(temporal).filter(key => typeof temporal[key] === 'function');
  console.log(functions.sort());
  
  console.log('\n📋 Todas las exportaciones disponibles:');
  console.log(Object.keys(temporal).sort());
  
  // Verificar si workflowInfo existe
  if (temporal.workflowInfo) {
    console.log('\n✅ workflowInfo encontrada!');
    console.log('Tipo:', typeof temporal.workflowInfo);
  } else {
    console.log('\n❌ workflowInfo NO encontrada');
  }
  
  // Buscar algo similar
  const similarFunctions = Object.keys(temporal).filter(key => 
    key.toLowerCase().includes('workflow') && key.toLowerCase().includes('info')
  );
  console.log('\n🔍 Funciones similares encontradas:', similarFunctions);
  
} catch (error) {
  console.error('❌ Error al importar @temporalio/workflow:', error);
}

console.log('\n' + '='.repeat(50));
console.log('💡 Buscando funciones para obtener información del workflow...');

// Buscar funciones relacionadas con información del workflow
try {
  const temporal = require('@temporalio/workflow');
  
  const infoRelated = Object.keys(temporal).filter(key =>
    key.toLowerCase().includes('info') || 
    key.toLowerCase().includes('current') ||
    key.toLowerCase().includes('execution') ||
    key.toLowerCase().includes('handle')
  );
  
  console.log('📋 Funciones relacionadas con información:', infoRelated);
  
} catch (error) {
  console.error('❌ Error:', error);
}