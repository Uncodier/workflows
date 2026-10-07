import { patched } from '@temporalio/workflow';
import type { SiteSetupParams } from '../activities/siteSetupActivities';
import { siteSetupLegacyWorkflow } from './siteSetupLegacyWorkflow';
import { runMinimumSiteSetup } from './site-setup/minimum-site-setup';
import type { SiteSetupResult } from './site-setup/setup-result';

export type { SiteSetupResult } from './site-setup/setup-result';

/** New runs accept a saved site ID; retained histories keep their original commands. */
export async function siteSetupWorkflow(params: SiteSetupParams): Promise<SiteSetupResult> {
  if (!patched('site-setup-minimum-data-v1')) {
    return siteSetupLegacyWorkflow(params as Parameters<typeof siteSetupLegacyWorkflow>[0]);
  }
  return runMinimumSiteSetup(params);
}