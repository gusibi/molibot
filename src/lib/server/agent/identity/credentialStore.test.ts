import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModels, type Provider } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "$lib/server/agent/identity/credentialStore.js";

test("FileCredentialStore round-trips credentials without using runtime data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molibot-pi-auth-"));
  const authPath = join(directory, "auth.json");
  const store = new FileCredentialStore(authPath);

  await store.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));

  const reloaded = new FileCredentialStore(authPath);
  assert.deepEqual(await reloaded.read("anthropic"), { type: "api_key", key: "test-key" });
  assert.deepEqual(await reloaded.list(), [{ providerId: "anthropic", type: "api_key" }]);
  assert.equal(JSON.parse(await readFile(authPath, "utf8")).anthropic.key, "test-key");

  await reloaded.delete("anthropic");
  assert.equal(await reloaded.read("anthropic"), undefined);
});

test("FileCredentialStore serializes concurrent cross-instance modifications", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molibot-pi-auth-lock-"));
  const authPath = join(directory, "auth.json");
  const stores = [new FileCredentialStore(authPath), new FileCredentialStore(authPath)];

  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const store = stores[index % stores.length]!;
    await store.modify("counter", async (current) => {
      const value = Number(current?.type === "api_key" ? current.key : "0");
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { type: "api_key", key: String(value + 1) };
    });
  }));

  assert.deepEqual(await stores[0]!.read("counter"), { type: "api_key", key: "12" });
});

test("Models refreshes one expired OAuth credential under the store lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molibot-pi-oauth-lock-"));
  const store = new FileCredentialStore(join(directory, "auth.json"));
  await store.modify("fake-oauth", async () => ({
    type: "oauth",
    access: "expired",
    refresh: "refresh-token",
    expires: 0
  }));
  let refreshCount = 0;
  const provider = {
    id: "fake-oauth",
    name: "Fake OAuth",
    auth: {
      oauth: {
        name: "Fake OAuth",
        login: async () => ({ type: "oauth", access: "login", refresh: "refresh-token", expires: Date.now() + 60_000 }),
        refresh: async () => {
          refreshCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { type: "oauth", access: "refreshed", refresh: "refresh-token", expires: Date.now() + 60_000 };
        },
        toAuth: async (credential) => ({ apiKey: credential.access })
      }
    },
    getModels: () => [],
    stream: () => { throw new Error("not used"); },
    streamSimple: () => { throw new Error("not used"); }
  } as Provider;
  const models = createModels({ credentials: store });
  models.setProvider(provider);

  const [first, second] = await Promise.all([
    models.getAuth("fake-oauth"),
    models.getAuth("fake-oauth")
  ]);

  assert.equal(refreshCount, 1);
  assert.equal(first?.auth.apiKey, "refreshed");
  assert.equal(second?.auth.apiKey, "refreshed");
  assert.equal((await store.read("fake-oauth") as { access?: string })?.access, "refreshed");
});

test("Models login and logout round-trip through FileCredentialStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molibot-pi-oauth-login-"));
  const store = new FileCredentialStore(join(directory, "auth.json"));
  const provider = {
    id: "fake-login",
    name: "Fake Login",
    auth: {
      oauth: {
        name: "Fake Login",
        login: async () => ({ type: "oauth", access: "login", refresh: "refresh-token", expires: Date.now() + 60_000 }),
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access })
      }
    },
    getModels: () => [],
    stream: () => { throw new Error("not used"); },
    streamSimple: () => { throw new Error("not used"); }
  } as Provider;
  const models = createModels({ credentials: store });
  models.setProvider(provider);
  const interaction = {
    notify: () => {},
    prompt: async () => "unused"
  };

  await models.login("fake-login", "oauth", interaction);
  assert.equal((await store.read("fake-login"))?.type, "oauth");
  await models.logout("fake-login");
  assert.equal(await store.read("fake-login"), undefined);
});

test("FileCredentialStore preserves the previous credential when a mutation fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "molibot-pi-auth-failure-"));
  const store = new FileCredentialStore(join(directory, "auth.json"));
  await store.modify("anthropic", async () => ({ type: "api_key", key: "keep-me" }));

  await assert.rejects(
    store.modify("anthropic", async () => {
      throw new Error("refresh failed");
    }),
    /refresh failed/
  );

  assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "keep-me" });
});
