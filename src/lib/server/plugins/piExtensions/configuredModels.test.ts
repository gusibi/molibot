import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { Models } from "@earendil-works/pi-ai";

const root=mkdtempSync(join(tmpdir(),"pi-configured-models-"));
process.env.DATA_DIR=root;
after(()=>rmSync(root,{recursive:true,force:true}));
const {configuredPiExtensionChatModels,resolvePiExtensionChatModel}=await import("./configuredModels.js");
const {defaultRuntimeSettings}=await import("$lib/server/settings/defaults.js");

test("native configured model catalog excludes unconfigured and disabled rows and retains custom chat models",()=>{
  const builtin={provider:"fixture",id:"configured",name:"Configured"};
  const missing={provider:"missing",id:"not-configured",name:"Missing"};
  const models={getModels:()=>[builtin,missing],getModel:()=>undefined} as unknown as Models;
  const settings=structuredClone(defaultRuntimeSettings);
  settings.customProviders=[{id:"custom-fixture",name:"Custom",enabled:true,baseUrl:"http://127.0.0.1:9/v1",apiKey:"fixture-secret",path:"/chat/completions",defaultModel:"chat",models:[{id:"chat",enabled:true,tags:["text"],supportedRoles:["user","assistant"]},{id:"disabled",enabled:false,tags:["text"],supportedRoles:["user","assistant"]},{id:"image",enabled:true,tags:["vision"],supportedRoles:["user","assistant"]}]}];
  const catalog={chat:[],classifier:[],image:[],providerAuth:{fixture:true,missing:false}};
  const available=configuredPiExtensionChatModels(settings,models,catalog);
  assert.deepEqual(available.map(model=>model.id),["configured","chat"]);
  assert.equal(JSON.stringify(available).includes("fixture-secret"),false);
  assert.equal(resolvePiExtensionChatModel(settings,models,{provider:"custom-fixture",id:"chat"})?.baseUrl,"http://127.0.0.1:9/v1");
  assert.equal(resolvePiExtensionChatModel(settings,models,{provider:"custom-fixture",id:"disabled"}),undefined);
  settings.customProviders[0].enabled=false;
  assert.deepEqual(configuredPiExtensionChatModels(settings,models,catalog).map(model=>model.id),["configured"]);
});
