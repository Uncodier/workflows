export const DEFAULT_ICP_TARGET_LEADS = 150;
export const MAX_ICP_TARGET_LEADS = 3000;
export const MAX_ICP_SELECTED_LISTS = 1000;

export function normalizeIcpMiningListIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ICP_SELECTED_LISTS
    || value.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error(`ICP list_ids must be an array of at most ${MAX_ICP_SELECTED_LISTS} UUIDs`);
  }
  return [...new Set(value.map(id => id.toLowerCase()))];
}

export interface IcpMiningConfiguration {
  targetLeads: number;
  researchEnabled: boolean;
  allLists: boolean;
  listIds: string[];
}

/** Missing legacy settings use defaults; malformed spending controls fail closed. */
export function resolveIcpMiningConfiguration(
  settings: any,
  overrides: { targetLeadsWithEmail?: number; researchEnabled?: boolean } = {},
): IcpMiningConfiguration {
  const config = settings?.activities?.icp_lead_generation;
  const savedTarget = config?.target_leads === undefined ? DEFAULT_ICP_TARGET_LEADS : config.target_leads;
  const savedResearch = config?.research_enabled === undefined ? false : config.research_enabled;
  const targetLeads = overrides.targetLeadsWithEmail === undefined ? savedTarget : overrides.targetLeadsWithEmail;
  const researchEnabled = overrides.researchEnabled === undefined ? savedResearch : overrides.researchEnabled;
  if (!Number.isInteger(targetLeads) || targetLeads < 1 || targetLeads > MAX_ICP_TARGET_LEADS) {
    throw new Error(`ICP target_leads must be an integer between 1 and ${MAX_ICP_TARGET_LEADS}`);
  }
  if (typeof researchEnabled !== 'boolean') {
    throw new Error('ICP research_enabled must be a boolean');
  }
  const allLists = config?.all_lists === undefined ? true : config.all_lists;
  if (typeof allLists !== 'boolean') throw new Error('ICP all_lists must be a boolean');
  const listIds = normalizeIcpMiningListIds(config?.list_ids === undefined ? [] : config.list_ids);
  return { targetLeads, researchEnabled, allLists, listIds };
}