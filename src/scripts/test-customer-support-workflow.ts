/**
 * Manual test script for Customer Support Messages Workflow
 * This script can be run to test the scheduleCustomerSupportMessagesWorkflow functionality
 */

import { getTemporalClient } from '../temporal/client';
import type { AnalysisData, ScheduleCustomerSupportParams } from '../temporal/activities/customerSupportActivities';

// Sample analysis data for testing
const mockAnalysisData: AnalysisData[] = [
  {
    analysis: {
      summary: "Customer inquiry about pricing for enterprise features",
      insights: ["Interested in premium features", "Budget-conscious", "Enterprise focused"],
      sentiment: "positive",
      priority: "high",
      action_items: ["Send pricing information", "Schedule demo", "Provide trial access"],
      response: ["Thank you for your interest in our enterprise solution"],
      lead_extraction: {
        contact_info: {
          name: "John Doe",
          email: "john.doe@example.com",
          phone: "+1234567890",
          company: "Example Corp"
        },
        intent: "inquiry",
        requirements: ["Enterprise features", "API access", "Custom integrations"],
        budget_indication: "$5000-10000",
        timeline: "Q1 2024",
        decision_maker: "yes",
        source: "website"
      },
      commercial_opportunity: {
        requires_response: true,
        response_type: "commercial",
        priority_level: "high",
        suggested_actions: ["Send proposal", "Schedule call", "Provide demo"],
        potential_value: "high",
        next_steps: ["Follow up within 24h", "Send custom pricing"]
      }
    }
  },
  {
    analysis: {
      summary: "Support request for integration help",
      insights: ["Existing customer", "Technical support needed"],
      sentiment: "neutral",
      priority: "medium",
      action_items: ["Provide documentation", "Schedule technical call"],
      response: ["We'll help you with the integration"],
      lead_extraction: {
        contact_info: {
          name: "Jane Smith",
          email: "jane.smith@customer.com",
          phone: null,
          company: "Customer Inc"
        },
        intent: "support",
        requirements: ["Integration support", "Documentation"],
        budget_indication: null,
        timeline: "ASAP",
        decision_maker: "unknown",
        source: "website"
      },
      commercial_opportunity: {
        requires_response: true,
        response_type: "support",
        priority_level: "medium",
        suggested_actions: ["Provide technical documentation", "Schedule support call"],
        potential_value: "medium",
        next_steps: ["Send integration guide", "Follow up in 2 days"]
      }
    }
  },
  {
    analysis: {
      summary: "General inquiry about product features",
      insights: ["Potential lead", "Early stage"],
      sentiment: "positive",
      priority: "low",
      action_items: ["Send product information"],
      response: ["Thanks for your interest"],
      lead_extraction: {
        contact_info: {
          name: "Bob Wilson",
          email: "bob@startup.com",
          phone: null,
          company: "Startup LLC"
        },
        intent: "inquiry",
        requirements: ["Basic features", "Pricing information"],
        budget_indication: "Under $1000",
        timeline: "Q2 2024",
        decision_maker: "no",
        source: "social_media"
      },
      commercial_opportunity: {
        requires_response: false,
        response_type: "informational",
        priority_level: "low",
        suggested_actions: ["Send product brochure"],
        potential_value: "low",
        next_steps: ["Add to newsletter list"]
      }
    }
  }
];

async function testCustomerSupportWorkflow() {
  console.log('🚀 Testing Customer Support Messages Workflow...');
  
  try {
    const client = await getTemporalClient();
    
    // Test parameters
    const params: ScheduleCustomerSupportParams = {
      analysisArray: mockAnalysisData,
      site_id: "test-site-12345",
      agentId: "agent-67890",
      userId: "user-54321"
    };
    
    console.log('📋 Test parameters:', {
      analysisCount: params.analysisArray.length,
      site_id: params.site_id,
      agentId: params.agentId,
      userId: params.userId
    });
    
    console.log('🎯 Starting workflow execution...');
    
    // Execute the workflow
    const workflowId = `test-customer-support-${Date.now()}`;
    const handle = await client.workflow.start('scheduleCustomerSupportMessagesWorkflow', {
      args: [params],
      workflowId,
      taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
      workflowRunTimeout: '30m', // 30 minutes timeout for the entire workflow
    });
    
    console.log(`✅ Workflow started successfully with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow completion...');
    console.log('   Note: This may take several minutes due to 1-minute intervals between messages');
    
    // Wait for the workflow to complete
    const result = await handle.result();
    
    console.log('🎉 Workflow completed successfully!');
    console.log('📊 Results:', JSON.stringify(result, null, 2));
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

async function testSingleCustomerSupportMessage() {
  console.log('🎯 Testing Single Customer Support Message Workflow...');
  
  try {
    const client = await getTemporalClient();
    
    // Test with first analysis item
    const analysisData = mockAnalysisData[0];
    const baseParams = {
      site_id: "test-site-12345",
      agentId: "agent-67890",
      userId: "user-54321"
    };
    
    console.log('📋 Testing single message with analysis:', {
      summary: analysisData.analysis.summary,
      priority: analysisData.analysis.priority,
      sentiment: analysisData.analysis.sentiment,
      requires_response: analysisData.analysis.commercial_opportunity.requires_response
    });
    
    // Execute single message workflow
    const workflowId = `test-single-message-${Date.now()}`;
    const handle = await client.workflow.start('customerSupportMessageWorkflow', {
      args: [analysisData, baseParams],
      workflowId,
      taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
      workflowRunTimeout: '5m',
    });
    
    console.log(`✅ Single message workflow started: ${handle.workflowId}`);
    console.log('⏳ Waiting for completion...');
    
    const result = await handle.result();
    
    console.log('🎉 Single message workflow completed!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    return result;
    
  } catch (error) {
    console.error('❌ Single message test failed:', error);
    throw error;
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

export { testCustomerSupportWorkflow, testSingleCustomerSupportMessage }; 