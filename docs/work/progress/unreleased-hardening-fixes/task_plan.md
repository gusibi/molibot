# Unreleased hardening fixes

Scope: the eight defects found in the v2.9.64-to-workspace review. Preserve unrelated edits.

1. Complete: add failing regressions for unsafe effect recovery, startup retry, expired claims, instance heartbeat, claim errors, worker capacity, QQ fallback, and bounded previews.
2. Complete: fix the shared runtime/store and the two transport/file boundaries.
3. Complete: run directly affected tests five times, type-check, review the final change, and update owning documentation.

Acceptance: no unknown external effect is automatically replayed; leases recover without another restart; running work does not block scheduling or heartbeat; errors stay contained; final QQ output and preview limits hold.
