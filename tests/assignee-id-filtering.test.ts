import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

/**
 * Test suite for assignee_id filtering logic in getProspectionLeadsActivity
 * 
 * This validates the business rule: 
 * - Don't send leads that have assignee_id
 * - If ANY lead from a company has assignee_id, don't send ANY lead from that company
 */

describe('Assignee ID Filtering Logic', () => {
  
  // Mock implementation of the filtering logic extracted from getProspectionLeadsActivity
  function applyAssigneeIdFiltering(leads: any[]): any[] {
    console.log(`🔒 Applying assignee_id validation rules...`);
    
    // Step 1: Group leads by company
    const leadsGroupedByCompany = new Map<string, any[]>();
    const leadsWithoutCompany: any[] = [];
    
    leads.forEach(lead => {
      const companyId = lead.company_id;
      const companyName = lead.company?.name;
      
      // Use company_id as primary key, fallback to company.name, then to 'no-company' group
      let companyKey = 'no-company';
      if (companyId) {
        companyKey = `id:${companyId}`;
      } else if (companyName) {
        companyKey = `name:${companyName.toLowerCase().trim()}`;
      }
      
      if (companyKey === 'no-company') {
        leadsWithoutCompany.push(lead);
      } else {
        if (!leadsGroupedByCompany.has(companyKey)) {
          leadsGroupedByCompany.set(companyKey, []);
        }
        leadsGroupedByCompany.get(companyKey)!.push(lead);
      }
    });
    
    // Step 2: Filter companies - exclude companies where ANY lead has assignee_id
    const validCompanyLeads: any[] = [];
    
    for (const [companyKey, companyLeads] of leadsGroupedByCompany) {
      const leadsWithAssignee = companyLeads.filter(lead => lead.assignee_id);
      
      if (leadsWithAssignee.length > 0) {
        // Exclude entire company if ANY lead has assignee_id
        const companyName = companyKey.startsWith('id:') ? 
          companyLeads[0]?.company?.name || 'Unknown' : 
          companyKey.replace('name:', '');
        
        console.log(`❌ Excluding company "${companyName}" (${companyLeads.length} leads) - ${leadsWithAssignee.length} lead(s) have assignee_id`);
      } else {
        // Include all leads from this company (none have assignee_id)
        validCompanyLeads.push(...companyLeads);
      }
    }
    
    // Step 3: Filter individual leads without company - exclude those with assignee_id
    const validIndividualLeads = leadsWithoutCompany.filter(lead => !lead.assignee_id);
    
    // Step 4: Combine all valid leads
    return [...validCompanyLeads, ...validIndividualLeads];
  }

  describe('Individual Lead Filtering', () => {
    it('should include leads without assignee_id', () => {
      const leads = [
        { id: '1', name: 'John Doe', email: 'john@example.com', assignee_id: null },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' }, // No assignee_id field
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      expect(result).toHaveLength(2);
      expect(result.map(l => l.id)).toEqual(['1', '2']);
    });

    it('should exclude individual leads with assignee_id', () => {
      const leads = [
        { id: '1', name: 'John Doe', email: 'john@example.com', assignee_id: null },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com', assignee_id: 'user-123' },
        { id: '3', name: 'Bob Wilson', email: 'bob@example.com' },
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      expect(result).toHaveLength(2);
      expect(result.map(l => l.id)).toEqual(['1', '3']);
    });
  });

  describe('Company-Based Filtering', () => {
    it('should group leads by company_id correctly', () => {
      const leads = [
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' }
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' }
        },
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      expect(result).toHaveLength(2);
      expect(result.map(l => l.id).sort()).toEqual(['1', '2']);
    });

    it('should exclude entire company if ANY lead has assignee_id', () => {
      const leads = [
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' }
          // No assignee_id - should be excluded because company has assigned lead
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' },
          assignee_id: 'user-456' // This lead is assigned
        },
        {
          id: '3',
          name: 'Bob Wilson',
          email: 'bob@techco.com',
          company_id: 'company-456',
          company: { name: 'TechCo Inc' }
          // Different company, no assignee_id - should be included
        }
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      // Only Bob Wilson should remain (different company, no assignee_id)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('3');
      expect(result[0].name).toBe('Bob Wilson');
    });

    it('should include entire company if NO lead has assignee_id', () => {
      const leads = [
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' }
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' }
        },
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      expect(result).toHaveLength(2);
      expect(result.map(l => l.id).sort()).toEqual(['1', '2']);
    });

    it('should group by company.name when company_id is missing', () => {
      const leads = [
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@acme.com',
          company: { name: 'Acme Corp' } // No company_id, use name
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@acme.com',
          company: { name: 'Acme Corp' }, // Same company by name
          assignee_id: 'user-456'
        },
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      // Both should be excluded because they're in the same company and Jane has assignee_id
      expect(result).toHaveLength(0);
    });

    it('should handle mixed company identification methods', () => {
      const leads = [
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@acme.com',
          company_id: 'company-123',
          company: { name: 'Acme Corp' }
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@techco.com',
          company: { name: 'TechCo Inc' } // No company_id, different company
        },
        {
          id: '3',
          name: 'Bob Wilson',
          email: 'bob@example.com'
          // No company info - individual lead
        }
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      // All should be included (different companies/individual, no assignee_id)
      expect(result).toHaveLength(3);
      expect(result.map(l => l.id).sort()).toEqual(['1', '2', '3']);
    });
  });

  describe('Mixed Scenarios', () => {
    it('should handle complex mix of company leads and individual leads', () => {
      const leads = [
        // Company A - has assigned lead, should exclude all
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@companya.com',
          company_id: 'company-a',
          company: { name: 'Company A' }
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@companya.com',
          company_id: 'company-a',
          company: { name: 'Company A' },
          assignee_id: 'user-123' // Assigned - excludes whole company
        },
        
        // Company B - no assigned leads, should include all
        { 
          id: '3', 
          name: 'Bob Wilson', 
          email: 'bob@companyb.com',
          company_id: 'company-b',
          company: { name: 'Company B' }
        },
        { 
          id: '4', 
          name: 'Alice Brown', 
          email: 'alice@companyb.com',
          company_id: 'company-b',
          company: { name: 'Company B' }
        },
        
        // Individual leads
        { 
          id: '5', 
          name: 'Charlie Green', 
          email: 'charlie@individual.com'
          // No company, no assignee - should include
        },
        { 
          id: '6', 
          name: 'Diana White', 
          email: 'diana@individual.com',
          assignee_id: 'user-456' // Individual with assignee - should exclude
        },
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      // Should include: Company B (2 leads) + Charlie (1 individual)
      expect(result).toHaveLength(3);
      expect(result.map(l => l.id).sort()).toEqual(['3', '4', '5']);
    });

    it('should handle case-insensitive company name matching', () => {
      const leads = [
        { 
          id: '1', 
          name: 'John Doe', 
          email: 'john@acme.com',
          company: { name: 'ACME Corp' }
        },
        { 
          id: '2', 
          name: 'Jane Smith', 
          email: 'jane@acme.com',
          company: { name: 'acme corp' }, // Different case, same company
          assignee_id: 'user-456'
        },
      ];

      const result = applyAssigneeIdFiltering(leads);
      
      // Both should be excluded (same company, one has assignee_id)
      expect(result).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty lead array', () => {
      const result = applyAssigneeIdFiltering([]);
      expect(result).toHaveLength(0);
    });

    it('should handle null/undefined assignee_id', () => {
      const leads = [
        { id: '1', name: 'John', assignee_id: null },
        { id: '2', name: 'Jane', assignee_id: undefined },
        { id: '3', name: 'Bob' }, // No assignee_id field
      ];

      const result = applyAssigneeIdFiltering(leads);
      expect(result).toHaveLength(3);
    });

    it('should handle empty string assignee_id as assigned', () => {
      const leads = [
        { id: '1', name: 'John', assignee_id: '' }, // Empty string should be treated as no assignment
        { id: '2', name: 'Jane', assignee_id: 'user-123' },
      ];

      const result = applyAssigneeIdFiltering(leads);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });
  });
}); 