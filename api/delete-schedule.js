// Delete Schedule Endpoint - Remove incorrect schedule from Temporal Cloud
require('dotenv').config();

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Delete Schedule Endpoint Called ===');
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      query: req.query,
      timestamp: new Date().toISOString()
    });

    // Environment validation
    if (!process.env.TEMPORAL_SERVER_URL || !process.env.TEMPORAL_NAMESPACE) {
      throw new Error('Missing required Temporal configuration');
    }

    // Get schedule ID from query parameter
    const scheduleId = req.query.id || 'sync-emails-schedule';

    console.log(`🗑️ Attempting to delete schedule: ${scheduleId}`);

    // Import required modules
    const { Client } = require('@temporalio/client');

    // Configure connection
    const connectionOptions = {
      address: process.env.TEMPORAL_SERVER_URL,
      connectTimeout: '5s',
      rpcTimeout: '10s',
    };

    if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
      connectionOptions.tls = {
        handshakeTimeout: '5s',
      };
    }

    if (process.env.TEMPORAL_API_KEY) {
      connectionOptions.metadata = {
        'temporal-namespace': process.env.TEMPORAL_NAMESPACE,
      };
      connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
    }

    console.log('📡 Creating Temporal client connection...');
    const client = new Client({
      connection: connectionOptions,
      namespace: process.env.TEMPORAL_NAMESPACE,
    });

    // Get schedule client
    const scheduleClient = client.schedule;

    try {
      // Try to get the schedule first to see if it exists
      console.log(`🔍 Checking if schedule ${scheduleId} exists...`);
      const scheduleHandle = scheduleClient.getHandle(scheduleId);
      
      // Try to describe it (this will throw if it doesn't exist)
      await scheduleHandle.describe();
      console.log(`✅ Schedule ${scheduleId} exists, proceeding with deletion...`);
      
      // Delete the schedule
      await scheduleHandle.delete();
      console.log(`🗑️ Successfully deleted schedule: ${scheduleId}`);

      return res.status(200).json({
        success: true,
        message: `Schedule '${scheduleId}' deleted successfully`,
        scheduleId,
        duration: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      if (error.message.includes('not found') || error.message.includes('NotFound')) {
        console.log(`ℹ️ Schedule ${scheduleId} does not exist, nothing to delete`);
        
        return res.status(200).json({
          success: true,
          message: `Schedule '${scheduleId}' does not exist (already deleted or never created)`,
          scheduleId,
          duration: `${Date.now() - startTime}ms`,
          timestamp: new Date().toISOString()
        });
      }
      
      throw error; // Re-throw if it's a different error
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('=== Delete schedule endpoint failed ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      duration: `${duration}ms`
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  }
}; 