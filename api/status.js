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
    const connection = await Connection.connect({ address });
    
    // If we reach here, connection was successful
    return {
      connected: true,
      address: address
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
} 