const fs = require('fs');

const filesToPatch = [
    '../API/src/app/api/notifications/taskCommentReminder/route.ts',
    '../API/src/app/api/notifications/leadAssignment/route.ts',
    '../API/src/app/api/notifications/leadAttention/route.ts',
    '../API/src/app/api/notifications/taskStatus/route.ts',
    '../API/src/app/api/notifications/emailSyncFailure/route.ts'
];

const newCode = `async function getSiteEmailConfig(siteId: string): Promise<{email: string | null, aliases: string[]}> {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('channels')
      .eq('site_id', siteId)
      .single();
    
    if (error || !data?.channels) {
      return { email: null, aliases: [] };
    }
    
    const emailConfig = data.channels.email;
    const agentEmailConfig = data.channels.agent_email || data.channels.agent_mail || data.channels.agent;
    let aliases: string[] = [];
    
    // Procesar aliases
    if (emailConfig && emailConfig.aliases) {
      if (Array.isArray(emailConfig.aliases)) {
        aliases = emailConfig.aliases;
      } else if (typeof emailConfig.aliases === 'string') {
        aliases = emailConfig.aliases
          .split(',')
          .map((alias: string) => alias.trim())
          .filter((alias: string) => alias.length > 0);
      }
    }
    
    // Si agent_email está activo y no hay alias ni email principal, usamos el de agente
    let primaryEmail = emailConfig?.email || null;
    if (!primaryEmail && agentEmailConfig && (String(agentEmailConfig.status) === 'active' || String(agentEmailConfig.status) === 'synced') && agentEmailConfig.enabled !== false) {
      primaryEmail = agentEmailConfig.email || (agentEmailConfig.data?.username && agentEmailConfig.data?.domain ? \`\${agentEmailConfig.data.username}@\${agentEmailConfig.data.domain}\` : null);
    }
    
    return {
      email: primaryEmail,
      aliases
    };`;

for (const file of filesToPatch) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    
    // Find the getSiteEmailConfig function
    const startRegex = /async function getSiteEmailConfig\(siteId: string\): Promise<\{email: string \| null, aliases: string\[\]\}> \{[\s\S]*?return \{\s*email: [\s\S]*?aliases\s*\};\s*\n/m;
    
    if (startRegex.test(content)) {
        content = content.replace(startRegex, newCode + '\n');
        fs.writeFileSync(file, content);
        console.log(`Patched ${file}`);
    } else {
        console.log(`Could not find match in ${file}`);
    }
}
