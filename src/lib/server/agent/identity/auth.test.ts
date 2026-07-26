import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthCheck,
  AuthInteraction,
  Credential,
  CredentialInfo,
  CredentialStore,
  Provider
} from "@earendil-works/pi-ai";
import {
  OAuthLoginError,
  OAuthLoginManager
} from "$lib/server/agent/identity/auth.js";

class MemoryCredentialStore implements CredentialStore {
  readonly data = new Map<string, Credential>();

  async read(providerId: string): Promise<Credential | undefined> {
    return this.data.get(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.data].map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    const next = await fn(this.data.get(providerId));
    if (next) this.data.set(providerId, next);
    return next;
  }

  async delete(providerId: string): Promise<void> {
    this.data.delete(providerId);
  }
}

type LoginFlow = (interaction: AuthInteraction) => Promise<Credential>;

class FakeModels {
  constructor(
    private readonly store: MemoryCredentialStore,
    private readonly flow: LoginFlow
  ) {}

  // A field initializer runs before constructor parameter properties are
  // assigned, so binding `this.flow` directly here left the fake provider's
  // own `login` undefined (TS2729). Delegate through a closure instead.
  private readonly provider = {
    id: "fake-oauth",
    name: "Fake OAuth",
    auth: {
      oauth: {
        name: "Fake subscription",
        loginLabel: "Sign in to Fake",
        login: (interaction: AuthInteraction) => this.flow(interaction),
        refresh: async (credential: Credential) => credential,
        toAuth: async () => ({})
      }
    },
    getModels: () => [],
    stream: () => { throw new Error("unused"); },
    streamSimple: () => { throw new Error("unused"); }
  } as unknown as Provider;

  getProviders(): readonly Provider[] {
    return [this.provider];
  }

  getProvider(providerId: string): Provider | undefined {
    return providerId === this.provider.id ? this.provider : undefined;
  }

  async checkAuth(providerId: string): Promise<AuthCheck | undefined> {
    return await this.store.read(providerId) ? { type: "oauth", source: "OAuth" } : undefined;
  }

  async login(providerId: string, _type: "oauth", interaction: AuthInteraction): Promise<Credential> {
    const credential = await this.flow(interaction);
    await this.store.modify(providerId, async () => credential);
    return credential;
  }

  async logout(providerId: string): Promise<void> {
    await this.store.delete(providerId);
  }
}

function credential(): Credential {
  return { type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: Date.now() + 60_000 };
}

function manager(flow: LoginFlow, options: { activeTtlMs?: number; terminalRetentionMs?: number } = {}) {
  const store = new MemoryCredentialStore();
  let id = 0;
  const models = new FakeModels(store, flow);
  return {
    store,
    value: new OAuthLoginManager({
      models,
      credentials: store,
      createId: () => `id-${++id}`,
      ...options
    })
  };
}

async function waitFor(
  login: OAuthLoginManager,
  sessionId: string,
  predicate: (state: ReturnType<OAuthLoginManager["get"]>) => boolean
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = login.get(sessionId);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for login state");
}

test("typed select and text prompts preserve options and accept an intentional blank text answer", async () => {
  const { value } = manager(async (interaction) => {
    const method = await interaction.prompt({
      type: "select",
      message: "Choose a method",
      options: [
        { id: "browser", label: "Browser", description: "Recommended" },
        { id: "device", label: "Device code" }
      ]
    });
    assert.equal(method, "device");
    const domain = await interaction.prompt({ type: "text", message: "Enterprise domain" });
    assert.equal(domain, "");
    return credential();
  });

  const started = value.start("fake-oauth");
  const select = await waitFor(value, started.id, (state) => state.prompt?.type === "select");
  assert.deepEqual(select.prompt?.options?.map((option) => option.id), ["browser", "device"]);
  assert.equal(JSON.stringify(select).includes("access-secret"), false);
  value.answer(started.id, select.prompt!.id, "device");

  const text = await waitFor(value, started.id, (state) => state.prompt?.type === "text");
  value.answer(started.id, text.prompt!.id, "");
  const done = await waitFor(value, started.id, (state) => state.state === "done");
  assert.equal(done.prompt, null);
});

test("a stale prompt id cannot answer a later login step", async () => {
  const { value } = manager(async (interaction) => {
    await interaction.prompt({
      type: "select",
      message: "Choose",
      options: [{ id: "browser", label: "Browser" }]
    });
    await interaction.prompt({ type: "manual_code", message: "Paste redirect" });
    return credential();
  });
  const started = value.start("fake-oauth");
  const first = await waitFor(value, started.id, (state) => state.prompt?.type === "select");
  value.answer(started.id, first.prompt!.id, "browser");
  const second = await waitFor(value, started.id, (state) => state.prompt?.type === "manual_code");

  assert.throws(
    () => value.answer(started.id, first.prompt!.id, "old-answer"),
    (error) => error instanceof OAuthLoginError && error.code === "stale_prompt"
  );
  value.answer(started.id, second.prompt!.id, "http://localhost/callback?code=secret");
  await waitFor(value, started.id, (state) => state.state === "done");
});

