import { buildWhatsAppSendParams } from '../src/temporal/workflows/helpers/buildWhatsAppSendParams';

const MESSAGE_ID = '560f9c02-bf68-42ea-9a1a-e1c5bc50a4fc';
const CONVERSATION_ID = '4b041a57-5868-440a-a6d4-f50a76b4e365';
const LEAD_ID = '3a43f16a-fd45-4794-b531-379a6d17dba0';
const SITE_ID = '353b235b-1242-4e5e-9bfa-f0cf23363483';
const AGENT_ID = '6f206b96-878e-4d2d-832c-de05a9780355';

const whatsappData = {
  phoneNumber: '+5214613123326',
  siteId: SITE_ID,
  conversationId: CONVERSATION_ID,
};

describe('buildWhatsAppSendParams', () => {
  it('maps message_id, conversation_id and lead_id from customer support response', () => {
    const params = buildWhatsAppSendParams({
      csResponse: {
        conversation_id: CONVERSATION_ID,
        lead_id: LEAD_ID,
        messages: {
          assistant: {
            content: '¡Hola, Karla! ¿En qué puedo ayudarte?',
            message_id: MESSAGE_ID,
          },
        },
      },
      whatsappData: { ...whatsappData, conversationId: null },
      agentId: AGENT_ID,
    });

    expect(params).toEqual({
      phone_number: '+5214613123326',
      message: '¡Hola, Karla! ¿En qué puedo ayudarte?',
      site_id: SITE_ID,
      from: 'Customer Support',
      agent_id: AGENT_ID,
      conversation_id: CONVERSATION_ID,
      lead_id: LEAD_ID,
      message_id: MESSAGE_ID,
      responseWindowEnabled: true,
    });
  });

  it('falls back to inbound conversationId when CS response has none', () => {
    const params = buildWhatsAppSendParams({
      csResponse: {
        messages: {
          assistant: {
            content: 'Claro, Karla.',
            message_id: MESSAGE_ID,
          },
        },
      },
      whatsappData,
    });

    expect(params?.conversation_id).toBe(CONVERSATION_ID);
    expect(params?.message_id).toBe(MESSAGE_ID);
    expect(params?.lead_id).toBeUndefined();
  });

  it('returns null when assistant content is missing', () => {
    expect(
      buildWhatsAppSendParams({
        csResponse: {
          conversation_id: CONVERSATION_ID,
          messages: { assistant: { message_id: MESSAGE_ID } },
        },
        whatsappData,
      })
    ).toBeNull();

    expect(
      buildWhatsAppSendParams({
        csResponse: { messages: { assistant: { content: '   ' } } },
        whatsappData,
      })
    ).toBeNull();

    expect(buildWhatsAppSendParams({ csResponse: null, whatsappData })).toBeNull();
  });

  it('omits invalid UUIDs instead of passing tracking placeholders', () => {
    const params = buildWhatsAppSendParams({
      csResponse: {
        conversation_id: 'not-a-uuid',
        lead_id: 'whatsapp-123',
        messages: {
          assistant: {
            content: 'Hola',
            message_id: 'unknown',
          },
        },
      },
      whatsappData: { ...whatsappData, conversationId: undefined },
    });

    expect(params).toMatchObject({
      message: 'Hola',
      responseWindowEnabled: true,
    });
    expect(params?.message_id).toBeUndefined();
    expect(params?.conversation_id).toBeUndefined();
    expect(params?.lead_id).toBeUndefined();
  });
});
