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
exports.activities = void 0;
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
};
