import { apiService } from '../services/apiService';

export interface LookEmailOnIcyPeasOptions {
  domainOrCompany: string;
  firstname?: string;
  lastname?: string;
  customobject?: any;
}

export interface LookEmailOnIcyPeasResult {
  success: boolean;
  data?: {
    email: string;
    confidence: number;
    status: string;
    [key: string]: any;
  };
  error?: string;
}

/**
 * Activity to search for an email using IcyPeas integration
 */
export async function lookEmailOnIcyPeas(
  options: LookEmailOnIcyPeasOptions
): Promise<LookEmailOnIcyPeasResult> {
  const { domainOrCompany, firstname, lastname, customobject } = options;

  try {
    if (!domainOrCompany) {
      return { success: false, error: 'domainOrCompany is required' };
    }

    if (!firstname && !lastname) {
      return { success: false, error: 'Either firstname or lastname is required' };
    }

    const requestBody = {
      domainOrCompany,
      firstname,
      lastname,
      customobject,
    };

    console.log(`🔍 Calling IcyPeas email search for: ${firstname} ${lastname} @ ${domainOrCompany}`);

    const response = await apiService.post('/api/integrations/icypeas/email-search', requestBody);

    if (!response.success) {
      return { 
        success: false, 
        error: response.error?.message || 'IcyPeas email search failed' 
      };
    }

    const payload = response.data?.data || response.data;

    if (!payload || !payload.email) {
      return { success: true, data: undefined };
    }

    return { 
      success: true, 
      data: payload 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error in lookEmailOnIcyPeas: ${message}`);
    return { success: false, error: message };
  }
}
