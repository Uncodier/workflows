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
const sendReportWorkflow_1 = require("./sendReportWorkflow");
const scheduleCustomerSupportMessagesWorkflow_1 = require("./scheduleCustomerSupportMessagesWorkflow");
const sendEmailFromAgentWorkflow_1 = require("./sendEmailFromAgentWorkflow");
const answerWhatsappMessageWorkflow_1 = require("./answerWhatsappMessageWorkflow");
// Export workflows individually
__exportStar(require("./dataProcessingWorkflow"), exports);
__exportStar(require("./cronWorkflow"), exports);
__exportStar(require("./syncEmailsWorkflow"), exports);
__exportStar(require("./syncEmailsScheduleWorkflow"), exports);
__exportStar(require("./scheduleActivitiesWorkflow"), exports);
__exportStar(require("./activityPrioritizationEngineWorkflow"), exports);
__exportStar(require("./sendReportWorkflow"), exports);
__exportStar(require("./scheduleCustomerSupportMessagesWorkflow"), exports);
__exportStar(require("./sendEmailFromAgentWorkflow"), exports);
__exportStar(require("./answerWhatsappMessageWorkflow"), exports);
// Also export as a bundle for the client
exports.workflows = {
    dataProcessingWorkflow: dataProcessingWorkflow_1.dataProcessingWorkflow,
    scheduledApiPollingWorkflow: cronWorkflow_1.scheduledApiPollingWorkflow,
    syncEmailsWorkflow: syncEmailsWorkflow_1.syncEmailsWorkflow,
    syncEmailsScheduleWorkflow: syncEmailsScheduleWorkflow_1.syncEmailsScheduleWorkflow,
    scheduleActivitiesWorkflow: scheduleActivitiesWorkflow_1.scheduleActivitiesWorkflow,
    activityPrioritizationEngineWorkflow: activityPrioritizationEngineWorkflow_1.activityPrioritizationEngineWorkflow,
    sendReportWorkflow: sendReportWorkflow_1.sendReportWorkflow,
    scheduleCustomerSupportMessagesWorkflow: scheduleCustomerSupportMessagesWorkflow_1.scheduleCustomerSupportMessagesWorkflow,
    customerSupportMessageWorkflow: scheduleCustomerSupportMessagesWorkflow_1.customerSupportMessageWorkflow,
    sendEmailFromAgent: sendEmailFromAgentWorkflow_1.sendEmailFromAgent,
    answerWhatsappMessageWorkflow: answerWhatsappMessageWorkflow_1.answerWhatsappMessageWorkflow,
    processWhatsAppMessagesWorkflow: answerWhatsappMessageWorkflow_1.processWhatsAppMessagesWorkflow,
};
// Workflow names for Temporal Client (strings)
exports.workflowNames = {
    dataProcessingWorkflow: 'dataProcessingWorkflow',
    scheduledApiPollingWorkflow: 'scheduledApiPollingWorkflow',
    syncEmailsWorkflow: 'syncEmailsWorkflow',
    syncEmailsScheduleWorkflow: 'syncEmailsScheduleWorkflow',
    scheduleActivitiesWorkflow: 'scheduleActivitiesWorkflow',
    activityPrioritizationEngineWorkflow: 'activityPrioritizationEngineWorkflow',
    sendReportWorkflow: 'sendReportWorkflow',
    scheduleCustomerSupportMessagesWorkflow: 'scheduleCustomerSupportMessagesWorkflow',
    customerSupportMessageWorkflow: 'customerSupportMessageWorkflow',
    sendEmailFromAgent: 'sendEmailFromAgent',
    answerWhatsappMessageWorkflow: 'answerWhatsappMessageWorkflow',
    processWhatsAppMessagesWorkflow: 'processWhatsAppMessagesWorkflow',
};
