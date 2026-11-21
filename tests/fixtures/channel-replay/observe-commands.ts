import { defaultPayloadConverter, proxySinks, type WorkflowInterceptorsFactory } from '@temporalio/workflow';

// Core checks command compatibility, not every value: changing only activity
// retries or a workflow's return payload need not cause a nondeterminism error.
// Observe what the real sandbox emitted, without replacing a command or result.
const { trace } = proxySinks<{ trace: { record(command: unknown): void } }>();
export const interceptors: WorkflowInterceptorsFactory = () => ({
  internals: [{
    concludeActivation(input, next) {
      const output = next(input);
      for (const command of output.commands) {
        const a = command.scheduleActivity;
        const c = command.startChildWorkflowExecution;
        if (a) trace.record({ activity: a.activityType, args: a.arguments?.map(p => defaultPayloadConverter.fromPayload(p)),
          attempts: a.retryPolicy?.maximumAttempts });
        if (c) trace.record({ child: c.workflowType, id: c.workflowId, args: c.input?.map(p => defaultPayloadConverter.fromPayload(p)),
          parentClosePolicy: c.parentClosePolicy });
        if (command.setPatchMarker) trace.record({ patch: command.setPatchMarker.patchId });
        if (command.completeWorkflowExecution?.result) trace.record({ returned: defaultPayloadConverter.fromPayload(command.completeWorkflowExecution.result) });
        const failure = command.failWorkflowExecution?.failure;
        if (failure) trace.record({ failed: failure.message, cause: failure.cause?.message,
          failedActivity: failure.activityFailureInfo?.activityType?.name,
          causeType: failure.cause?.applicationFailureInfo?.type || failure.cause?.timeoutFailureInfo?.timeoutType });
      }
      return output;
    },
  }],
});
