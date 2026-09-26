// Parent-only replay fixtures below never start a child (replies are empty).
// Isolate the parent bundle from unrelated customer-support implementations.
export async function ingestSocialCommentWorkflow(): Promise<never> {
  throw new Error('Unexpected child execution in the parent-only Outstand replay fixture');
}