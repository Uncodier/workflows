import type { EmailData } from '../activities/customerSupportActivities';
import type { WhatsAppMessageData } from '../activities/whatsappActivities';
/**
 * Email Customer Support Message Workflow
 * Processes one email and sends a customer support message
 * If successful, triggers sendEmailFromAgent for better traceability
 */
export declare function emailCustomerSupportMessageWorkflow(emailData: EmailData, baseParams: {
    agentId?: string;
    origin?: string;
}): Promise<{
    success: boolean;
    processed: boolean;
    reason: string;
    response?: any;
    emailSent?: boolean;
    emailWorkflowId?: string;
    error?: string;
}>;
/**
 * Customer Support Message Workflow
 * Detecta el origen (email vs whatsapp) y delega al workflow específico
 * Este es el workflow principal que debe ser llamado desde el API
 */
export declare function customerSupportMessageWorkflow(messageData: EmailData | {
    whatsappData: WhatsAppMessageData;
}, baseParams: {
    agentId?: string;
    origin?: string;
}): Promise<{
    success: boolean;
    processed: boolean;
    reason: string;
    response?: any;
    emailSent?: boolean;
    emailWorkflowId?: string;
    whatsappSent?: boolean;
    whatsappWorkflowId?: string;
    error?: string;
}>;
