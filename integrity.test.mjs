import assert from "node:assert/strict";
import test from "node:test";

import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

import {
  auditIntegrity,
  buildAuditTarget,
  isPublicAddress,
  normalizeOrigin,
  parseMppChallenges,
  parseX402Challenge,
  resolvePublicHost,
  toSarif,
  validateBazaarContract,
} from "./integrity.mjs";

const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

function discoveryExtension({ invalidOutput = false, legacyOutputSchema = false } = {}) {
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
    output: legacyOutputSchema
      ? { example: { ok: true, title: "Example" } }
      : { example: { ok: true, ...(invalidOutput ? {} : { title: "Example" }) }, schema: outputSchema },
    ...(legacyOutputSchema ? { outputSchema } : {}),
  }).bazaar;
  result.info.input.method = "GET";
  return result;
}

function x402Header(target, extension = discoveryExtension(), overrides = {}) {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: target, description: "fixture", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "50000",
      asset: ASSET,
      payTo: RECIPIENT,
      maxTimeoutSeconds: 300,
      ...overrides,
    }],
    extensions: { bazaar: extension },
  })).toString("base64url");
}

function mppHeader(overrides = {}) {
  const request = Buffer.from(JSON.stringify({
    amount: "50000",
    currency: ASSET,
    recipient: RECIPIENT,
    methodDetails: { chainId: 8453, decimals: 6, credentialTypes: ["authorization"] },
    ...overrides,
  })).toString("base64url");
  return `Payment id="fixture", realm="example.com", method="evm", intent="charge", request="${request}", expires="2099-08-10T00:00:00.000Z"`;
}

function documents() {
  const parameters = [{ name: "url", in: "query", required: true, schema: { type: "string", example: "https://example.com" } }];
  return {
    x402Document: {
      openapi: "3.1.0",
      info: { title: "fixture", version: "1.0.0" },
      paths: {
        "/read": { get: { parameters, responses: { 200: { content: { "application/json": { schema: { type: "object", required: ["ok", "data"], properties: { ok: { type: "boolean" }, data: { type: "object", required: ["value"], properties: { value: { type: "number" } } } } } } } } }, "x-payment-info": { price: { amount: "0.05", currency: "USD" }, protocols: [{ x402: { asset: ASSET, network: "eip155:8453", scheme: "exact" } }] } } },
      },
    },
    mppDocument: {
      openapi: "3.1.0",
      info: { title: "fixture", version: "1.0.0" },
      paths: {
        "/read": { get: { parameters, "x-payment-info": { offers: [
          { amount: "50000", currency: ASSET, method: "evm", intent: "charge", recipient: RECIPIENT, network: "eip155:8453", methodDetails: { chainId: 8453, decimals: 6 } },
          { amount: "50000", currency: ASSET, method: "x402", intent: "exact", payTo: RECIPIENT, network: "eip155:8453", scheme: "exact" },
        ] } } },
      },
    },
  };
}

function requestFixture({ extension, xOverrides, mppOverrides, resourceUrl } = {}) {
  return async (url) => ({
    status: 402,
    headers: {
      "payment-required": x402Header(resourceUrl || url.toString(), extension || discoveryExtension(), xOverrides),
      "www-authenticate": mppHeader(mppOverrides),
    },
    body: Buffer.alloc(0),
  });
}

