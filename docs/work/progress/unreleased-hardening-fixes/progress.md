# Progress

- 2026-10-18: implementation authorized for all eight findings. Reused the prior review reproductions. Tests will use temporary stores and local replacements only.
- Red phase: the four focused files ran 40 tests; 10 failed on the intended defects (startup retry, delayed recovery, heartbeat, unsafe replay, free slots, transient/fatal claims, large preview, QQ update/completion failures).
- First green phase: 40/40 passed. A broader run including wakeup store and execution runtime passed 72/72. Root TypeScript check passed.
- The dispatcher initially started claiming synchronously during `start()`, breaking two existing startup assertions and leaving failed test timers alive. Restored the existing first-poll startup timing; test cleanup and all affected checks passed.
- Added protection for live foreign leases and own in-flight claims; updated recovery requirements/design, feature/release notes and lasting pitfalls. Final validation below.
- Final validation: nine directly affected test files, 105 tests per run, five consecutive runs passed (525 successful test executions). `corepack pnpm exec tsc --noEmit` passed after the final code changes. Scoped whitespace checks passed.
- Adversarial review: recovery remains conservative for whole-step effects; foreign live leases and own in-flight claims are preserved; instance maintenance also runs independently in file mode; shutdown cancels pending startup retry and retains heartbeat while waiting for active work.
- No settings fields, UI controls, native transport, release versions, or capability-matrix statuses changed. No real databases, running service, providers or channels were used. Full `pnpm verify:feature`, browser/native smoke and live QQ delivery were not run; they remain release acceptance checks.
