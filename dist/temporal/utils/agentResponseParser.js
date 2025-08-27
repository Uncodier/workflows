"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAgentResponse = parseAgentResponse;
/**
 * Parser de respuestas de agentes según documentación v2
 */
function parseAgentResponse(response) {
    if (!response)
        return { type: 'unknown' };
    const trimmed = response.trim().toLowerCase();
    // Step completado: "finished" o "step X finished"
    const stepFinishedMatch = trimmed.match(/(?:step\s+(\d+)\s+)?finished/i);
    if (stepFinishedMatch) {
        return {
            type: 'step_completed',
            stepNumber: stepFinishedMatch[1] ? parseInt(stepFinishedMatch[1]) : undefined
        };
    }
    // Step fallido: "failed" o "step X failed"
    const stepFailedMatch = trimmed.match(/(?:step\s+(\d+)\s+)?failed/i);
    if (stepFailedMatch) {
        return {
            type: 'step_failed',
            stepNumber: stepFailedMatch[1] ? parseInt(stepFailedMatch[1]) : undefined
        };
    }
    // Step cancelado: "canceled" o "step X canceled"
    const stepCanceledMatch = trimmed.match(/(?:step\s+(\d+)\s+)?canceled/i);
    if (stepCanceledMatch) {
        return {
            type: 'step_canceled',
            stepNumber: stepCanceledMatch[1] ? parseInt(stepCanceledMatch[1]) : undefined
        };
    }
    // Plan fallido: "plan failed: [reason]"
    const planFailedMatch = response.match(/plan\s+failed:\s*(.+)/i);
    if (planFailedMatch) {
        return {
            type: 'plan_failed',
            reason: planFailedMatch[1].trim()
        };
    }
    // Nuevo plan requerido: "new plan"
    if (trimmed.includes('new plan')) {
        return { type: 'new_plan' };
    }
    // Nueva sesión adquirida: "new [platform] session acquired"
    const newSessionMatch = response.match(/new\s+(\w+)\s+session\s+acquired/i);
    if (newSessionMatch) {
        return {
            type: 'new_session',
            platform: newSessionMatch[1]
        };
    }
    // Sesión requerida: "session needed [platform] [domain]"
    const sessionNeededMatch = response.match(/session\s+needed\s+(\w+)(?:\s+([^\s]+))?/i);
    if (sessionNeededMatch) {
        return {
            type: 'session_needed',
            platform: sessionNeededMatch[1],
            domain: sessionNeededMatch[2]
        };
    }
    // Sesión guardada: "session saved" o "authentication session saved"
    if (trimmed.includes('session saved') || trimmed.includes('authentication session')) {
        return { type: 'session_saved' };
    }
    // Atención del usuario requerida: "user attention required: [explanation]"
    const userAttentionMatch = response.match(/user\s+attention\s+required:\s*(.+)/i);
    if (userAttentionMatch) {
        return {
            type: 'user_attention',
            explanation: userAttentionMatch[1].trim()
        };
    }
    return { type: 'unknown' };
}
