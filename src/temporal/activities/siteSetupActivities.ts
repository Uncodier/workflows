import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services/supabaseService';
import type { AgentConfig } from '../config/agentsConfig';
import { randomUUID } from 'crypto';

/**
 * Site Setup Activity interfaces
 */
export interface SiteSetupParams {
  site_id: string;
  user_id: string;
  company_name: string;
  contact_email: string;
  contact_name: string;
  package_type?: string;
  custom_requirements?: string[];
}

export interface CreateAgentsParams {
  site_id: string;
  user_id: string;
  company_name: string;
  agent_types?: string[];
  custom_config?: {
    agents_config?: AgentConfig[];
    use_detailed_config?: boolean;
    [key: string]: any;
  };
}

export interface CreateAgentsResult {
  success: boolean;
  agents: Array<{
    agent_id: string;
    type: string;
    name: string;
    status: string;
    description?: string;
    icon?: string;
    activities?: Array<{
      id: string;
      name: string;
      description: string;
      estimatedTime: string;
      successRate: number;
    }>;
  }>;
  total_created: number;
}

export interface AssignAccountManagerParams {
  site_id: string;
  user_id: string;
  contact_email: string;
  contact_name: string;
  company_name: string;
  preferred_manager_id?: string;
}

export interface AssignAccountManagerResult {
  success: boolean;
  account_manager: {
    manager_id: string;
    name: string;
    email: string;
    phone?: string;
  };
  assignment_date: string;
}

export interface SendSetupFollowUpEmailParams {
  contact_email: string;
  contact_name: string;
  company_name: string;
  site_id: string;
  account_manager: {
    name: string;
    email: string;
    phone?: string;
  };
  agents_created: Array<{
    type: string;
    name: string;
  }>;
  next_steps?: string[];
}

export interface SendSetupFollowUpEmailResult {
  success: boolean;
  messageId: string;
  recipient: string;
  timestamp: string;
}

/**
 * Activity to create agents for a new site
 */
