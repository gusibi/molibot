# Findings

- PlanService and durable store already own plan records, versions and controls.
- Session execution mirrors plan_progress into the durable read model. Keep this execution architecture.
- Workspace continue currently opens source Session; rework only appends; query caps before filtering and UI polls.
- Room production behavior exists; complete native acceptance pending.
- MCP production Pi client exists; multi-page fixture missing.
- Pre-existing untracked desktop logos belong to other work and must stay out of this commit.

Owner decision: plans execute through the existing Durable Execution runtime; Session is presentation/feedback. This supersedes the prior ordinary-turn execution paragraph in DESIGN. Reuse fresh attempt contexts, existing leases, approvals, recovery decisions and verification. Preserve immutable source and record explicit receiving Session separately.
