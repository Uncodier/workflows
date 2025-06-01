/**
 * Manual test script for Customer Support Messages Workflow
 * This script can be run to test the scheduleCustomerSupportMessagesWorkflow functionality
 */

import { getTemporalClient } from '../temporal/client';
import type { EmailData, ScheduleCustomerSupportParams, ApiEmailResponse } from '../temporal/activities/customerSupportActivities';

// Sample email data for testing with real API structure
const mockEmailData: EmailData[] = [
  {
    email: {
      summary: "The emails include notifications about a webinar on zero-click search strategies, product updates, verification codes, build failures, and event reminders. The correspondence is mainly promotional and informational, with some technical support alerts.",
      original_subject: "QQ: is your Google traffic dropping?",
      contact_info: {
        name: "Neil Patel",
        email: "neil@advanced.npdigital.com",
        phone: null,
        company: "NP Digital"
      }
    },
    site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
    lead_notification: "email", // Del flujo syncEmails - enviará follow-up email
    analysis_id: "email_1748742922564_0",
    priority: "high",
    response_type: "commercial",
    potential_value: "high",
    intent: "inquiry"
  },
  {
    email: {
      summary: "Support request for integration help with our API",
      original_subject: "Need help with API integration",
      contact_info: {
        name: "Jane Smith",
        email: "jane.smith@customer.com",
        phone: "+1555123456",
        company: "Customer Inc"
      }
    },
    site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
    lead_notification: "none",
    analysis_id: "email_1748742922564_1",
    priority: "medium",
    response_type: "support",
    potential_value: "medium",
    intent: "support"
  }
];

// Mock API response structure
const mockApiResponse: ApiEmailResponse = {
  emails: mockEmailData,
  site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
  user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
  total_emails: mockEmailData.length,
  timestamp: "2025-06-01T01:55:22.564Z",
  childWorkflow: {
    type: "scheduleCustomerSupportMessagesWorkflow",
    args: {
      emails: mockEmailData,
      site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
      user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
      total_emails: mockEmailData.length,
      timestamp: "2025-06-01T01:55:22.564Z",
      agentId: "test-agent-123"
    }
  }
};

/**
 * Test the main API email processing workflow
 */
export async function testApiEmailProcessingWorkflow() {
  try {
    console.log('🧪 Starting API Email Processing Workflow Test...');
    
    const client = await getTemporalClient();
    
    console.log(`📨 Testing with ${mockApiResponse.total_emails} emails from API response`);
    console.log(`🏢 Site: ${mockApiResponse.site_id}`);
    console.log(`👤 User: ${mockApiResponse.user_id}`);
    console.log(`⏰ Timestamp: ${mockApiResponse.timestamp}`);
    
    const result = await client.workflow.execute('processApiEmailsWorkflow', {
      args: [mockApiResponse],
      taskQueue: 'customer-support-queue',
      workflowId: `test-api-emails-workflow-${Date.now()}`,
    });
    
    console.log('✅ API Email Processing Workflow completed successfully!');
    console.log(`📊 Results:`, JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ API Email Processing Workflow test failed:', error);
  }
}

/**
 * Test the direct schedule customer support messages workflow
 */
export async function testCustomerSupportWorkflow() {
  try {
    console.log('🧪 Starting Direct Customer Support Messages Workflow Test...');
    
    const client = await getTemporalClient();
    
    const params: ScheduleCustomerSupportParams = {
      emails: mockEmailData,
      site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
      user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
      total_emails: mockEmailData.length,
      timestamp: "2025-06-01T01:55:22.564Z",
      agentId: 'test-agent-123'
    };
    
    console.log(`📊 Testing workflow with ${params.emails.length} emails`);
    console.log(`🏢 Site: ${params.site_id}, User: ${params.user_id}`);
    
    const result = await client.workflow.execute('scheduleCustomerSupportMessagesWorkflow', {
      args: [params],
      taskQueue: 'customer-support-queue',
      workflowId: `test-customer-support-workflow-${Date.now()}`,
    });
    
    console.log('✅ Direct Workflow completed successfully!');
    console.log(`📊 Results:`, JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Direct Workflow test failed:', error);
  }
}

/**
 * Test a single customer support message workflow
 */
export async function testSingleCustomerSupportMessage() {
  try {
    console.log('🧪 Testing Single Customer Support Message...');
    
    const client = await getTemporalClient();
    const emailData = mockEmailData[0]; // Use first email item
    
    console.log('📋 Testing single message with email:', {
      summary: emailData.email.summary.substring(0, 100) + '...',
      subject: emailData.email.original_subject,
      priority: emailData.priority,
      leadNotification: emailData.lead_notification,
      intent: emailData.intent,
      contact: emailData.email.contact_info.name
    });
    
    const baseParams = {
      agentId: 'test-agent-456'
    };
    
    const result = await client.workflow.execute('customerSupportMessageWorkflow', {
      args: [emailData, baseParams],
      taskQueue: 'customer-support-queue',
      workflowId: `test-single-customer-support-${Date.now()}`,
    });
    
    console.log('✅ Single workflow completed!');
    console.log(`📊 Result:`, JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Single workflow test failed:', error);
  }
}

// Main execution
async function main() {
  console.log('=== Customer Support Workflow Tests ===\n');
  
  try {
    // Test 1: Single message workflow
    console.log('📝 Test 1: Single Customer Support Message');
    console.log('─'.repeat(50));
    await testSingleCustomerSupportMessage();
    
    console.log('\n\n📝 Test 2: Direct Schedule Customer Support Messages');
    console.log('─'.repeat(50));
    await testCustomerSupportWorkflow();
    
    console.log('\n\n📝 Test 3: API Email Processing Workflow (Main Entry Point)');
    console.log('─'.repeat(50));
    await testApiEmailProcessingWorkflow();
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Tests failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
} 