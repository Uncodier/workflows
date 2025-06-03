export * from './supabaseActivities';
export * from './apiActivities';
export * from './prioritizationActivities';
export * from './reportActivities';
export * from './projectActivities';
export * from './emailSyncActivities';
export * from './cronActivities';
export * from './workflowSchedulingActivities';
export * from './emailAnalysisActivities';
export * from './customerSupportActivities';
export * from './emailActivities';
export * from './whatsappActivities';
export * from './siteSetupActivities';
import * as cronActivities from './cronActivities';
import * as workflowSchedulingActivities from './workflowSchedulingActivities';
import * as emailAnalysisActivities from './emailAnalysisActivities';
import * as customerSupportActivities from './customerSupportActivities';
import * as emailActivities from './emailActivities';
import * as whatsappActivities from './whatsappActivities';
import * as siteSetupActivities from './siteSetupActivities';
export declare const activities: {
    createAgentsActivity(params: siteSetupActivities.CreateAgentsParams): Promise<siteSetupActivities.CreateAgentsResult>;
    assignAccountManagerActivity(params: siteSetupActivities.AssignAccountManagerParams): Promise<siteSetupActivities.AssignAccountManagerResult>;
    sendSetupFollowUpEmailActivity(params: siteSetupActivities.SendSetupFollowUpEmailParams): Promise<siteSetupActivities.SendSetupFollowUpEmailResult>;
    analyzeWhatsAppMessageActivity(messageData: whatsappActivities.WhatsAppMessageData): Promise<whatsappActivities.WhatsAppAnalysisResponse>;
    sendWhatsAppResponseActivity(responseData: {
        phone: string;
        message: string;
        conversation_id?: string;
        site_id: string;
        user_id: string;
        agent_id?: string;
        message_type?: "text" | "image" | "document";
        media_url?: string;
    }): Promise<{
        success: boolean;
        message_id?: string;
        error?: string;
    }>;
    sendWhatsAppFromAgentActivity(params: whatsappActivities.SendWhatsAppFromAgentParams): Promise<whatsappActivities.SendWhatsAppFromAgentResult>;
    sendEmailFromAgentActivity(params: emailActivities.SendEmailParams): Promise<emailActivities.SendEmailResult>;
    sendCustomerSupportMessageActivity(emailData: customerSupportActivities.EmailData, baseParams: {
        agentId?: string;
        origin?: string;
    }): Promise<{
        success: boolean;
        data?: any;
        error?: string;
    }>;
    processAnalysisDataActivity(emailData: customerSupportActivities.EmailData): Promise<{
        shouldProcess: boolean;
        priority: string;
        reason: string;
    }>;
    processApiEmailResponseActivity(apiResponse: customerSupportActivities.ApiEmailResponse): Promise<{
        success: boolean;
        workflowId?: string;
        error?: string;
    }>;
    analyzeEmailsActivity(request: emailAnalysisActivities.EmailAnalysisRequest): Promise<emailAnalysisActivities.EmailAnalysisResponse>;
    checkEmailAnalysisStatusActivity(commandId: string): Promise<any>;
    scheduleEmailSyncWorkflowActivity(site: import("../services").SiteWithCronStatus, options?: import("../services").SchedulingOptions): Promise<workflowSchedulingActivities.ScheduleWorkflowResult>;
    scheduleMultipleEmailSyncWorkflowsActivity(sites: import("../services").SiteWithCronStatus[], options?: import("../services").SchedulingOptions): Promise<{
        scheduled: number;
        skipped: number;
        failed: number;
        results: workflowSchedulingActivities.ScheduleWorkflowResult[];
        errors: string[];
    }>;
    createRecurringEmailSyncScheduleActivity(site: import("../services").SiteWithCronStatus, cronExpression?: string, options?: import("../services").SchedulingOptions): Promise<workflowSchedulingActivities.ScheduleWorkflowResult>;
    saveCronStatusActivity(update: cronActivities.CronStatusUpdate): Promise<void>;
    batchSaveCronStatusActivity(updates: cronActivities.CronStatusUpdate[]): Promise<void>;
    getCronStatusActivity(activityName: string, siteIds: string[]): Promise<any[]>;
    shouldRunWorkflowActivity(activityName: string, siteId: string, minHoursBetweenRuns?: number): Promise<{
        shouldRun: boolean;
        reason: string;
        lastRun?: string;
    }>;
    fetchSitesActivity(options?: import("../services").SchedulingOptions): Promise<import("../services").SiteWithCronStatus[]>;
    scheduleEmailSyncWorkflowsActivity(sites: import("../services").SiteWithCronStatus[], options?: import("../services").SchedulingOptions): Promise<{
        scheduled: number;
        skipped: number;
        errors: string[];
    }>;
    updateCronStatusActivity(updates: {
        siteId: string;
        workflowId: string;
        scheduleId: string;
        status: string;
        nextRun?: string;
        errorMessage?: string;
    }[]): Promise<void>;
    getProjects(): Promise<{
        projects: any[];
        count: number;
        timestamp: Date;
    }>;
    schedulePrioritizationEngine(): Promise<{
        scheduled: boolean;
        workflowId: string;
        scheduledFor: Date;
    }>;
    getPerformance(): Promise<{
        metrics: any;
        timestamp: Date;
        summary: string;
    }>;
    sendDayReport(metrics: any, summary: string): Promise<{
        sent: boolean;
        recipients: string[];
        reportId: string;
    }>;
    getContext(): Promise<{
        context: string;
        timestamp: Date;
    }>;
    designPlan(context: string): Promise<{
        plan: string;
        activities: string[];
    }>;
    sendPlan(_plan: string): Promise<{
        sent: boolean;
        recipients: string[];
    }>;
    sendPriorityMail(activities: string[]): Promise<{
        sent: boolean;
        count: number;
    }>;
    scheduleActivities(activities: string[]): Promise<{
        scheduled: boolean;
        apiCalls: number;
    }>;
    fetchDataActivity(resourceId: string): Promise<any>;
    createApiResourceActivity(data: any): Promise<any>;
    updateApiResourceActivity(resourceId: string, data: any): Promise<any>;
    deleteApiResourceActivity(resourceId: string): Promise<any>;
    logWorkflowExecutionActivity(data: {
        workflowId: string;
        workflowType: string;
        status: string;
        input?: any;
        output?: any;
        error?: string;
    }): Promise<any>;
    trackApiCallActivity(data: {
        endpoint: string;
        method: string;
        statusCode: number;
        duration: number;
        workflowId?: string;
        error?: string;
    }): Promise<any>;
    fetchConfigurationActivity(configName: string): Promise<any>;
    storeWorkflowResultActivity(data: {
        workflowId: string;
        result: any;
        metadata?: Record<string, any>;
    }): Promise<any>;
    createResourceActivity(data: Record<string, unknown>): Promise<Record<string, unknown>>;
    updateResourceActivity(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
    deleteResourceActivity(id: string): Promise<void>;
};
export type Activities = typeof activities;
