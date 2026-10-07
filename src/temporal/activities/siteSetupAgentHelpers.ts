import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateAgentsParams, SetupAgent, SetupAgentConfig } from './siteSetupTypes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireSetupUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${field} must be a valid UUID`);
}

export async function fetchSetupSite(client: SupabaseClient, siteId: string) {
  requireSetupUuid(siteId, 'site_id');
  const { data, error } = await client.from('sites')
    .select('id, name, url, description, user_id, created_at, updated_at, archived_at')
    .eq('id', siteId).maybeSingle();
  if (error) throw new Error(`Failed to fetch site: ${error.message}`);
  if (!data) return null;
  if (typeof data.id !== 'string' || data.id.toLowerCase() !== siteId.toLowerCase()) {
    throw new Error('Site identity does not match setup request');
  }
  if (data.archived_at) throw new Error('Archived sites cannot be set up');
  return data;
}

export function normalizeSetupAgentType(type: string): string {
  const aliases: Record<string, string> = {
    sales: 'sales', support: 'support', marketing: 'marketing',
    customer_support: 'support', general: 'marketing', product: 'marketing',
  };
  const normalized = aliases[type];
  if (typeof normalized !== 'string') throw new Error(`Unsupported agent type: ${type}`);
  return normalized;
}

export interface AgentCandidate {
  config: SetupAgentConfig;
  basic: boolean;
}

export function setupAgentCandidates(params: CreateAgentsParams): AgentCandidate[] {
  if (params.custom_config?.use_detailed_config) {
    if (!Array.isArray(params.custom_config.agents_config)) {
      throw new Error('Detailed agent configuration must include agents_config');
    }
    return params.custom_config.agents_config.map(config => ({ config, basic: false }));
  }
  const templates: Record<string, { name: string; description: string }> = {
    support: { name: 'Customer Support', description: 'Handles customer inquiries and support requests' },
    sales: { name: 'Sales Assistant', description: 'Assists with sales processes and lead management' },
    marketing: { name: 'General Assistant', description: 'Provides general assistance and information' },
  };
  return (params.agent_types ?? ['support', 'sales', 'marketing']).map(type => {
    // Keep invalid types as candidates so one failure cannot prevent other agents.
    const key = type === 'customer_support' ? 'support' : ['general', 'product'].includes(type) ? 'marketing' : type;
    return { config: { type, ...(templates[key] ?? { name: type }) }, basic: true };
  });
}

export function setupAgentId(siteId: string, userId: string, type: string, role: string): string {
  // Stable primary keys make insert-only retries safe without a new unique index.
  const hash = createHash('sha256').update(JSON.stringify([
    'site-setup-agent-v1', siteId.toLowerCase(), userId.toLowerCase(), type, role,
  ])).digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  hash[16] = ((parseInt(hash[16], 16) & 3) | 8).toString(16);
  const value = hash.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function buildSetupAgentRow(candidate: AgentCandidate, siteId: string, userId: string, companyName?: string) {
  const config = candidate.config;
  const type = normalizeSetupAgentType(config.type);
  if (typeof config.name !== 'string' || !config.name.trim()) throw new Error('Agent name is required');
  const role = config.role?.trim() || config.name.trim();
  const status = config.status ?? 'active';
  if (!['active', 'inactive', 'training'].includes(status)) throw new Error(`Unsupported agent status: ${status}`);
  const prompt = config.prompt?.trim() || `You are ${config.name.trim()}${companyName ? ` for ${companyName}` : ''}.${config.description ? ` ${config.description}.` : ''}`;
  // Database defaults supply counters/timestamps and optional JSON fields.
  return {
    id: setupAgentId(siteId, userId, type, role),
    site_id: siteId,
    user_id: userId,
    name: config.name.trim(),
    type,
    status,
    prompt,
    role,
    ...(config.description !== undefined && { description: config.description }),
    ...(config.backstory !== undefined && { backstory: config.backstory }),
    ...(config.activities !== undefined && { activities: config.activities }),
    ...(config.configuration !== undefined && { configuration: config.configuration }),
    ...(config.tools !== undefined && { tools: config.tools }),
    ...(config.integrations !== undefined && { integrations: config.integrations }),
  };
}

export type SetupAgentRow = ReturnType<typeof buildSetupAgentRow>;

export async function findExistingSetupAgent(client: SupabaseClient, row: SetupAgentRow, consumed: ReadonlySet<string>) {
  const { data, error } = await client.from('agents')
    .select('id, name, type, status, role, description, activities')
    .eq('site_id', row.site_id).eq('type', row.type);
  if (error) throw new Error(`Unable to check existing agents: ${error.message}`);
  // Creator is historical metadata, not tenant/role identity. An exact setup ID
  // remains authoritative even after the user customizes its role or name.
  const available = (data ?? []).filter(agent => !consumed.has(agent.id));
  const role = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  return available.find(agent => agent.id === row.id)
    ?? available.find(agent => role(agent.role) === row.role)
    ?? available.find(agent => !role(agent.role) && agent.name === row.name);
}

export function setupAgentResult(row: Record<string, unknown>): SetupAgent {
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.type !== 'string' || typeof row.status !== 'string') {
    throw new Error('Database did not return a valid agent');
  }
  return {
    agent_id: row.id, type: row.type, name: row.name, status: row.status,
    ...(typeof row.description === 'string' && { description: row.description }),
    ...(Array.isArray(row.activities) && { activities: row.activities }),
  };
}