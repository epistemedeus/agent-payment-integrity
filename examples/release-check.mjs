// Reproduce an example decision without resolving DNS or contacting a seller.
import assert from "node:assert/strict";
import { auditIntegrity, TOOL_VERSION } from "../integrity.mjs";

const origin = "https://release-check.example";
const route = "/watch";
const requiredPath = "deliverable.watch_id";
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const unsigned = Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url: origin + route, mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", asset,
    payTo: "0x1111111111111111111111111111111111111111", maxTimeoutSeconds: 300 }],
})).toString("base64url");

async function assess(revision, guaranteesId) {
  const schema = {
    type: "object", required: ["deliverable"],
    properties: { deliverable: {
      type: "object", properties: { watch_id: { type: "string" } },
      ...(guaranteesId ? { required: ["watch_id"] } : {}),
    } },
  };
  const report = await auditIntegrity({
    origin, route, method: "GET", requiredPaths: [requiredPath], maxRoutes: 1,
    x402Document: { openapi: "3.1.0", info: { title: "Synthetic watch", version: revision }, paths: {
      [route]: { get: {
        "x-payment-info": { price: { amount: "0.01", currency: "USD" },
          protocols: [{ x402: { asset, network: "eip155:8453", scheme: "exact" } }] },
        responses: { 200: { description: "Watch created", content: { "application/json": {
          schema, example: { deliverable: { watch_id: "watch-demo" } },
        } } } },
      } },
    } },
    requestImpl: async (target) => {
      assert.equal(target.href, origin + route);
      return { status: 402, headers: { "payment-required": unsigned }, body: Buffer.alloc(0) };
    },
  });
  const result = report.routes[0];
  return {
    revision,
    simulatedUnsignedChallengeBound: result.runtimeChallengeVerified,
    decision: report.ok ? "declared_contract_passes" : "hold_required_output",
    guaranteedOutput: result.repairPlan.guaranteedPaths,
    finding: result.findings.find((value) => value.startsWith("seller_response_required_path_missing:")) ?? null,
    suggestedDeclarationChange: result.repairPlan.actions.map(({ requiredPath, action }) => ({ requiredPath, action })),
  };
}

console.log(JSON.stringify({
  sample: true,
  checkerVersion: TOOL_VERSION,
  operation: `GET ${route}`,
  buyerRequirement: requiredPath,
  revisions: [await assess("candidate", false), await assess("candidate-with-declaration-fix", true)],
  notTested: ["live seller behavior", "paid result", "settlement"],
}, null, 2));
