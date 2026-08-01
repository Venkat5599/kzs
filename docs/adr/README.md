# Architecture Decision Records

One file per decision, numbered and immutable. A decision is not edited once
accepted — it is **superseded** by a later ADR that references it.

Format: Context · Decision · Consequences · Alternatives considered.

| ADR | Title | Status |
|---|---|---|
| [001](./001-branchless-authorization.md) | Branchless authorization instead of reverting comparisons | Accepted |
| [002](./002-fail-closed.md) | Fail closed on an unreadable authorization flag | Accepted |
| [003](./003-epoch-batching.md) | Batch debits into epochs rather than settling per call | Accepted |
| [004](./004-single-relayer.md) | Single gateway relayer, with the exposure documented | Accepted |
| [005](./005-unchanged-wire-formats.md) | Keep x402 and MCP wire formats unchanged | Accepted |
| [006](./006-single-scheduling-rule.md) | Graph scheduling by one predecessor rule | Accepted |

## Writing a new ADR

Copy the shape of an existing file. Number it sequentially. Add a row above.

An ADR is worth writing when the decision is **hard to reverse**, **surprising
to a newcomer**, or **the subject of a real disagreement**. Routine choices do
not need one.
