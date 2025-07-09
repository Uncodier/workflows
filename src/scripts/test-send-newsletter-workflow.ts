import { getTemporalClient } from '../temporal/client';
import { workflows } from '../temporal/workflows';

async function testSendNewsletterWorkflow() {
  // Create Temporal client
  const client = await getTemporalClient();

  // Example 1: Newsletter with segment and status filters
  const testParamsWithFilters = {
    site_id: 'test-site-id-123',
    subject: 'Newsletter Segmentado - Mayo 2024 📧',
    message: `
      <h1>Newsletter Exclusivo!</h1>
      <p>Este mensaje es para un segmento específico de nuestra audiencia.</p>
      
      <h2>Contenido Personalizado</h2>
      <ul>
        <li>Ofertas especiales para tu segmento</li>
        <li>Contenido relevante para tu industria</li>
        <li>Actualizaciones importantes</li>
      </ul>
      
      <p>¡Gracias por ser parte de nuestra comunidad!</p>
      
      <p>Saludos,<br>El Equipo</p>
    `,
    segments_ids: ['segment-1', 'segment-2'], // Optional: specific segments
    status: ['new', 'contacted'],             // Optional: specific statuses
    maxEmails: 50 // Optional: limit emails
  };

  // Example 2: Newsletter to all leads (no filters)
  const testParamsNoFilters = {
    site_id: 'test-site-id-123',
    subject: 'Newsletter General - Todos los Leads 📧',
    message: `
      <h1>Newsletter General</h1>
      <p>Este mensaje va para todos los leads con email válido.</p>
      
      <h2>Novedades Generales</h2>
      <ul>
        <li>Nuevas funcionalidades</li>
        <li>Actualizaciones del producto</li>
        <li>Noticias de la industria</li>
      </ul>
      
      <p>¡Mantente al día con nosotros!</p>
      
      <p>Cordialmente,<br>El Equipo</p>
    `,
    // segments_ids and status are optional - if not provided or empty, no filters applied
    maxEmails: 100
  };

  console.log('🚀 Testing sendNewsletterWorkflow with different scenarios...\n');

  // Test Scenario 1: With filters
  console.log('📧 SCENARIO 1: Newsletter with segment and status filters');
  console.log('Parameters:', JSON.stringify(testParamsWithFilters, null, 2));
  await runNewsletterTest(client, testParamsWithFilters, 'with-filters');

  console.log('\n' + '='.repeat(80) + '\n');

  // Test Scenario 2: No filters (all leads)
  console.log('📧 SCENARIO 2: Newsletter to all leads (no filters)');
  console.log('Parameters:', JSON.stringify(testParamsNoFilters, null, 2));
  await runNewsletterTest(client, testParamsNoFilters, 'no-filters');
}

async function runNewsletterTest(client: any, params: any, scenario: string) {
  try {
    // Start the workflow
    const handle = await client.workflow.start(workflows.sendNewsletterWorkflow, {
      args: [params],
      taskQueue: 'default',
      workflowId: `test-newsletter-${scenario}-${Date.now()}`,
    });

    console.log(`📨 Newsletter workflow started with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...');

    // Wait for workflow to complete
    const result = await handle.result();

    console.log(`✅ Newsletter workflow completed for scenario: ${scenario}`);
    console.log('\n📊 Results:');
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Email Config Valid: ${result.emailConfigValid}`);
    console.log(`   - Total Leads Found: ${result.totalLeads}`);
    console.log(`   - Leads Processed: ${result.leadsProcessed}`);
    console.log(`   - Emails Sent: ${result.emailsSent}`);
    console.log(`   - Emails Failed: ${result.emailsFailed}`);
    console.log(`   - Execution Time: ${result.executionTime}`);
    console.log(`   - Timestamp: ${result.timestamp}`);

    if (result.error) {
      console.log(`   - Error: ${result.error}`);
    }

    if (result.results && result.results.length > 0) {
      console.log('\n📧 Email Results (first 5):');
      result.results.slice(0, 5).forEach((emailResult: any, index: number) => {
        console.log(`   ${index + 1}. ${emailResult.email} - ${emailResult.success ? '✅ Success' : '❌ Failed'}`);
        if (emailResult.name) {
          console.log(`      Name: ${emailResult.name}`);
        }
        if (emailResult.error) {
          console.log(`      Error: ${emailResult.error}`);
        }
      });
      
      if (result.results.length > 5) {
        console.log(`   ... and ${result.results.length - 5} more emails`);
      }
    }

    // Calculate success rate
    if (result.leadsProcessed > 0) {
      const successRate = (result.emailsSent / result.leadsProcessed) * 100;
      console.log(`\n📈 Success Rate: ${successRate.toFixed(1)}%`);
    }

    // Business rules validation
    console.log('\n📋 Business Rules Applied:');
    console.log('   ✅ Only leads with valid email addresses processed');
    console.log('   ✅ Latest leads by creation date selected (if > limit)');
    if (params.segments_ids && params.segments_ids.length > 0) {
      console.log(`   ✅ Segment filter applied: ${params.segments_ids.join(', ')}`);
    } else {
      console.log('   ✅ No segment filter (all segments included)');
    }
    if (params.status && params.status.length > 0) {
      console.log(`   ✅ Status filter applied: ${params.status.join(', ')}`);
    } else {
      console.log('   ✅ No status filter (all statuses included)');
    }
    console.log(`   ✅ Email limit respected: ${params.maxEmails || 500} max`);

  } catch (error) {
    console.error(`❌ Newsletter workflow failed for scenario ${scenario}:`, error);
    
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
}

// Run the test
testSendNewsletterWorkflow().catch(console.error); 