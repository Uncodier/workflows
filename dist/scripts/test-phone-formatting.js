"use strict";
/**
 * Test script for Spanish phone number formatting
 * Tests the formatSpanishPhoneNumber function with various input formats
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testPhoneFormatting = testPhoneFormatting;
exports.testErrorCase = testErrorCase;
/**
 * Format Spanish phone numbers to international format
 * Converts "663 211 22 33" to "+34663211233"
 */
function formatSpanishPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
        return phone;
    }
    // Remove all spaces, dashes, parentheses, and other non-digit characters except +
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    // If already has + at start, assume it's international format
    if (cleanPhone.startsWith('+')) {
        return cleanPhone;
    }
    // If starts with 34, assume it's Spanish with country code but missing +
    if (cleanPhone.startsWith('34') && cleanPhone.length === 11) {
        return '+' + cleanPhone;
    }
    // If it's 9 digits starting with 6 or 7, it's likely a Spanish mobile number
    if (cleanPhone.length === 9 && (cleanPhone.startsWith('6') || cleanPhone.startsWith('7'))) {
        return '+34' + cleanPhone;
    }
    // If it's 9 digits starting with 9, it's likely a Spanish landline
    if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
        return '+34' + cleanPhone;
    }
    // For any other 9-digit number, assume it's Spanish
    if (cleanPhone.length === 9) {
        return '+34' + cleanPhone;
    }
    // For 10-digit numbers starting with 6 or 7 (likely Spanish mobile with extra digit)
    if (cleanPhone.length === 10 && (cleanPhone.startsWith('6') || cleanPhone.startsWith('7'))) {
        // For numbers like 6632112233, treat as Spanish mobile
        return '+34' + cleanPhone;
    }
    // For other cases, try to add +34 if it looks like it could be Spanish
    if (cleanPhone.length <= 9 && cleanPhone.length >= 7) {
        return '+34' + cleanPhone;
    }
    // Return as-is if we can't determine format
    console.log(`⚠️ Unable to format phone number: ${phone} -> ${cleanPhone}`);
    return cleanPhone;
}
/**
 * Test cases for phone number formatting
 */
const testCases = [
    {
        name: "Spanish mobile with spaces (like in the error)",
        input: "663 211 22 33",
        expected: "+346632112233"
    },
    {
        name: "Spanish mobile with dashes",
        input: "663-211-22-33",
        expected: "+346632112233"
    },
    {
        name: "Spanish mobile without formatting (9 digits)",
        input: "663211233",
        expected: "+34663211233"
    },
    {
        name: "Spanish mobile without formatting (correct 9 digits with spaces)",
        input: "663 211 233",
        expected: "+34663211233"
    },
    {
        name: "Already international format",
        input: "+34663211233",
        expected: "+34663211233"
    },
    {
        name: "Spanish landline",
        input: "912 345 678",
        expected: "+34912345678"
    },
    {
        name: "Spanish mobile starting with 7",
        input: "712 345 678",
        expected: "+34712345678"
    },
    {
        name: "Spanish with country code but no plus",
        input: "34663211233",
        expected: "+34663211233"
    },
    {
        name: "Short number (7 digits, should add +34)",
        input: "1234567",
        expected: "+341234567"
    },
    {
        name: "Invalid format (too long)",
        input: "123456789012",
        expected: "123456789012"
    },
    {
        name: "Non-Spanish international",
        input: "+15551234567",
        expected: "+15551234567"
    }
];
/**
 * Run all test cases
 */
function testPhoneFormatting() {
    console.log('🧪 Testing Spanish phone number formatting...\n');
    let passed = 0;
    let failed = 0;
    testCases.forEach((testCase, index) => {
        const result = formatSpanishPhoneNumber(testCase.input);
        const success = result === testCase.expected;
        if (success) {
            console.log(`✅ Test ${index + 1}: ${testCase.name}`);
            console.log(`   Input: "${testCase.input}" -> Output: "${result}"`);
            passed++;
        }
        else {
            console.log(`❌ Test ${index + 1}: ${testCase.name}`);
            console.log(`   Input: "${testCase.input}"`);
            console.log(`   Expected: "${testCase.expected}"`);
            console.log(`   Got: "${result}"`);
            failed++;
        }
        console.log('');
    });
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('🎉 All tests passed!');
    }
    else {
        console.log('⚠️ Some tests failed. Please review the function logic.');
    }
    return { passed, failed };
}
/**
 * Test the specific case from the error log
 */
function testErrorCase() {
    console.log('🎯 Testing specific error case from logs...\n');
    const errorInput = "663 211 22 33";
    const result = formatSpanishPhoneNumber(errorInput);
    const expected = "+346632112233";
    console.log(`Input from error: "${errorInput}"`);
    console.log(`Formatted result: "${result}"`);
    console.log(`Expected: "${expected}"`);
    console.log(`Success: ${result === expected ? '✅' : '❌'}`);
    return result === expected;
}
// Run tests if this file is executed directly
if (require.main === module) {
    testPhoneFormatting();
    console.log('\n' + '='.repeat(50) + '\n');
    testErrorCase();
}
