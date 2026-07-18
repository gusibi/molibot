export type HapticPreference = "off" | "system";

export type HapticAdapter = {
  commit(): Promise<void>;
};

export class HapticCoordinator {
  private committedGesture: string | null = null;

  constructor(
    private readonly adapter: HapticAdapter,
    private readonly preference: () => HapticPreference
  ) {}

  async commit(gestureId: string): Promise<void> {
    if (this.preference() !== "system" || this.committedGesture === gestureId) return;
    this.committedGesture = gestureId;
    await this.adapter.commit();
  }
}

export async function createTauriHapticAdapter(): Promise<HapticAdapter> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    async commit() {
      await invoke("perform_haptic_feedback");
    }
  };
}

export const browserHapticAdapter: HapticAdapter = {
  async commit() {}
};
