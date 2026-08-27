import { buildSendTemplateActivityParams } from '../src/temporal/workflows/helpers/buildSendTemplateParams';

const TEMPLATE_ID = 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SITE_ID = '353b235b-1242-4e5e-9bfa-f0cf23363483';
const LEAD_ID = '3a43f16a-fd45-4794-b531-379a6d17dba0';
const MESSAGE_ID = '560f9c02-bf68-42ea-9a1a-e1c5bc50a4fc';

describe('buildSendTemplateActivityParams', () => {
  it('includes lead_id when it is a valid UUID', () => {
    const params = buildSendTemplateActivityParams({
      template_id: TEMPLATE_ID,
      phone_number: '+5214612980112',
      site_id: SITE_ID,
      message_id: MESSAGE_ID,
      original_message: 'Hola {{lead.name}}',
      lead_id: LEAD_ID,
    });

    expect(params.lead_id).toBe(LEAD_ID);
    expect(params.template_id).toBe(TEMPLATE_ID);
    expect(params.original_message).toBe('Hola {{lead.name}}');
  });

  it('omits lead_id when missing or not a UUID', () => {
    expect(
      buildSendTemplateActivityParams({
        template_id: TEMPLATE_ID,
        phone_number: '+5214612980112',
        site_id: SITE_ID,
      }).lead_id,
    ).toBeUndefined();

    expect(
      buildSendTemplateActivityParams({
        template_id: TEMPLATE_ID,
        phone_number: '+5214612980112',
        site_id: SITE_ID,
        lead_id: 'not-a-uuid',
      }).lead_id,
    ).toBeUndefined();
  });
});
