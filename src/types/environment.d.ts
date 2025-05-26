declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Temporal Configuration
      TEMPORAL_SERVER_URL: string;
      TEMPORAL_NAMESPACE: string;
      WORKFLOW_TASK_QUEUE: string;
      TEMPORAL_API_KEY?: string;
      TEMPORAL_TLS?: string;
      
      // Supabase Configuration
      SUPABASE_URL?: string;
      SUPABASE_KEY?: string;
      
      // API Configuration
      API_BASE_URL?: string;
      API_KEY?: string;
      
      // Application Configuration
      LOG_LEVEL?: string;
    }
  }
}

export {}; 