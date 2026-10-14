#!/usr/bin/env node
/**
 * Native App tests (WebdriverIO + Tauri built-in driver). Not built yet: the
 * plan is a test build compiled with the driver behind a default-off cargo
 * feature, a distinct app identifier, and a temporary HOME/DATA_DIR so the
 * owner's running app is untouched.
 *
 * Until that exists this exits non-zero so an absent native check can never be
 * mistaken for a passing one.
 */
console.error(
  "原生 App 测试尚未建设：需要带 Tauri 驱动的测试构建、独立应用标识和隔离的 HOME/DATA_DIR。" +
  "在此之前该检查一律记为「未验证」。见 docs/requirements/feature-verification-spec.md。"
);
process.exit(1);
