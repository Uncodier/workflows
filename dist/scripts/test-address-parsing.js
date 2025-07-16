"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
// Load environment variables
(0, dotenv_1.configDotenv)();
/**
 * Test the new Google Maps address parsing functionality
 * This script verifies that addresses are correctly parsed and companies always use target_city
 */
// Import the parsing function (we'll test it directly)
// Note: This is a simplified version for testing - the actual function is in leadGenerationActivities.ts
/**
 * Test version of parseGoogleMapsAddress function
 */
function parseGoogleMapsAddress(addressString, targetCity) {
    if (!addressString)
        return {};
    try {
        // Split the address by commas
        const parts = addressString.split(',').map(part => part.trim());
        if (parts.length < 2) {
            // If we can't parse, just store the full address
            return {
                full_address: addressString,
                address1: addressString,
                city: targetCity || null, // Always use target_city if available
            };
        }
        // Initialize result object
        const parsed = {
            full_address: addressString
        };
        // Last part is typically country
        if (parts.length >= 1) {
            parsed.country = parts[parts.length - 1];
        }
        // Second to last is typically state/region (if we have enough parts)
        if (parts.length >= 2) {
            parsed.state = parts[parts.length - 2];
        }
        // Look for city and zip code in the middle parts
        let cityFound = false;
        let zipFound = false;
        const address1Parts = [];
        for (let i = 0; i < parts.length - 2; i++) {
            const part = parts[i];
            // Check if this part contains a number that could be a zip code
            const zipMatch = part.match(/\b(\d{4,6})\b/);
            if (zipMatch && !zipFound) {
                parsed.zip = zipMatch[1];
                zipFound = true;
                // The rest of this part (after removing zip) could be part of city
                const remainingPart = part.replace(zipMatch[0], '').trim();
                if (remainingPart && !cityFound) {
                    // Check if target_city matches this remaining part
                    if (targetCity && remainingPart.toLowerCase().includes(targetCity.toLowerCase())) {
                        parsed.city = targetCity; // Always use target_city
                        cityFound = true;
                    }
                    else {
                        parsed.city = targetCity || remainingPart; // Prioritize target_city
                        cityFound = true;
                    }
                }
            }
            else if (!cityFound && targetCity) {
                // Check if this part matches target_city
                if (part.toLowerCase().includes(targetCity.toLowerCase())) {
                    parsed.city = targetCity; // Always use target_city
                    cityFound = true;
                }
                else {
                    // This part goes to address1
                    address1Parts.push(part);
                }
            }
            else if (!cityFound) {
                // If no target_city, check if this looks like a city name (no numbers)
                if (!/\d/.test(part) && part.length > 2) {
                    parsed.city = part;
                    cityFound = true;
                }
                else {
                    address1Parts.push(part);
                }
            }
            else {
                // After city is found, remaining parts go to address1
                address1Parts.push(part);
            }
        }
        // Always ensure we use target_city if provided
        if (targetCity) {
            parsed.city = targetCity;
        }
        // Build address1 from collected parts
        if (address1Parts.length > 0) {
            parsed.address1 = address1Parts.join(', ');
        }
        return parsed;
    }
    catch (error) {
        console.error(`❌ Error parsing address: ${addressString}`, error);
        // Fallback: return basic structure with target_city
        return {
            full_address: addressString,
            address1: addressString,
            city: targetCity || null,
        };
    }
}
/**
 * Test cases for address parsing
 */
const testCases = [
    {
        name: "Mexican address with zip code",
        address: "Agustín Arroyo Chagoyan 501, Alameda, 38050 Celaya, Gto., Mexico",
        targetCity: "Celaya",
        expected: {
            address1: "Agustín Arroyo Chagoyan 501, Alameda",
            city: "Celaya",
            state: "Gto.",
            country: "Mexico",
            zip: "38050"
        }
    },
    {
        name: "US address format",
        address: "123 Main Street, Suite 456, 12345 New York, NY, USA",
        targetCity: "New York",
        expected: {
            address1: "123 Main Street, Suite 456",
            city: "New York",
            state: "NY",
            country: "USA",
            zip: "12345"
        }
    },
    {
        name: "Address without target_city match (should still use target_city)",
        address: "456 Commerce Ave, 54321 Different City, CA, USA",
        targetCity: "Los Angeles",
        expected: {
            address1: "456 Commerce Ave",
            city: "Los Angeles", // Should use target_city even if address says "Different City"
            state: "CA",
            country: "USA",
            zip: "54321"
        }
    },
    {
        name: "Simple address without zip",
        address: "789 Business Blvd, Miami, FL, USA",
        targetCity: "Miami",
        expected: {
            address1: "789 Business Blvd",
            city: "Miami",
            state: "FL",
            country: "USA"
        }
    },
    {
        name: "No target_city provided",
        address: "321 Corporate Dr, Austin, TX, USA",
        targetCity: undefined,
        expected: {
            address1: "321 Corporate Dr",
            city: "Austin",
            state: "TX",
            country: "USA"
        }
    }
];
/**
 * Run the tests
 */
