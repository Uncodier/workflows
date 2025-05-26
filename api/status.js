// Status endpoint to check if the service is running
module.exports = async (req, res) => {
  try {
    // Check connection to Temporal
    const temporalStatus = await checkTemporalConnection();
    
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      temporal: temporalStatus
    });
  } catch (error) {
    console.error('Status check failed:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

async function checkTemporalConnection() {
  try {
    // We'll use a dynamic import to avoid issues with ES modules vs CommonJS
    const { Connection } = await import('@temporalio/client');
    
    const address = process.env.TEMPORAL_SERVER_URL || 'localhost:7233';
    
    // Configure connection options
    const connectionOptions = { address };
    
    // Add TLS and API key for remote connections (Temporal Cloud)
    if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
      connectionOptions.tls = {};
    }

    if (process.env.TEMPORAL_API_KEY) {
      connectionOptions.metadata = {
        'temporal-namespace': process.env.TEMPORAL_NAMESPACE || 'default',
      };
      connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
    }
    
    const connection = await Connection.connect(connectionOptions);
    
    // If we reach here, connection was successful
    return {
      connected: true,
      address: address,
      tls: !!connectionOptions.tls,
      hasApiKey: !!process.env.TEMPORAL_API_KEY
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
} 