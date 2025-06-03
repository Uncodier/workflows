/**
 * Default Agents Configuration
 * Configuration for creating agents during site setup
 */
export interface AgentActivity {
    id: string;
    name: string;
    description: string;
    estimatedTime: string;
    successRate: number;
    executions: number;
    status: string;
}
export interface AgentConfig {
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    conversations: number;
    successRate: number;
    lastActive: string;
    icon: string;
    activities: AgentActivity[];
}
export interface AgentsConfiguration {
    agents: AgentConfig[];
}
export declare const defaultAgentsConfig: AgentsConfiguration;
/**
 * Helper function to get agent types for backwards compatibility
 */
export declare function getAgentTypes(): string[];
/**
 * Helper function to get agents by type
 */
export declare function getAgentsByType(type: string): AgentConfig[];
/**
 * Helper function to get all agent names
 */
export declare function getAgentNames(): string[];
