export type ResponseFormat = 'text' | 'audio';

/** Omission is intentional: do not turn legacy delivery into an explicit text send. */
export function responseFormatFields(value: unknown): { response_format?: ResponseFormat } {
  return value === 'text' || value === 'audio' ? { response_format: value } : {};
}

export function customerSupportResponseFormat(data: any, explicit?: ResponseFormat): ResponseFormat | undefined {
  return responseFormatFields(explicit ?? data?.response_format
    ?? data?.messages?.assistant?.response_format
    ?? data?.messages?.assistant?.custom_data?.response_format).response_format;
}