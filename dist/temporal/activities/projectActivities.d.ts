export declare function getProjects(): Promise<{
    projects: any[];
    count: number;
    timestamp: Date;
}>;
export declare function schedulePrioritizationEngine(): Promise<{
    scheduled: boolean;
    workflowId: string;
    scheduledFor: Date;
}>;
