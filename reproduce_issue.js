
const emailConfig = { enabled: true, status: 'active' }; // Missing SMTP fields (invalid)
const agentConfig = { enabled: true, status: 'active', type: 'agent' };
const agentMailConfig = undefined;

console.log("Scenario: emailConfig exists (but invalid), agentConfig exists.");

// Current logic
if (emailConfig && !agentConfig && !agentMailConfig) {
    console.log("Current Logic: Validation RUNS");
} else {
    console.log("Current Logic: Validation SKIPPED (BUG)");
}

// Proposed logic
if (emailConfig) {
    console.log("Proposed Logic: Validation RUNS (FIXED)");
} else {
    console.log("Proposed Logic: Validation SKIPPED");
}
