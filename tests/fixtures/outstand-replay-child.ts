// Parent-only replay consumes child completion events from synthetic history;
// it must never execute customer support or live activities.
export async function ingestSocialCommentWorkflow(): Promise<never> {
  throw new Error('Unexpected child execution in the parent-only Outstand replay fixture');
}