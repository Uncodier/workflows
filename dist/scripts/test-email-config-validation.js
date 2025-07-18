"use strict";
/**
 * Test Email Config Validation
 * Quick test to verify email config validation works with real site data including status validation
 */
Object.defineProperty(exports, "__esModule", { value: true });
const emailConfigService_1 = require("../temporal/services/emailConfigService");
// Test data from user's example with status scenarios
const testSites = [
    {
        name: "Uncodie (valid)",
        email: {
            "email": "sergio@uncodie.com",
            "enabled": true,
            "password": "",
            "incomingServer": "imap.gmail.com",
            "outgoingServer": "smtp.gmail.com",
            "incomingPort": "993",
            "outgoingPort": "587",
            "status": "connected" // Valid status
        }
    },
    {
        name: "B Venture Capital (no status - should be valid)",
        email: {
            "email": "derlyflorez@bventure.capital",
            "enabled": true,
            "password": "",
            "incomingServer": "imap.gmail.com",
            "outgoingServer": "smtp.gmail.com",
            "incomingPort": "993",
            "outgoingPort": "587"
            // No status field - should still be valid
        }
    },
    {
        name: "Bugster (error status - should be invalid)",
        email: {
            "email": "facundo@bugster.dev",
            "enabled": true,
            "password": "",
            "incomingServer": "imap.gmail.com",
            "outgoingServer": "smtp.gmail.com",
            "incomingPort": "993",
            "outgoingPort": "587",
            "status": "error" // Error status - should be invalid
        }
    },
    {
        name: "Julia (no config)",
        email: undefined
    },
    {
        name: "Disabled email (should be invalid)",
        email: {
            "email": "test@example.com",
            "enabled": false,
            "password": "",
            "incomingServer": "imap.gmail.com",
            "outgoingServer": "smtp.gmail.com",
            "incomingPort": "993",
            "outgoingPort": "587",
            "status": "connected"
        }
    }
];
async function testEmailConfigValidation() {
    console.log('🧪 Testing email config validation with status checks...\n');
    for (const site of testSites) {
        console.log(`📧 Testing ${site.name}:`);
        const validation = emailConfigService_1.EmailConfigService.validateEmailConfig(site.email);
        console.log(`   - Valid: ${validation.isValid}`);
        console.log(`   - Reason: ${validation.reason}`);
        if (validation.errors.length > 0) {
            console.log(`   - Errors: ${validation.errors.join(', ')}`);
        }
        console.log('');
    }
    // Summary
    const validSites = testSites.filter(site => emailConfigService_1.EmailConfigService.validateEmailConfig(site.email).isValid);
    console.log(`📊 Summary:`);
    console.log(`   - Total sites: ${testSites.length}`);
    console.log(`   - Valid configs: ${validSites.length}`);
    console.log(`   - Invalid configs: ${testSites.length - validSites.length}`);
    const expectedValid = 2; // Only Uncodie (valid status) and B Venture (no status) should be valid
    if (validSites.length === expectedValid) {
        console.log(`✅ Test PASSED: ${validSites.length}/${expectedValid} sites correctly validated`);
    }
    else {
        console.log(`❌ Test FAILED: Expected ${expectedValid} valid sites, got ${validSites.length}`);
    }
}
// Run the test
testEmailConfigValidation().catch(console.error);
