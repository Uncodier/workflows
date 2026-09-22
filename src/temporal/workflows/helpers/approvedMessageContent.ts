export interface ApprovedMessageContent {
  content: string;
  unresolved: string[];
}

export function resolveApprovedMessageContent(
  content: string,
  customData: Record<string, unknown> | null | undefined,
  preserveTemplate: boolean
): ApprovedMessageContent {
  if (preserveTemplate) {
    return { content, unresolved: [] };
  }

  const template =
    typeof customData?.templated_body === 'string'
      ? customData.templated_body
      : content;
  const variables =
    customData?.content_variables
    && typeof customData.content_variables === 'object'
      ? customData.content_variables as Record<string, unknown>
      : {};
  const unresolved: string[] = [];

  const resolved = template.replace(/\{\{(\d+)\}\}/g, (token, index: string) => {
    const value = variables[index];
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    unresolved.push(token);
    return token;
  });

  return { content: resolved, unresolved };
}
