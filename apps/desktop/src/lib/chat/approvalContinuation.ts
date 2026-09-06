/** Follow the server lifecycle, including long runs and another approval wait. */
export async function followApprovalContinuation(input: {
  isCurrent(): boolean;
  reload(): Promise<void>;
  adoptApproval(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  pause(): Promise<void>;
}): Promise<void> {
  // A run may finish just before its final transcript metadata is committed.
  let idleChecks = 0;
  while (input.isCurrent()) {
    await input.pause();
    if (!input.isCurrent()) return;
    await input.reload();
    if (!input.isCurrent() || await input.adoptApproval()) return;
    if (!input.isCurrent()) return;
    idleChecks = await input.isRunning() ? 0 : idleChecks + 1;
    if (!input.isCurrent()) return;
    if (idleChecks >= 2) {
      await input.reload();
      return;
    }
  }
}
