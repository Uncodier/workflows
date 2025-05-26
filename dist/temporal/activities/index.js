"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activities = void 0;
const apiActivities_1 = require("./apiActivities");
const supabaseActivities_1 = require("./supabaseActivities");
exports.activities = {
    fetchDataActivity: apiActivities_1.fetchDataActivity,
    createResourceActivity: supabaseActivities_1.createResourceActivity,
    updateResourceActivity: supabaseActivities_1.updateResourceActivity,
    deleteResourceActivity: supabaseActivities_1.deleteResourceActivity,
};
