// Schedule Manager - Auto-registration utility
import { createAllSchedules, listSchedules } from '../temporal/schedules';

let schedulesInitialized = false;
let initializationPromise: Promise<void> | null = null;

export async function ensureSchedulesExist(): Promise<{ 
  initialized: boolean; 
  schedules: string[]; 
  error?: string 
}> {
  console.log('🔍 Checking if schedules need initialization...');
  
  // If already initialized, return immediately
  if (schedulesInitialized) {
    console.log('✅ Schedules already initialized');
    return { initialized: true, schedules: [] };
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    console.log('⏳ Waiting for ongoing initialization...');
    await initializationPromise;
    return { initialized: schedulesInitialized, schedules: [] };
  }

  // Start initialization
  console.log('🚀 Starting schedule initialization...');
  initializationPromise = initializeSchedules();
  
  try {
    await initializationPromise;
    return { initialized: schedulesInitialized, schedules: [] };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Schedule initialization failed:', errorMessage);
    return { 
      initialized: false, 
      schedules: [], 
      error: errorMessage 
    };
  } finally {
    initializationPromise = null;
  }
}

async function initializeSchedules(): Promise<void> {
  try {
    console.log('📋 Checking existing schedules...');
    
    // First, try to list existing schedules to see what's already there
    let existingSchedules: any[] = [];
    try {
      existingSchedules = await listSchedules();
      console.log(`📊 Found ${existingSchedules.length} existing schedules`);
    } catch (listError) {
      console.log('⚠️ Could not list existing schedules, will attempt to create all:', listError);
    }

    // If we have schedules, we might be good to go
    if (existingSchedules.length >= 3) {
      console.log('✅ Sufficient schedules already exist, marking as initialized');
      schedulesInitialized = true;
      return;
    }

    // Create missing schedules
    console.log('🔧 Creating missing schedules...');
    const result = await createAllSchedules();
    
    if (result.success.length > 0) {
      console.log(`✅ Successfully created ${result.success.length} schedules`);
      schedulesInitialized = true;
    } else if (result.failed.length > 0) {
      // Check if failures are due to schedules already existing
      const alreadyExistErrors = result.failed.filter(f => 
        f.error.includes('already exists') || f.error.includes('Schedule already exists')
      );
      
      if (alreadyExistErrors.length === result.failed.length) {
        console.log('✅ All schedules already exist, marking as initialized');
        schedulesInitialized = true;
      } else {
        throw new Error(`Failed to create schedules: ${result.failed.map(f => f.error).join(', ')}`);
      }
    }
    
  } catch (error) {
    console.error('💥 Schedule initialization error:', error);
    throw error;
  }
}

// Reset initialization state (useful for testing)
export function resetScheduleInitialization(): void {
  schedulesInitialized = false;
  initializationPromise = null;
  console.log('🔄 Schedule initialization state reset');
} 