export async function createAgentsActivity(params: CreateAgentsParams): Promise<CreateAgentsResult> {
  console.log('🤖 Creating agents for site:', {
    site_id: params.site_id,
    user_id: params.user_id,
    company_name: params.company_name,
    agent_types: params.agent_types,
    use_detailed_config: params.custom_config?.use_detailed_config
  });

  try {
    const supabaseService = getSupabaseService();
    const createdAgents: Array<{
      agent_id: string;
      type: string;
      name: string;
      status: string;
      description?: string;
      icon?: string;
      activities?: Array<{
        id: string;
        name: string;
        description: string;
        estimatedTime: string;
        successRate: number;
      }>;
    }> = [];

    // Si se proporciona configuración detallada, usar esos agentes
    if (params.custom_config?.use_detailed_config && params.custom_config?.agents_config) {
      console.log('📋 Using detailed agents configuration...');
      
      for (const agentConfig of params.custom_config.agents_config) {
        const agentId = randomUUID();
        const now = new Date().toISOString();
        
        // Preparar datos del agente para Supabase
        const agentData = {
          id: agentId,
          name: agentConfig.name,
          description: agentConfig.description,
          type: agentConfig.type,
          status: agentConfig.status,
          site_id: params.site_id,
          user_id: params.user_id,
          conversations: agentConfig.conversations || 0,
          success_rate: agentConfig.successRate || 0,
          role: agentConfig.name, // El rol es el nombre del agente
          activities: agentConfig.activities, // Guardamos las actividades como JSON
          configuration: {
            icon: agentConfig.icon,
            company_name: params.company_name,
            agent_type: agentConfig.type
          },
          created_at: now,
          updated_at: now,
          last_active: agentConfig.lastActive || now,
          tools: [], // Inicializamos vacío, se puede configurar después
          integrations: {}, // Inicializamos vacío, se puede configurar después
          backstory: `AI agent specialized in ${agentConfig.description.toLowerCase()}`,
          prompt: `You are a ${agentConfig.name} specialized in ${agentConfig.description}. Help users with tasks related to your expertise.`
        };

        console.log(`   • Creating agent: ${agentConfig.name} (${agentConfig.type})`);
        
        try {
          // Insertar agente en Supabase usando el método del servicio
          await supabaseService.createAgent(agentData);
          
          console.log(`   ✅ Agent ${agentConfig.name} created with ID: ${agentId}`);

          // Agregar a la lista de agentes creados
          createdAgents.push({
            agent_id: agentId,
            type: agentConfig.type,
            name: agentConfig.name,
            status: agentConfig.status,
            description: agentConfig.description,
            icon: agentConfig.icon,
            activities: agentConfig.activities.map(activity => ({
              id: activity.id,
              name: activity.name,
              description: activity.description,
              estimatedTime: activity.estimatedTime,
              successRate: activity.successRate
            }))
          });
        } catch (error) {
          console.error(`❌ Failed to create agent ${agentConfig.name}:`, error);
          throw new Error(`Failed to create agent ${agentConfig.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      console.log(`✅ Successfully created ${createdAgents.length} agents with detailed configuration`);
    } else {
      // Configuración básica - crear agentes simples basados en tipos
      const agentTypes = params.agent_types || ['customer_support', 'sales', 'general'];
      console.log('📋 Using basic agent types configuration:', agentTypes);
      
      for (const agentType of agentTypes) {
        const agentId = randomUUID();
        const now = new Date().toISOString();
        
        // Configuración básica por tipo
        const typeConfigs = {
          customer_support: {
            name: 'Customer Support',
            description: 'Handles customer inquiries and support requests',
            icon: 'HelpCircle'
          },
          sales: {
            name: 'Sales Assistant',
            description: 'Assists with sales processes and lead management',
            icon: 'ShoppingCart'
          },
          general: {
            name: 'General Assistant',
            description: 'Provides general assistance and information',
            icon: 'MessageSquare'
          }
        };

        const config = typeConfigs[agentType as keyof typeof typeConfigs] || typeConfigs.general;
        
        const agentData = {
          id: agentId,
          name: config.name,
          description: config.description,
          type: agentType,
          status: 'active',
          site_id: params.site_id,
          user_id: params.user_id,
          conversations: 0,
          success_rate: 0,
          role: config.name,
          activities: [],
          configuration: {
            icon: config.icon,
            company_name: params.company_name,
            agent_type: agentType
          },
          created_at: now,
          updated_at: now,
          last_active: now,
          tools: [],
          integrations: {},
          backstory: `AI agent specialized in ${config.description.toLowerCase()}`,
          prompt: `You are a ${config.name} for ${params.company_name}. ${config.description}.`
        };

        console.log(`   • Creating basic agent: ${config.name} (${agentType})`);
        
        try {
          // Insertar agente en Supabase usando el método del servicio
          await supabaseService.createAgent(agentData);

          console.log(`   ✅ Agent ${config.name} created with ID: ${agentId}`);

          // Agregar a la lista de agentes creados
          createdAgents.push({
            agent_id: agentId,
            type: agentType,
            name: config.name,
            status: 'active',
            description: config.description,
            icon: config.icon
          });
        } catch (error) {
          console.error(`❌ Failed to create agent ${config.name}:`, error);
          throw new Error(`Failed to create agent ${config.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      console.log(`✅ Successfully created ${createdAgents.length} basic agents`);
    }

    return {
      success: true,
      agents: createdAgents,
      total_created: createdAgents.length
    };

  } catch (error) {
    console.error('❌ Agent creation failed:', error);
    throw new Error(`Agent creation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to assign an account manager to a new site
 */
export async function assignAccountManagerActivity(params: AssignAccountManagerParams): Promise<AssignAccountManagerResult> {
  console.log('👤 Assigning account manager for site:', {
    site_id: params.site_id,
    user_id: params.user_id,
    contact_email: params.contact_email,
    company_name: params.company_name,
    preferred_manager_id: params.preferred_manager_id
  });

  try {
    const response = await apiService.post('/api/sites/setup/account-manager', {
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

  } catch (error) {
    console.error('❌ Account manager assignment failed:', error);
    throw new Error(`Account manager assignment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to send setup follow-up email with next steps
 */
export async function sendSetupFollowUpEmailActivity(params: SendSetupFollowUpEmailParams): Promise<SendSetupFollowUpEmailResult> {
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

    const response = await apiService.post('/api/emails/send', {
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

  } catch (error) {
    console.error('❌ Setup follow-up email failed:', error);
    throw new Error(`Setup follow-up email failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} 