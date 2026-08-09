# ADR 0002: Process boundaries for untrusted runtimes

## Status

Accepted

## Context

Mini App server modules and Pi extensions were imported into the Molibot service process. A thrown error could be caught, but `process.exit()`, native aborts, out-of-memory failures, and synchronous infinite loops share the host's fault domain and can stop or permanently block every channel and active task. Promise timeouts do not help when the main event loop itself is blocked.

External command tools already use subprocesses, but the shared tool runtime had no final deadline for a handler that ignored its `AbortSignal`.

## Decision

- Each loaded Mini App gets a dedicated Node child process. This includes scratch-build smoke validation performed by the Agent install tool; validation must use the same runtime boundary and must never dynamically import candidate code into the service. Tool and HTTP calls use bounded IPC; AI, badge, and logging remain explicit host bridges. The child has a 256 MiB old-space limit. Abort, timeout, disconnect, or abnormal exit kills its process group, fails pending calls, and invalidates the runtime so the next call starts a fresh process.
- All installed Pi extensions load and execute in a separate extension child process. The service receives serializable catalog/tool/command metadata and invokes tools, events, and commands over IPC; it never receives executable extension functions. An abnormal exit invalidates the extension host and the next runtime load recreates it.
- The shared tool runtime gives every handler a five-minute final deadline. It derives an abort signal for subprocess-backed handlers and returns a stable timeout/abort result even if an asynchronous handler never settles.
- Built-in tools remain in the service process because they depend on live host stores, approvals, and run context. They are trusted code, not an extension boundary. A synchronous infinite loop in a built-in remains a service bug; the watchdog only releases asynchronous non-settling handlers.

## Consequences

- Third-party `process.exit()`, synchronous loops, and child-process V8 heap OOM no longer take down the Molibot service.
- A Mini App failure is isolated per app. Pi extensions share one extension process, so one failed extension temporarily takes the other extensions down with it, but not the service; they return on the next extension-host load.
- IPC payloads must remain serializable. Abort is enforced by terminating the untrusted process instead of trusting third-party code to cooperate.
- Process isolation is a fault-containment boundary, not a permission sandbox. Installed code still runs with the owner's OS permissions inside its child process; install only trusted Mini Apps and extensions until a separate capability sandbox is introduced.
