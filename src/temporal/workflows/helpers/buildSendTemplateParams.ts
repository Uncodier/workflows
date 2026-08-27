export type BuildSendTemplateActivityParamsInput = {
  template_id: string;
  phone_number: string;
  site_id: string;
  message_id?: string;
  original_message?: string;
  lead_id?: string;
};

export type SendTemplateActivityPayload = {
  template_id: string;
  phone_number: string;
  site_id: string;
  message_id?: string;
  original_message?: string;
  lead_id?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Payload for sendTemplateActivity. Only forwards lead_id when it is a valid UUID
 * so the API can resolve ContentVariables from the template placeholder_map.
 */
export function buildSendTemplateActivityParams(
  input: BuildSendTemplateActivityParamsInput,
): SendTemplateActivityPayload {
  const payload: SendTemplateActivityPayload = {
    template_id: input.template_id,
    phone_number: input.phone_number,
    site_id: input.site_id,
  };
  if (input.message_id) {
    payload.message_id = input.message_id;
  }
  if (input.original_message) {
    payload.original_message = input.original_message;
  }
  if (input.lead_id && UUID_RE.test(input.lead_id)) {
    payload.lead_id = input.lead_id;
  }
  return payload;
}
