"use strict";
/**
 * Test script for multiple venues search functionality
 * Tests the new callRegionVenuesWithMultipleSearchTermsActivity
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testMultipleVenuesSearch = testMultipleVenuesSearch;
exports.runTestScenarios = runTestScenarios;
const leadGenerationActivities_1 = require("../temporal/activities/leadGenerationActivities");
async function testMultipleVenuesSearch() {
    console.log('🧪 Testing multiple venues search functionality...');
    // Mock business types para la prueba
    const mockBusinessTypes = [
        {
            name: 'restaurantes',
            description: 'Establecimientos de comida',
            relevance: 'High demand for marketing services',
            market_potential: 'High'
        },
        {
            name: 'tiendas de ropa',
            description: 'Comercios de moda',
            relevance: 'Need digital presence',
            market_potential: 'Medium'
        },
        {
            name: 'consultorias',
            description: 'Servicios profesionales',
            relevance: 'Business growth focus',
            market_potential: 'High'
        }
    ];
    const testOptions = {
        site_id: 'test-site-id',
        userId: 'test-user-id',
        businessTypes: mockBusinessTypes,
        city: 'Madrid',
        region: 'Comunidad de Madrid',
        country: 'España', // País de ejemplo (normalmente viene del regionSearch)
        maxVenues: 10,
        targetVenueGoal: 8,
        priority: 'high',
        excludeNames: ['Test Exclude Company'],
        additionalData: {
            testRun: true,
            timestamp: new Date().toISOString()
        }
    };
    try {
        console.log('📤 Calling multiple venues search activity...');
        console.log('Test options:', JSON.stringify(testOptions, null, 2));
        const result = await (0, leadGenerationActivities_1.callRegionVenuesWithMultipleSearchTermsActivity)(testOptions);
        console.log('📥 Result received:', JSON.stringify(result, null, 2));
        if (result.success) {
            console.log('✅ Multiple venues search test completed successfully!');
            console.log(`📊 Results summary:`);
            console.log(`   - Success: ${result.success}`);
            console.log(`   - Venues found: ${result.data?.venueCount || 0}`);
            console.log(`   - Search term: ${result.data?.searchTerm || 'N/A'}`);
            if (result.data && 'multipleSearchMetadata' in result.data) {
                const metadata = result.data.multipleSearchMetadata;
                console.log(`   - API calls made: ${metadata.totalApiCalls}`);
                console.log(`   - Business types searched: ${metadata.businessTypesSearched}`);
                console.log(`   - Goal achieved: ${metadata.goalAchieved ? '✅' : '❌'}`);
                console.log(`   - Country used: ${metadata.country}`);
                console.log(`   - Strategy: ${metadata.strategy}`);
            }
        }
        else {
            console.error('❌ Multiple venues search test failed:', result.error);
        }
    }
    catch (error) {
        console.error('💥 Exception during test:', error);
    }
}
// Función para probar diferentes escenarios
async function runTestScenarios() {
    console.log('🚀 Starting multiple venues search test scenarios...\n');
    // Escenario 1: Búsqueda normal con múltiples business types
    console.log('📋 Scenario 1: Normal search with multiple business types');
    await testMultipleVenuesSearch();
    console.log('\n' + '='.repeat(50) + '\n');
    // Escenario 2: Búsqueda con un solo business type
    console.log('📋 Scenario 2: Search with single business type');
    const singleBusinessType = [
        {
            name: 'farmacias',
            description: 'Establecimientos farmacéuticos',
            relevance: 'Essential services',
            market_potential: 'Medium'
        }
    ];
    const singleOptions = {
        site_id: 'test-site-single',
        userId: 'test-user-single',
        businessTypes: singleBusinessType,
        city: 'Barcelona',
        region: 'Cataluña',
        country: 'España', // País de ejemplo (normalmente viene del regionSearch)
        maxVenues: 5,
        targetVenueGoal: 5,
        priority: 'medium',
        excludeNames: [],
        additionalData: {
            testScenario: 'single_business_type'
        }
    };
    try {
        const result = await (0, leadGenerationActivities_1.callRegionVenuesWithMultipleSearchTermsActivity)(singleOptions);
        console.log('✅ Single business type scenario completed');
        console.log(`📊 Venues found: ${result.data?.venueCount || 0}`);
    }
    catch (error) {
        console.error('❌ Single business type scenario failed:', error);
    }
    console.log('\n🏁 All test scenarios completed!');
}
// Ejecutar si se llama directamente
if (require.main === module) {
    runTestScenarios()
        .then(() => {
        console.log('✅ Test script completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('❌ Test script failed:', error);
        process.exit(1);
    });
}
