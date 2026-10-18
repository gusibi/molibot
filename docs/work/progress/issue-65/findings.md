# Findings

- PlanService and durable store already own plan records, versions and controls.
- Session execution mirrors plan_progress into the durable read model. Keep this execution architecture.
- Workspace continue currently opens source Session; rework only appends; query caps before filtering and UI polls.
- Room production behavior exists; complete native acceptance pending.
- MCP production Pi client exists; multi-page fixture missing.
- Pre-existing untracked desktop logos belong to other work and must stay out of this commit.

Owner decision: plans execute through the existing Durable Execution runtime; Session is presentation/feedback. This supersedes the prior ordinary-turn execution paragraph in DESIGN. Reuse fresh attempt contexts, existing leases, approvals, recovery decisions and verification. Preserve immutable source and record explicit receiving Session separately.

## 2026-10-18 audit

A and MCP pagination were implemented in 18290993. The actual outstanding evidence was native acceptance. Native Room recovery exposed a real entry-path defect: the Room API required an in-memory active runner for a persisted recovery decision, while the old integration fixture called the generic Desktop broker directly. A second restart also removed Room recovery ownership because piRecoveryCandidates retained review records but returned only running records. Both are now guarded through the production Room HTTP handler and two real restart cycles.

The plan API regression also exposed Durable startup outside liveServicesDisabled. Its worker consumed queued test plans without channel managers and kept the test process alive. Startup and background delivery reconciliation now share the existing disabled-live-services rule.

Native core paths are verified; microphone recording is awaiting explicit permission. See validation-2026-10-18.md for evidence and unperformed cases.