test("rejects private addresses and credential-like query parameters", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fc00::1"), false);
  assert.equal(isPublicAddress("ff02::1"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.throws(() => buildAuditTarget("https://example.com", "/read", {
    parameters: [{ name: "api_key", in: "query", required: true, schema: { type: "string" } }],
  }), /unsafe required query parameter/);
});

test("rejects unsafe origins and mixed public-private DNS answers", async () => {
  assert.throws(() => normalizeOrigin("https://user:password@example.com"), /credential-free HTTPS origin/);
  assert.throws(() => normalizeOrigin("https://example.com:8443"), /credential-free HTTPS origin/);
  assert.throws(() => normalizeOrigin("https://example.com/path"), /credential-free HTTPS origin/);
  assert.throws(() => normalizeOrigin("https://127.0.0.1"), /not public/);

  await assert.rejects(
    resolvePublicHost("example.com", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /non-public address/,
  );
  assert.deepEqual(
    await resolvePublicHost("example.com", async () => [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]),
    [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ],
  );
});

test("official Bazaar validation also enforces example against schema", () => {
  assert.deepEqual(validateBazaarContract(discoveryExtension()), { valid: true, findings: [] });
  const invalid = validateBazaarContract(discoveryExtension({ invalidOutput: true }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.findings.some((finding) => finding.startsWith("bazaar_output_example_invalid")));
  const legacy = validateBazaarContract(discoveryExtension({ legacyOutputSchema: true }));
  assert.equal(legacy.valid, false);
});

test("parses public x402 and MPP economics without retaining opaque state", () => {
  const target = "https://example.com/read?url=https%3A%2F%2Fexample.com";
  const x402 = parseX402Challenge(x402Header(target));
  const mpp = parseMppChallenges(mppHeader());
  assert.equal(x402.accepts[0].amountAtomic, "50000");
  assert.equal(x402.payload.resource.url, target);
  assert.equal(mpp.offers[0].recipient, RECIPIENT.toLowerCase());
  assert.equal(mpp.offers[0].network, "eip155:8453");
});

test("passes a dual-rail declaration bound to the full runtime request", async () => {
  const report = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture(),
  });
  assert.equal(report.ok, true);
  assert.equal(report.schemaVersion, "agent-payment-integrity.audit.v2");
  assert.equal(report.routeCount, 1);
  assert.deepEqual(report.routes[0].protocols, ["mpp", "x402"]);
  assert.deepEqual(report.routes[0].findings, []);
  assert.equal(report.routes[0].responseContract.schemaVersion, "agent-payment-policy.response-contract-report.v2");
  assert.equal(report.routes[0].responseContract.decision, "admissible");
  assert.deepEqual(report.routes[0].responseContract.requiredPaths, ["data", "data.value", "ok"]);
  assert.equal("schema" in report.routes[0].responseContract, false);
  assert.deepEqual(report.routes[0].discovery.bazaar, { present: true, valid: true });
  assert.deepEqual(report.safety, {
    credentialsUsed: false,
    paymentSigned: false,
    paymentSent: false,
    redirectsAllowed: false,
    dnsPinned: true,
    rawPaymentHeadersRetained: false,
    opaqueStateRetained: false,
    queryValuesRetained: false,
  });
});

test("treats an omitted optional Bazaar extension as a discovery state, not a payment-integrity failure", async () => {
  const requestImpl = async (url) => ({
    status: 402,
    headers: {
      "payment-required": Buffer.from(JSON.stringify({
        x402Version: 2,
        resource: { url: url.pathname + url.search, description: "fixture", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: "50000", asset: ASSET, payTo: RECIPIENT, maxTimeoutSeconds: 300 }],
      })).toString("base64url"),
      "www-authenticate": mppHeader(),
    },
    body: Buffer.alloc(0),
  });
  const report = await auditIntegrity({ origin: "https://example.com", ...documents(), requestImpl });
  assert.equal(report.ok, true);
  assert.deepEqual(report.policy, { requireBazaar: false });
  assert.deepEqual(report.routes[0].discovery.bazaar, { present: false, valid: null });
  assert.equal(report.routes[0].findings.includes("bazaar_extension_missing"), false);

  const strict = await auditIntegrity({ origin: "https://example.com", ...documents(), requireBazaar: true, requestImpl });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.policy, { requireBazaar: true });
  assert.ok(strict.routes[0].findings.includes("bazaar_extension_missing"));
});

test("fails seller CI when exact OpenAPI success output is absent or underconstrained", async () => {
  const absentDocuments = documents();
  delete absentDocuments.x402Document.paths["/read"].get.responses;
  const absent = await auditIntegrity({
    origin: "https://example.com",
    ...absentDocuments,
    requestImpl: requestFixture(),
  });
  assert.equal(absent.ok, false);
  assert.ok(absent.routes[0].findings.includes("seller_response_contract_absent"));

  const partialDocuments = documents();
  partialDocuments.x402Document.paths["/read"].get.responses[200].content["application/json"].schema = {
    type: "object",
    additionalProperties: true,
  };
  const partial = await auditIntegrity({
    origin: "https://example.com",
    ...partialDocuments,
    requestImpl: requestFixture(),
  });
  assert.equal(partial.ok, false);
  assert.ok(partial.routes[0].findings.includes("seller_response_contract_partial"));
});

test("fails closed on full-query drift and cross-rail economics drift", async () => {
  const fullQueryMismatch = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture({ resourceUrl: "https://example.com/read" }),
  });
  assert.ok(fullQueryMismatch.routes[0].findings.includes("x402_full_request_binding_mismatch"));

  const priceMismatch = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture({ mppOverrides: { amount: "60000" } }),
  });
  assert.ok(priceMismatch.routes[0].findings.includes("x402_mpp_economics_mismatch"));
  assert.ok(priceMismatch.routes[0].findings.includes("mpp_declaration_runtime_mismatch"));
});

test("accepts an exact root-relative resource binding and rejects scheme-relative or changed paths", async () => {
  const exact = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture({ resourceUrl: "/read?url=https%3A%2F%2Fexample.com" }),
  });
  assert.equal(exact.ok, true);

  for (const resourceUrl of [
    "//lookalike.example/read?url=https%3A%2F%2Fexample.com",
    "/other?url=https%3A%2F%2Fexample.com",
  ]) {
    const report = await auditIntegrity({
      origin: "https://example.com",
      ...documents(),
      requestImpl: requestFixture({ resourceUrl }),
    });
    assert.ok(report.routes[0].findings.includes("x402_full_request_binding_mismatch"));
  }
});

test("emits SARIF with controlled findings and no raw headers", async () => {
  const report = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture({ resourceUrl: "https://example.com/read" }),
  });
  const sarif = toSarif(report);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].ruleId, "x402_full_request_binding_mismatch");
  assert.equal(sarif.runs[0].tool.driver.version, "0.1.0-candidate.2");
  assert.equal(JSON.stringify(sarif).includes("payment-required"), false);
});
