import assert from "node:assert/strict";
import test from "node:test";
import { FeedbackCoordinator, type FeedbackAdapter, type NotificationPermission } from "./feedbackCoordinator";

function createAdapter(permission: NotificationPermission) {
  const notifications: Array<{ title: string; body: string }> = [];
  const adapter: FeedbackAdapter = {
    async permission() { return permission; },
    async requestPermission() { return permission; },
    async notify(event) { notifications.push(event); }
  };
  return { adapter, notifications };
}

test("FeedbackCoordinator announces foreground feedback once without native notifications", async () => {
  const { adapter, notifications } = createAdapter("granted");
  const announcements: string[] = [];
  const coordinator = new FeedbackCoordinator(adapter, () => true, () => "enabled", (message) => announcements.push(message));
  const event = { id: "task-1", kind: "task" as const, terminal: true, title: "Task completed", body: "The task completed." };

  assert.equal((await coordinator.publish(event)).delivered, "in-app");
  assert.equal((await coordinator.publish(event)).delivered, "suppressed");
  assert.deepEqual(announcements, ["The task completed."]);
  assert.deepEqual(notifications, []);
});

test("FeedbackCoordinator only delivers eligible terminal events while inactive", async () => {
  const { adapter, notifications } = createAdapter("granted");
  const coordinator = new FeedbackCoordinator(adapter, () => false, () => "enabled", () => {});

  assert.equal((await coordinator.publish({ id: "service", kind: "service", terminal: false, title: "Service", body: "Checking" })).delivered, "suppressed");
  assert.equal((await coordinator.publish({ id: "task-2", kind: "task", terminal: true, title: "Task completed", body: "The task completed." })).delivered, "notification");
  assert.deepEqual(notifications, [{ title: "Task completed", body: "The task completed." }]);
});

test("Feedback adapters can clean up a notification action listener", async () => {
  let cleaned = false;
  const adapter: FeedbackAdapter = {
    async permission() { return "granted"; },
    async requestPermission() { return "granted"; },
    async notify() {},
    async onAction() {
      return () => { cleaned = true; };
    }
  };

  const cleanup = await adapter.onAction?.(() => {});
  cleanup?.();
  assert.equal(cleaned, true);
});


test("FeedbackCoordinator respects default, disabled, and denied notification states", async () => {
  const defaultPermission = createAdapter("default");
  const denied = createAdapter("denied");
  const disabled = createAdapter("granted");
  const event = { id: "task-3", kind: "task" as const, terminal: true, title: "Task failed", body: "The task failed." };

  assert.equal((await new FeedbackCoordinator(defaultPermission.adapter, () => false, () => "enabled", () => {}).publish(event)).delivered, "suppressed");
  assert.equal((await new FeedbackCoordinator(denied.adapter, () => false, () => "enabled", () => {}).publish(event)).delivered, "suppressed");
  assert.equal((await new FeedbackCoordinator(disabled.adapter, () => false, () => "off", () => {}).publish(event)).delivered, "suppressed");
  assert.deepEqual(defaultPermission.notifications, []);
  assert.deepEqual(denied.notifications, []);
  assert.deepEqual(disabled.notifications, []);
});