test("device-code events remain pollable, extend expiry, and never expose tokens", async () => {
  const { value } = manager(async (interaction) => {
    interaction.notify({
      type: "device_code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://example.com/device",
      intervalSeconds: 5,
      expiresInSeconds: 900
    });
    await new Promise<void>((resolve, reject) => {
      interaction.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      setTimeout(resolve, 5);
    });
    return credential();
  }, { activeTtlMs: 10 });

  const started = value.start("fake-oauth");
  const waiting = await waitFor(value, started.id, (state) => Boolean(state.deviceCode));
  assert.equal(waiting.state, "waiting_external");
  assert.equal(waiting.deviceCode?.userCode, "ABCD-EFGH");
  assert.ok(waiting.expiresAt - waiting.startedAt > 14 * 60 * 1000);
  assert.equal(JSON.stringify(waiting).includes("refresh-secret"), false);
  await waitFor(value, started.id, (state) => state.state === "done");
});

test("per-prompt abort clears manual input while the provider callback completes", async () => {
  const { value } = manager(async (interaction) => {
    interaction.notify({ type: "auth_url", url: "https://example.com/authorize" });
    const promptAbort = new AbortController();
    const manual = interaction.prompt({
      type: "manual_code",
      message: "Paste redirect",
      signal: promptAbort.signal
    }).catch(() => "callback-won");
    promptAbort.abort();
    assert.equal(await manual, "callback-won");
    return credential();
  });

  const started = value.start("fake-oauth");
  const done = await waitFor(value, started.id, (state) => state.state === "done");
  assert.equal(done.prompt, null);
});

test("cancel aborts a pending prompt and duplicate provider login is rejected", async () => {
  const { value, store } = manager(async (interaction) => {
    await interaction.prompt({ type: "secret", message: "Secret" });
    return credential();
  });
  const started = value.start("fake-oauth");
  await waitFor(value, started.id, (state) => state.state === "awaiting_input");
  assert.throws(
    () => value.start("fake-oauth"),
    (error) => error instanceof OAuthLoginError && error.code === "provider_busy"
  );
  assert.equal(value.cancel(started.id).state, "cancelled");
  await waitFor(value, started.id, (state) => state.state === "cancelled");
  assert.equal(await store.read("fake-oauth"), undefined);
});

test("a cancelled login stays provider-busy until an abort-ignoring provider settles", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { value } = manager(async () => {
    await gate;
    return credential();
  }, { terminalRetentionMs: 5 });

  const started = value.start("fake-oauth");
  value.cancel(started.id);
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.throws(
    () => value.start("fake-oauth"),
    (error) => error instanceof OAuthLoginError && error.code === "provider_busy"
  );

  release();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(value.start("fake-oauth").providerId, "fake-oauth");
});

test("cancelling a replacement login preserves the credential that was already active", async () => {
  const { value, store } = manager(async (interaction) => {
    await interaction.prompt({ type: "manual_code", message: "Paste redirect" });
    return credential();
  });
  const previous = { ...credential(), access: "previous-access", refresh: "previous-refresh" };
  store.data.set("fake-oauth", previous);
  const started = value.start("fake-oauth");
  await waitFor(value, started.id, (state) => state.state === "awaiting_input");
  value.cancel(started.id);
  await waitFor(value, started.id, (state) => state.state === "cancelled");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await store.read("fake-oauth"), previous);
});

test("logout during login prevents a late credential from remaining stored", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { value, store } = manager(async () => {
    await gate;
    return credential();
  });
  const started = value.start("fake-oauth");
  await value.logout("fake-oauth");
  release();
  await waitFor(value, started.id, (state) => state.state === "cancelled");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await store.read("fake-oauth"), undefined);
});

test("provider status returns only safe credential metadata", async () => {
  const { value, store } = manager(async () => credential());
  store.data.set("fake-oauth", credential());
  const providers = await value.listProviders();
  assert.equal(providers[0]?.credential?.type, "oauth");
  assert.equal(providers[0]?.effectiveAuth?.source, "OAuth");
  const json = JSON.stringify(providers);
  assert.equal(json.includes("access-secret"), false);
  assert.equal(json.includes("refresh-secret"), false);
});

test("a saved API-key override is reported on provider status, because pi resolves it first", async () => {
  const { value, store } = manager(async () => credential());
  store.data.set("fake-oauth", credential());

  const plain = await value.listProviders();
  assert.equal(plain[0]?.apiKeyOverride, undefined);

  const shadowed = await value.listProviders({ apiKeyOverrides: new Set(["fake-oauth"]) });
  assert.equal(shadowed[0]?.apiKeyOverride, true);
  // The flag must be all that crosses the boundary — never the key itself.
  assert.equal(JSON.stringify(shadowed).includes("access-secret"), false);
});
