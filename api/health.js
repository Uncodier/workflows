// Simple health check endpoint - completely public
module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Health check endpoint called ===');
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    });

    // Basic system info
    const systemInfo = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryUsage: process.memoryUsage(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL ? 'SET' : 'NOT_SET',
        PWD: process.cwd()
      }
    };

    // Check if this is a cron call
    const isCronCall = req.headers['user-agent']?.includes('vercel-cron');
    if (isCronCall) {
      systemInfo.calledBy = 'vercel-cron';
    }

    const duration = Date.now() - startTime;
    systemInfo.duration = duration;

    console.log('Health check completed:', {
      status: 'healthy',
      duration: duration,
      isCron: isCronCall
    });

    // Set headers to ensure no caching and public access
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.status(200).json(systemInfo);

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('=== Health check failed ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      duration: duration
    });

    res.status(500).json({
      status: 'error',
      error: error.message,
      duration: duration,
      timestamp: new Date().toISOString()
    });
  }
}; 