export declare function getPerformance(): Promise<{
    metrics: any;
    timestamp: Date;
    summary: string;
}>;
export declare function sendDayReport(metrics: any, summary: string): Promise<{
    sent: boolean;
    recipients: string[];
    reportId: string;
}>;
