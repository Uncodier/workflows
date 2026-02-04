/**
 * Sanitize phone numbers without inferring/adding country codes.
 * Let Twilio/backend resolve the region/country.
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    return phone;
  }

  // Keep digits and plus signs only; collapse to a single leading +
  let cleanPhone = phone.replace(/[^\d+]/g, '');

  if (cleanPhone.startsWith('+')) {
    cleanPhone = '+' + cleanPhone.slice(1).replace(/\+/g, '');
  } else {
    cleanPhone = cleanPhone.replace(/\+/g, '');
  }

  return cleanPhone;
}

/**
 * Checks if lead needs research based on notes and metadata
 * Criteria: No notes AND no metadata
 */
export function shouldExecuteLeadResearch(leadInfo: any): boolean {
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
export function shouldExecuteCompanyResearch(leadInfo: any): boolean {
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
export function extractWebsite(leadInfo: any): string | null {
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
