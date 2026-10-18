# Issue 65 implementation

Base: 917fc272. Scope: issue #65 A/B; C stays deferred.

1. Inspect Session execution, plan ownership and existing public API test fixtures. Complete.
   Owner approved Durable execution instead of ordinary Session turns.
2. Agree DESIGN/PRD behavior; implement plan query/events and editing with regression tests.
3. Implement Session handoff and controls through shared execution with regression tests.
4. Implement bilingual responsive workspace and integration/UI coverage.
5. Add MCP pagination evidence and run isolated Room/native acceptance where available.
6. Run verify:feature, full tests, type/build; review Standards/Spec; fix findings; commit current branch.

Tests use the public API integration seam agreed in #50 and real isolated desktop flows. Temporary databases/local model fixtures only.

## 2026-10-18 follow-up audit

- Complete: verify the shipped A implementation and MCP pagination guard against current HEAD.
- Complete: native plan and Room core paths, repeated interruption recovery, member lifecycle, bilingual/theme/minimum-window checks.
- Complete: fix background test startup, Room recovery approval routing and repeated-review startup ownership; add regression evidence and synchronize documents.
- Pending user authorization: native microphone recording. Issue #65 stays open; exact scope and limits are in validation-2026-10-18.md.

The existing root planning files belong to other work and are preserved.
