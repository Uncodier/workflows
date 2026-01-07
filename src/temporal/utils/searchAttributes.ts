/**
 * Search Attributes Utilities
 * 
 * Automatically extract search attributes from workflow inputs to enable
 * filtering workflows by site_id, lead_id, user_id, etc. from both
 * Temporal Cloud UI and programmatically via the SDK.
 */

/**
 * Automatically extract searchAttributes from workflow input
 * Supports common fields: site_id, lead_id, user_id, segment_id, etc.
 * 
 * @param input - Workflow input object
 * @returns SearchAttributes object formatted for Temporal (values as arrays)
 * 
 * @example
 * const input = { site_id: 'site-123', userId: 'user-456' };
 * const attrs = extractSearchAttributesFromInput(input);
 * // Returns: { site_id: ['site-123'], user_id: ['user-456'] }
 */
export function extractSearchAttributesFromInput(
  input: Record<string, any>
): Record<string, string[]> {
  const searchAttributes: Record<string, string[]> = {};
  
  // Map common fields (supports both naming conventions)
  const fieldMappings: Record<string, string[]> = {
    site_id: ['site_id', 'siteId'],
    user_id: ['userId', 'user_id'],
    lead_id: ['lead_id', 'leadId'],
    segment_id: ['segmentId', 'segment_id'],
    campaign_id: ['campaignId', 'campaign_id'],
    person_id: ['person_id', 'personId'],
    icp_mining_id: ['icp_mining_id'],
    command_id: ['command_id'],
    conversation_id: ['conversation_id'],
    instance_id: ['instance_id'],
  };
  
  // Extract values from input
  for (const [searchKey, inputKeys] of Object.entries(fieldMappings)) {
    for (const inputKey of inputKeys) {
      const value = input[inputKey];
      if (value && typeof value === 'string') {
        searchAttributes[searchKey] = [value];
        break; // Found value, no need to check other variants
      }
    }
  }
  
  return searchAttributes;
}

/**
 * Merge multiple search attributes objects
 * Later objects take precedence over earlier ones
 * 
 * @param attributes - Array of search attributes objects to merge
 * @returns Merged search attributes
 * 
 * @example
 * const auto = { site_id: ['site-123'] };
 * const manual = { site_id: ['site-456'], workflow_category: ['critical'] };
 * const merged = mergeSearchAttributes(auto, manual);
 * // Returns: { site_id: ['site-456'], workflow_category: ['critical'] }
 */
export function mergeSearchAttributes(
  ...attributes: Array<Record<string, string[]> | undefined>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  
  for (const attrs of attributes) {
    if (attrs && typeof attrs === 'object') {
      Object.assign(merged, attrs);
    }
  }
  
  return merged;
}

/**
 * Validate that search attributes are properly formatted
 * All values must be arrays
 * 
 * @param attributes - Search attributes to validate
 * @returns true if valid, false otherwise
 */
export function validateSearchAttributes(
  attributes: Record<string, any>
): boolean {
  if (!attributes || typeof attributes !== 'object') {
    return false;
  }
  
  for (const [key, value] of Object.entries(attributes)) {
    if (!Array.isArray(value)) {
      console.warn(`Search attribute "${key}" must be an array, got ${typeof value}`);
      return false;
    }
    
    // Check that all array elements are strings
    if (!value.every(v => typeof v === 'string')) {
      console.warn(`Search attribute "${key}" array must contain only strings`);
      return false;
    }
  }
  
  return true;
}

/**
 * Add a workflow category to search attributes
 * Useful for grouping related workflows
 * 
 * @param attributes - Existing search attributes
 * @param category - Category name (e.g., 'lead-generation', 'segments', 'critical')
 * @returns Search attributes with category added
 */
export function addWorkflowCategory(
  attributes: Record<string, string[]>,
  category: string
): Record<string, string[]> {
  return {
    ...attributes,
    workflow_category: [category]
  };
}

