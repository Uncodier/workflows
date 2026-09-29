/** Keep failure metadata until after validation; an empty list is a real success. */
export function extractSocialCommentResponse(response: any): any[] {
  if (!response || response.success === false || response.degraded === true) {
    throw new Error('Social comments response failed or is degraded');
  }
  const payload = response.data;
  if (payload?.success === false || payload?.degraded === true) {
    throw new Error('Social comments response failed or is degraded');
  }
  if (Array.isArray(payload)) return payload;
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    if (!Array.isArray(payload.data)) throw new Error('Invalid social comments data collection');
    return payload.data;
  }
  if (Array.isArray(payload?.comments)) return payload.comments;
  if (Array.isArray(payload?.replies)) return payload.replies;
  if (Array.isArray(payload?.replies?.comments)) return payload.replies.comments;
  throw new Error('Invalid social comments response: expected a comment list');
}