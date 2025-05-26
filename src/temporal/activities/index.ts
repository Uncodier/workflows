import { fetchDataActivity } from './apiActivities';
import { 
  createResourceActivity, 
  updateResourceActivity, 
  deleteResourceActivity,
  logWorkflowExecutionActivity,
  trackApiCallActivity,
  fetchConfigurationActivity,
  storeWorkflowResultActivity
} from './supabaseActivities';

export const activities = {
  fetchDataActivity,
  createResourceActivity,
  updateResourceActivity,
  deleteResourceActivity,
  logWorkflowExecutionActivity,
  trackApiCallActivity,
  fetchConfigurationActivity,
  storeWorkflowResultActivity,
};

export type Activities = typeof activities; 