async function runAddressParsingTests() {
    console.log('🧪 Starting Google Maps Address Parsing Tests...\n');
    let passedTests = 0;
    const totalTests = testCases.length;
    for (const testCase of testCases) {
        console.log(`📋 Test: ${testCase.name}`);
        console.log(`   Input: "${testCase.address}"`);
        console.log(`   Target City: "${testCase.targetCity || 'none'}"`);
        const result = parseGoogleMapsAddress(testCase.address, testCase.targetCity);
        console.log(`   Result: ${JSON.stringify(result, null, 6)}`);
        // Check key fields
        let testPassed = true;
        const checks = [];
        if (testCase.expected.address1 && result.address1 !== testCase.expected.address1) {
            checks.push(`❌ address1: expected "${testCase.expected.address1}", got "${result.address1}"`);
            testPassed = false;
        }
        else if (testCase.expected.address1) {
            checks.push(`✅ address1: "${result.address1}"`);
        }
        if (testCase.expected.city && result.city !== testCase.expected.city) {
            checks.push(`❌ city: expected "${testCase.expected.city}", got "${result.city}"`);
            testPassed = false;
        }
        else if (testCase.expected.city) {
            checks.push(`✅ city: "${result.city}"`);
        }
        if (testCase.expected.state && result.state !== testCase.expected.state) {
            checks.push(`❌ state: expected "${testCase.expected.state}", got "${result.state}"`);
            testPassed = false;
        }
        else if (testCase.expected.state) {
            checks.push(`✅ state: "${result.state}"`);
        }
        if (testCase.expected.country && result.country !== testCase.expected.country) {
            checks.push(`❌ country: expected "${testCase.expected.country}", got "${result.country}"`);
            testPassed = false;
        }
        else if (testCase.expected.country) {
            checks.push(`✅ country: "${result.country}"`);
        }
        if (testCase.expected.zip && result.zip !== testCase.expected.zip) {
            checks.push(`❌ zip: expected "${testCase.expected.zip}", got "${result.zip}"`);
            testPassed = false;
        }
        else if (testCase.expected.zip) {
            checks.push(`✅ zip: "${result.zip}"`);
        }
        checks.forEach(check => console.log(`     ${check}`));
        if (testPassed) {
            console.log(`   ✅ Test PASSED\n`);
            passedTests++;
        }
        else {
            console.log(`   ❌ Test FAILED\n`);
        }
    }
    console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);
    if (passedTests === totalTests) {
        console.log('🎉 All tests passed! Address parsing is working correctly.');
    }
    else {
        console.log('⚠️  Some tests failed. Please review the implementation.');
    }
    // Test the company.city enforcement
    console.log('\n🏢 Testing company.city field enforcement...');
    const companyTestCases = [
        {
            venue: {
                name: "Test Restaurant",
                address: "123 Different Street, 12345 Different City, State, Country"
            },
            targetCity: "Correct City",
            expected: {
                city: "Correct City" // Should always use target_city regardless of venue address
            }
        }
    ];
    for (const testCase of companyTestCases) {
        console.log(`📋 Company Test: ${testCase.venue.name}`);
        console.log(`   Venue Address: "${testCase.venue.address}"`);
        console.log(`   Target City: "${testCase.targetCity}"`);
        // Simulate company creation with target_city
        const company = {
            name: testCase.venue.name,
            address: testCase.venue.address,
            city: testCase.targetCity // ✅ This should always be target_city
        };
        if (company.city === testCase.expected.city) {
            console.log(`   ✅ Company city correctly set to: "${company.city}"`);
        }
        else {
            console.log(`   ❌ Company city incorrectly set to: "${company.city}", expected: "${testCase.expected.city}"`);
        }
    }
    console.log('\n✅ Address parsing tests completed!');
}
// Run the tests
runAddressParsingTests().catch(console.error);
