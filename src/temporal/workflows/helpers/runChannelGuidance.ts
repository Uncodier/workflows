import { CancellationScope, isCancellation, proxyActivities, sleep } from '@temporalio/workflow';
import type { Activities } from '../../activities';
import type { ChannelGuidanceContext } from '../../activities/channelGuidanceActivities';
import { channelGuidanceEnabled } from './channelGuidanceVersion';

const { prepareChannelGuidanceActivity, resultChannelGuidanceActivity } =
  proxyActivities<Activities>({ startToCloseTimeout: '15 seconds', retry: { maximumAttempts: 1 } });
const { advanceChannelGuidanceActivity } =
  proxyActivities<Activities>({ startToCloseTimeout: '110 seconds', retry: { maximumAttempts: 1 } });

const MAX_WINDOW_MS = 240_000;
const BUSY_POLL_MS = 4_000;
const MAX_RUNS = 10;
const MAX_SIMULTANEOUS_RUNS = 2;

type MessageData = Record<string, any>;
type BaseParams = { origin?: string; origin_message_id?: string } | undefined;

function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function contextForMessage(messageData: MessageData, baseParams: BaseParams): ChannelGuidanceContext | undefined {
  const providerData = messageData.whatsappData;
  const siteId = nonempty(providerData?.siteId) || nonempty(messageData.site_id) || nonempty(messageData.siteId);
  // A provider's stable inbound id is mandatory. analysis_id / Date.now are not
  // message identifiers, so legacy emails without a provider id simply skip guidance.
  const messageId = nonempty(baseParams?.origin_message_id) || nonempty(messageData.origin_message_id) ||
    nonempty(messageData.messageId) || nonempty(providerData?.messageId);
  const message = nonempty(providerData?.messageContent) || nonempty(messageData.message) ||
    nonempty(messageData.original_text) || nonempty(messageData.summary);
  const origin = nonempty(baseParams?.origin) || nonempty(messageData.origin);
  const channel = origin?.toLowerCase() === 'website_chat' ? 'web' : origin?.toLowerCase();
  if (!siteId || !messageId || !message || !channel) return undefined;
  const conversationId = nonempty(providerData?.conversationId) || nonempty(messageData.conversationId) ||
    nonempty(messageData.conversation_id);
  return { siteId, messageId, channel, ...(conversationId ? { conversationId } : {}), message };
}

/**
 * Durable, bounded pre-response orchestration. The only value crossing into the
 * customer-support API is completed run IDs. The API rechecks site/message ownership
 * and loads bounded guidance server-side; no external message can inject advice.
 */
export async function runChannelGuidance(messageData: MessageData, baseParams: BaseParams): Promise<string[]> {
  if (!channelGuidanceEnabled()) return [];
  const context = contextForMessage(messageData, baseParams);
  if (!context) return [];

  const identity = { siteId: context.siteId, messageId: context.messageId };
  const parentScope = CancellationScope.current();
  const deadlineScope = new CancellationScope({ cancellable: true, timeout: MAX_WINDOW_MS });
  try {
    // Cancels outstanding Temporal activities/timers on timeout, rather than
    // abandoning a raced promise and letting it continue after responding.
    return await deadlineScope.run(async () => {
      const prepared = await prepareChannelGuidanceActivity(context);
      if (!prepared || !Array.isArray(prepared.runs)) return [];

      // Never silently drop a matched plan: all prepared runs must fit the
      // shared API cap, or this message proceeds without any guidance.
      if (prepared.runs.length > MAX_RUNS) return [];
      const seen = new Set<string>();
      const runs = prepared.runs.filter(({ runPlanId }) => {
        if (!nonempty(runPlanId) || seen.has(runPlanId)) return false;
        seen.add(runPlanId);
        return true;
      });
      const completed = new Set<string>();
      let nextRun = 0;

      const worker = async () => {
        while (nextRun < runs.length) {
          const run = runs[nextRun++];
          if (run.status === 'completed') {
            completed.add(run.runPlanId);
            continue;
          }
          if (run.status === 'failed') continue;

          while (true) {
            try {
              const outcome = await advanceChannelGuidanceActivity({ ...identity, runPlanId: run.runPlanId });
              if (outcome.status === 'completed') {
                completed.add(run.runPlanId);
                break;
              }
              if (outcome.status === 'failed' || !['in_progress', 'already_running'].includes(outcome.status)) break;
              await sleep(BUSY_POLL_MS);
            } catch (error) {
              if (isCancellation(error)) throw error;
              console.warn('Channel guidance advance failed; continuing without this run', error);
              break;
            }
          }
        }
      };

      const workers = Promise.all(Array.from({ length: Math.min(MAX_SIMULTANEOUS_RUNS, runs.length) }, worker));
      await workers;
      const runPlanIds = runs.filter(run => completed.has(run.runPlanId)).map(run => run.runPlanId);
      if (!runPlanIds.length) return [];

      // Verify the server can produce guidance from the completed runs. Guidance
      // text itself is never sent as part of the customer-support request.
      const result = await resultChannelGuidanceActivity({ ...identity, channel: context.channel, runPlanIds });
      return typeof result?.guidance === 'string' && result.guidance.trim() ? runPlanIds : [];
    });
  } catch (error) {
    if (isCancellation(error)) {
      // Only our own deadline is fail-open. Parent/workflow cancellation and
      // activity cancellation must never be converted into a successful reply.
      if (parentScope.consideredCancelled || !deadlineScope.consideredCancelled) throw error;
      console.warn('Channel guidance deadline reached; continuing without guidance');
    } else {
      console.warn('Channel guidance unavailable; continuing customer support without guidance', error);
    }
    return [];
  }
}
