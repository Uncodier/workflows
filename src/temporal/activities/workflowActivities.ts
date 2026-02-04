import { upsertSearchAttributes } from '@temporalio/workflow';

export async function upsertLeadSearchAttributesActivity(searchAttributes: Record<string, string[]>): Promise<void> {
  console.log(`⬆️ Upserting lead search attributes:`, searchAttributes);
  upsertSearchAttributes(searchAttributes);
  console.log(`✅ Lead search attributes upserted successfully.`);
}
