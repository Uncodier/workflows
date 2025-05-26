// API endpoint to manage Temporal schedules
require('dotenv').config();

module.exports = async (req, res) => {
  try {
    // Route based on HTTP method
    switch (req.method) {
      case 'GET':
        return await listSchedules(req, res);
      case 'POST':
        return await createSchedule(req, res);
      case 'DELETE':
        return await deleteSchedule(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Schedule operation failed:', error);
    return res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// List all schedules
async function listSchedules(req, res) {
  try {
    // Dynamically import scheduler module
    const { listSchedules } = await import('../dist/temporal/scheduler/index.js');
    const schedules = await listSchedules();
    
    return res.status(200).json({
      status: 'success',
      schedules,
      count: schedules.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to list schedules:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Create a new schedule
async function createSchedule(req, res) {
  try {
    const { scheduleName, workflowType, args, cronExpression, options } = req.body;
    
    if (!scheduleName || !workflowType || !cronExpression) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['scheduleName', 'workflowType', 'cronExpression'],
        optional: ['args', 'options']
      });
    }
    
    // Dynamically import scheduler module
    const { createCronSchedule } = await import('../dist/temporal/scheduler/index.js');
    
    // Create the schedule with Temporal
    const scheduleId = await createCronSchedule(
      scheduleName,
      workflowType,
      args || [],
      cronExpression,
      options
    );
    
    return res.status(201).json({
      status: 'success',
      schedule: {
        id: scheduleId,
        name: scheduleName,
        workflowType,
        cronExpression,
        args: args || []
      }
    });
  } catch (error) {
    console.error('Failed to create schedule:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Delete a schedule
async function deleteSchedule(req, res) {
  try {
    const scheduleId = req.query.scheduleId;
    
    if (!scheduleId) {
      return res.status(400).json({
        error: 'Missing required parameter',
        required: ['scheduleId']
      });
    }
    
    // Dynamically import scheduler module
    const { deleteSchedule } = await import('../dist/temporal/scheduler/index.js');
    
    // Delete the schedule from Temporal
    await deleteSchedule(scheduleId);
    
    return res.status(200).json({
      status: 'success',
      message: `Schedule ${scheduleId} deleted successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to delete schedule:', error);
    return res.status(500).json({ error: error.message });
  }
} 