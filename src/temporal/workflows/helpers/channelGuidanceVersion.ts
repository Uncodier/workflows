import { patched } from '@temporalio/workflow';

// Keep this gate at workflow entry: histories without the marker must retain
// their original activity sequence and send arguments, even after resuming.
export function channelGuidanceEnabled(): boolean {
  return patched('customer-support-channel-guidance-v1');
}