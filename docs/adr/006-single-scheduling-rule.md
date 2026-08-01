# ADR-006 — Graph scheduling by one predecessor rule

**Status:** Accepted
**Date:** 2026-08-01

## Context

Workflows are graphs of nodes an agent executes as one tool call. The engine
needs to decide when each node runs, and what happens to nodes downstream of a
branch that was not taken.

The conventional design gives the graph typed structural nodes: a `parallel`
node that fans out, a `merge` or `join` node that waits, a `branch` node that
splits. Each type carries its own scheduling semantics.

That design accumulates edge cases. What does a merge do when one input was
skipped? What does a parallel node do when one arm fails? Does a join inside a
branch inside a loop wait for the skipped arm? Every combination is a rule, and
the rules interact.

## Decision

There are no structural node types. Scheduling is **one rule**:

> A node becomes **runnable** once every predecessor has settled, and **actually
> runs** if at least one incoming edge fired.

"Settled" means finished in any terminal state — succeeded, failed, or skipped.
"Fired" means the edge's condition was satisfied: an edge out of a condition node
fires on the matching branch, and an unbranched edge fires only on pass.

Everything else falls out of it:

- **Fan-out** — nodes that become runnable together simply run together.
- **Join** — a node with several predecessors waits for all of them, because all
  must settle.
- **Skip propagation** — if no incoming edge fired, the node is skipped and
  settles, which lets *its* successors evaluate the same rule.
- **Branch** — a condition node's `true` and `false` edges fire exclusively, so
  the untaken arm skips and propagates naturally to the join.

Node kinds (`trigger`, `http`, `condition`, `onchain`, `delay`, `transform`,
`loop`) describe **what a node does**, never **when it runs**.

## Consequences

**Positive**

- Concurrency and skip semantics are correct by construction, including in
  nestings nobody explicitly designed for.
- The engine is small enough to test exhaustively; the rule is one predicate.
- Authors cannot construct an invalid topology out of valid nodes, because
  topology is not expressed through node types.
- New node kinds cost nothing in scheduling logic.

**Negative**

- Authors coming from tools with explicit `parallel` and `merge` nodes will look
  for them and not find them. This is a documentation burden.
- Because the rule is implicit, a graph's execution order is not obvious from
  reading it. The visual editor and per-node run history carry that weight.
- The rule genuinely depends on skipped nodes *settling*. A future node kind that
  can neither succeed, fail, nor skip would break it — such a kind must not exist.

## Guards

Scheduling correctness does not imply termination or safety, so:

- Cycles, dangling edges, duplicate ids, and missing entry points are rejected at
  **publish** time, not at run time.
- A run halts at a bounded node-execution count.
- `loop` is bounded.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Typed `parallel` / `merge` nodes | Every combination becomes a special case; skip semantics through a join are ambiguous |
| Sequential-only execution | No fan-out; a workflow is just a list, which the existing `steps` form already covered |
| Data-availability scheduling | Runs a node as soon as its inputs exist; loses the ability to express ordering that is not a data dependency |
| Full dataflow / actor model | Far more machinery than agent workflows need, and much harder to draw |
