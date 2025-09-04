import { executeWorkflow } from '../api/execute-workflow.js';

/**
 * Example: Email Validation Workflow
 * 
 * This workflow runs on Render to provide SMTP email validation
 * bypassing Vercel's port 25 restrictions.
 */

async function exampleValidateEmail() {
  try {
    console.log('🚀 Starting email validation workflow example...');
    
    // Example 1: Basic email validation
    console.log('\n📧 Example 1: Basic email validation');
    const basicResult = await executeWorkflow({
      workflowType: 'validateEmailWorkflow',
      workflowId: `validate-email-basic-${Date.now()}`,
      input: {
        email: 'user@gmail.com',
        aggressiveMode: false
      },
      taskQueue: 'email-validation-queue'
    });
    
    console.log('Basic validation result:', {
      isValid: basicResult.data?.isValid,
      deliverable: basicResult.data?.deliverable,
      result: basicResult.data?.result,
      confidence: basicResult.data?.confidence,
      message: basicResult.data?.message
    });
    
    // Example 2: Aggressive mode validation
    console.log('\n🔥 Example 2: Aggressive mode validation');
    const aggressiveResult = await executeWorkflow({
      workflowType: 'validateEmailWorkflow',
      workflowId: `validate-email-aggressive-${Date.now()}`,
      input: {
        email: 'test@hotmail.com', // High bounce risk domain
        aggressiveMode: true
      },
      taskQueue: 'email-validation-queue'
    });
    
    console.log('Aggressive validation result:', {
      isValid: aggressiveResult.data?.isValid,
      deliverable: aggressiveResult.data?.deliverable,
      result: aggressiveResult.data?.result,
      confidence: aggressiveResult.data?.confidence,
      bounceRisk: aggressiveResult.data?.bounceRisk,
      flags: aggressiveResult.data?.flags,
      reasoning: aggressiveResult.data?.reasoning
    });
    
    // Example 3: Invalid email validation
    console.log('\n❌ Example 3: Invalid email validation');
    const invalidResult = await executeWorkflow({
      workflowType: 'validateEmailWorkflow',
      workflowId: `validate-email-invalid-${Date.now()}`,
      input: {
        email: 'nonexistent@thisdoesnotexist12345.com',
        aggressiveMode: false
      },
      taskQueue: 'email-validation-queue'
    });
    
    console.log('Invalid validation result:', {
      isValid: invalidResult.data?.isValid,
      result: invalidResult.data?.result,
      message: invalidResult.data?.message,
      flags: invalidResult.data?.flags
    });
    
    // Example 4: Disposable email validation
    console.log('\n🗑️ Example 4: Disposable email validation');
    const disposableResult = await executeWorkflow({
      workflowType: 'validateEmailWorkflow',
      workflowId: `validate-email-disposable-${Date.now()}`,
      input: {
        email: 'test@10minutemail.com',
        aggressiveMode: false
      },
      taskQueue: 'email-validation-queue'
    });
    
    console.log('Disposable validation result:', {
      isValid: disposableResult.data?.isValid,
      result: disposableResult.data?.result,
      message: disposableResult.data?.message,
      flags: disposableResult.data?.flags
    });
    
    console.log('\n✅ Email validation workflow examples completed!');
    
  } catch (error) {
    console.error('❌ Email validation workflow example failed:', error);
    throw error;
  }
}

/**
 * Example: Direct HTTP API Usage
 */
async function exampleDirectAPI() {
  try {
    console.log('\n🌐 Testing direct HTTP API...');
    
    // Replace with your actual Render URL
    const RENDER_URL = 'https://your-app.onrender.com';
    
    const response = await fetch(`${RENDER_URL}/api/validate-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'test@example.com',
        aggressiveMode: false
      })
    });
    
    const result = await response.json();
    console.log('Direct API result:', result);
    
  } catch (error) {
    console.error('❌ Direct API test failed:', error);
    // This is expected if Render URL is not configured
  }
}

/**
 * Example: Batch Email Validation
 */
async function exampleBatchValidation() {
  try {
    console.log('\n📚 Example: Batch email validation');
    
    const emails = [
      'valid@gmail.com',
      'invalid@nonexistentdomain123.com',
      'test@10minutemail.com',
      'user@hotmail.com'
    ];
    
    const results = await Promise.allSettled(
      emails.map((email, index) => 
        executeWorkflow({
          workflowType: 'validateEmailWorkflow',
          workflowId: `validate-email-batch-${index}-${Date.now()}`,
          input: {
            email,
            aggressiveMode: false
          },
          taskQueue: 'email-validation-queue'
        })
      )
    );
    
    console.log('Batch validation results:');
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const data = result.value.data;
        console.log(`  ${emails[index]}: ${data?.result} (confidence: ${data?.confidence}%)`);
      } else {
        console.log(`  ${emails[index]}: ERROR - ${result.reason.message}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Batch validation example failed:', error);
  }
}

// Run examples if this file is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log('🎯 Email Validation Workflow Examples');
  console.log('=====================================');
  
  await exampleValidateEmail();
  await exampleDirectAPI();
  await exampleBatchValidation();
  
  console.log('\n🎉 All examples completed!');
  console.log('\nNext steps:');
  console.log('1. Deploy to Render with proper environment variables');
  console.log('2. Configure Temporal worker for email-validation-queue');
  console.log('3. Test with real email addresses');
  console.log('4. Monitor validation performance and accuracy');
}
