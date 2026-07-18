export type NotificationPermission = "default" | "denied" | "granted";
export type FeedbackPreference = "off" | "enabled";

export type FeedbackEvent = {
  id: string;
  kind: "command" | "service" | "task";
  terminal: boolean;
  title: string;
  body: string;
};

export type FeedbackAdapter = {
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  notify(event: Pick<FeedbackEvent, "title" | "body">): Promise<void>;
  onAction?(listener: () => void): Promise<() => void>;
};

export type FeedbackResult = {
  delivered: "in-app" | "notification" | "suppressed";
  event: FeedbackEvent;
};

export class FeedbackCoordinator {
  private readonly delivered = new Set<string>();

  constructor(
    private readonly adapter: FeedbackAdapter,
    private readonly isActive: () => boolean,
    private readonly preference: () => FeedbackPreference,
    private readonly announce: (message: string) => void
  ) {}

  async publish(event: FeedbackEvent): Promise<FeedbackResult> {
    const key = `${event.id}:${event.terminal ? "terminal" : "progress"}`;
    if (this.delivered.has(key)) return { delivered: "suppressed", event };
    this.delivered.add(key);

    if (this.isActive()) {
      this.announce(event.body || event.title);
      return { delivered: "in-app", event };
    }
    if (!event.terminal || this.preference() !== "enabled") return { delivered: "suppressed", event };
    if (await this.adapter.permission() !== "granted") return { delivered: "suppressed", event };
    await this.adapter.notify({ title: event.title, body: event.body });
    return { delivered: "notification", event };
  }
}

export async function requestFeedbackPermission(adapter: FeedbackAdapter): Promise<NotificationPermission> {
  return adapter.requestPermission();
}

export async function createTauriFeedbackAdapter(): Promise<FeedbackAdapter> {
  const { isPermissionGranted, requestPermission, sendNotification, onAction } = await import("@tauri-apps/plugin-notification");
  let passivePermission: NotificationPermission = "default";

  return {
    async permission() {
      if (window.Notification?.permission && window.Notification.permission !== "default") {
        passivePermission = window.Notification.permission;
        return passivePermission;
      }
      if (await isPermissionGranted()) {
        passivePermission = "granted";
      }
      return passivePermission;
    },
    async requestPermission() {
      passivePermission = await requestPermission();
      return passivePermission;
    },
    async notify(event) {
      sendNotification({ title: event.title, body: event.body });
    },
    async onAction(listener) {
      const subscription = await onAction(listener);
      return () => { void subscription.unregister(); };
    }
  };
}

export const browserFeedbackAdapter: FeedbackAdapter = {
  async permission() { return "denied"; },
  async requestPermission() { return "denied"; },
  async notify() {}
};
