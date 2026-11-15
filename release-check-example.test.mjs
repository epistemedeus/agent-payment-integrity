import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TOOL_VERSION } from "./integrity.mjs";

test("release-check sample separates the same 402 from different output guarantees", () => {
  const entry = fileURLToPath(new URL("./examples/release-check.mjs", import.meta.url));
  const { sample, checkerVersion, buyerRequirement, operation, revisions, notTested } =
    JSON.parse(execFileSync(process.execPath, [entry], { encoding: "utf8", timeout: 5000 }));
  assert.equal(sample, true);
  assert.equal(checkerVersion, TOOL_VERSION);
  assert.equal(operation, "GET /watch");
  assert.equal(buyerRequirement, "deliverable.watch_id");
  assert.deepEqual(revisions, [
    { revision: "candidate", simulatedUnsignedChallengeBound: true,
      decision: "hold_required_output", guaranteedOutput: [],
      finding: "seller_response_required_path_missing:deliverable.watch_id",
      suggestedDeclarationChange: [{ requiredPath: buyerRequirement, action: "add_property_to_required" }] },
    { revision: "candidate-with-declaration-fix", simulatedUnsignedChallengeBound: true,
      decision: "declared_contract_passes", guaranteedOutput: [buyerRequirement],
      finding: null, suggestedDeclarationChange: [] },
  ]);
  assert.deepEqual(notTested, ["live seller behavior", "paid result", "settlement"]);
});
