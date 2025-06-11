# ICP Workflow Refactoring - Robust Segment Processing

## 📖 Overview

The ICP (Ideal Customer Profile) workflow has been refactored to improve robustness and reliability by processing segments individually instead of all at once. This change makes the system more resilient to failures and provides better error handling.

## 🔄 Changes Made

### 1. Created a Sub-Workflow for Individual Segment Processing

**File**: `src/temporal/workflows/buildSegmentsICPWorkflow.ts`

- **New Function**: `buildSingleSegmentICPWorkflow`
- **Purpose**: Processes one ICP segment at a time
- **Benefits**: 
  - Better error isolation
  - Improved logging and tracking
  - Individual segment retry capability

### 2. Refactored Main ICP Workflow

**Modified Function**: `buildSegmentsICPWorkflow`

**Key Changes**:
- Now processes segments sequentially instead of all at once
- Uses `startChild` to spawn child workflows for each segment
- Includes a 5-second delay between segment processing
- Better error handling and partial success reporting
- Enhanced analysis reporting with individual segment results

### 3. Updated Build Segments Workflow

**File**: `src/temporal/workflows/buildSegmentsWorkflow.ts`

- Modified to use the new robust ICP workflow as a child workflow
- Replaced direct `buildICPSegmentsActivity` call with `buildSegmentsICPWorkflow` child workflow
- Improved error handling and logging

## 🏗️ Architecture

```
buildSegmentsWorkflow
  ├── buildNewSegmentsActivity (general segments)
  └── buildSegmentsICPWorkflow (child workflow)
      ├── buildSingleSegmentICPWorkflow (child 1)
      ├── buildSingleSegmentICPWorkflow (child 2)
      └── ... (one per segment)
```

## 🔧 New Interfaces

### BuildSingleSegmentICPOptions
```typescript
interface BuildSingleSegmentICPOptions {
  siteId: string;
  userId?: string;
  segmentId: string;
  segmentName?: string;
  aiProvider?: 'openai' | 'anthropic' | 'gemini';
  aiModel?: string;
}
```

### BuildSingleSegmentICPResult
```typescript
interface BuildSingleSegmentICPResult {
  success: boolean;
  siteId: string;
  segmentId: string;
  segmentName?: string;
  icpSegment?: any;
  analysis?: any;
  error?: string;
  executionTime: string;
  completedAt: string;
}
```

## 📊 Enhanced Reporting

The new workflow provides detailed reporting including:

- **Individual segment results**: Success/failure for each segment
- **Combined analysis**: Aggregated results from all processed segments
- **Partial success handling**: Workflow succeeds if at least one segment is processed
- **Detailed error tracking**: Specific errors for each failed segment

## 🎯 Benefits

1. **Improved Resilience**: If one segment fails, others can still be processed
2. **Better Debugging**: Clear logging for each segment processing step
3. **Partial Success**: Workflow can succeed even if some segments fail
4. **Resource Management**: 5-second delays prevent overwhelming the system
5. **Better Monitoring**: Individual workflow tracking for each segment

## 🧪 Testing

A test script has been created to validate the new functionality:

**File**: `src/scripts/test-build-segments-icp.ts`

Run the test:
```bash
npx ts-node src/scripts/test-build-segments-icp.ts
```

The test validates both:
- The main `buildSegmentsICPWorkflow`
- The individual `buildSingleSegmentICPWorkflow`

## 🚀 Usage

### Direct ICP Workflow Execution
```typescript
const result = await client.workflow.start(workflows.buildSegmentsICPWorkflow, {
  taskQueue: 'default',
  workflowId: 'build-segments-icp-' + Date.now(),
  args: [{
    site_id: "your-site-id",
    userId: "your-user-id",
    segmentIds: ["segment-1", "segment-2"], // Optional
    aiProvider: "openai",
    aiModel: "gpt-4"
  }],
});
```

### Individual Segment Processing
```typescript
const result = await client.workflow.start(workflows.buildSingleSegmentICPWorkflow, {
  taskQueue: 'default',
  workflowId: 'build-single-segment-icp-' + Date.now(),
  args: [{
    siteId: "your-site-id",
    segmentId: "your-segment-id",
    userId: "your-user-id"
  }],
});
```

## 📝 Migration Notes

- The public API remains the same for `buildSegmentsICPWorkflow`
- Existing scheduled workflows will automatically use the new robust implementation
- No database schema changes required
- Backward compatible with existing integrations

## 🔍 Monitoring

New workflow types for monitoring:
- `buildSegmentsICPWorkflow`: Main ICP workflow
- `buildSingleSegmentICPWorkflow`: Individual segment processing

Both workflows log comprehensive execution details and can be monitored through Temporal UI.

---

**Last Updated**: $(date)
**Version**: 1.0.0
**Author**: Assistant 