/**
 * Test for duplicate lead prevention
 * Tests the createSingleLead function's ability to prevent duplicate leads by name and email
 */

import { supabaseServiceRole } from '../src/lib/supabase/client';

// Mock the lead generation activities module
const mockCreateSingleLead = jest.fn();

// Test data
const testSiteId = 'test-site-duplicate-prevention';
const testUserId = 'test-user-id';

const testLead1 = {
  name: 'John Doe',
  email: 'john.doe@example.com',
  telephone: '+1234567890',
  company_name: 'Test Company',
  position: 'CEO'
};

const testLead2 = {
  name: 'John Doe', // Same name
  email: 'john.different@example.com',
  telephone: '+0987654321',
  company_name: 'Another Company',
  position: 'CTO'
};

const testLead3 = {
  name: 'Jane Smith',
  email: 'john.doe@example.com', // Same email
  telephone: '+1111111111',
  company_name: 'Different Company',
  position: 'Manager'
};

describe('Duplicate Lead Prevention', () => {
  beforeAll(async () => {
    // Clean up any existing test data
    await supabaseServiceRole
      .from('leads')
      .delete()
      .eq('site_id', testSiteId);
  });

  afterAll(async () => {
    // Clean up test data
    await supabaseServiceRole
      .from('leads')
      .delete()
      .eq('site_id', testSiteId);
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });

  test('should create first lead successfully', async () => {
    // Import the actual function for testing
    const { createSingleLead } = await import('../src/temporal/activities/leadGenerationActivities');
    
    const result = await (createSingleLead as any)(testLead1, testSiteId, testUserId);
    
    expect(result.success).toBe(true);
    expect(result.leadId).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  test('should prevent duplicate lead by name', async () => {
    // Import the actual function for testing
    const { createSingleLead } = await import('../src/temporal/activities/leadGenerationActivities');
    
    const result = await (createSingleLead as any)(testLead2, testSiteId, testUserId);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(result.error).toContain('name');
    expect(result.leadId).toBeUndefined();
  });

  test('should prevent duplicate lead by email', async () => {
    // Import the actual function for testing  
    const { createSingleLead } = await import('../src/temporal/activities/leadGenerationActivities');
    
    const result = await (createSingleLead as any)(testLead3, testSiteId, testUserId);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(result.error).toContain('email');
    expect(result.leadId).toBeUndefined();
  });

  test('should allow lead with different name and email', async () => {
    // Import the actual function for testing
    const { createSingleLead } = await import('../src/temporal/activities/leadGenerationActivities');
    
    const uniqueLead = {
      name: 'Maria Garcia',
      email: 'maria.garcia@example.com',
      telephone: '+5555555555',
      company_name: 'Unique Company',
      position: 'Director'
    };
    
    const result = await (createSingleLead as any)(uniqueLead, testSiteId, testUserId);
    
    expect(result.success).toBe(true);
    expect(result.leadId).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  test('should allow same lead name/email in different sites', async () => {
    // Import the actual function for testing
    const { createSingleLead } = await import('../src/temporal/activities/leadGenerationActivities');
    
    const differentSiteId = 'different-site-id';
    
    // Try to create the same lead in a different site
    const result = await (createSingleLead as any)(testLead1, differentSiteId, testUserId);
    
    expect(result.success).toBe(true);
    expect(result.leadId).toBeDefined();
    expect(result.error).toBeUndefined();
    
    // Clean up
    await supabaseServiceRole
      .from('leads')
      .delete()
      .eq('site_id', differentSiteId);
  });

  test('should handle lead without email (name-only validation)', async () => {
    // Import the actual function for testing
    const { createSingleLead } = await import('../src/temporal/activities/leadGenerationActivities');
    
    const leadWithoutEmail = {
      name: 'Phone Only Contact',
      telephone: '+9999999999',
      company_name: 'Phone Company',
      position: 'Contact'
    };
    
    // First creation should succeed
    const result1 = await (createSingleLead as any)(leadWithoutEmail, testSiteId, testUserId);
    expect(result1.success).toBe(true);
    
    // Second creation with same name should fail
    const result2 = await (createSingleLead as any)(leadWithoutEmail, testSiteId, testUserId);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('already exists');
    expect(result2.error).toContain('name');
  });
}); 