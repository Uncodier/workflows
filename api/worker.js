// This file serves as the entry point for Vercel serverless functions
require('dotenv').config();
const path = require('path');

// Dynamically import the worker script
module.exports = async (req, res) => {
  try {
    // This import works with compiled JavaScript in dist folder
    const startWorkerModule = require('../dist/scripts/start-worker');
    
    // Return a response immediately to prevent timeout
    res.status(200).json({ 
      status: 'Worker process initiated',
      timestamp: new Date().toISOString()
    });
    
    // The worker keeps running in the background
    console.log('Worker serverless function triggered');
  } catch (error) {
    console.error('Failed to start worker:', error);
    res.status(500).json({ error: 'Failed to start worker' });
  }
}; 