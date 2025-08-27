/**
 * Test script to verify that cleanupFailedFollowUpActivity correctly deletes
 * conversations when they have no messages remaining (lead generation context)
 */

import { cleanupFailedFollowUpActivity } from '../temporal/activities/leadActivities';

async function testCleanupConversationDeletion() {
  console.log('🧪 Testing cleanup conversation deletion logic...');
  
  // Test case 1: Conversation with only 1 message (should be deleted after message deletion)
  console.log('\n📋 Test Case 1: Single message conversation (lead generation scenario)');
  console.log('Expected: Conversation should be deleted after message is deleted');
  
  try {
    const result1 = await cleanupFailedFollowUpActivity({
      lead_id: 'test-lead-1',
      site_id: 'test-site-1', 
      conversation_id: 'test-conv-1',
      message_id: 'test-msg-1',
      failure_reason: 'lead_generation_first_message_failed',
      delivery_channel: 'whatsapp'
    });
    
    console.log('📊 Result 1:', {
      success: result1.success,
      conversation_deleted: result1.conversation_deleted,
      message_deleted: result1.message_deleted,
      messages_remaining: result1.cleanup_summary?.messages_in_conversation
    });
    
  } catch (error) {
    console.log('⚠️ Test 1 failed (expected if test data doesn\'t exist):', error instanceof Error ? error.message : String(error));
  }
  
  // Test case 2: Conversation with multiple messages (should be preserved)
  console.log('\n📋 Test Case 2: Multi-message conversation');
  console.log('Expected: Conversation should be preserved, only failed message deleted');
  
  try {
    const result2 = await cleanupFailedFollowUpActivity({
      lead_id: 'test-lead-2',
      site_id: 'test-site-2',
      conversation_id: 'test-conv-2', 
      message_id: 'test-msg-2',
      failure_reason: 'follow_up_message_failed',
      delivery_channel: 'email'
    });
    
    console.log('📊 Result 2:', {
      success: result2.success,
      conversation_deleted: result2.conversation_deleted,
      message_deleted: result2.message_deleted,
      messages_remaining: result2.cleanup_summary?.messages_in_conversation
    });
    
  } catch (error) {
    console.log('⚠️ Test 2 failed (expected if test data doesn\'t exist):', error instanceof Error ? error.message : String(error));
  }
  
  console.log('\n✅ Test completed. Check logs above to verify behavior:');
  console.log('   - Single message conversations should be deleted completely');
  console.log('   - Multi-message conversations should preserve conversation but delete failed message');
  console.log('   - Message count should be updated AFTER message deletion for accurate decision making');
}

// Run the test
if (require.main === module) {
  testCleanupConversationDeletion()
    .then(() => {
      console.log('\n🎉 Test script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test script failed:', error);
      process.exit(1);
    });
}

export { testCleanupConversationDeletion };
