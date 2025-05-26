export interface WorkflowExecutionLog {
  workflowId: string;
  workflowType: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
} 