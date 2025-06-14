"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteSetupWorkflow = siteSetupWorkflow;
const workflow_1 = require("@temporalio/workflow");
const agentsConfig_1 = require("../config/agentsConfig");
const buildSegmentsWorkflow_1 = require("./buildSegmentsWorkflow");
// Configure activity options
const { createAgentsActivity, assignAccountManagerActivity, sendSetupFollowUpEmailActivity, getSiteActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Site Setup Workflow
 * Orchestrates the complete setup process for a new site including:
 * 1. Creating agents
 * 2. Assigning an account manager
 * 3. Sending follow-up email with next steps
 */
async function siteSetupWorkflow(params) {
    console.log('🚀 Starting site setup workflow...');
    console.log(`🏢 Setting up site for: ${params.company_name}`);
    console.log(`📋 Site ID: ${params.site_id}, User ID: ${params.user_id}`);
    console.log(`📧 Contact: ${params.contact_name} (${params.contact_email})`);
    const result = {
        success: false,
        site_id: params.site_id,
        agents_created: {
            success: false,
            total_created: 0,
            agents: []
        },
        segments_created: {
            success: false,
            segments_built: 0
        },
        account_manager_assigned: {
            success: false,
            account_manager: {
                manager_id: '',
                name: '',
                email: ''
            },
            assignment_date: ''
        },
        follow_up_email_sent: {
            success: false,
            messageId: '',
            recipient: '',
            timestamp: ''
        },
        setup_completed_at: new Date().toISOString()
    };
    try {
        // Step 0: Get site information to ensure we have user_id and company details
        console.log('🏢 Step 0: Getting site information...');
        const siteInfo = await getSiteActivity(params.site_id);
        if (!siteInfo.success || !siteInfo.site) {
            throw new Error(`Failed to get site information: ${siteInfo.error || 'Site not found'}`);
        }
        const actualUserId = params.user_id || siteInfo.site.user_id;
        const actualCompanyName = params.company_name || siteInfo.site.name;
        if (!actualUserId) {
            throw new Error('Cannot proceed: user_id is required but not found in params or site data');
        }
        console.log(`✅ Site information retrieved: ${siteInfo.site.name} (${siteInfo.site.url})`);
        console.log(`📋 Using user_id: ${actualUserId}, company: ${actualCompanyName}`);
        // Step 1: Create agents for the site using detailed configuration
        console.log('🤖 Step 1: Creating agents with detailed configuration...');
        const agentsResult = await createAgentsActivity({
            site_id: params.site_id,
            user_id: actualUserId,
            company_name: actualCompanyName,
            agent_types: (0, agentsConfig_1.getAgentTypes)(),
            custom_config: {
                agents_config: agentsConfig_1.defaultAgentsConfig.agents,
                use_detailed_config: true
            }
        });
        if (!agentsResult.success) {
            throw new Error('Failed to create agents');
        }
        result.agents_created = {
            success: true,
            total_created: agentsResult.total_created,
            agents: agentsResult.agents
        };
        console.log(`✅ Step 1 completed: ${agentsResult.total_created} agents created`);
        console.log(`   • Agent types: ${(0, agentsConfig_1.getAgentTypes)().join(', ')}`);
        // Step 2: Create segments for the site
        console.log('🎯 Step 2: Creating initial segments for the site...');
        try {
            const segmentsOptions = {
                siteId: params.site_id,
                site_id: params.site_id, // Added required field
                segmentCount: 5,
                mode: 'create',
                userId: actualUserId,
                industryContext: 'ecommerce', // Default context, could be made configurable
                aiProvider: 'openai',
                aiModel: 'gpt-4o'
            };
            const segmentsHandle = await (0, workflow_1.startChild)(buildSegmentsWorkflow_1.buildSegmentsWorkflow, {
                args: [segmentsOptions],
                workflowId: `setup-segments-${params.site_id}-${Date.now()}`,
                workflowRunTimeout: '1 hour'
            });
            const segmentsResult = await segmentsHandle.result();
            if (segmentsResult.success) {
                result.segments_created = {
                    success: true,
                    segments_built: segmentsResult.segmentsBuilt || 0,
                    site_url: segmentsResult.siteUrl,
                    mode: segmentsResult.mode,
                    execution_time: segmentsResult.executionTime
                };
                console.log(`✅ Step 2 completed: ${segmentsResult.segmentsBuilt} segments created`);
                console.log(`   • Site URL: ${segmentsResult.siteUrl}`);
                console.log(`   • Execution time: ${segmentsResult.executionTime}`);
            }
            else {
                result.segments_created = {
                    success: false,
                    segments_built: 0,
                    error: segmentsResult.errors?.join(', ') || 'Unknown error creating segments'
                };
                console.warn(`⚠️  Step 2 warning: Failed to create segments - ${result.segments_created.error}`);
                console.warn('   • Setup will continue without segments');
            }
        }
        catch (segmentsError) {
            const errorMessage = segmentsError instanceof Error ? segmentsError.message : String(segmentsError);
            result.segments_created = {
                success: false,
                segments_built: 0,
                error: errorMessage
            };
            console.warn(`⚠️  Step 2 warning: Segments creation failed - ${errorMessage}`);
            console.warn('   • Setup will continue without segments');
        }
        // Step 3: Assign account manager
        console.log('👤 Step 3: Assigning account manager...');
        try {
            const accountManagerResult = await assignAccountManagerActivity({
                site_id: params.site_id,
                user_id: actualUserId,
                contact_email: params.contact_email,
                contact_name: params.contact_name,
                company_name: actualCompanyName
            });
            if (accountManagerResult.success) {
                result.account_manager_assigned = {
                    success: true,
                    account_manager: accountManagerResult.account_manager,
                    assignment_date: accountManagerResult.assignment_date
                };
                console.log(`✅ Step 3 completed: Account manager ${accountManagerResult.account_manager.name} assigned`);
            }
            else {
                result.account_manager_assigned = {
                    success: false,
                    account_manager: {
                        manager_id: '',
                        name: '',
                        email: ''
                    },
                    assignment_date: ''
                };
                console.warn('⚠️  Step 3 warning: Failed to assign account manager');
                console.warn('   • Setup will continue without account manager assignment');
            }
        }
        catch (accountManagerError) {
            const errorMessage = accountManagerError instanceof Error ? accountManagerError.message : String(accountManagerError);
            result.account_manager_assigned = {
                success: false,
                account_manager: {
                    manager_id: '',
                    name: '',
                    email: ''
                },
                assignment_date: ''
            };
            console.warn(`⚠️  Step 3 warning: Account manager assignment failed - ${errorMessage}`);
            console.warn('   • Setup will continue without account manager assignment');
        }
        // Step 4: Send follow-up email with next steps
        console.log('📧 Step 4: Sending follow-up email...');
        try {
            const emailResult = await sendSetupFollowUpEmailActivity({
                contact_email: params.contact_email,
                contact_name: params.contact_name,
                company_name: actualCompanyName,
                site_id: params.site_id,
                account_manager: result.account_manager_assigned.success ? {
                    name: result.account_manager_assigned.account_manager.name,
                    email: result.account_manager_assigned.account_manager.email,
                    phone: result.account_manager_assigned.account_manager.phone
                } : {
                    name: '',
                    email: ''
                },
                agents_created: agentsResult.agents.map((agent) => ({
                    type: agent.type,
                    name: agent.name
                })),
                next_steps: params.custom_requirements || [
                    'Configurar las integraciones necesarias',
                    'Personalizar las respuestas de los agentes',
                    'Realizar pruebas de funcionamiento',
                    'Programar sesión de entrenamiento del equipo',
                    'Activar el servicio en producción'
                ]
            });
            if (emailResult.success) {
                result.follow_up_email_sent = {
                    success: true,
                    messageId: emailResult.messageId,
                    recipient: emailResult.recipient,
                    timestamp: emailResult.timestamp
                };
                console.log(`✅ Step 4 completed: Follow-up email sent to ${emailResult.recipient}`);
            }
            else {
                result.follow_up_email_sent = {
                    success: false,
                    messageId: '',
                    recipient: '',
                    timestamp: ''
                };
                console.warn('⚠️  Step 4 warning: Failed to send follow-up email');
                console.warn('   • Setup completed without follow-up email');
            }
        }
        catch (emailError) {
            const errorMessage = emailError instanceof Error ? emailError.message : String(emailError);
            result.follow_up_email_sent = {
                success: false,
                messageId: '',
                recipient: '',
                timestamp: ''
            };
            console.warn(`⚠️  Step 4 warning: Follow-up email failed - ${errorMessage}`);
            console.warn('   • Setup completed without follow-up email');
        }
        // Mark overall success
        result.success = true;
        result.setup_completed_at = new Date().toISOString();
        console.log('🎉 Site setup workflow completed successfully');
        console.log(`📊 Summary:`);
        console.log(`   • Agents created: ${result.agents_created.total_created}`);
        console.log(`   • Segments created: ${result.segments_created.segments_built} (${result.segments_created.success ? 'success' : 'failed'})`);
        console.log(`   • Account manager: ${result.account_manager_assigned.account_manager.name}`);
        console.log(`   • Follow-up email: sent to ${result.follow_up_email_sent.recipient}`);
        return result;
    }
    catch (error) {
        console.error('❌ Site setup workflow failed:', error);
        result.error = error instanceof Error ? error.message : String(error);
        result.success = false;
        return result;
    }
}
