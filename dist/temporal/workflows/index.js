"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowNames = exports.workflows = void 0;
const dataProcessingWorkflow_1 = require("./dataProcessingWorkflow");
const cronWorkflow_1 = require("./cronWorkflow");
const syncEmailsWorkflow_1 = require("./syncEmailsWorkflow");
const syncEmailsScheduleWorkflow_1 = require("./syncEmailsScheduleWorkflow");
const scheduleActivitiesWorkflow_1 = require("./scheduleActivitiesWorkflow");
const activityPrioritizationEngineWorkflow_1 = require("./activityPrioritizationEngineWorkflow");
const dailyOperationsWorkflow_1 = require("./dailyOperationsWorkflow");
const sendReportWorkflow_1 = require("./sendReportWorkflow");
const scheduleCustomerSupportMessagesWorkflow_1 = require("./scheduleCustomerSupportMessagesWorkflow");
const customerSupportWorkflow_1 = require("./customerSupportWorkflow");
const sendEmailFromAgentWorkflow_1 = require("./sendEmailFromAgentWorkflow");
const sendWhatsappFromAgentWorkflow_1 = require("./sendWhatsappFromAgentWorkflow");
const answerWhatsappMessageWorkflow_1 = require("./answerWhatsappMessageWorkflow");
const siteSetupWorkflow_1 = require("./siteSetupWorkflow");
const buildCampaignsWorkflow_1 = require("./buildCampaignsWorkflow");
const buildSegmentsWorkflow_1 = require("./buildSegmentsWorkflow");
const buildContentWorkflow_1 = require("./buildContentWorkflow");
const leadFollowUpWorkflow_1 = require("./leadFollowUpWorkflow");
const leadResearchWorkflow_1 = require("./leadResearchWorkflow");
const buildSegmentsICPWorkflow_1 = require("./buildSegmentsICPWorkflow");
const humanInterventionWorkflow_1 = require("./humanInterventionWorkflow");
const deepResearchWorkflow_1 = require("./deepResearchWorkflow");
const dailyStandUpWorkflow_1 = require("./dailyStandUpWorkflow");
// Export workflows individually
__exportStar(require("./dataProcessingWorkflow"), exports);
__exportStar(require("./cronWorkflow"), exports);
__exportStar(require("./syncEmailsWorkflow"), exports);
__exportStar(require("./syncEmailsScheduleWorkflow"), exports);
__exportStar(require("./scheduleActivitiesWorkflow"), exports);
__exportStar(require("./activityPrioritizationEngineWorkflow"), exports);
__exportStar(require("./dailyOperationsWorkflow"), exports);
__exportStar(require("./sendReportWorkflow"), exports);
__exportStar(require("./scheduleCustomerSupportMessagesWorkflow"), exports);
__exportStar(require("./sendEmailFromAgentWorkflow"), exports);
__exportStar(require("./sendWhatsappFromAgentWorkflow"), exports);
__exportStar(require("./answerWhatsappMessageWorkflow"), exports);
__exportStar(require("./siteSetupWorkflow"), exports);
__exportStar(require("./buildCampaignsWorkflow"), exports);
__exportStar(require("./buildSegmentsWorkflow"), exports);
__exportStar(require("./buildContentWorkflow"), exports);
__exportStar(require("./leadFollowUpWorkflow"), exports);
__exportStar(require("./leadResearchWorkflow"), exports);
__exportStar(require("./buildSegmentsICPWorkflow"), exports);
__exportStar(require("./humanInterventionWorkflow"), exports);
__exportStar(require("./deepResearchWorkflow"), exports);
__exportStar(require("./dailyStandUpWorkflow"), exports);
// Also export as a bundle for the client
exports.workflows = {
    dataProcessingWorkflow: dataProcessingWorkflow_1.dataProcessingWorkflow,
    scheduledApiPollingWorkflow: cronWorkflow_1.scheduledApiPollingWorkflow,
    syncEmailsWorkflow: syncEmailsWorkflow_1.syncEmailsWorkflow,
    syncEmailsScheduleWorkflow: syncEmailsScheduleWorkflow_1.syncEmailsScheduleWorkflow,
    scheduleActivitiesWorkflow: scheduleActivitiesWorkflow_1.scheduleActivitiesWorkflow,
    activityPrioritizationEngineWorkflow: activityPrioritizationEngineWorkflow_1.activityPrioritizationEngineWorkflow,
    dailyOperationsWorkflow: dailyOperationsWorkflow_1.dailyOperationsWorkflow,
    sendReportWorkflow: sendReportWorkflow_1.sendReportWorkflow,
    scheduleCustomerSupportMessagesWorkflow: scheduleCustomerSupportMessagesWorkflow_1.scheduleCustomerSupportMessagesWorkflow,
    customerSupportMessageWorkflow: customerSupportWorkflow_1.customerSupportMessageWorkflow,
    emailCustomerSupportMessageWorkflow: customerSupportWorkflow_1.emailCustomerSupportMessageWorkflow,
    sendEmailFromAgent: sendEmailFromAgentWorkflow_1.sendEmailFromAgent,
    sendWhatsappFromAgent: sendWhatsappFromAgentWorkflow_1.sendWhatsappFromAgent,
    answerWhatsappMessageWorkflow: answerWhatsappMessageWorkflow_1.answerWhatsappMessageWorkflow,
    processWhatsAppMessagesWorkflow: answerWhatsappMessageWorkflow_1.processWhatsAppMessagesWorkflow,
    siteSetupWorkflow: siteSetupWorkflow_1.siteSetupWorkflow,
    buildCampaignsWorkflow: buildCampaignsWorkflow_1.buildCampaignsWorkflow,
    buildSegmentsWorkflow: buildSegmentsWorkflow_1.buildSegmentsWorkflow,
    buildContentWorkflow: buildContentWorkflow_1.buildContentWorkflow,
    leadFollowUpWorkflow: leadFollowUpWorkflow_1.leadFollowUpWorkflow,
    leadResearchWorkflow: leadResearchWorkflow_1.leadResearchWorkflow,
    buildSegmentsICPWorkflow: buildSegmentsICPWorkflow_1.buildSegmentsICPWorkflow,
    buildSingleSegmentICPWorkflow: buildSegmentsICPWorkflow_1.buildSingleSegmentICPWorkflow,
    humanInterventionWorkflow: humanInterventionWorkflow_1.humanInterventionWorkflow,
    deepResearchWorkflow: deepResearchWorkflow_1.deepResearchWorkflow,
    dailyStandUpWorkflow: dailyStandUpWorkflow_1.dailyStandUpWorkflow,
};
// Workflow names for Temporal Client (strings)
exports.workflowNames = {
    dataProcessingWorkflow: 'dataProcessingWorkflow',
    scheduledApiPollingWorkflow: 'scheduledApiPollingWorkflow',
    syncEmailsWorkflow: 'syncEmailsWorkflow',
    syncEmailsScheduleWorkflow: 'syncEmailsScheduleWorkflow',
    scheduleActivitiesWorkflow: 'scheduleActivitiesWorkflow',
    activityPrioritizationEngineWorkflow: 'activityPrioritizationEngineWorkflow',
    dailyOperationsWorkflow: 'dailyOperationsWorkflow',
    sendReportWorkflow: 'sendReportWorkflow',
    scheduleCustomerSupportMessagesWorkflow: 'scheduleCustomerSupportMessagesWorkflow',
    customerSupportMessageWorkflow: 'customerSupportMessageWorkflow',
    emailCustomerSupportMessageWorkflow: 'emailCustomerSupportMessageWorkflow',
    sendEmailFromAgent: 'sendEmailFromAgent',
    sendWhatsappFromAgent: 'sendWhatsappFromAgent',
    answerWhatsappMessageWorkflow: 'answerWhatsappMessageWorkflow',
    processWhatsAppMessagesWorkflow: 'processWhatsAppMessagesWorkflow',
    siteSetupWorkflow: 'siteSetupWorkflow',
    buildCampaignsWorkflow: 'buildCampaignsWorkflow',
    buildSegmentsWorkflow: 'buildSegmentsWorkflow',
    buildContentWorkflow: 'buildContentWorkflow',
    leadFollowUpWorkflow: 'leadFollowUpWorkflow',
    leadResearchWorkflow: 'leadResearchWorkflow',
    buildSegmentsICPWorkflow: 'buildSegmentsICPWorkflow',
    buildSingleSegmentICPWorkflow: 'buildSingleSegmentICPWorkflow',
    humanInterventionWorkflow: 'humanInterventionWorkflow',
    deepResearchWorkflow: 'deepResearchWorkflow',
    dailyStandUpWorkflow: 'dailyStandUpWorkflow',
};
