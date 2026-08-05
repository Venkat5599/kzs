import { attemptAsync, notFound, type Result } from "@kairos/shared";
import {
  executeGraph,
  graphFromSteps,
  validateGraph,
  type NodeRun,
  type RunResult,
  type StepHandlers,
  type WorkflowGraph,
  type WorkflowStep,
} from "@kairos/workflow";

/**
 * @kairos/execution — running workflows end to end.
 *
 * The engine (`@kairos/workflow`) is pure; this service binds it to the
 * gateway: it accepts a workflow (graph or flat steps), validates it, executes
 * with injected handlers, and hands the trace to a recorder so `/fabric/runs`
 * has something to list.
 */

export interface ExecutionOptions {
  /** Hard stop on node executions per run. */
  maxNodeExecutions?: number;
  /** Upper bound on times a single node may be visited (loop guard). */
  maxLoopItems?: number;
  /** Called with every completed run so the host can persist it. */
  record?: (run: RunRecord) => void;
}

export interface RunRecord {
  id: string;
  workflow: string;
  input: unknown;
  result: RunResult;
  at: string;
}

export interface ExecutionService {
  run(
    workflow: { name?: string; slug?: string; graph?: WorkflowGraph; steps?: WorkflowStep[] },
    input: Record<string, unknown>,
    handlers: StepHandlers,
  ): Promise<Result<RunRecord, ReturnType<typeof notFound>>>;
  record(run: RunRecord): void;
}

/** Build a record id from the run so retries are idempotent-ish. */
function recordId(): string {
  return crypto.randomUUID();
}

export function createExecutionService(options: ExecutionOptions = {}): ExecutionService {
  let recorded: RunRecord[] = [];

  const service: ExecutionService = {
    record(run: RunRecord): void {
      recorded.unshift(run);
      if (recorded.length > 100) recorded.pop();
    },

    async run(workflow, input, handlers) {
      return attemptAsync(async () => {
        let graph: WorkflowGraph;
        if (workflow.graph) {
          graph = workflow.graph;
        } else if (workflow.steps) {
          graph = graphFromSteps(workflow.steps);
        } else {
          throw notFound("workflow has neither a graph nor steps");
        }

        const validation = validateGraph(graph);
        if (!validation.ok) {
          throw notFound(`invalid workflow graph: ${validation.reason}`);
        }

        const result: RunResult = await executeGraph(graph, input, handlers, {
          ...(options.maxNodeExecutions !== undefined ? { maxNodeExecutions: options.maxNodeExecutions } : {}),
          ...(options.maxLoopItems !== undefined ? { maxLoopItems: options.maxLoopItems } : {}),
        });

        const run: RunRecord = {
          id: recordId(),
          workflow: workflow.slug ?? workflow.name ?? "untitled",
          input,
          result,
          at: new Date().toISOString(),
        };
        service.record(run);
        options.record?.(run);
        return run;
      });
    },
  };

  return service;
}

/** Summarize a trace for display — statuses and the first error, no payloads. */
export function summarizeTrace(trace: NodeRun[]): { nodes: number; ok: number; error: number; skipped: number; firstError?: string } {
  const summary = { nodes: trace.length, ok: 0, error: 0, skipped: 0 };
  for (const t of trace) {
    if (t.status === "ok") summary.ok += 1;
    else if (t.status === "error") summary.error += 1;
    else summary.skipped += 1;
  }
  const failed = trace.find((t) => t.status === "error");
  return { ...summary, ...(failed ? { firstError: failed.error } : {}) };
}
