"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflows = void 0;
const dataProcessingWorkflow_1 = require("./dataProcessingWorkflow");
const cronWorkflow_1 = require("./cronWorkflow");
// Export all workflows
exports.workflows = {
    dataProcessingWorkflow: dataProcessingWorkflow_1.dataProcessingWorkflow,
    scheduledApiPollingWorkflow: cronWorkflow_1.scheduledApiPollingWorkflow,
};
