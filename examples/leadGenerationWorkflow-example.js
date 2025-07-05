/**
 * Example usage of the leadGenerationWorkflow with optimized unified structure
 * 
 * This example demonstrates the optimized flow that combines all business types 
 * for a single company research phase, then processes each company individually 
 * for lead generation and employee research.
 */

import { Connection, Client } from '@temporalio/client';
import { nanoid } from 'nanoid';

async function runLeadGenerationWorkflow() {
  console.log('🚀 Starting Lead Generation Workflow Example (OPTIMIZED FLOW)');

  // Get site ID from environment or default
  const siteId = process.env.SITE_ID || 'cm1xvn8e1001m8p4fzjbv8x1y';

  try {
    // Connect to Temporal
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });

    console.log('✅ Connected to Temporal');

    // Define workflow options
    const workflowOptions = {
      site_id: siteId,
      create: false, // Set to true to actually create leads, false for validation only
      userId: 'test-user-id',
      additionalData: {
        testMode: true,
        region: 'North America',
        industry: 'Technology',
        priority: 'high'
      }
    };

    console.log('📋 Workflow options:', JSON.stringify(workflowOptions, null, 2));

    const workflowId = `lead-gen-example-${nanoid()}`;
    console.log(`🔍 Starting workflow with ID: ${workflowId}`);

    // Start the workflow
    const handle = await client.workflow.start('leadGenerationWorkflow', {
      args: [workflowOptions],
      taskQueue: 'default',
      workflowId,
    });

    console.log('⏳ Workflow started, waiting for completion...');

    // Wait for workflow to complete
    const result = await handle.result();

    console.log('🎉 Workflow completed successfully!');
    console.log('\n📊 WORKFLOW RESULTS:');
    console.log('==================');
    console.log(`Success: ${result.success}`);
    console.log(`Site ID: ${result.siteId}`);
    console.log(`Site Name: ${result.siteName || 'N/A'}`);
    console.log(`Site URL: ${result.siteUrl || 'N/A'}`);
    console.log(`Business Types Received: ${result.businessTypes?.length || 0}`);
    console.log(`Enhanced Search Topic: ${result.enhancedSearchTopic || 'N/A'}`);
    console.log(`Target City: ${result.targetCity || 'N/A'}`);
    console.log(`Target Region: ${result.targetRegion || 'N/A'}`);
    console.log(`Companies Found: ${result.companiesFound?.length || 0}`);
    console.log(`Companies Processed: ${result.companyResults?.length || 0}`);
    console.log(`Total Leads Generated: ${result.totalLeadsGenerated || 0}`);
    console.log(`Lead Creation Results: ${result.leadCreationResults?.length || 0}`);
    console.log(`Execution Time: ${result.executionTime}`);
    console.log(`Errors: ${result.errors?.length || 0}`);

    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  ERRORS:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }

    // Region Search Result
    if (result.regionSearchResult) {
      console.log('\n🌍 REGION SEARCH RESULT:');
      console.log('========================');
      console.log(`Success: ${result.regionSearchResult.success}`);
      console.log(`Business Types Count: ${result.regionSearchResult.business_types?.length || 0}`);
      console.log(`Target City: ${result.regionSearchResult.targetCity || 'N/A'}`);
      console.log(`Target Region: ${result.regionSearchResult.targetRegion || 'N/A'}`);
    }

    // Business Types Details
    if (result.businessTypes && result.businessTypes.length > 0) {
      console.log('\n🏢 BUSINESS TYPES RECEIVED:');
      console.log('===========================');
      result.businessTypes.forEach((businessType, index) => {
        console.log(`  ${index + 1}. ${businessType.name}`);
        console.log(`     Description: ${businessType.description || 'N/A'}`);
        console.log(`     Relevance: ${businessType.relevance || 'N/A'}`);
        console.log(`     Market Potential: ${businessType.market_potential || 'N/A'}`);
        console.log('');
      });
    }

    // Companies Research Result
    if (result.companiesResearchResult) {
      console.log('\n🏢 COMPANIES RESEARCH RESULT:');
      console.log('=============================');
      console.log(`Success: ${result.companiesResearchResult.success}`);
      console.log(`Operation Results: ${result.companiesResearchResult.operationResults?.length || 0}`);
      console.log(`Insights: ${result.companiesResearchResult.insights?.length || 0}`);
      if (result.companiesResearchResult.error) {
        console.log(`Error: ${result.companiesResearchResult.error}`);
      }
    }

    // Companies Found
    if (result.companiesFound && result.companiesFound.length > 0) {
      console.log('\n🏢 COMPANIES FOUND:');
      console.log('==================');
      result.companiesFound.forEach((company, index) => {
        console.log(`  ${index + 1}. ${company.name}`);
        console.log(`     Website: ${company.website || 'N/A'}`);
        console.log(`     Industry: ${company.industry || 'N/A'}`);
        console.log(`     Location: ${company.location || 'N/A'}`);
        console.log(`     Size: ${company.size || 'N/A'}`);
        console.log(`     Employees: ${company.employees_count || 'N/A'}`);
        console.log('');
      });
    }

    // Company Results Detail
    if (result.companyResults && result.companyResults.length > 0) {
      console.log('\n📊 COMPANY PROCESSING RESULTS:');
      console.log('==============================');
      result.companyResults.forEach((companyResult, index) => {
        console.log(`  ${index + 1}. Company: ${companyResult.company.name}`);
        console.log(`     Lead Generation: ${companyResult.leadGenerationResult?.success ? 'Success' : 'Failed'}`);
        console.log(`     Employee Research: ${companyResult.employeeResearchResult?.success ? 'Success' : 'Failed'}`);
        console.log(`     Leads Generated: ${companyResult.leadsGenerated?.length || 0}`);
        console.log(`     Errors: ${companyResult.errors?.length || 0}`);
        
        if (companyResult.leadsGenerated && companyResult.leadsGenerated.length > 0) {
          console.log(`     Lead Details:`);
          companyResult.leadsGenerated.forEach((lead, leadIndex) => {
            console.log(`       ${leadIndex + 1}. ${lead.name} (${lead.email})`);
            console.log(`          Position: ${lead.position || 'N/A'}`);
            console.log(`          Company: ${lead.company_name || 'N/A'}`);
            console.log(`          Phone: ${lead.telephone || 'N/A'}`);
          });
        }
        
        if (companyResult.errors && companyResult.errors.length > 0) {
          console.log(`     Errors:`);
          companyResult.errors.forEach((error, errorIndex) => {
            console.log(`       ${errorIndex + 1}. ${error}`);
          });
        }
        console.log('');
      });
    }

    // Lead Creation Results
    if (result.leadCreationResults && result.leadCreationResults.length > 0) {
      console.log('\n✅ LEAD CREATION RESULTS:');
      console.log('=========================');
      result.leadCreationResults.forEach((creationResult, index) => {
        console.log(`  ${index + 1}. Success: ${creationResult.success}`);
        console.log(`     Leads Validated: ${creationResult.leadsValidated || 0}`);
        console.log(`     Leads Created: ${creationResult.leadsCreated || 0}`);
        console.log(`     Errors: ${creationResult.errors?.length || 0}`);
      });
    }

    console.log('\n🎯 WORKFLOW FLOW SUMMARY:');
    console.log('=========================');
    console.log('1. ✅ Called region search API → got business types array');
    console.log('2. ✅ Combined all business types with geographic info');
    console.log('3. ✅ Single deep research to find companies for ALL business types');
    console.log('4. ✅ For each company found:');
    console.log('   4a. Called lead generation API with company-specific parameters');
    console.log('   4b. Researched employees for that company');
    console.log('   4c. Created/validated leads for that company');
    console.log('\n🎯 KEY IMPROVEMENTS:');
    console.log('   📍 Geographic targeting: All business types enhanced with location');
    console.log('   🔍 Unified company search: One research for all business types');
    console.log('   🎯 Company-specific lead generation: Precise targeting per company');
    console.log('   👥 Employee-focused research: Detailed contact extraction');
    console.log('\nThis represents the optimized business-type-driven workflow! 🚀');

  } catch (error) {
    console.error('❌ Error running lead generation workflow:', error);
    
    if (error.cause) {
      console.error('Root cause:', error.cause);
    }
    
    if (error.details) {
      console.error('Details:', error.details);
    }
  }
}

// Run the example
runLeadGenerationWorkflow().catch(console.error); 