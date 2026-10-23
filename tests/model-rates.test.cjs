const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("标准速度等值估算按 Token 类型计算，未知模型不伪造费率", () => {
  const window = {};
  for (const file of ["shared/config.js", "domain/usage-domain.js"]) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../codex-meter-extension", file), "utf8"), { window });
  }
  const result = window.CodexMeterDomain.getModelTokenStats([{ models: [
    { model: "gpt-6.1-sol", uncached_text_input_tokens: 1e6, cached_text_input_tokens: 1e6, text_output_tokens: 1e6 },
    { model: "unknown-model", text_output_tokens: 1e6 },
  ] }], window.CodexMeterConfig.CONFIG.TOKEN_CREDIT_RATES);
  assert.equal(result.models.find((model) => model.model === "gpt-6.1-sol").creditEquivalent, 302.5);
  assert.equal(result.models.find((model) => model.model === "unknown-model").hasRate, false);
  assert.equal(result.totals.tokens, 4e6);
  assert.equal(result.totals.rateCoverage, 0.75);
});
