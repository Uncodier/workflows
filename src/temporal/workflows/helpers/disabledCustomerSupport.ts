/** Only accept an explicit disabled result after the API persisted the inbound message. */
export function isDisabledCustomerSupportResult(data: any): boolean {
  return data?.agent_disabled === true && data?.response_skipped === true &&
    typeof data?.conversation_id === 'string' && data.conversation_id.length > 0 &&
    typeof data?.messages?.user?.message_id === 'string' && data.messages.user.message_id.length > 0;
}

export function disabledCustomerSupportResult(data: any) {
  return {
    success: true,
    data: {
      ...data,
      processed: true,
      reason: 'Customer support agent is disabled; inbound message saved without an automatic response',
      emailSent: false,
      whatsappSent: false,
      channelMessageSent: false,
    },
  };
}