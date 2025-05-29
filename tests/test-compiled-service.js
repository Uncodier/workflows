const { EmailSyncSchedulingService } = require('../dist/temporal/services/EmailSyncSchedulingService.js');

console.log('🔍 Checking compiled service...');
console.log('Class exists:', !!EmailSyncSchedulingService);

// Create a mock failed site scenario with COMPLETE valid email config
const mockSite = {
  id: 'mock-site', 
  name: 'Mock Site',
  email: { 
    email: 'test@test.com',
    enabled: true,
    password: 'secure_password_123',
    incomingPort: '993',
    outgoingPort: '587',
    incomingServer: 'imap.gmail.com',
    outgoingServer: 'smtp.gmail.com'
  }
};

const mockLastSync = {
  site_id: 'mock-site',
  status: 'FAILED',
  retry_count: 1,
  last_run: new Date(Date.now() - 26 * 60 * 1000).toISOString() // 26 minutes ago
};

console.log('Mock scenario:');
console.log('- Status: FAILED');
console.log('- Retry count: 1/3');
console.log('- Minutes since failure:', 26);

const result = EmailSyncSchedulingService.determineSiteScheduling(mockSite, mockLastSync);
console.log('Result:', result); 