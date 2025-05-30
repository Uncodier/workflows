import { apiService } from '../services/apiService';

/**
 * Email Activity interfaces
 */
export interface SendEmailParams {
  email: string;
  from: string;
  subject: string;
  message: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId: string;
  recipient: string;
  timestamp: string;
}

/**
 * Activity to send email via agent API
 */
export async function sendEmailFromAgentActivity(params: SendEmailParams): Promise<SendEmailResult> {
  console.log('📧 Sending email from agent:', {
    recipient: params.email,
    from: params.from,
    subject: params.subject,
    messageLength: params.message.length
  });

  try {
    const response = await apiService.post('/api/agents/tools/sendEmail', {
      email: params.email,
      from: params.from,
      subject: params.subject,
      message: params.message
    });

    if (!response.success) {
      throw new Error(`Failed to send email: ${response.error?.message}`);
    }

    console.log('✅ Email sent successfully:', response.data);

    return {
      success: true,
      messageId: response.data.messageId || 'unknown',
      recipient: params.email,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw new Error(`Email sending failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} 