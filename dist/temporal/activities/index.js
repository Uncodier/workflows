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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSiteAnalysisActivity = exports.deleteResourceActivity = exports.updateResourceActivity = exports.createResourceActivity = exports.storeWorkflowResultActivity = exports.fetchConfigurationActivity = exports.trackApiCallActivity = exports.logWorkflowExecutionActivity = exports.executeDailyProspectionWorkflowsActivity = exports.scheduleIndividualDailyProspectionActivity = exports.scheduleIndividualLeadGenerationActivity = exports.scheduleIndividualSiteAnalysisActivity = exports.scheduleIndividualDailyStandUpsActivity = exports.scheduleDailyOperationsWorkflowActivity = exports.executeDailyStandUpWorkflowsActivity = exports.activities = void 0;
// Export all activities
__exportStar(require("./supabaseActivities"), exports);
__exportStar(require("./apiActivities"), exports);
__exportStar(require("./prioritizationActivities"), exports);
__exportStar(require("./reportActivities"), exports);
__exportStar(require("./projectActivities"), exports);
__exportStar(require("./emailSyncActivities"), exports);
__exportStar(require("./cronActivities"), exports);
__exportStar(require("./workflowSchedulingActivities"), exports);
__exportStar(require("./emailAnalysisActivities"), exports);
__exportStar(require("./customerSupportActivities"), exports);
__exportStar(require("./emailActivities"), exports);
__exportStar(require("./whatsappActivities"), exports);
__exportStar(require("./siteSetupActivities"), exports);
__exportStar(require("./executeToolActivities"), exports);
__exportStar(require("./campaignActivities"), exports);
__exportStar(require("./leadActivities"), exports);
__exportStar(require("./interventionActivities"), exports);
__exportStar(require("./dataAnalystActivities"), exports);
__exportStar(require("./cmoActivities"), exports);
__exportStar(require("./leadGenerationActivities"), exports);
__exportStar(require("./uxActivities"), exports);
__exportStar(require("./newsletterActivities"), exports);
__exportStar(require("./dailyProspectionActivities"), exports);
__exportStar(require("./robotActivities"), exports);
__exportStar(require("./validateEmailActivities"), exports);
__exportStar(require("./webhookActivities"), exports);
__exportStar(require("./finderActivities"), exports);
// Bundle all activities for the worker
const supabaseActivities = __importStar(require("./supabaseActivities"));
const apiActivities = __importStar(require("./apiActivities"));
const prioritizationActivities = __importStar(require("./prioritizationActivities"));
const reportActivities = __importStar(require("./reportActivities"));
const projectActivities = __importStar(require("./projectActivities"));
const emailSyncActivities = __importStar(require("./emailSyncActivities"));
const cronActivities = __importStar(require("./cronActivities"));
const workflowSchedulingActivities = __importStar(require("./workflowSchedulingActivities"));
const emailAnalysisActivities = __importStar(require("./emailAnalysisActivities"));
const customerSupportActivities = __importStar(require("./customerSupportActivities"));
const emailActivities = __importStar(require("./emailActivities"));
const whatsappActivities = __importStar(require("./whatsappActivities"));
const siteSetupActivities = __importStar(require("./siteSetupActivities"));
const executeToolActivities = __importStar(require("./executeToolActivities"));
const campaignActivities = __importStar(require("./campaignActivities"));
const leadActivities = __importStar(require("./leadActivities"));
const interventionActivities = __importStar(require("./interventionActivities"));
const dataAnalystActivities = __importStar(require("./dataAnalystActivities"));
const cmoActivities = __importStar(require("./cmoActivities"));
const leadGenerationActivities = __importStar(require("./leadGenerationActivities"));
const uxActivities = __importStar(require("./uxActivities"));
const newsletterActivities = __importStar(require("./newsletterActivities"));
const dailyProspectionActivities = __importStar(require("./dailyProspectionActivities"));
const robotActivities = __importStar(require("./robotActivities")); // Used in activities spread
const validateEmailActivities = __importStar(require("./validateEmailActivities"));
const webhookActivities = __importStar(require("./webhookActivities"));
const finderActivities = __importStar(require("./finderActivities"));
exports.activities = {
    ...supabaseActivities,
    ...apiActivities,
    ...prioritizationActivities,
    ...reportActivities,
    ...projectActivities,
    ...emailSyncActivities,
    ...cronActivities,
    ...workflowSchedulingActivities,
    ...emailAnalysisActivities,
    ...customerSupportActivities,
    ...emailActivities,
    ...whatsappActivities,
    ...siteSetupActivities,
    ...executeToolActivities,
    ...campaignActivities,
    ...leadActivities,
    ...interventionActivities,
    ...dataAnalystActivities,
    ...cmoActivities,
    ...leadGenerationActivities,
    ...uxActivities,
    ...newsletterActivities,
    ...dailyProspectionActivities,
    ...robotActivities,
    ...validateEmailActivities,
    ...webhookActivities,
    ...finderActivities,
};
var workflowSchedulingActivities_1 = require("./workflowSchedulingActivities");
Object.defineProperty(exports, "executeDailyStandUpWorkflowsActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.executeDailyStandUpWorkflowsActivity; } });
Object.defineProperty(exports, "scheduleDailyOperationsWorkflowActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.scheduleDailyOperationsWorkflowActivity; } });
Object.defineProperty(exports, "scheduleIndividualDailyStandUpsActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.scheduleIndividualDailyStandUpsActivity; } });
Object.defineProperty(exports, "scheduleIndividualSiteAnalysisActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.scheduleIndividualSiteAnalysisActivity; } });
Object.defineProperty(exports, "scheduleIndividualLeadGenerationActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.scheduleIndividualLeadGenerationActivity; } });
Object.defineProperty(exports, "scheduleIndividualDailyProspectionActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.scheduleIndividualDailyProspectionActivity; } });
Object.defineProperty(exports, "executeDailyProspectionWorkflowsActivity", { enumerable: true, get: function () { return workflowSchedulingActivities_1.executeDailyProspectionWorkflowsActivity; } });
var supabaseActivities_1 = require("./supabaseActivities");
Object.defineProperty(exports, "logWorkflowExecutionActivity", { enumerable: true, get: function () { return supabaseActivities_1.logWorkflowExecutionActivity; } });
Object.defineProperty(exports, "trackApiCallActivity", { enumerable: true, get: function () { return supabaseActivities_1.trackApiCallActivity; } });
Object.defineProperty(exports, "fetchConfigurationActivity", { enumerable: true, get: function () { return supabaseActivities_1.fetchConfigurationActivity; } });
Object.defineProperty(exports, "storeWorkflowResultActivity", { enumerable: true, get: function () { return supabaseActivities_1.storeWorkflowResultActivity; } });
Object.defineProperty(exports, "createResourceActivity", { enumerable: true, get: function () { return supabaseActivities_1.createResourceActivity; } });
Object.defineProperty(exports, "updateResourceActivity", { enumerable: true, get: function () { return supabaseActivities_1.updateResourceActivity; } });
Object.defineProperty(exports, "deleteResourceActivity", { enumerable: true, get: function () { return supabaseActivities_1.deleteResourceActivity; } });
Object.defineProperty(exports, "checkSiteAnalysisActivity", { enumerable: true, get: function () { return supabaseActivities_1.checkSiteAnalysisActivity; } });
