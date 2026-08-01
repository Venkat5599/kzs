# @kairos/shared

Types, the error taxonomy, and the authorization verdict rule.

Depends on nothing in the workspace and never will — every other package is
allowed to import this one, so a dependency here would create a cycle through
the whole tree.

The important file is `src/authorization.ts`. It encodes the rule that a verdict
which cannot be read is a refusal, and its test suite is permanently required
(see `docs/PROJECT_STRUCTURE.md` §8).
