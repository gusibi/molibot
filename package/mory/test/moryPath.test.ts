import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMoryPath,
  isCanonicalMoryPath,
  policyForRawPath,
  buildMoryPath,
} from "../src/index.js";

test("normalizeMoryPath maps common aliases to canonical URIs", () => {
  assert.equal(
    normalizeMoryPath("/profile/preferences/language"),
    "mory://user_preference/language"
  );
  assert.equal(
    normalizeMoryPath("mory://user/lang_pref"),
    "mory://user_preference/language"
  );
  assert.equal(
    normalizeMoryPath("mory://skill/python/fastapi"),
    "mory://skill/python.fastapi"
  );
});

test("isCanonicalMoryPath validates registry-backed paths", () => {
  assert.equal(isCanonicalMoryPath("mory://user_preference/tone"), true);
  assert.equal(isCanonicalMoryPath("mory://user_preference/non_existing"), false);
  assert.equal(isCanonicalMoryPath("mory://skill/"), false);
  assert.equal(isCanonicalMoryPath("not-a-uri"), false);
});

test("policyForRawPath and buildMoryPath use canonical registry rules", () => {
  assert.equal(policyForRawPath("/profile/preferences/language"), "overwrite");
  assert.equal(
    buildMoryPath({ type: "skill", subject: "python/asyncio" }),
    "mory://skill/python.asyncio"
  );
});
