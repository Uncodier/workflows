"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgentsActivity = createAgentsActivity;
exports.assignAccountManagerActivity = assignAccountManagerActivity;
exports.sendSetupFollowUpEmailActivity = sendSetupFollowUpEmailActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to create agents for a new site
 */
async function createAgentsActivity(params) {
    console.log('🤖 Creating agents for site:', {
        site_id: params.site_id,
        user_id: params.user_id,
        company_name: params.company_name,
        agent_types: params.agent_types,
        use_detailed_config: params.custom_config?.use_detailed_config
    });
    try {
        const requestPayload = {
            site_id: params.site_id,
            user_id: params.user_id,
            company_name: params.company_name,
            agent_types: params.agent_types || ['customer_support', 'sales', 'general'],
            custom_config: params.custom_config || {}
        };
        // Si se proporciona configuración detallada, incluir los agentes específicos
        if (params.custom_config?.use_detailed_config && params.custom_config?.agents_config) {
            console.log('📋 Using detailed agents configuration...');
            requestPayload.custom_config.detailed_agents = params.custom_config.agents_config.map((agent) => ({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                type: agent.type,
                status: agent.status,
                icon: agent.icon,
                activities: agent.activities.map(activity => ({
                    id: activity.id,
                    name: activity.name,
                    description: activity.description,
                    estimatedTime: activity.estimatedTime,
                    successRate: activity.successRate,
                    executions: activity.executions,
                    status: activity.status
                }))
            }));
            console.log(`   • Total agents to create: ${params.custom_config.agents_config.length}`);
            console.log(`   • Agent names: ${params.custom_config.agents_config.map(a => a.name).join(', ')}`);
        }
        const response = await apiService_1.apiService.post('/api/sites/setup/agents', requestPayload);
        if (!response.success) {
            throw new Error(`Failed to create agents: ${response.error?.message}`);
        }
        console.log('✅ Agents created successfully:', response.data);
        return {
            success: true,
            agents: response.data.agents || [],
            total_created: response.data.agents?.length || 0
        };
    }
    catch (error) {
        console.error('❌ Agent creation failed:', error);
        throw new Error(`Agent creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to assign an account manager to a new site
 */
async function assignAccountManagerActivity(params) {
    console.log('👤 Assigning account manager for site:', {
        site_id: params.site_id,
        user_id: params.user_id,
        contact_email: params.contact_email,
        company_name: params.company_name,
        preferred_manager_id: params.preferred_manager_id
    });
    try {
        const response = await apiService_1.apiService.post('/api/sites/setup/account-manager', {
            site_id: params.site_id,
            user_id: params.user_id,
            contact_email: params.contact_email,
            contact_name: params.contact_name,
            company_name: params.company_name,
            preferred_manager_id: params.preferred_manager_id
        });
        if (!response.success) {
            throw new Error(`Failed to assign account manager: ${response.error?.message}`);
        }
        console.log('✅ Account manager assigned successfully:', response.data);
        return {
            success: true,
            account_manager: response.data.account_manager,
            assignment_date: response.data.assignment_date || new Date().toISOString()
        };
    }
    catch (error) {
        console.error('❌ Account manager assignment failed:', error);
        throw new Error(`Account manager assignment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to send setup follow-up email with next steps
 */
async function sendSetupFollowUpEmailActivity(params) {
    console.log('📧 Sending setup follow-up email:', {
        recipient: params.contact_email,
        contact_name: params.contact_name,
        company_name: params.company_name,
        site_id: params.site_id,
        account_manager: params.account_manager.name,
        agents_count: params.agents_created.length
    });
    try {
        // Construir el mensaje del email con los siguientes pasos
        const agentsList = params.agents_created
            .map(agent => `- ${agent.name} (${agent.type})`)
            .join('\n');
        const defaultNextSteps = [
            'Configurar las integraciones necesarias',
            'Personalizar las respuestas de los agentes',
            'Realizar pruebas de funcionamiento',
            'Programar sesión de entrenamiento del equipo',
            'Activar el servicio en producción'
        ];
        const nextStepsList = (params.next_steps || defaultNextSteps)
            .map((step, index) => `${index + 1}. ${step}`)
            .join('\n');
        const emailMessage = `
Hola ${params.contact_name},

¡Bienvenido a Uncodie! Nos complace informarte que hemos completado la configuración inicial de tu sitio.

**Detalles de la configuración:**
- Empresa: ${params.company_name}
- ID del sitio: ${params.site_id}

**Agentes creados:**
${agentsList}

**Tu Account Manager asignado:**
- Nombre: ${params.account_manager.name}
- Email: ${params.account_manager.email}
${params.account_manager.phone ? `- Teléfono: ${params.account_manager.phone}` : ''}

**Próximos pasos:**
${nextStepsList}

Tu Account Manager se pondrá en contacto contigo en las próximas 24 horas para coordinar los siguientes pasos.

¡Gracias por confiar en Uncodie!

Saludos,
El equipo de Uncodie
`.trim();
        const response = await apiService_1.apiService.post('/api/emails/send', {
            to: params.contact_email,
            from: 'setup@uncodie.com',
            subject: `¡Bienvenido a Uncodie! - Configuración completada para ${params.company_name}`,
            message: emailMessage,
            cc: params.account_manager.email,
            tags: ['site_setup', 'welcome', 'onboarding']
        });
        if (!response.success) {
            throw new Error(`Failed to send setup follow-up email: ${response.error?.message}`);
        }
        console.log('✅ Setup follow-up email sent successfully:', response.data);
        return {
            success: true,
            messageId: response.data.messageId || 'unknown',
            recipient: params.contact_email,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('❌ Setup follow-up email failed:', error);
        throw new Error(`Setup follow-up email failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
