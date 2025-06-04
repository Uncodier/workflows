"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeToolWorkflow = executeToolWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { executeApiCall, validateParameters, processResponse } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        initialInterval: '1s',
        maximumInterval: '30s',
        maximumAttempts: 3,
    },
});
async function executeToolWorkflow(input) {
    try {
        console.log(`[Workflow] Executing tool: ${input.toolName}`);
        // 1. Validar parámetros
        await validateParameters(input.toolName, input.args, input.apiConfig);
        // 2. Ejecutar la llamada API
        const result = await executeApiCall(input);
        // 3. Procesar respuesta si hay mapeo
        if (input.apiConfig.responseMapping && result.success) {
            result.data = await processResponse(result.data, input.apiConfig.responseMapping);
        }
        console.log(`[Workflow] Tool ${input.toolName} executed successfully`);
        return result;
    }
    catch (error) {
        console.error(`[Workflow] Error executing tool ${input.toolName}:`, error);
        return {
            success: false,
            error: error.message || 'Unknown workflow error',
        };
    }
}
