import { getSupabaseService } from '../../services/supabaseService';
import { ValidateCommunicationChannelsParams, ValidateCommunicationChannelsResult } from './types';

/**
 * Activity to validate communication channels (email or WhatsApp) are configured for a site
 */
export async function validateCommunicationChannelsActivity(
  params: ValidateCommunicationChannelsParams
): Promise<ValidateCommunicationChannelsResult> {
  console.log(`📡 Validating communication channels for site: ${params.site_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot validate communication channels');
      return {
        success: false,
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        hasAnyChannel: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching settings...');
    
    // Get settings for the site
    const settings = await supabaseService.fetchCompleteSettings([params.site_id]);
    
    if (!settings || settings.length === 0) {
      console.log('⚠️  No settings found for site');
      return {
        success: true,
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        hasAnyChannel: false,
        error: 'No settings found for site'
      };
    }

    const siteSettings = settings[0];
    const channels = siteSettings.channels || {};
    
    console.log(`🔍 Checking channel configurations for channels:`, channels);
    console.log(`🔍 DEBUG: channels type:`, typeof channels);
    console.log(`🔍 DEBUG: channels isArray:`, Array.isArray(channels));
    console.log(`🔍 DEBUG: channels value:`, JSON.stringify(channels, null, 2));
    
    let hasEmailChannel = false;
    let hasWhatsappChannel = false;
    let emailConfig = null;
    let whatsappConfig = null;
    let emailAliasConfigured = false;
    
    // Handle different channel structure formats
    if (Array.isArray(channels)) {
      // Array format: channels is an array of channel objects
      console.log(`📋 Processing channels as array with ${channels.length} configurations`);
      
      emailConfig = channels.find((channel: any) => 
        channel.type === 'email' && channel.enabled === true && (channel.status === 'active' || channel.status === 'synced')
      );
      
      const agentConfig = channels.find((channel: any) => 
        channel.type === 'agent' && channel.enabled === true && channel.status === 'active'
      );

      const agentMailConfig = channels.find((channel: any) => 
        (channel.type === 'agent_mail' || channel.type === 'agent_email') && 
        (channel.enabled !== false) && (channel.status === 'active' || channel.status === 'synced')
      );
      
      whatsappConfig = channels.find((channel: any) => 
        channel.type === 'whatsapp' && channel.enabled === true && channel.status === 'active'
      );
      
      hasEmailChannel = !!emailConfig || !!agentConfig || !!agentMailConfig;
      hasWhatsappChannel = !!whatsappConfig;
      
    } else if (typeof channels === 'object' && channels !== null) {
      // Object format: channels.email.enabled, channels.whatsapp.enabled
      console.log(`📋 Processing channels as object structure`);
      console.log(`🔍 DEBUG: Channels object keys:`, Object.keys(channels));
      console.log(`🔍 DEBUG: Full channels object:`, JSON.stringify(channels, null, 2));
      
      // Check email configuration
      let isEmailActive = false;
      if (channels.email && typeof channels.email === 'object') {
        // Set config regardless of enabled status so callers can inspect aliases
        emailConfig = channels.email;
        // Email accepts "active" or "synced" status
        isEmailActive = channels.email.enabled === true && (channels.email.status === 'active' || channels.email.status === 'synced');
        console.log(`   - Email enabled: ${isEmailActive}`, channels.email);
        // Detect aliases: accept string, array or truthy value
        const aliasesValue = channels.email.aliases;
        if (typeof aliasesValue === 'string') {
          emailAliasConfigured = aliasesValue.trim().length > 0;
        } else if (Array.isArray(aliasesValue)) {
          emailAliasConfigured = aliasesValue.length > 0;
        } else if (aliasesValue) {
          emailAliasConfigured = true;
        }
      }

      // Check agent channel
      const isAgentActive = channels.agent && channels.agent.enabled === true && channels.agent.status === 'active';
      if (channels.agent) {
         console.log(`   - Agent enabled: ${isAgentActive}`, channels.agent);
      }
      
      // Check agent_mail channel (and agent_email) with relaxed validation
      console.log(`🔍 DEBUG: Checking agent_mail/agent_email channels...`);
      console.log(`🔍 DEBUG: channels.agent_mail =`, channels.agent_mail);
      console.log(`🔍 DEBUG: channels.agent_email =`, channels.agent_email);
      
      const agentMailChannel = channels.agent_mail || channels.agent_email;
      console.log(`🔍 DEBUG: agentMailChannel =`, agentMailChannel);
      
      if (agentMailChannel) {
        console.log(`🔍 DEBUG: agentMailChannel.enabled =`, agentMailChannel.enabled);
        console.log(`🔍 DEBUG: agentMailChannel.enabled !== false =`, agentMailChannel.enabled !== false);
        console.log(`🔍 DEBUG: agentMailChannel.status =`, agentMailChannel.status);
        console.log(`🔍 DEBUG: status check =`, agentMailChannel.status === 'active' || agentMailChannel.status === 'synced');
      }
      
      const isAgentMailActive = agentMailChannel && (agentMailChannel.enabled !== false) && (
        agentMailChannel.status === 'active' || 
        agentMailChannel.status === 'synced'
      );
      
      console.log(`🔍 DEBUG: isAgentMailActive =`, isAgentMailActive);
      
      if (agentMailChannel) {
         console.log(`   - Agent Mail/Email found (status=${agentMailChannel.status}, enabled=${agentMailChannel.enabled}): ${isAgentMailActive}`, agentMailChannel);
      } else {
         console.log(`   - Agent Mail/Email NOT FOUND in channels object`);
      }

      hasEmailChannel = isEmailActive || isAgentActive || isAgentMailActive;
      
      // Check WhatsApp configuration  
      if (channels.whatsapp && typeof channels.whatsapp === 'object') {
        hasWhatsappChannel = channels.whatsapp.enabled === true && channels.whatsapp.status === 'active';
        if (hasWhatsappChannel) {
          whatsappConfig = channels.whatsapp;
        }
        console.log(`   - WhatsApp enabled: ${hasWhatsappChannel}`, channels.whatsapp);
      }
      
    } else {
      console.log(`⚠️  Channels configuration is neither array nor object:`, typeof channels);
    }
    const hasAnyChannel = hasEmailChannel || hasWhatsappChannel;
    
    console.log(`📊 Channel validation results:`);
    console.log(`   - Email enabled: ${hasEmailChannel ? '✅' : '❌'}`);
    console.log(`   - WhatsApp enabled: ${hasWhatsappChannel ? '✅' : '❌'}`);
    console.log(`   - Any channel available: ${hasAnyChannel ? '✅' : '❌'}`);
    
    if (!hasAnyChannel) {
      console.log('❌ No communication channels (email or WhatsApp) are configured and enabled');
      
      return {
        success: true,
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        hasAnyChannel: false,
        error: 'No communication channels (email or WhatsApp) are configured and enabled'
      };
    }

    console.log('✅ Communication channels validation completed successfully');
    return {
      success: true,
      hasEmailChannel,
      hasWhatsappChannel,
      hasAnyChannel,
      // Always return emailConfig to allow alias check even if disabled
      emailConfig,
      emailAliasConfigured,
      whatsappConfig: hasWhatsappChannel ? whatsappConfig : undefined
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Exception validating communication channels:', errorMessage);
    
    return {
      success: false,
      hasEmailChannel: false,
      hasWhatsappChannel: false,
      hasAnyChannel: false,
      error: errorMessage
    };
  }
}

