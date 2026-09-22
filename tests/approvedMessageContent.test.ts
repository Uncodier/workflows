import { resolveApprovedMessageContent } from '../src/temporal/workflows/helpers/approvedMessageContent';

describe('resolveApprovedMessageContent', () => {
  it('resolves numbered variables for SMS, Telegram, and Voice delivery', () => {
    expect(resolveApprovedMessageContent(
      'Hello {{1}} from {{2}}',
      {
        templated_body: 'Hello {{1}} from {{2}}',
        content_variables: { '1': 'Ana', '2': 'Acme' },
      },
      false
    )).toEqual({ content: 'Hello Ana from Acme', unresolved: [] });
  });

  it('reports missing variables instead of sending placeholders', () => {
    expect(resolveApprovedMessageContent(
      'Hello {{1}} {{2}}',
      { content_variables: { '1': 'Ana' } },
      false
    )).toEqual({ content: 'Hello Ana {{2}}', unresolved: ['{{2}}'] });
  });

  it('preserves WhatsApp template content', () => {
    expect(resolveApprovedMessageContent(
      'Hello {{1}}',
      { content_variables: { '1': 'Ana' } },
      true
    )).toEqual({ content: 'Hello {{1}}', unresolved: [] });
  });
});
