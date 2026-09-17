import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

import {
  composeFromFixture,
  decimalUsdToAtomic,
  openApiInputNames,
  openApiRequiredSuccessFields,
} from "./src/offer-coherence-composer/compose.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

function composerCli(args) {
  return spawnSync(process.execPath, [join(root, "bin/offer-coherence-composer.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function policyCli(args) {
  return spawnSync(process.execPath, [join(root, "node_modules/agent-payment-policy-015/cli.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
}

function bazaarExtension() {
  const outputSchema = {
    type: "object",
    properties: { ok: { type: "boolean" }, title: { type: "string" } },
    required: ["ok", "title"],
    additionalProperties: false,
  };
  const result = declareDiscoveryExtension({
    input: { url: "https://example.com" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    output: { example: { ok: true, title: "Example" }, schema: outputSchema },
  }).bazaar;
  result.info.input.method = "GET";
  return result;
}

function coherentObservation() {
  const target = "https://example.com/extract?url=https%3A%2F%2Fexample.com";
  const bazaar = bazaarExtension();
  return {
    schemaVersion: "agent-payment-integrity.offer-handler-coherence-observation.v1",
    origin: "https://example.com",
    method: "GET",
    route: "/extract",
    url: target,
    openapi: {
      openapi: "3.1.0",
      info: { title: "fixture", version: "1.0.0" },
      paths: {
        "/extract": {
          get: {
            parameters: [{
              name: "url",
              in: "query",
              required: true,
              schema: { type: "string", example: "https://example.com" },
            }],
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["ok", "title"],
                      properties: { ok: { type: "boolean" }, title: { type: "string" } },
                    },
                    example: { ok: true, title: "Example" },
                  },
                },
              },
            },
            "x-payment-info": {
              price: { amount: "0.05", currency: "USD" },
              protocols: [{ x402: { asset: ASSET, network: "eip155:8453", scheme: "exact" } }],
            },
          },
        },
      },
    },
    runtime: {
      status: 402,
      challenge: {
        x402Version: 2,
        error: "Payment required",
        resource: { url: target, description: "fixture", mimeType: "application/json" },
        accepts: [{
          scheme: "exact",
          network: "eip155:8453",
          amount: "50000",
          asset: ASSET,
          payTo: RECIPIENT,
          maxTimeoutSeconds: 300,
        }],
        extensions: { bazaar },
      },
    },
  };
}

test("decimalUsdToAtomic maps example USDC prices without inventing extra scale", () => {
  assert.equal(decimalUsdToAtomic("0.001"), "1000");
  assert.equal(decimalUsdToAtomic("0.003"), "3000");
  assert.equal(decimalUsdToAtomic("0.005"), "5000");
  assert.equal(decimalUsdToAtomic("0.007123456"), null);
});

test("coherent GET fixture exits 0 with integrity ok and machineBuyable", async () => {
  const report = await composeFromFixture(coherentObservation());
  assert.equal(report.ok, true);
  assert.equal(report.machineBuyable, true);
  assert.equal(report.integrity.ok, true);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.sellerPostTransmitted, false);
  assert.equal(report.boundary.bazaarCallCountsUsedAsConversion, false);
  assert.equal(report.boundary.handlerTypesInferred, false);
  assert.equal(report.boundary.twoCharges, false);
});

test("OneSource fixture fails closed on address/contract vs account/token and 1000 vs 3000", async () => {
  const observation = JSON.parse(readFileSync(join(root, "fixtures/onesource-erc20-balance.json"), "utf8"));
  assert.deepEqual(openApiInputNames(observation.openapi, observation.route, observation.method), ["address", "contract"]);
  const report = await composeFromFixture(observation);
  assert.equal(report.ok, false);
  assert.equal(report.inputNames.matched, false);
  assert.deepEqual(report.inputNames.openapi, ["address", "contract"]);
  assert.deepEqual(report.inputNames.bazaar, ["account", "token"]);
  assert.equal(report.examplePrice.exampleAtomic, "1000");
  assert.equal(report.examplePrice.runtimeAtomic, "3000");
  assert.equal(report.examplePrice.matched, false);
  assert.equal(report.offerCoherence?.decision, "drifted");
  assert.ok(report.offerCoherence.drifted.includes("amount"));
  assert.ok(report.findings.includes("openapi_bazaar_input_name_mismatch"));
  assert.ok(report.findings.includes("example_price_runtime_amount_mismatch"));
  assert.ok(report.findings.some((finding) => finding.startsWith("offer_coherence_drifted")));
  assert.equal(report.ignored.bazaarCallCountsUsedAsConversion, false);
  const cli = composerCli(["--fixture", "fixtures/onesource-erc20-balance.json"]);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /openapi_bazaar_input_name_mismatch/);
  assert.match(cli.stdout, /example_price_runtime_amount_mismatch/);
});

test("Exa fixture fails closed on OpenAPI results vs Bazaar output.type and ignores call counts", async () => {
  const observation = JSON.parse(readFileSync(join(root, "fixtures/exa-direct-search.json"), "utf8"));
  assert.ok(openApiRequiredSuccessFields(observation.openapi, observation.route, observation.method).includes("results"));
  const report = await composeFromFixture(observation);
  assert.equal(report.ok, false);
  assert.equal(report.method, "POST");
  assert.ok(report.successPaths.openapi.includes("results"));
  assert.deepEqual(report.successPaths.bazaarWrapper, ["type"]);
  assert.equal(report.successPaths.bazaarWrapperOnly, true);
  assert.ok(report.findings.includes("openapi_required_path_missing_from_bazaar:results"));
  assert.ok(report.findings.includes("bazaar_output_wrapper_only"));
  assert.equal(report.boundary.sellerPostTransmitted, false);
  assert.equal(report.ignored.bazaarCallCountsUsedAsConversion, false);
  assert.equal(report.ignored.bazaarCallCounts.l30DaysTotalCalls, 5879);
  const cli = composerCli(["--fixture", "fixtures/exa-direct-search.json"]);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /openapi_required_path_missing_from_bazaar:results/);
  assert.match(cli.stdout, /"bazaarCallCountsUsedAsConversion": false/);
});

test("Stall /cap/weather fixture fails closed as seller_response_contract_partial", async () => {
  const observation = JSON.parse(readFileSync(join(root, "fixtures/stall-cap-weather.json"), "utf8"));
  const report = await composeFromFixture(observation);
  assert.equal(report.ok, false);
  assert.equal(report.responseContract.decision, "partial");
  assert.ok(report.findings.includes("seller_response_contract_partial"));
  const cli = composerCli(["--fixture", "fixtures/stall-cap-weather.json"]);
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /seller_response_contract_partial/);
});

test("policy offer-coherence-check exits 0 on the same amount drift the composer rejects", () => {
  const policy = policyCli(["offer-coherence-check", join(root, "fixtures/policy-drifted-onesource-amount.json")]);
  assert.equal(policy.status, 0, policy.stderr);
  const body = JSON.parse(policy.stdout);
  assert.equal(body.decision, "drifted");
  assert.ok(body.drifted.includes("amount"));
  const composer = composerCli(["--fixture", "fixtures/onesource-erc20-balance.json"]);
  assert.equal(composer.status, 1);
});

test("CLI refuses pay and POST live probes", () => {
  const pay = composerCli(["--url", "https://agents.samedaydesk.com/extract?url=https://example.com", "--pay"]);
  assert.equal(pay.status, 2);
  const post = composerCli(["--method", "POST", "--url", "https://api.exa.ai/search"]);
  assert.equal(post.status, 1);
  assert.match(post.stderr, /does not transmit seller POST/);
});
