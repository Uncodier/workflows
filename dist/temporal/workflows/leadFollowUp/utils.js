"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPhoneNumber = formatPhoneNumber;
exports.shouldExecuteLeadResearch = shouldExecuteLeadResearch;
exports.shouldExecuteCompanyResearch = shouldExecuteCompanyResearch;
exports.extractWebsite = extractWebsite;
/**
 * Sanitize phone numbers without inferring/adding country codes.
 * Let Twilio/backend resolve the region/country.
 */
function formatPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
        return phone;
    }
    // Keep digits and plus signs only; collapse to a single leading +
    let cleanPhone = phone.replace(/[^\d+]/g, '');
    if (cleanPhone.startsWith('+')) {
        cleanPhone = '+' + cleanPhone.slice(1).replace(/\+/g, '');
    }
    else {
        cleanPhone = cleanPhone.replace(/\+/g, '');
    }
    return cleanPhone;
}
/**
 * Checks if lead needs research based on notes and metadata
 * Criteria: No notes AND no metadata
 */
function shouldExecuteLeadResearch(leadInfo) {
    // Check if origin is lead_generation_workflow
    if (leadInfo.origin !== 'lead_generation_workflow') {
        return false;
    }
    // Check notes
    const hasNotes = leadInfo.notes && typeof leadInfo.notes === 'string' && leadInfo.notes.trim() !== '';
    // Check metadata
    const hasMetadata = leadInfo.metadata &&
        typeof leadInfo.metadata === 'object' &&
        Object.keys(leadInfo.metadata).length > 0;
    return !hasNotes && !hasMetadata;
}
/**
 * Checks if lead needs company website research
 * Criteria: No notes AND has website/domain
 */
function shouldExecuteCompanyResearch(leadInfo) {
    const hasNotes = leadInfo.notes && typeof leadInfo.notes === 'string' && leadInfo.notes.trim() !== '';
    if (hasNotes) {
        return false;
    }
    const website = extractWebsite(leadInfo);
    return !!website;
}
/**
 * Extracts website URL from lead info
 */
function extractWebsite(leadInfo) {
    // Check lead.website
    if (leadInfo.website && typeof leadInfo.website === 'string' && leadInfo.website.trim() !== '') {
        return leadInfo.website.trim();
    }
    // Check lead.company.website
    if (leadInfo.company && typeof leadInfo.company === 'object' && leadInfo.company.website) {
        return leadInfo.company.website.trim();
    }
    // Check lead.metadata.website
    if (leadInfo.metadata && leadInfo.metadata.website) {
        return leadInfo.metadata.website.trim();
    }
    return null;
}
