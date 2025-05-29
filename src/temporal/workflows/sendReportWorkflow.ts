import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// Configure activity options
const { getPerformance, sendDayReport } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * Send Report Workflow
 * Generates and sends daily performance reports
 */
export async function sendReportWorkflow(): Promise<{
  performanceRetrieved: boolean;
  reportSent: boolean;
  reportId: string;
  recipientCount: number;
  executionTime: string;
}> {
  console.log('📊 Starting send report workflow...');
  const startTime = new Date();

  try {
    // Step 1: Get performance metrics
    console.log('📈 Step 1: Getting performance metrics...');
    const performanceResult = await getPerformance();
    console.log('✅ Performance metrics retrieved successfully');

    // Step 2: Send day report
    console.log('📤 Step 2: Sending daily report...');
    const reportResult = await sendDayReport(
      performanceResult.metrics,
      performanceResult.summary
    );
    console.log(`✅ Report sent to ${reportResult.recipients.length} recipients`);
    console.log(`📋 Report ID: ${reportResult.reportId}`);

    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

    console.log('🎉 Send report workflow completed successfully');
    return {
      performanceRetrieved: true,
      reportSent: reportResult.sent,
      reportId: reportResult.reportId,
      recipientCount: reportResult.recipients.length,
      executionTime
    };

  } catch (error) {
    console.error('❌ Send report workflow failed:', error);
    throw error;
  }
} 