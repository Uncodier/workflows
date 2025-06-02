"use strict";
/**
 * Script de validación para la configuración de agentes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConfigValidation = runConfigValidation;
const agentsConfig_1 = require("./agentsConfig");
const agentRolesConfig_1 = require("./agentRolesConfig");
console.log('🔍 Validando configuración de agentes...\n');
// 1. Validar estructura básica
console.log('📋 Configuración básica:');
console.log(`   • Total de agentes: ${agentsConfig_1.defaultAgentsConfig.agents.length}`);
console.log(`   • Tipos disponibles: ${(0, agentsConfig_1.getAgentTypes)().join(', ')}`);
console.log(`   • Nombres: ${(0, agentsConfig_1.getAgentNames)().join(', ')}\n`);
// 2. Validar distribución por tipos
console.log('📊 Distribución por tipos:');
const distribution = (0, agentRolesConfig_1.getAgentTypeDistribution)();
Object.entries(distribution).forEach(([type, count]) => {
    console.log(`   • ${type}: ${count} agentes`);
});
console.log('');
// 3. Validar agentes por tipo
console.log('🏷️ Agentes por tipo:');
(0, agentsConfig_1.getAgentTypes)().forEach(type => {
    const agents = (0, agentsConfig_1.getAgentsByType)(type);
    console.log(`   • ${type.toUpperCase()}:`);
    agents.forEach(agent => {
        console.log(`     - ${agent.name} (${agent.activities.length} actividades)`);
    });
});
console.log('');
// 4. Validar roles
console.log('✅ Validación de roles:');
const roleValidation = (0, agentRolesConfig_1.validateAgentRoles)();
if (roleValidation.valid) {
    console.log('   • ✅ Todos los agentes tienen roles definidos');
}
else {
    console.log('   • ❌ Roles faltantes:', roleValidation.missingRoles);
}
console.log('');
// 5. Validar actividades
console.log('⚡ Validación de actividades:');
let totalActivities = 0;
agentsConfig_1.defaultAgentsConfig.agents.forEach(agent => {
    totalActivities += agent.activities.length;
    console.log(`   • ${agent.name}: ${agent.activities.length} actividades`);
});
console.log(`   • Total de actividades: ${totalActivities}\n`);
// 6. Estadísticas de rendimiento
console.log('📈 Estadísticas de rendimiento:');
const overallStats = agentsConfig_1.defaultAgentsConfig.agents.reduce((stats, agent) => {
    stats.totalConversations += agent.conversations;
    stats.totalSuccessRate += agent.successRate;
    return stats;
}, { totalConversations: 0, totalSuccessRate: 0 });
const avgSuccessRate = overallStats.totalSuccessRate / agentsConfig_1.defaultAgentsConfig.agents.length;
console.log(`   • Total conversaciones: ${overallStats.totalConversations.toLocaleString()}`);
console.log(`   • Tasa de éxito promedio: ${avgSuccessRate.toFixed(1)}%`);
// 7. Validar estructura de datos
console.log('\n🔬 Validación de estructura:');
let structureValid = true;
const requiredFields = ['id', 'name', 'description', 'type', 'status', 'conversations', 'successRate', 'lastActive', 'icon', 'activities'];
agentsConfig_1.defaultAgentsConfig.agents.forEach((agent, index) => {
    requiredFields.forEach(field => {
        if (!(field in agent)) {
            console.log(`   • ❌ Agente ${index + 1} (${agent.name}) falta campo: ${field}`);
            structureValid = false;
        }
    });
    // Validar actividades
    agent.activities.forEach((activity, actIndex) => {
        const requiredActivityFields = ['id', 'name', 'description', 'estimatedTime', 'successRate', 'executions', 'status'];
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
function runConfigValidation() {
    const roleValidation = (0, agentRolesConfig_1.validateAgentRoles)();
    return roleValidation.valid && structureValid;
}
