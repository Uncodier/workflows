import type { processSingleIcp } from './processSingle';
import { isIcpCreditFailure } from '../../utils/icpDispatchSelection';

/** New histories: exact lead target, partial-page resume and cumulative completion. */
export async function processConfiguredIcp(args: Parameters<typeof processSingleIcp>[0]) {
  const { icp, options, maxPages, targetLeadsWithEmail, actualUserId, deps } = args;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 300) {
    throw new Error('ICP maxPages must be an integer between 1 and 300');
  }
  const pageSize = 10;
  const previousProcessed = Math.max(0, Number(icp.processed_targets) || 0);
  const previousFound = Math.max(0, Number(icp.found_matches) || 0);
  let totalTargets: number | undefined = Number(icp.total_targets) > 0 ? Number(icp.total_targets) : undefined;
  const hasCursor = Number.isInteger(icp.current_page_offset);
  // Historical full-page executions stored their page before incrementing it.
  let currentPage = hasCursor ? Number(icp.current_page) || 0
    : Math.max(Math.ceil(previousProcessed / pageSize), Number(icp.current_page) || 0);
  let startIndex = hasCursor ? icp.current_page_offset : 0;
  let processed = 0;
  let foundMatches = 0;
  let exhausted = false;
  const errors: string[] = [];
  const persist = async (update: Parameters<typeof deps.updateIcpMiningProgressActivity>[0]) => {
    const result = await deps.updateIcpMiningProgressActivity(update);
    if (!result.success) throw new Error(`ICP progress was not saved: ${result.error}`);
  };
  const started = await deps.markIcpMiningStartedActivity({ id: icp.id });
  if (!started.success) throw new Error(`ICP could not start: ${started.error}`);

  for (let pages = 0; pages < maxPages && foundMatches < targetLeadsWithEmail; pages++) {
    if (totalTargets !== undefined && previousProcessed + processed >= totalTargets) {
      exhausted = true;
      break;
    }
    let result;
    try {
      result = await deps.executePageSearch({
        role_query_id: icp.role_query_id,
        page: currentPage,
        page_size: pageSize,
        site_id: options.site_id,
        userId: actualUserId,
        icp_mining_id: icp.id,
        start_index: startIndex,
        max_matches: targetLeadsWithEmail - foundMatches,
        research_enabled: options.researchEnabled === true,
        ...(options.icpCreditGuard ? { stop_on_credit_failure: true } : {}),
      });
    } catch (error) {
      errors.push(`Page ${currentPage} failed: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }

    if (typeof result.total === 'number' && result.total >= 0) totalTargets = result.total;
    processed += result.processed;
    foundMatches += result.foundMatches;
    errors.push(...result.errors);
    const pageComplete = result.pageCompleted !== false;
    const nextPage = pageComplete ? currentPage + 1 : currentPage;
    const nextIndex = pageComplete ? 0 : startIndex + result.processed;
    await persist({
      id: icp.id,
      processedTargets: previousProcessed + processed,
      foundMatches: previousFound + foundMatches,
      currentPage: result.processed > 0 || result.success ? nextPage : currentPage,
      currentPageOffset: result.processed > 0 || result.success ? nextIndex : startIndex,
      ...(totalTargets !== undefined ? { totalTargets } : {}),
    });
    await deps.logWorkflowExecutionActivity({
      workflowId: args.workflowId, workflowType: 'idealClientProfileMiningWorkflow', status: 'INFO',
      output: { page: currentPage, processed, foundMatches, targetLeadsWithEmail, researchEnabled: options.researchEnabled },
    });
    // A failed fetch must not advance the cursor or turn an API error into completion.
    if ((options.icpCreditGuard && errors.some(isIcpCreditFailure)) || (!result.success && result.processed === 0)) break;
    exhausted = (pageComplete && !result.hasMore)
      || (totalTargets !== undefined && previousProcessed + processed >= totalTargets);
    if (exhausted || foundMatches >= targetLeadsWithEmail) break;
    if (!pageComplete && result.processed === 0) {
      errors.push(`Page ${currentPage} made no progress`);
      break;
    }
    currentPage = nextPage;
    startIndex = pageComplete ? 0 : startIndex + result.processed;
  }

  for (const error of errors) await persist({ id: icp.id, appendError: error });
  const lastError = errors.length ? errors.join('; ') : null;
  if (exhausted) {
    const completed = await deps.markIcpMiningCompletedActivity({ id: icp.id, failed: false, last_error: lastError });
    if (!completed.success) throw new Error(`ICP completion was not saved: ${completed.error}`);
  } else {
    await persist({ id: icp.id, status: 'pending', last_error: lastError });
  }
  return { processed, foundMatches, totalTargets, errors };
}