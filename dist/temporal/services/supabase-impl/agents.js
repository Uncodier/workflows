"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgents = createAgents;
exports.createAgent = createAgent;
async function createAgents(client, agents) {
    console.log(`🔍 Creating ${agents.length} agents in Supabase...`);
    const { data, error } = await client
        .from('agents')
        .insert(agents)
        .select();
    if (error) {
        console.error('❌ Error creating agents:', error);
        throw new Error(`Failed to create agents: ${error.message}`);
    }
    console.log(`✅ Successfully created ${data?.length || 0} agents in database`);
    return data || [];
}
async function createAgent(client, agentData) {
    console.log(`🔍 Creating agent '${agentData.name}' in Supabase...`);
    const { data, error } = await client
        .from('agents')
        .insert([agentData])
        .select()
        .single();
    if (error) {
        console.error('❌ Error creating agent:', error);
        throw new Error(`Failed to create agent: ${error.message}`);
    }
    console.log(`✅ Successfully created agent '${agentData.name}' with ID: ${data.id}`);
    return data;
}
