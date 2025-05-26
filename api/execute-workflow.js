// API endpoint to execute workflows manually
require('dotenv').config();

module.exports = async (req, res) => {
  try {
    // Check if request is POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed, use POST' });
    }

    // Extract workflow parameters from request body
    const { workflowType, resourceId, options } = req.body;

    if (!workflowType || !resourceId) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['workflowType', 'resourceId'],
        optional: ['options']
      });
    }

    // Dynamically import the client module
    const { executeWorkflow } = await import('../dist/temporal/client/index.js');
    
    // Execute the workflow
    const handle = await executeWorkflow(workflowType, [resourceId, options || {}]);
    
    // Return workflow ID and execution details
    return res.status(200).json({
      status: 'success',
      workflow: {
        id: handle.workflowId,
        type: workflowType,
        resourceId,
        options: options || {},
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Failed to execute workflow:', error);
    return res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}; 