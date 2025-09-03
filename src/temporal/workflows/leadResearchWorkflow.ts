import { proxyActivities, startChild, workflowInfo, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { deepResearchWorkflow, type DeepResearchOptions } from './deepResearchWorkflow';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getLeadActivity,
  updateLeadActivity,
  upsertCompanyActivity,
  leadSegmentationActivity,
  validateContactInformation,
  leadContactGenerationActivity,
  updateLeadEmailVerificationActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', // Reasonable timeout for lead research
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadResearchOptions {
  lead_id: string;                    // Required: Lead ID
  site_id: string;                    // Required: Site ID
  userId?: string;
  additionalData?: any;
}

export interface LeadResearchResult {
  success: boolean;
  leadId: string;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  leadInfo?: any;                     // Información del lead de la base de datos
  deepResearchResult?: any;           // Resultado del deep research
  researchQuery?: string;             // Query generado para la investigación
  leadSegmentationResult?: any;       // Resultado de la segmentación del lead
  data?: any;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Extract the real schedule ID from workflow info
 * This looks for evidence of schedule execution in search attributes or memo
 */
function extractScheduleId(info: any): string {
  // Check if workflow was triggered by a schedule
  // Temporal schedules typically set search attributes or memo data
  const searchAttributes = info.searchAttributes || {};
  const memo = info.memo || {};
  
  // Look for common schedule-related attributes
  const scheduleId = 
    searchAttributes['TemporalScheduledById'] || 
    searchAttributes['ScheduleId'] ||
    memo['TemporalScheduledById'] ||
    memo['scheduleId'] ||
    memo['scheduleName'];
    
  if (scheduleId) {
    console.log(`✅ Lead Research - Real schedule ID found: ${scheduleId}`);
    return scheduleId;
  }
  
  // If no schedule ID found, it might be a manual execution or child workflow
  console.log(`⚠️ Lead Research - No schedule ID found in workflow info - likely manual execution`);
  return 'manual-execution';
}

/**
 * Helper function to validate and generate emails for leads
 */
async function validateAndGenerateEmails(
  leadInfo: any,
  siteInfo: any,
  options: LeadResearchOptions
): Promise<{ success: boolean; validEmail?: string; error?: string }> {
  console.log(`📧 Starting email validation and generation for lead ${leadInfo.id}...`);

  // Check if email is already verified
  if (leadInfo.metadata?.emailVerified) {
    console.log(`✅ Email already verified for lead ${leadInfo.id}, skipping validation`);
    return { success: true, validEmail: leadInfo.email };
  }

  const leadEmail = leadInfo.email;
  const leadPhone = leadInfo.phone || leadInfo.phone_number;

  // Step 1: If lead has email, validate it first
  if (leadEmail && leadEmail.trim() !== '') {
    console.log(`📧 Validating existing email: ${leadEmail}`);
    
    const emailValidationResult = await validateContactInformation({
      email: leadEmail,
      hasEmailMessage: true, // We want to validate email
      hasWhatsAppMessage: false,
      leadId: leadInfo.id,
      phone: leadPhone,
      leadMetadata: leadInfo.metadata
    });

    if (emailValidationResult.success && emailValidationResult.isValid) {
      console.log(`✅ Existing email is valid and deliverable: ${leadEmail}`);
      
      // Mark email as verified
      await updateLeadEmailVerificationActivity({
        lead_id: leadInfo.id,
        emailVerified: true,
        validatedEmail: leadEmail,
        userId: options.userId
      });

      return { success: true, validEmail: leadEmail };
    } else {
      console.log(`❌ Existing email is invalid or not deliverable: ${leadEmail}`);
      console.log(`🔍 Reason: ${emailValidationResult.reason}`);
      console.log(`📊 Full validation result:`, JSON.stringify(emailValidationResult, null, 2));
    }
  }

  // Step 2: Generate new emails using leadContactGeneration
  console.log(`🔄 Generating new emails for lead ${leadInfo.name}...`);
  
  // Extract domain from company website or use generic approach
  let domain = '';
  if (leadInfo.company_name || leadInfo.company) {
    // Try to extract domain from website if available
    const website = leadInfo.web || siteInfo?.url;
    if (website) {
      try {
        const url = new URL(website.startsWith('http') ? website : `https://${website}`);
        domain = url.hostname.replace('www.', '');
      } catch {
        // If URL parsing fails, use company name
        domain = (leadInfo.company_name || leadInfo.company).toLowerCase().replace(/\s+/g, '') + '.com';
      }
    } else {
      domain = (leadInfo.company_name || leadInfo.company).toLowerCase().replace(/\s+/g, '') + '.com';
    }
  } else {
    console.log(`⚠️ No company information available for domain extraction`);
    return { success: false, error: 'No company information available for email generation' };
  }

  // Build context for email generation
  const context = `
    Name: ${leadInfo.name}
    Company: ${leadInfo.company_name || leadInfo.company}
    Position: ${leadInfo.position || leadInfo.job_title || 'Unknown'}
    Current Email: ${leadEmail || 'None'}
    Domain: ${domain}
    Context: Lead research workflow email generation
  `.trim();

  const emailGenerationResult = await leadContactGenerationActivity({
    name: leadInfo.name,
    domain: domain,
    context: context,
    site_id: options.site_id,
    leadId: leadInfo.id
  });

  if (!emailGenerationResult.success || !emailGenerationResult.email_generation_analysis) {
    console.log(`❌ Email generation failed: ${emailGenerationResult.error}`);
    return { success: false, error: emailGenerationResult.error };
  }

  const generatedEmails = emailGenerationResult.email_generation_analysis;
  console.log(`🔄 Generated ${generatedEmails.length} potential emails to validate`);
  
  // Log additional analysis data if available
  if (emailGenerationResult.emailAnalysisData) {
    const analysisData = emailGenerationResult.emailAnalysisData;
    console.log(`🎯 Analysis for ${analysisData.contact_name} @ ${analysisData.domain}`);
    if (analysisData.recommendations && analysisData.recommendations.length > 0) {
      console.log(`💡 Top AI recommendation: ${analysisData.recommendations[0]}`);
    }
  }

  // Step 3: Validate each generated email
  for (const email of generatedEmails) {
    console.log(`📧 Validating generated email: ${email}`);
    
    const validationResult = await validateContactInformation({
      email: email,
      hasEmailMessage: true,
      hasWhatsAppMessage: false,
      leadId: leadInfo.id,
      phone: leadPhone,
      leadMetadata: null // New generated email, no existing metadata
    });

    if (validationResult.success && validationResult.isValid) {
      console.log(`✅ Valid email found: ${email}`);
      
      // Update lead with verified email
      await updateLeadEmailVerificationActivity({
        lead_id: leadInfo.id,
        emailVerified: true,
        validatedEmail: email,
        userId: options.userId
      });

      return { success: true, validEmail: email };
    } else {
      console.log(`❌ Invalid email: ${email} (${validationResult.reason})`);
      console.log(`📊 Full validation result:`, JSON.stringify(validationResult, null, 2));
    }
  }

  console.log(`❌ No valid emails found after validation`);
  return { success: false, error: 'No valid emails found after generation and validation' };
}

/**
 * Genera un query de búsqueda estructurado basado en TODA la información disponible del lead
 */
function generateLeadResearchQuery(lead: any): string {
  const contextParts: string[] = [];
  let companyName = 'Unknown Company';
  
  // === INFORMACIÓN PERSONAL ===
  const personName = lead.name || lead.email || 'prospecto';
  contextParts.push(`PERSONA: ${personName}`);
  
  if (lead.email && lead.email !== personName) {
    contextParts.push(`email: ${lead.email}`);
  }
  
  if (lead.phone) {
    contextParts.push(`teléfono: ${lead.phone}`);
  }
  
  if (lead.position || lead.job_title) {
    contextParts.push(`cargo: ${lead.position || lead.job_title}`);
  }
  
  if (lead.location) {
    contextParts.push(`ubicación: ${lead.location}`);
  }
  
  if (lead.language) {
    contextParts.push(`idioma: ${lead.language}`);
  }
  
  if (lead.birthday) {
    contextParts.push(`cumpleaños: ${lead.birthday}`);
  }
  
  // === INFORMACIÓN DE LA EMPRESA ===
  if (lead.company || lead.company_name) {
    // Extraer el nombre de la empresa de diferentes estructuras posibles
    if (typeof lead.company === 'object' && lead.company !== null) {
      companyName = lead.company.name || lead.company.company_name || lead.company.title || 'Unknown Company';
      
      // Si es un objeto, también incluir información adicional si está disponible
      const companyInfo = [];
      if (lead.company.industry && !lead.industry) companyInfo.push(`industria: ${lead.company.industry}`);
      if (lead.company.size && !lead.company_size) companyInfo.push(`tamaño: ${lead.company.size}`);
      if (lead.company.location) companyInfo.push(`ubicación empresa: ${lead.company.location}`);
      
      if (companyInfo.length > 0) {
        contextParts.push(`datos empresa adicionales: ${companyInfo.join(', ')}`);
      }
    } else if (typeof lead.company === 'string') {
      companyName = lead.company;
    } else if (lead.company_name) {
      companyName = typeof lead.company_name === 'object' ? 
        (lead.company_name.name || lead.company_name.title || 'Unknown Company') :
        lead.company_name;
    }
    
    if (companyName !== 'Unknown Company' && companyName.trim() !== '') {
      contextParts.push(`EMPRESA: ${companyName}`);
    }
  }
  
  if (lead.industry) {
    contextParts.push(`industria: ${lead.industry}`);
  }
  
  if (lead.company_size) {
    contextParts.push(`tamaño empresa: ${lead.company_size}`);
  }
  
  if (lead.website) {
    contextParts.push(`sitio web empresa: ${lead.website}`);
  }
  
  // === REDES SOCIALES EXISTENTES ===
  if (lead.social_networks && typeof lead.social_networks === 'object') {
    const socialNetworks = lead.social_networks;
    const socialParts: string[] = [];
    
    Object.keys(socialNetworks).forEach(platform => {
      const value = socialNetworks[platform];
      if (value && typeof value === 'string' && value.trim() !== '') {
        socialParts.push(`${platform}: ${value}`);
      }
    });
    
    if (socialParts.length > 0) {
      contextParts.push(`redes sociales conocidas: ${socialParts.join(', ')}`);
    }
  }
  
  // === INFORMACIÓN ADICIONAL ===
  if (lead.status) {
    contextParts.push(`status: ${lead.status}`);
  }
  
  if (lead.origin) {
    contextParts.push(`origen: ${lead.origin}`);
  }
  
  if (lead.attribution) {
    const attributionText = typeof lead.attribution === 'object' ? 
      JSON.stringify(lead.attribution) : 
      lead.attribution;
    contextParts.push(`atribución: ${attributionText}`);
  }
  
  if (lead.subscription) {
    const subscriptionText = typeof lead.subscription === 'object' ? 
      JSON.stringify(lead.subscription) : 
      lead.subscription;
    contextParts.push(`suscripción: ${subscriptionText}`);
  }
  
  if (lead.last_contact) {
    contextParts.push(`último contacto: ${lead.last_contact}`);
  }
  
  if (lead.address) {
    if (typeof lead.address === 'object') {
      const addressParts = [];
      if (lead.address.street) addressParts.push(lead.address.street);
      if (lead.address.city) addressParts.push(lead.address.city);
      if (lead.address.state) addressParts.push(lead.address.state);
      if (lead.address.country) addressParts.push(lead.address.country);
      if (addressParts.length > 0) {
        contextParts.push(`dirección: ${addressParts.join(', ')}`);
      }
    } else {
      contextParts.push(`dirección: ${lead.address}`);
    }
  }
  
  if (lead.notes && lead.notes.trim() !== '') {
    contextParts.push(`NOTAS IMPORTANTES: ${lead.notes}`);
  }
  
  // === METADATA ADICIONAL ===
  if (lead.metadata && typeof lead.metadata === 'object') {
    const metadataEntries = Object.entries(lead.metadata)
      .filter(([_key, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => {
        // Serializar objetos complejos apropiadamente
        const serializedValue = typeof value === 'object' ? 
          JSON.stringify(value) : 
          String(value);
        return `${key}: ${serializedValue}`;
      })
      .slice(0, 5); // Limitar a las primeras 5 entradas para no sobrecargar
    
    if (metadataEntries.length > 0) {
      contextParts.push(`información adicional: ${metadataEntries.join(', ')}`);
    }
  }
  
  // === CONSTRUIR EL QUERY FINAL ===
  const hasCompany = companyName !== 'Unknown Company' && companyName.trim() !== '';
  const fullContext = contextParts.join(', ');
  
  // Extraer notas para darles más prominencia en el query
  const hasNotes = lead.notes && lead.notes.trim() !== '';
  const notesSection = hasNotes ? `

🔍 EXISTING NOTES TO CONSIDER: ${lead.notes}` : '';
  
  // Si no hay información específica, usar un query básico
  if (contextParts.length <= 1) {
    return `Make deep research about this person: ${personName}${notesSection} - comprehensive analysis of professional background, career history, social media presence (LinkedIn, Twitter, Facebook, Instagram, YouTube, GitHub), business opportunities, and market positioning`;
  }
  
  // Query completo con todo el contexto disponible
  const baseResearchAreas = "professional background, career trajectory, industry analysis, competitive landscape, business opportunities, social media presence (LinkedIn, Twitter, Facebook, Instagram, YouTube, GitHub), market positioning, strategic approach recommendations";
  
  if (hasCompany) {
    return `Make deep research about this person: ${personName} and the company: ${companyName}.${notesSection}

KNOWN CONTEXT: ${fullContext}

Comprehensive analysis including: ${baseResearchAreas}, company information, industry positioning, competitive analysis, and strategic insights. Use the known context to validate existing information and discover new details that complement what we already know. ${hasNotes ? 'Pay special attention to the existing notes and use them to guide your research focus.' : ''}`;
  } else {
    return `Make deep research about this person: ${personName}.${notesSection}

KNOWN CONTEXT: ${fullContext}

Comprehensive analysis including: ${baseResearchAreas}. Use the known context to validate existing information and discover new details that complement what we already know. ${hasNotes ? 'Pay special attention to the existing notes and use them to guide your research focus.' : ''}`;
  }
}

/**
 * Genera una estructura de deliverables basada en lo que queremos completar del lead
 * NO prellenamos datos existentes - solo definimos la estructura de campos a completar
 * Retorna estructura separada en lead y company para mejor procesamiento
 */
function generateLeadDeliverables(lead: any): any {
  const deliverables: any = {
    // Estructura para información del lead - SOLO campos que queremos completar/actualizar
    lead: {},
    
    // Estructura para información de la empresa - SOLO campos que queremos completar/actualizar  
    company: {}
  };
  
  // Para el LEAD: Solo agregar campos que NO tenemos o que están incompletos
  if (!lead.name || lead.name.trim() === '') {
    deliverables.lead.name = null; // Buscar nombre si no lo tenemos
  }
  
  if (!lead.position || lead.position.trim() === '') {
    deliverables.lead.position = null; // Buscar posición si no la tenemos
  }
  
  if (!lead.phone || lead.phone.trim() === '') {
    deliverables.lead.phone = null; // Buscar teléfono si no lo tenemos
  }
  
  if (!lead.language || lead.language.trim() === '') {
    deliverables.lead.language = null; // Detectar idioma si no lo tenemos
  }
  
  if (!lead.birthday) {
    deliverables.lead.birthday = null; // Buscar fecha de cumpleaños si no la tenemos
  }
  
  // Redes sociales: Solo buscar si no las tenemos o están incompletas
  const currentSocialNetworks = lead.social_networks || {};
  const socialNetworksToFind: any = {};
  
  const socialPlatforms = ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'github'];
  socialPlatforms.forEach(platform => {
    const platformValue = currentSocialNetworks[platform];
    // Verificar que sea un string antes de usar .trim()
    if (!platformValue || typeof platformValue !== 'string' || platformValue.trim() === '') {
      socialNetworksToFind[platform] = null;
    }
  });
  
  // Solo agregar social_networks si hay plataformas por completar
  if (Object.keys(socialNetworksToFind).length > 0) {
    deliverables.lead.social_networks = socialNetworksToFind;
  }
  
  // Siempre buscar enriquecer las notas con información de investigación
  deliverables.lead.notes = null; // Para agregar información de investigación
  
  // Para la EMPRESA: Solo agregar campos que NO tenemos o necesitamos completar
  const hasCompanyName = lead.company || lead.company_name;
  if (hasCompanyName) {
    // Solo buscar información de empresa si tenemos al menos el nombre
    
    if (!lead.company_description) {
      deliverables.company.description = null;
    }
    
    if (!lead.industry) {
      deliverables.company.industry = null;
    }
    
    if (!lead.company_size) {
      deliverables.company.size = null;
    }
    
    if (!lead.website) {
      deliverables.company.website = null;
    }
    
    // Campos adicionales que usualmente no tenemos
    deliverables.company.founded = null;
    deliverables.company.employees_count = null;
    deliverables.company.annual_revenue = null;
    deliverables.company.phone = null;
    deliverables.company.email = null;
    deliverables.company.linkedin_url = null;
    deliverables.company.social_media = {};
    deliverables.company.key_people = [];
    deliverables.company.funding_info = {};
    deliverables.company.business_model = null;
    deliverables.company.products_services = [];
    deliverables.company.tech_stack = null;
    deliverables.company.competitor_info = {};
    deliverables.company.address = {};
    
    // Asegurar que el nombre de la empresa esté disponible para contexto
    const companyName = typeof lead.company === 'object' && lead.company !== null ?
      (lead.company.name || lead.company.company_name || lead.company.title) :
      (typeof lead.company === 'string' ? lead.company : lead.company_name);
    
    if (companyName && companyName.trim() !== '') {
      deliverables.company.name = companyName; // Para contexto, no para completar
    }
  }
  
  return deliverables;
}

/**
 * Mapea un valor de industry libre a uno de los valores válidos de la base de datos
 */
function mapIndustryToValidValue(industryValue: string | null): string | null {
  if (!industryValue || typeof industryValue !== 'string') {
    return null;
  }
  
  // Lista de valores válidos según el schema de la base de datos
  const validIndustries = [
    'technology', 'finance', 'healthcare', 'education', 'retail', 
    'manufacturing', 'services', 'hospitality', 'media', 'real_estate', 
    'logistics', 'nonprofit', 'other'
  ];
  
  // Normalizar el valor de entrada (lowercase y trim)
  const normalizedInput = industryValue.toLowerCase().trim();
  
  // Mapeo de patrones comunes a valores válidos
  const industryMappings: { [key: string]: string } = {
    // Technology variations
    'software': 'technology',
    'tech': 'technology',
    'it': 'technology',
    'saas': 'technology',
    'digital': 'technology',
    'programming': 'technology',
    'development': 'technology',
    'computing': 'technology',
    
    // Finance variations
    'banking': 'finance',
    'financial': 'finance',
    'investment': 'finance',
    'fintech': 'finance',
    
    // Healthcare variations
    'medical': 'healthcare',
    'pharma': 'healthcare',
    'pharmaceutical': 'healthcare',
    'health': 'healthcare',
    
    // Education variations
    'learning': 'education',
    'training': 'education',
    'academic': 'education',
    'university': 'education',
    
    // Media variations
    'marketing': 'media',
    'advertising': 'media',
    'content': 'media',
    'publishing': 'media',
    'social media': 'media',
    'digital marketing': 'media',
    
    // Services variations
    'consulting': 'services',
    'professional services': 'services',
    'business services': 'services',
    'support': 'services',
    
    // Sports and other specific cases
    'cycling': 'other',
    'sports': 'other',
    'entertainment': 'media',
    'entrepreneurship': 'other',
    'startup': 'technology',
    
    // Real estate variations
    'property': 'real_estate',
    'real estate': 'real_estate',
    
    // Manufacturing variations
    'production': 'manufacturing',
    'industrial': 'manufacturing',
    
    // Retail variations
    'ecommerce': 'retail',
    'e-commerce': 'retail',
    'sales': 'retail',
    
    // Logistics variations
    'shipping': 'logistics',
    'transportation': 'logistics',
    'supply chain': 'logistics',
    
    // Hospitality variations
    'hotel': 'hospitality',
    'tourism': 'hospitality',
    'travel': 'hospitality',
    'restaurant': 'hospitality'
  };
  
  // Si el valor normalizado ya es válido, retornarlo
  if (validIndustries.includes(normalizedInput)) {
    return normalizedInput;
  }
  
  // Buscar coincidencia exacta en el mapeo
  if (industryMappings[normalizedInput]) {
    return industryMappings[normalizedInput];
  }
  
  // Manejar casos con múltiples industrias separadas por comas
  if (normalizedInput.includes(',')) {
    const industries = normalizedInput.split(',').map(i => i.trim());
    
    // Buscar la primera industria que tenga un mapeo válido
    for (const industry of industries) {
      // Buscar coincidencia exacta
      if (industryMappings[industry]) {
        console.log(`🔧 Found mapping for "${industry}" in multi-industry string: ${industryMappings[industry]}`);
        return industryMappings[industry];
      }
      
      // Buscar coincidencias parciales
      for (const [pattern, mappedValue] of Object.entries(industryMappings)) {
        if (industry.includes(pattern)) {
          console.log(`🔧 Found partial mapping for "${industry}" (contains "${pattern}"): ${mappedValue}`);
          return mappedValue;
        }
      }
    }
  }
  
  // Buscar coincidencias parciales en el input completo
  for (const [pattern, mappedValue] of Object.entries(industryMappings)) {
    if (normalizedInput.includes(pattern)) {
      console.log(`🔧 Found partial mapping for "${normalizedInput}" (contains "${pattern}"): ${mappedValue}`);
      return mappedValue;
    }
  }
  
  // Si no hay coincidencias, retornar 'other' como fallback
  console.log(`🔧 No industry mapping found for "${industryValue}", using fallback: other`);
  return 'other';
}

/**
 * Limpia y valida los campos de company que tienen restricciones de check en la base de datos
 */
function cleanCompanyDataForDatabase(companyData: any): any {
  const cleanedData = { ...companyData };
  
  // Limpiar industry
  if (cleanedData.industry) {
    const originalIndustry = cleanedData.industry;
    cleanedData.industry = mapIndustryToValidValue(originalIndustry);
    
    if (originalIndustry !== cleanedData.industry) {
      console.log(`🔧 Mapped industry from "${originalIndustry}" to "${cleanedData.industry}"`);
    }
  }
  
  // Limpiar size (debe ser uno de los valores válidos)
  if (cleanedData.size) {
    const validSizes = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'];
    if (!validSizes.includes(cleanedData.size)) {
      console.log(`⚠️ Invalid company size "${cleanedData.size}", setting to null`);
      cleanedData.size = null;
    }
  }
  
  // Limpiar annual_revenue (debe ser uno de los valores válidos)
  if (cleanedData.annual_revenue) {
    const validRevenues = ['<1M', '1M-10M', '10M-50M', '50M-100M', '100M-500M', '500M-1B', '>1B'];
    if (!validRevenues.includes(cleanedData.annual_revenue)) {
      console.log(`⚠️ Invalid annual revenue "${cleanedData.annual_revenue}", setting to null`);
      cleanedData.annual_revenue = null;
    }
  }
  
  // Limpiar legal_structure (debe ser uno de los valores válidos)
  if (cleanedData.legal_structure) {
    const validStructures = [
      'sole_proprietorship', 'partnership', 'llc', 'corporation', 'nonprofit', 'cooperative', 
      's_corp', 'c_corp', 'lp', 'llp', 'sa', 'srl', 'gmbh', 'ltd', 'plc', 'bv', 'nv', 'other'
    ];
    if (!validStructures.includes(cleanedData.legal_structure)) {
      console.log(`⚠️ Invalid legal structure "${cleanedData.legal_structure}", setting to null`);
      cleanedData.legal_structure = null;
    }
  }
  
  // Limpiar business_model (debe ser uno de los valores válidos)
  if (cleanedData.business_model) {
    const validModels = ['b2b', 'b2c', 'b2b2c', 'marketplace', 'saas', 'ecommerce', 'other'];
    if (!validModels.includes(cleanedData.business_model)) {
      console.log(`⚠️ Invalid business model "${cleanedData.business_model}", setting to null`);
      cleanedData.business_model = null;
    }
  }
  
  // Limpiar remote_policy (debe ser uno de los valores válidos)
  if (cleanedData.remote_policy) {
    const validPolicies = ['remote_first', 'hybrid', 'office_only', 'flexible'];
    if (!validPolicies.includes(cleanedData.remote_policy)) {
      console.log(`⚠️ Invalid remote policy "${cleanedData.remote_policy}", setting to null`);
      cleanedData.remote_policy = null;
    }
  }
  
  // Validar sustainability_score (debe estar entre 0 y 100)
  if (cleanedData.sustainability_score !== null && cleanedData.sustainability_score !== undefined) {
    const score = parseInt(cleanedData.sustainability_score);
    if (isNaN(score) || score < 0 || score > 100) {
      console.log(`⚠️ Invalid sustainability score "${cleanedData.sustainability_score}", setting to null`);
      cleanedData.sustainability_score = null;
    } else {
      cleanedData.sustainability_score = score;
    }
  }
  
  return cleanedData;
}

/**
 * Workflow to execute lead research using deepResearchWorkflow
 * 
 * Este workflow:
 * 1. Obtiene información del sitio
 * 2. Obtiene información del lead de la base de datos
 * 3. Genera un query de investigación basado en la información del lead
 * 4. Ejecuta deepResearchWorkflow con ese query
 * 5. Retorna los resultados del deep research
 * 
 * @param options - Configuration options for lead research
 */
export async function leadResearchWorkflow(
  options: LeadResearchOptions
): Promise<LeadResearchResult> {
  const { lead_id, site_id } = options;
  
  if (!lead_id) {
    throw new Error('No lead ID provided');
  }
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  // Get workflow information from Temporal to extract schedule ID
  const workflowInfo_real = workflowInfo();
  const realWorkflowId = workflowInfo_real.workflowId;
  const realScheduleId = extractScheduleId(workflowInfo_real);
  
  const workflowId = `lead-research-${lead_id}-${site_id}`;
  const startTime = Date.now();
  
  console.log(`🔍 Starting lead research workflow for lead ${lead_id} on site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));
  console.log(`📋 REAL Workflow ID: ${realWorkflowId} (from Temporal)`);
  console.log(`📋 REAL Schedule ID: ${realScheduleId} (from ${realScheduleId === 'manual-execution' ? 'manual execution' : 'schedule'})`);

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadResearchWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `lead-research-${lead_id}-${site_id}`,
    activityName: 'leadResearchWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let deepResearchResult: any = null;
  let leadInfo: any = null;
  let siteName = '';
  let siteUrl = '';
  let researchQuery = '';

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information to obtain site details
    const siteResult = await getSiteActivity(site_id);
    
    if (!siteResult.success) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    console.log(`👤 Step 2: Getting lead information for ${lead_id}...`);
    
    // Get lead information from database
    const leadResult = await getLeadActivity(lead_id);
    
    if (!leadResult.success) {
      const errorMsg = `Failed to get lead information: ${leadResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    leadInfo = leadResult.lead!;
    
    console.log(`✅ Retrieved lead information: ${leadInfo.name || leadInfo.email} from ${leadInfo.company || leadInfo.company_name || 'Unknown Company'}`);
    console.log(`📋 Lead details:`);
    console.log(`   - Name: ${leadInfo.name || 'N/A'}`);
    console.log(`   - Email: ${leadInfo.email || 'N/A'}`);
    console.log(`   - Company: ${leadInfo.company || leadInfo.company_name || 'N/A'}`);
    console.log(`   - Position: ${leadInfo.job_title || leadInfo.position || 'N/A'}`);
    console.log(`   - Industry: ${leadInfo.industry || 'N/A'}`);
    console.log(`   - Location: ${leadInfo.location || 'N/A'}`);

    console.log(`📧 Step 2.5: Validating and generating lead email if needed...`);
    
    // Validate and generate emails for the lead
    try {
      const emailValidationResult = await validateAndGenerateEmails(leadInfo, site, options);
      
      if (emailValidationResult.success) {
        console.log(`✅ Email validation completed successfully`);
        if (emailValidationResult.validEmail) {
          console.log(`📧 Valid email confirmed: ${emailValidationResult.validEmail}`);
          // Update leadInfo with the validated email for use in research
          if (leadInfo.email !== emailValidationResult.validEmail) {
            leadInfo.email = emailValidationResult.validEmail;
            console.log(`📧 Updated lead email for research context`);
          }
        }
      } else {
        console.log(`⚠️ Email validation failed: ${emailValidationResult.error}`);
        errors.push(`Email validation error: ${emailValidationResult.error}`);
        // Continue with research even if email validation fails
      }
    } catch (emailValidationError) {
      const emailErrorMessage = emailValidationError instanceof Error ? emailValidationError.message : String(emailValidationError);
      console.error(`❌ Email validation exception: ${emailErrorMessage}`);
      errors.push(`Email validation exception: ${emailErrorMessage}`);
      // Continue with research even if email validation throws an error
    }

    console.log(`🔍 Step 3: Generating research query from lead information...`);
    
    // Debug: Log lead info structure before generating query
    console.log(`🔧 Lead company structure:`, JSON.stringify(leadInfo.company, null, 2));
    console.log(`🔧 Lead company_name structure:`, JSON.stringify(leadInfo.company_name, null, 2));
    
    // Estructurar la información del lead como query de búsqueda
    researchQuery = generateLeadResearchQuery(leadInfo);
    
    console.log(`🔧 Generated research query: "${researchQuery}"`);
    
    console.log(`🔬 Step 4: Executing deep research workflow...`);
    
    // Generar deliverables basados en la estructura actual del lead
    const leadDeliverables = generateLeadDeliverables(leadInfo);
    console.log(`📋 Generated deliverables structure:`, JSON.stringify(leadDeliverables, null, 2));
    
    // Preparar opciones para el deep research workflow
    const deepResearchOptions: DeepResearchOptions = {
      site_id: site_id,
      research_topic: researchQuery,
      userId: options.userId || site.user_id,
      deliverables: leadDeliverables,
      scheduleId: realScheduleId, // Pass the schedule ID from parent workflow
      parentWorkflowType: 'leadResearchWorkflow', // Identify the parent workflow type
      additionalData: {
        ...options.additionalData,
        leadId: lead_id,
        leadInfo: leadInfo,
        researchContext: 'lead_research_workflow',
        siteName: siteName,
        siteUrl: siteUrl
      }
    };
    
    // Ejecutar deep research workflow como proceso hijo
    try {
      const deepResearchHandle = await startChild(deepResearchWorkflow, {
        args: [deepResearchOptions],
        workflowId: `deep-research-lead-${lead_id}-${site_id}-${Date.now()}`,
        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON, // ✅ Child continues independently
      });
      
      deepResearchResult = await deepResearchHandle.result();
      
      // Debug: Log complete deep research result structure
      console.log(`🔍 Deep research result structure:`, JSON.stringify(deepResearchResult, null, 2));
      
      if (deepResearchResult.success) {
        console.log(`✅ Deep research completed successfully`);
        console.log(`📊 Deep research results:`);
        console.log(`   - Operations in main level: ${deepResearchResult.operations?.length || 0}`);
        console.log(`   - Operations executed: ${deepResearchResult.operationResults?.length || 0}`);
        console.log(`   - Insights generated: ${deepResearchResult.insights?.length || 0}`);
        console.log(`   - Recommendations: ${deepResearchResult.recommendations?.length || 0}`);
        
        // Process deliverables and analysis for lead and company updates
        let leadDeliverablesToUpdate = null;
        let companyDeliverablesToUpdate = null;
        let analysisForMetadata = null;
        
        // Extract deliverables from the result - structured format
        if (deepResearchResult.data && deepResearchResult.data.deliverables) {
          const deliverables = deepResearchResult.data.deliverables;
          console.log(`📦 Found deliverables in data.deliverables:`, JSON.stringify(deliverables, null, 2));
          
          // Extract lead deliverables
          if (deliverables.lead) {
            leadDeliverablesToUpdate = deliverables.lead;
            console.log(`👤 Found lead deliverables:`, Object.keys(leadDeliverablesToUpdate));
          }
          
          // Extract company deliverables  
          if (deliverables.company) {
            companyDeliverablesToUpdate = deliverables.company;
            console.log(`🏢 Found company deliverables:`, Object.keys(companyDeliverablesToUpdate));
          }
        }
        
        // Extract analysis for metadata - simplified structure
        if (deepResearchResult.data && deepResearchResult.data.analysis) {
          analysisForMetadata = deepResearchResult.data.analysis;
          console.log(`🔍 Found analysis in data.analysis`);
        } else if (deepResearchResult.analysis) {
          analysisForMetadata = deepResearchResult.analysis;
          console.log(`🔍 Found analysis in main level`);
        }
        
        // Step 5a: Update lead if we have lead deliverables or analysis
        if (leadDeliverablesToUpdate || analysisForMetadata) {
          console.log(`🔄 Step 5a: Updating lead with research results...`);
          
          try {
            // Prepare lead update data
            const leadUpdateData: any = {};
            
            // Add lead deliverables
            if (leadDeliverablesToUpdate) {
              const rawLeadDeliverables = leadDeliverablesToUpdate;
              
              // Debug: Log social_networks specifically
              if (rawLeadDeliverables.social_networks) {
                console.log(`🔍 Found social_networks in deliverables:`, JSON.stringify(rawLeadDeliverables.social_networks, null, 2));
              } else {
                console.log(`⚠️ No social_networks found in deliverables`);
              }
              
              // Define campos que SÍ existen en la tabla leads según database.md
              const validLeadFields = [
                'id', 'name', 'email', 'position', 'segment_id', 'status', 'notes', 'last_contact',
                'site_id', 'user_id', 'created_at', 'updated_at', 'phone', 'origin', 'social_networks',
                'address', 'company', 'subscription', 'birthday', 'campaign_id', 'command_id',
                'language', 'company_id', 'attribution', 'metadata'
              ];
              
              // Separar campos válidos de los que van a metadata
              const safeLeadDeliverables: any = {};
              const metadataFields: any = {};
              
              Object.keys(rawLeadDeliverables).forEach(key => {
                if (validLeadFields.includes(key)) {
                  safeLeadDeliverables[key] = rawLeadDeliverables[key];
                  // Debug específico para social_networks
                  if (key === 'social_networks') {
                    console.log(`✅ Adding social_networks to safeLeadDeliverables:`, JSON.stringify(rawLeadDeliverables[key], null, 2));
                  }
                } else {
                  metadataFields[key] = rawLeadDeliverables[key];
                  console.log(`📦 Moving field "${key}" to metadata (not in validLeadFields)`);
                }
              });
              
              // Add safe fields that exist in the table
              Object.assign(leadUpdateData, safeLeadDeliverables);
              
              // Debug: Verificar que social_networks esté en leadUpdateData
              if (leadUpdateData.social_networks) {
                console.log(`✅ social_networks confirmed in leadUpdateData:`, JSON.stringify(leadUpdateData.social_networks, null, 2));
              } else {
                console.log(`❌ social_networks NOT found in leadUpdateData`);
              }
              
              // Handle metadata fields - merge with existing metadata
              if (Object.keys(metadataFields).length > 0) {
                leadUpdateData.metadata = {
                  ...leadInfo.metadata,
                  ...metadataFields,
                  // Agregar timestamp de investigación
                  research_timestamp: new Date().toISOString(),
                  research_source: 'lead_research_workflow'
                };
                console.log(`📦 Adding metadata fields to lead:`, Object.keys(metadataFields));
              }
              
              console.log(`📦 Adding lead deliverables to update:`, Object.keys(safeLeadDeliverables));
            }
            
            // Add analysis to metadata (merge with any existing metadata from deliverables)
            if (analysisForMetadata) {
              leadUpdateData.metadata = {
                ...leadUpdateData.metadata || leadInfo.metadata,
                research_analysis: analysisForMetadata,
                last_research_date: new Date().toISOString(),
                research_workflow_id: workflowId
              };
              console.log(`🔍 Adding analysis to lead metadata`);
            }
            
            if (Object.keys(leadUpdateData).length > 0) {
              const leadUpdateResult = await updateLeadActivity({
                lead_id: lead_id,
                updateData: leadUpdateData,
                safeUpdate: true // Ensure email and phone are not overwritten
              });
              
              if (leadUpdateResult.success) {
                console.log(`✅ Lead updated successfully with research results`);
                console.log(`📊 Updated lead fields: ${Object.keys(leadUpdateData).join(', ')}`);
              } else {
                console.error(`❌ Failed to update lead: ${leadUpdateResult.error}`);
                errors.push(`Lead update failed: ${leadUpdateResult.error}`);
              }
            } else {
              console.log(`⚠️ No lead deliverables or analysis found to update lead`);
            }
          } catch (updateError) {
            const updateErrorMessage = updateError instanceof Error ? updateError.message : String(updateError);
            console.error(`❌ Exception updating lead: ${updateErrorMessage}`);
            errors.push(`Lead update exception: ${updateErrorMessage}`);
          }
        } else {
          console.log(`⚠️ No lead deliverables or analysis found in deep research result`);
        }
        
        // Step 5b: Update company if we have company deliverables
        if (companyDeliverablesToUpdate && companyDeliverablesToUpdate.name) {
          console.log(`🔄 Step 5b: Updating company with research results...`);
          
          try {
            // Clean up company data (remove metadata fields)
            const rawCompanyData = companyDeliverablesToUpdate;
            
            // Define campos que SÍ existen en la tabla companies según database.md
            const validCompanyFields = [
              'id', 'name', 'website', 'industry', 'size', 'annual_revenue', 'founded', 'description', 
              'address', 'created_at', 'updated_at', 'legal_name', 'tax_id', 'tax_country', 
              'registration_number', 'vat_number', 'legal_structure', 'phone', 'email', 'linkedin_url', 
              'employees_count', 'is_public', 'stock_symbol', 'parent_company_id', 'logo_url', 
              'cover_image_url', 'social_media', 'key_people', 'funding_info', 'certifications', 
              'awards', 'business_model', 'products_services', 'tech_stack', 'languages', 
              'business_hours', 'video_url', 'press_releases', 'partnerships', 'competitor_info', 
              'sustainability_score', 'diversity_info', 'remote_policy', 'office_locations', 
              'market_cap', 'last_funding_date', 'ipo_date', 'acquisition_date', 'acquired_by_id'
            ];
            
            // Separar campos válidos de los que van a metadata
            const cleanCompanyData: any = {};
            const metadataFields: any = {};
            
            Object.keys(rawCompanyData).forEach(key => {
              if (validCompanyFields.includes(key)) {
                cleanCompanyData[key] = rawCompanyData[key];
              } else {
                metadataFields[key] = rawCompanyData[key];
              }
            });
            
            // Si hay campos adicionales, añadirlos a metadata
            if (Object.keys(metadataFields).length > 0) {
              // Agregar metadata al objeto de company, no como campo separado
              // Ya que companies no tiene campo metadata según el schema
              console.log(`⚠️ Found ${Object.keys(metadataFields).length} fields not in companies schema: ${Object.keys(metadataFields).join(', ')}`);
              console.log(`📋 These fields will be skipped: ${Object.keys(metadataFields).join(', ')}`);
            }
            
            // If lead has company_id, use it for company identification
            const companyId: string | undefined = leadInfo.company_id;
            if (companyId) {
              cleanCompanyData.id = companyId;
              console.log(`🔗 Using company_id from lead: ${companyId}`);
            }
            
            // Aplicar limpieza adicional para campos con restricciones de check
            const finalCleanCompanyData = cleanCompanyDataForDatabase(cleanCompanyData);
            
            console.log(`🏢 Upserting company: ${finalCleanCompanyData.name}`);
            console.log(`📊 Company fields to update: ${Object.keys(finalCleanCompanyData).join(', ')}`);
            
            const companyUpsertResult = await upsertCompanyActivity(finalCleanCompanyData);
            
            if (companyUpsertResult.success) {
              console.log(`✅ Company updated successfully: ${companyUpsertResult.company.name}`);
              console.log(`🆔 Company ID: ${companyUpsertResult.company.id}`);
              
              // Update lead with company_id if it wasn't set before
              if (!leadInfo.company_id && companyUpsertResult.company.id) {
                try {
                  const leadCompanyUpdateResult = await updateLeadActivity({
                    lead_id: lead_id,
                    updateData: { company_id: companyUpsertResult.company.id },
                    safeUpdate: true
                  });
                  
                  if (leadCompanyUpdateResult.success) {
                    console.log(`✅ Lead updated with company_id: ${companyUpsertResult.company.id}`);
                  } else {
                    console.error(`⚠️ Failed to update lead with company_id: ${leadCompanyUpdateResult.error}`);
                  }
                } catch (companyIdUpdateError) {
                  console.error(`⚠️ Exception updating lead with company_id:`, companyIdUpdateError);
                }
              }
              
              // Si hay campos adicionales, los guardamos en la metadata del lead ya que companies no tiene metadata
              if (Object.keys(metadataFields).length > 0) {
                try {
                  const leadMetadataUpdate = await updateLeadActivity({
                    lead_id: lead_id,
                    updateData: {
                      metadata: {
                        ...leadInfo.metadata,
                        company_additional_fields: metadataFields,
                        company_metadata_updated: new Date().toISOString()
                      }
                    },
                    safeUpdate: true
                  });
                  
                  if (leadMetadataUpdate.success) {
                    console.log(`✅ Additional company fields saved to lead metadata: ${Object.keys(metadataFields).join(', ')}`);
                  } else {
                    console.log(`⚠️ Failed to save additional company fields to lead metadata: ${leadMetadataUpdate.error}`);
                  }
                } catch (metadataError) {
                  console.log(`⚠️ Exception saving additional company fields to lead metadata:`, metadataError);
                }
              }
              
              // Preservar información original de industria si fue mapeada
              if (rawCompanyData.industry && rawCompanyData.industry !== finalCleanCompanyData.industry) {
                try {
                  const originalIndustryUpdate = await updateLeadActivity({
                    lead_id: lead_id,
                    updateData: {
                      metadata: {
                        ...leadInfo.metadata,
                        company_original_industry: rawCompanyData.industry,
                        company_mapped_industry: finalCleanCompanyData.industry,
                        industry_mapping_timestamp: new Date().toISOString()
                      }
                    },
                    safeUpdate: true
                  });
                  
                  if (originalIndustryUpdate.success) {
                    console.log(`✅ Original industry information preserved in lead metadata`);
                  }
                } catch (industryError) {
                  console.log(`⚠️ Exception preserving original industry info:`, industryError);
                }
              }
            } else {
              console.error(`❌ Failed to update company: ${companyUpsertResult.error}`);
              errors.push(`Company update failed: ${companyUpsertResult.error}`);
            }
          } catch (companyUpdateError) {
            const companyUpdateErrorMessage = companyUpdateError instanceof Error ? companyUpdateError.message : String(companyUpdateError);
            console.error(`❌ Exception updating company: ${companyUpdateErrorMessage}`);
            errors.push(`Company update exception: ${companyUpdateErrorMessage}`);
          }
        } else {
          console.log(`ℹ️ No company deliverables found or company name missing - skipping company update`);
        }
        
        if (deepResearchResult.insights && deepResearchResult.insights.length > 0) {
          console.log(`🔍 Research insights:`);
          deepResearchResult.insights.slice(0, 5).forEach((insight: any, index: number) => {
            console.log(`   ${index + 1}. ${insight.title || insight.summary || insight.description || `Insight ${index + 1}`}`);
          });
          if (deepResearchResult.insights.length > 5) {
            console.log(`   ... and ${deepResearchResult.insights.length - 5} more insights`);
          }
        }
        
        if (deepResearchResult.recommendations && deepResearchResult.recommendations.length > 0) {
          console.log(`💡 Research recommendations:`);
          deepResearchResult.recommendations.slice(0, 3).forEach((recommendation: any, index: number) => {
            console.log(`   ${index + 1}. ${recommendation}`);
          });
          if (deepResearchResult.recommendations.length > 3) {
            console.log(`   ... and ${deepResearchResult.recommendations.length - 3} more recommendations`);
          }
        }
      } else {
        console.log(`⚠️ Deep research completed with errors: ${deepResearchResult.errors?.join(', ')}`);
        errors.push(`Deep research errors: ${deepResearchResult.errors?.join(', ')}`);
      }
    } catch (deepResearchError) {
      const errorMessage = deepResearchError instanceof Error ? deepResearchError.message : String(deepResearchError);
      console.error(`⚠️ Deep research workflow failed: ${errorMessage}`);
      errors.push(`Deep research workflow error: ${errorMessage}`);
      // No lanzamos error aquí para que continúe con los resultados parciales
    }

    // Step 6: Execute lead segmentation after research and updates are complete
    let leadSegmentationResult: any = null;
    
    console.log(`🎯 Step 6: Executing lead segmentation...`);
    try {
      const segmentationResult = await leadSegmentationActivity({
        site_id: site_id,
        lead_id: lead_id,
        userId: options.userId || site.user_id,
        additionalData: {
          ...options.additionalData,
          leadInfo: leadInfo,
          siteName: siteName,
          siteUrl: siteUrl,
          researchCompleted: true,
          deepResearchCompleted: !!deepResearchResult,
          workflowId: workflowId
        }
      });
      
      if (segmentationResult.success) {
        leadSegmentationResult = segmentationResult;
        console.log(`✅ Lead segmentation completed successfully`);
        console.log(`🎯 Segmentation data:`, segmentationResult.segmentation ? 'Available' : 'Not available');
      } else {
        console.error(`❌ Lead segmentation failed: ${segmentationResult.error}`);
        errors.push(`Lead segmentation error: ${segmentationResult.error}`);
      }
    } catch (segmentationError) {
      const segmentationErrorMessage = segmentationError instanceof Error ? segmentationError.message : String(segmentationError);
      console.error(`❌ Lead segmentation exception: ${segmentationErrorMessage}`);
      errors.push(`Lead segmentation exception: ${segmentationErrorMessage}`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Deep research result is now already cleaned by the activities - no need for complex cleaning
    let cleanedDeepResearchResult = null;
    if (deepResearchResult) {
      cleanedDeepResearchResult = {
        success: deepResearchResult.success,
        siteId: deepResearchResult.siteId,
        researchTopic: deepResearchResult.researchTopic,
        siteName: deepResearchResult.siteName,
        siteUrl: deepResearchResult.siteUrl,
        operations: deepResearchResult.operations || [],
        operationResults: deepResearchResult.operationResults || [],
        analysis: deepResearchResult.analysis,
        insights: deepResearchResult.insights || [],
        recommendations: deepResearchResult.recommendations || [],
        errors: deepResearchResult.errors || [],
        executionTime: deepResearchResult.executionTime,
        completedAt: deepResearchResult.completedAt
        // Note: We're NOT including the raw 'data' field to avoid nesting
      };
      
      console.log(`🧹 Cleaned result operations count: ${cleanedDeepResearchResult.operations.length}`);
    }
    
    const result: LeadResearchResult = {
      success: true,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      leadInfo,
      deepResearchResult: cleanedDeepResearchResult,
      researchQuery,
      leadSegmentationResult,
      data: cleanedDeepResearchResult, // Use cleaned version instead of raw deepResearchResult
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead research workflow completed successfully!`);
    console.log(`📊 Summary: Lead research for ${leadInfo.name || leadInfo.email} completed in ${executionTime}`);
    console.log(`   - Lead: ${leadInfo.name || leadInfo.email} from ${leadInfo.company || leadInfo.company_name}`);
    console.log(`   - Site: ${siteName}`);
    console.log(`   - Deep research executed: ${deepResearchResult ? 'Yes' : 'No'}`);
    if (cleanedDeepResearchResult) {
      console.log(`   - Operations mapped: ${cleanedDeepResearchResult.operations.length}`);
      console.log(`   - Operation results: ${cleanedDeepResearchResult.operationResults.length}`);
      console.log(`   - Total insights: ${cleanedDeepResearchResult.insights.length}`);
      console.log(`   - Total recommendations: ${cleanedDeepResearchResult.recommendations.length}`);
    }
    console.log(`   - Lead segmentation executed: ${leadSegmentationResult ? 'Yes' : 'No'}`);
    if (leadSegmentationResult?.segmentation) {
      console.log(`   - Segmentation data: Available`);
    }

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-research-${lead_id}-${site_id}`,
      activityName: 'leadResearchWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadResearchWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Lead research workflow failed: ${errorMessage}`);
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-research-${lead_id}-${site_id}`,
      activityName: 'leadResearchWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadResearchWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Throw error to properly fail the workflow
    throw new Error(`Lead research workflow failed: ${errorMessage}`);
  }
} 