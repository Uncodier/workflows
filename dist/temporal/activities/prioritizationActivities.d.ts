export declare function getContext(): Promise<{
    context: string;
    timestamp: Date;
}>;
export declare function designPlan(context: string): Promise<{
    plan: string;
    activities: string[];
}>;
export declare function sendPlan(_plan: string): Promise<{
    sent: boolean;
    recipients: string[];
}>;
export declare function sendPriorityMail(activities: string[]): Promise<{
    sent: boolean;
    count: number;
}>;
export declare function scheduleActivities(activities: string[]): Promise<{
    scheduled: boolean;
    apiCalls: number;
}>;
