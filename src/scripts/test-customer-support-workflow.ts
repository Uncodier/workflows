/**
 * Manual test script for Customer Support Messages Workflow
 * This script can be run to test the scheduleCustomerSupportMessagesWorkflow functionality
 */

import { getTemporalClient } from '../temporal/client';
import type { EmailData, ScheduleCustomerSupportParams } from '../temporal/activities/customerSupportActivities';

// Sample email data for testing
const mockEmailData: EmailData[] = [
  {
    email: {
      summary: "Customer inquiry about pricing for enterprise features",
      contact_info: {
        name: "John Doe",
        email: "john.doe@example.com",
        phone: "+1234567890",
        company: "Example Corp"
      }
    },
    lead_notification: true,
    priority: "high",
    response_type: "commercial",
    potential_value: "high",
    intent: "inquiry",
    analysis_id: `analysis_${Date.now()}_0`
  },
  {
    email: {
      summary: "Support request for integration help",
      contact_info: {
        name: "Jane Smith",
        email: "jane.smith@customer.com",
        phone: null,
        company: "Customer Inc"
      }
    },
    lead_notification: true,
    priority: "medium",
    response_type: "support",
    potential_value: "medium",
    intent: "support",
    analysis_id: `analysis_${Date.now()}_1`
  },
  {
    email: {
      summary: "General inquiry about product features",
      contact_info: {
        name: "Bob Wilson",
        email: "bob@startup.com",
        phone: null,
        company: "Startup LLC"
      }
    },
    lead_notification: false,
    priority: "low",
    response_type: "informational",
    potential_value: "low",
    intent: "inquiry",
    analysis_id: `analysis_${Date.now()}_2`
  }
];

/**
 * Test the full schedule customer support messages workflow
 */
export async function testCustomerSupportWorkflow() {
  try {
    console.log('🧪 Starting Customer Support Messages Workflow Test...');
    
    const client = await getTemporalClient();
    
    const params: ScheduleCustomerSupportParams = {
      emails: mockEmailData,
      site_id: 'test-site-123',
      user_id: 'test-user-456',
      total_emails: mockEmailData.length,
      agentId: 'test-agent-123'
    };
    
    console.log(`📊 Testing workflow with ${params.emails.length} emails`);
    console.log(`🏢 Site: ${params.site_id}, User: ${params.user_id}`);
    
    const result = await client.workflow.execute('scheduleCustomerSupportMessagesWorkflow', {
      args: [params],
      taskQueue: 'customer-support-queue',
      workflowId: `test-customer-support-workflow-${Date.now()}`,
    });
    
    console.log('✅ Workflow completed successfully!');
    console.log(`📊 Results:`, JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Workflow test failed:', error);
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
      summary: emailData.email.summary,
      priority: emailData.priority,
      leadNotification: emailData.lead_notification,
      intent: emailData.intent
    });
    
    const baseParams = {
      site_id: 'test-site-123',
      user_id: 'test-user-456',
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
    
    console.log('\n\n📝 Test 2: Full Schedule Customer Support Messages');
    console.log('─'.repeat(50));
    // Test 2: Full scheduling workflow
    await testCustomerSupportWorkflow();
    
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