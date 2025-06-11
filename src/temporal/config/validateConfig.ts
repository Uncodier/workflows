/**
 * Script de validación para la configuración de agentes
 */

import { defaultAgentsConfig, getAgentTypes, getAgentsByType, getAgentNames } from './agentsConfig';
import { validateAgentRoles, getAgentTypeDistribution } from './agentRolesConfig';

console.log('🔍 Validando configuración de agentes...\n');

// 1. Validar estructura básica
console.log('📋 Configuración básica:');
console.log(`   • Total de agentes: ${defaultAgentsConfig.agents.length}`);
console.log(`   • Tipos disponibles: ${getAgentTypes().join(', ')}`);
console.log(`   • Nombres: ${getAgentNames().join(', ')}\n`);

// 2. Validar distribución por tipos
console.log('📊 Distribución por tipos:');
const distribution = getAgentTypeDistribution();
Object.entries(distribution).forEach(([type, count]) => {
  console.log(`   • ${type}: ${count} agentes`);
});
console.log('');

// 3. Validar agentes por tipo
console.log('🏷️ Agentes por tipo:');
getAgentTypes().forEach(type => {
  const agents = getAgentsByType(type);
  console.log(`   • ${type.toUpperCase()}:`);
  agents.forEach(agent => {
    console.log(`     - ${agent.name} (${agent.activities.length} actividades)`);
  });
});
console.log('');

// 4. Validar roles
console.log('✅ Validación de roles:');
const roleValidation = validateAgentRoles();
if (roleValidation.valid) {
  console.log('   • ✅ Todos los agentes tienen roles definidos');
} else {
  console.log('   • ❌ Roles faltantes:', roleValidation.missingRoles);
}
console.log('');

// 5. Validar actividades
console.log('⚡ Validación de actividades:');
let totalActivities = 0;
defaultAgentsConfig.agents.forEach(agent => {
  totalActivities += agent.activities.length;
  console.log(`   • ${agent.name}: ${agent.activities.length} actividades`);
});
console.log(`   • Total de actividades: ${totalActivities}\n`);

// 6. Estadísticas de rendimiento
console.log('📈 Estadísticas de rendimiento:');
const overallStats = defaultAgentsConfig.agents.reduce((stats, agent) => {
  stats.totalConversations += agent.conversations;
  stats.totalSuccessRate += agent.success_rate;
  return stats;
}, { totalConversations: 0, totalSuccessRate: 0 });

const avgSuccessRate = overallStats.totalSuccessRate / defaultAgentsConfig.agents.length;
console.log(`   • Total conversaciones: ${overallStats.totalConversations.toLocaleString()}`);
console.log(`   • Tasa de éxito promedio: ${avgSuccessRate.toFixed(1)}%`);

// 7. Validar estructura de datos
console.log('\n🔬 Validación de estructura:');
let structureValid = true;
const requiredFields = ['id', 'name', 'description', 'type', 'status', 'conversations', 'success_rate', 'lastActive', 'icon', 'activities'];

defaultAgentsConfig.agents.forEach((agent, index) => {
  requiredFields.forEach(field => {
    if (!(field in agent)) {
      console.log(`   • ❌ Agente ${index + 1} (${agent.name}) falta campo: ${field}`);
      structureValid = false;
    }
  });
  
  // Validar actividades
  agent.activities.forEach((activity, actIndex) => {
    const requiredActivityFields = ['id', 'name', 'description', 'estimatedTime', 'success_rate', 'executions', 'status'];
    requiredActivityFields.forEach(field => {
      if (!(field in activity)) {
        console.log(`   • ❌ Agente ${agent.name}, actividad ${actIndex + 1} falta campo: ${field}`);
        structureValid = false;
      }
    });
  });
});

if (structureValid) {
  console.log('   • ✅ Estructura de datos válida');
}

console.log('\n🎉 Validación completada!');

// Exportar función de validación para uso en tests
export function runConfigValidation(): boolean {
  const roleValidation = validateAgentRoles();
  return roleValidation.valid && structureValid;
} 