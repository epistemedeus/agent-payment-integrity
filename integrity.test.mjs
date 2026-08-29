import assert from "node:assert/strict";
import test from "node:test";

import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { PURCHASE_EVIDENCE_RELATION, createPurchaseEvidenceManifest } from "agent-payment-policy";

import {
  SCHEMA_VERSION,
  auditIntegrity,
  buildAuditTarget,
  createPurchaseEvidenceScaffold,
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
const MULTICHAIN_RESOURCE = "https://agent402.tools/api/unemployment-rate";
const MULTICHAIN_BASE_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MULTICHAIN_BASE_RECIPIENT = "0xaBF4FAbd7c416fB67202E5f9002389Fc75e2a9D0";
const FROZEN_MULTICHAIN_X402_V2_CHALLENGE = {
  x402Version: 2,
  resource: {
    url: MULTICHAIN_RESOURCE,
    description: "Latest US unemployment rate plus a trailing N-month series for trend.",
    mimeType: "application/json",
  },
  accepts: [
    { scheme: "exact", network: "eip155:8453", amount: "10000", asset: MULTICHAIN_BASE_ASSET, payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:137", amount: "10000", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:42161", amount: "10000", asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:143", amount: "10000", asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:43114", amount: "10000", asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:1329", amount: "10000", asset: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:10", amount: "11000", asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:4663", amount: "10000", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "eip155:42220", amount: "10000", asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "upto", network: "eip155:8453", amount: "10000", asset: MULTICHAIN_BASE_ASSET, payTo: MULTICHAIN_BASE_RECIPIENT, maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "10000", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payTo: "J7aN3PLJnTCF5qpEnvJHJsnCjcGuqC2rYtEM8Gv3xwg", maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "stellar:pubnet", amount: "100000", asset: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", payTo: "GDNJXCKW7ZM7GEEVP674TWPU26YJNBQ2FI4ZIPRKTPTNUEJMDHFJWWRL", maxTimeoutSeconds: 300 },
    { scheme: "exact", network: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=", amount: "10000", asset: "31566704", payTo: "C7IIHG7SPLPZ5H7ZT6HW3UV2OQMQQE6Y2HBNGZXSLRJULE42BEE2OY2XIE", maxTimeoutSeconds: 300 },
  ],
};
const FROZEN_MULTICHAIN_X402_V2_HEADER = Buffer.from(
  JSON.stringify(FROZEN_MULTICHAIN_X402_V2_CHALLENGE),
).toString("base64url");

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

function mppHeader(overrides = {}, realm = "example.com") {
  const request = Buffer.from(JSON.stringify({
    amount: "50000",
    currency: ASSET,
    recipient: RECIPIENT,
    methodDetails: { chainId: 8453, decimals: 6, credentialTypes: ["authorization"] },
    ...overrides,
  })).toString("base64url");
  return `Payment id="fixture", realm="${realm}", method="evm", intent="charge", request="${request}", expires="2099-08-10T00:00:00.000Z"`;
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

function multichainDocuments() {
  const result = documents();
  const x402Operation = result.x402Document.paths["/read"].get;
  const mppOperation = result.mppDocument.paths["/read"].get;
  x402Operation.parameters = [];
  mppOperation.parameters = [];
  result.x402Document.paths = { "/api/unemployment-rate": { get: x402Operation } };
  result.mppDocument.paths = { "/api/unemployment-rate": { get: mppOperation } };
  for (const offer of mppOperation["x-payment-info"].offers) {
    offer.amount = "10000";
    offer.currency = MULTICHAIN_BASE_ASSET;
    offer.network = "eip155:8453";
    if (offer.method === "evm") offer.recipient = MULTICHAIN_BASE_RECIPIENT;
    if (offer.method === "x402") offer.payTo = MULTICHAIN_BASE_RECIPIENT;
  }
  return result;
}

function postDocuments({ requireAttributes = false } = {}) {
  const responseSchema = {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object",
        ...(requireAttributes ? { required: ["attributes"] } : {}),
        properties: { attributes: { type: "object" } },
      },
    },
  };
  return {
    x402Document: {
      openapi: "3.1.0",
      info: { title: "fixture", version: "1.0.0" },
      paths: {
        "/simulate": {
          post: {
            requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["address"], properties: { address: { type: "string" } } } } } },
            responses: { 200: { content: { "application/json": { schema: responseSchema } } } },
            "x-payment-info": { price: { amount: "0.01", currency: "USD" }, protocols: [{ x402: {} }, { mpp: {} }] },
          },
        },
      },
    },
  };
}

function requestFixture({ extension, xOverrides, mppOverrides, resourceUrl, link } = {}) {
  return async (url) => ({
    status: 402,
    headers: {
      "payment-required": x402Header(resourceUrl || url.toString(), extension || discoveryExtension(), xOverrides),
      "www-authenticate": mppHeader(mppOverrides),
      ...(link ? { link } : {}),
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

  const badFormat = discoveryExtension();
  badFormat.schema.properties.input.properties.queryParams.properties.url.format = "uri";
  badFormat.schema.properties.input.properties.queryParams.properties.format = { type: "string" };
  badFormat.schema.properties.input.properties.queryParams.required.push("format");
  badFormat.info.input.queryParams.url = "not a uri";
  badFormat.info.input.queryParams.format = "json";
  const formatted = validateBazaarContract(badFormat);
  assert.equal(formatted.valid, false);
  assert.ok(formatted.findings.some((finding) => finding.includes("bazaar_input_example_invalid") && finding.includes("format")));
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

test("parses a frozen Base, Solana, Stellar, and Algorand x402 v2 challenge by network family", () => {
  const x402 = parseX402Challenge(FROZEN_MULTICHAIN_X402_V2_HEADER);
  assert.equal(x402.error, undefined);
  assert.equal(x402.accepts.length, 13);

  for (let index = 0; index < 10; index += 1) {
    assert.equal(x402.accepts[index].asset, FROZEN_MULTICHAIN_X402_V2_CHALLENGE.accepts[index].asset.toLowerCase());
    assert.equal(x402.accepts[index].recipient, FROZEN_MULTICHAIN_X402_V2_CHALLENGE.accepts[index].payTo.toLowerCase());
  }
  assert.deepEqual(x402.accepts.slice(10).map(({ network, asset, recipient }) => ({ network, asset, recipient })), [
    {
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      recipient: "J7aN3PLJnTCF5qpEnvJHJsnCjcGuqC2rYtEM8Gv3xwg",
    },
    {
      network: "stellar:pubnet",
      asset: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      recipient: "GDNJXCKW7ZM7GEEVP674TWPU26YJNBQ2FI4ZIPRKTPTNUEJMDHFJWWRL",
    },
    {
      network: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
      asset: "31566704",
      recipient: "C7IIHG7SPLPZ5H7ZT6HW3UV2OQMQQE6Y2HBNGZXSLRJULE42BEE2OY2XIE",
    },
  ]);

  const namespaceCase = structuredClone(FROZEN_MULTICHAIN_X402_V2_CHALLENGE);
  namespaceCase.accepts[10].network = "SoLaNa:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  namespaceCase.accepts[0].network = "EIP155:8453";
  const normalized = parseX402Challenge(Buffer.from(JSON.stringify(namespaceCase)).toString("base64url"));
  assert.equal(normalized.accepts[0].network, "eip155:8453");
  assert.equal(normalized.accepts[10].network, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
});

test("audits the frozen multichain PAYMENT-REQUIRED header with a zero-byte body", async () => {
  let requests = 0;
  const report = await auditIntegrity({
    origin: "https://agent402.tools",
    ...multichainDocuments(),
    requestImpl: async (url) => {
      requests += 1;
      assert.equal(url.toString(), MULTICHAIN_RESOURCE);
      return {
        status: 402,
        headers: {
          "payment-required": FROZEN_MULTICHAIN_X402_V2_HEADER,
          "www-authenticate": mppHeader({
            amount: "10000",
            currency: MULTICHAIN_BASE_ASSET,
            recipient: MULTICHAIN_BASE_RECIPIENT,
          }, "agent402.tools"),
        },
        body: Buffer.alloc(0),
      };
    },
  });
  assert.equal(requests, 1);
  assert.equal(report.ok, true);
  assert.deepEqual(report.routes[0].protocols, ["mpp", "x402"]);
  assert.equal(report.routes[0].findings.includes("x402_challenge_invalid"), false);
  assert.deepEqual(report.routes[0].economics.x402, {
    amountAtomic: "10000",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    network: "eip155:8453",
    recipient: "0xabf4fabd7c416fb67202e5f9002389fc75e2a9d0",
    decimals: null,
    method: "x402",
    intent: "exact",
    scheme: "exact",
  });
  assert.equal(report.safety.credentialsUsed, false);
  assert.equal(report.safety.paymentSigned, false);
  assert.equal(report.safety.paymentSent, false);
});

test("fails the entire mixed x402 challenge when one network-family identifier is malformed", () => {
  const cases = [
    ["missing non-EVM recipient", 10, (offer) => { delete offer.payTo; }],
    ["whitespace identifier", 10, (offer) => { offer.asset = "EPjF Wdd5"; }],
    ["control identifier", 11, (offer) => { offer.asset = "USDC\u0000"; }],
    ["trailing newline identifier", 11, (offer) => { offer.asset = "USDC\n"; }],
    ["oversized identifier", 12, (offer) => { offer.asset = "A".repeat(257); }],
    ["malformed EVM recipient", 0, (offer) => { offer.payTo = "0x1234"; }],
  ];
  for (const [name, index, mutate] of cases) {
    const challenge = structuredClone(FROZEN_MULTICHAIN_X402_V2_CHALLENGE);
    mutate(challenge.accepts[index]);
    const parsed = parseX402Challenge(Buffer.from(JSON.stringify(challenge)).toString("base64url"));
    assert.match(parsed.error, /invalid x402 economics/, name);
    assert.equal(parsed.accepts, undefined, name);
  }
});

test("passes a dual-rail declaration bound to the full runtime request", async () => {
  const report = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture(),
  });
  assert.equal(report.ok, true);
  assert.equal(report.schemaVersion, "agent-payment-integrity.audit.v5");
  assert.equal(report.machineBuyable, true);
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
  assert.deepEqual(report.policy, { requireBazaar: false, requirePurchaseEvidence: false });
  assert.deepEqual(report.routes[0].discovery.bazaar, { present: false, valid: null });
  assert.equal(report.routes[0].findings.includes("bazaar_extension_missing"), false);

  const strict = await auditIntegrity({ origin: "https://example.com", ...documents(), requireBazaar: true, requestImpl });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.policy, { requireBazaar: true, requirePurchaseEvidence: false });
  assert.ok(strict.routes[0].findings.includes("bazaar_extension_missing"));
});

test("audits one exact declared route and rejects absent, unsafe, or excessive selections", async () => {
  const exact = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    route: "/read",
    maxRoutes: 1,
    requestImpl: requestFixture(),
  });
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.selection, { route: "/read", method: "GET", requiredPaths: [], maxRoutes: 1, availableRouteCount: 1 });
  assert.equal(exact.routeCount, 1);

  await assert.rejects(
    auditIntegrity({ origin: "https://example.com", ...documents(), route: "/missing", requestImpl: requestFixture() }),
    /not declared/,
  );
  await assert.rejects(
    auditIntegrity({ origin: "https://example.com", ...documents(), route: "//other.example/read", requestImpl: requestFixture() }),
    /exact absolute path/,
  );
  await assert.rejects(
    auditIntegrity({ origin: "https://example.com", ...documents(), maxRoutes: 65, requestImpl: requestFixture() }),
    /from 1 to 64/,
  );

  const expanded = documents();
  expanded.x402Document.paths["/second"] = expanded.x402Document.paths["/read"];
  await assert.rejects(
    auditIntegrity({ origin: "https://example.com", ...expanded, maxRoutes: 1, requestImpl: requestFixture() }),
    /route count exceeds 1/,
  );
});

test("audits POST response contracts without transmitting the target request", async () => {
  let requests = 0;
  const missing = await auditIntegrity({
    origin: "https://api.example.com",
    ...postDocuments(),
    method: "POST",
    route: "/simulate",
    requiredPaths: ["data.attributes"],
    maxRoutes: 1,
    requestImpl: async () => { requests += 1; throw new Error("must not send"); },
  });
  assert.equal(requests, 0);
  assert.equal(missing.ok, false);
  assert.equal(missing.machineBuyable, false);
  assert.deepEqual(missing.selection.requiredPaths, ["data.attributes"]);
  assert.deepEqual(missing.routes[0].probe, { attempted: false, reason: "post_requires_explicit_non_secret_fixture" });
  assert.equal(missing.routes[0].runtimeChallengeVerified, false);
  assert.deepEqual(missing.routes[0].protocols, ["mpp", "x402"]);
  assert.ok(missing.routes[0].findings.includes("seller_response_required_path_missing:data.attributes"));
  assert.deepEqual(missing.routes[0].repairPlan, {
    mode: "advisory_openapi_repair",
    requiredPaths: ["data.attributes"],
    guaranteedPaths: [],
    actions: [{
      requiredPath: "data.attributes",
      action: "add_property_to_required",
      parentPath: "data",
      property: "attributes",
      propertyDeclared: true,
      propertyType: "object",
    }],
    complete: false,
    boundary: {
      schemaMutationApplied: false,
      propertyTypesInferred: false,
      sellerRuntimeVerified: false,
      statement: "Apply only after the seller confirms each property's real runtime type and semantics, then rerun integrity CI.",
    },
  });

  const complete = await auditIntegrity({
    origin: "https://api.example.com",
    ...postDocuments({ requireAttributes: true }),
    method: "POST",
    route: "/simulate",
    requiredPaths: ["data.attributes"],
    maxRoutes: 1,
    requestImpl: async () => { requests += 1; throw new Error("must not send"); },
  });
  assert.equal(requests, 0);
  assert.equal(complete.ok, true);
  assert.equal(complete.machineBuyable, false);
  assert.deepEqual(complete.routes[0].findings, []);
  assert.equal(complete.routes[0].repairPlan.complete, true);
  assert.deepEqual(complete.routes[0].repairPlan.guaranteedPaths, ["data.attributes"]);
});

test("requires exact runtime-linked purchase evidence and binds it to current OpenAPI", async () => {
  const baseline = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture(),
  });
  const contract = baseline.routes[0].responseContract;
  const manifest = createPurchaseEvidenceManifest({
    service: { origin: "https://example.com", version: "1.0.0" },
    protocols: ["x402", "mpp"],
    evidence: {},
    operations: [{
      method: "GET",
      path: "/read",
      effect: "read_only",
      output: {
        mediaType: "application/json",
        schemaDigest: contract.schemaDigest,
        requiredPaths: contract.requiredPaths,
        declaration: "seller_declared",
      },
      replay: {},
      receipt: { runtimeValidationRequired: true },
    }],
    boundary: {},
  });
  const manifestUrl = "https://example.com/.well-known/agent-payment-evidence.json";
  const link = `<${manifestUrl}>; rel="describedby ${PURCHASE_EVIDENCE_RELATION}"; type="application/json"`;
  const verified = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requirePurchaseEvidence: true,
    requestImpl: requestFixture({ link }),
    purchaseEvidenceLoader: async (url) => {
      assert.equal(url, manifestUrl);
      return manifest;
    },
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.routes[0].purchaseEvidence, {
    status: "verified",
    source: "runtime_402",
    relation: PURCHASE_EVIDENCE_RELATION,
    manifestUrl,
    manifestDigest: manifest.manifestDigest,
    serviceVersion: "1.0.0",
    responseSchemaDigest: contract.schemaDigest,
    requiredPaths: contract.requiredPaths,
    declaration: "seller_declared",
  });

  const unrelated = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requirePurchaseEvidence: true,
    requestImpl: requestFixture({ link: '<https://example.com/openapi.json>; rel="describedby"' }),
    purchaseEvidenceLoader: async () => assert.fail("unrelated documentation must not be fetched"),
  });
  assert.ok(unrelated.routes[0].findings.includes("purchase_evidence_required"));

  const changed = structuredClone(manifest);
  changed.operations[0].output.schemaDigest = `sha256:${"f".repeat(64)}`;
  const rebuilt = createPurchaseEvidenceManifest(changed);
  const drifted = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requirePurchaseEvidence: true,
    requestImpl: requestFixture({ link }),
    purchaseEvidenceLoader: async () => rebuilt,
  });
  assert.ok(drifted.routes[0].findings.includes("purchase_evidence_response_contract_mismatch"));
});

test("scaffolds deterministic minimal purchase evidence only from a passing audit", async () => {
  const report = await auditIntegrity({
    origin: "https://example.com",
    ...documents(),
    requestImpl: requestFixture(),
  });
  const first = createPurchaseEvidenceScaffold({ report, serviceVersion: "1.0.0" });
  const second = createPurchaseEvidenceScaffold({ report, serviceVersion: "1.0.0" });
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.deepEqual(first.protocols, ["mpp", "x402"]);
  assert.deepEqual(first.evidence, {});
  assert.deepEqual(first.operations, [{
    method: "GET",
    path: "/read",
    effect: "read_only",
    output: {
      mediaType: "application/json",
      schemaDigest: report.routes[0].responseContract.schemaDigest,
      requiredPaths: ["data", "data.value", "ok"],
      declaration: "seller_declared",
    },
    replay: {},
    receipt: { runtimeValidationRequired: true },
  }]);
  assert.equal(first.boundary.claims, "seller_declared_until_independently_verified");
});

test("scaffolding fails closed on invalid reports and requires an explicit POST assertion", async () => {
  assert.throws(
    () => createPurchaseEvidenceScaffold({ report: { schemaVersion: SCHEMA_VERSION, ok: false }, serviceVersion: "1.0.0" }),
    /passing agent-payment-integrity audit/,
  );
  const postReport = await auditIntegrity({
    origin: "https://api.example.com",
    ...postDocuments({ requireAttributes: true }),
    method: "POST",
    route: "/simulate",
    requiredPaths: ["data.attributes"],
  });
  assert.equal(postReport.ok, true);
  assert.throws(
    () => createPurchaseEvidenceScaffold({ report: postReport, serviceVersion: "2.0.0" }),
    /explicit read-only assertion/,
  );
  const broadPostReport = structuredClone(postReport);
  broadPostReport.selection.route = null;
  assert.throws(
    () => createPurchaseEvidenceScaffold({ report: broadPostReport, serviceVersion: "2.0.0", assertReadOnlyPost: true }),
    /one exact explicitly selected route/,
  );
  const manifest = createPurchaseEvidenceScaffold({
    report: postReport,
    serviceVersion: "2.0.0",
    assertReadOnlyPost: true,
  });
  assert.equal(manifest.operations[0].method, "POST");
  assert.equal(manifest.operations[0].effect, "read_only");
});

test("verifies POST purchase evidence from the free OpenAPI entry point without sending POST", async () => {
  const declared = postDocuments({ requireAttributes: true });
  const baseline = await auditIntegrity({
    origin: "https://api.example.com",
    ...declared,
    method: "POST",
    route: "/simulate",
    requiredPaths: ["data.attributes"],
  });
  const contract = baseline.routes[0].responseContract;
  const manifest = createPurchaseEvidenceManifest({
    service: { origin: "https://api.example.com", version: "2.0.0" },
    protocols: ["x402", "mpp"],
    evidence: {},
    operations: [{
      method: "POST",
      path: "/simulate",
      effect: "read_only",
      output: {
        mediaType: "application/json",
        schemaDigest: contract.schemaDigest,
        requiredPaths: contract.requiredPaths,
        declaration: "seller_declared",
      },
      replay: {},
      receipt: { runtimeValidationRequired: true },
    }],
    boundary: {},
  });
  let sellerRequests = 0;
  const manifestUrl = "https://api.example.com/evidence.json";
  const report = await auditIntegrity({
    origin: "https://api.example.com",
    ...declared,
    method: "POST",
    route: "/simulate",
    requiredPaths: ["data.attributes"],
    requirePurchaseEvidence: true,
    purchaseEvidenceLink: `<${manifestUrl}>; rel="describedby ${PURCHASE_EVIDENCE_RELATION}"`,
    purchaseEvidenceLoader: async () => manifest,
    requestImpl: async () => { sellerRequests += 1; throw new Error("must not send seller POST"); },
  });
  assert.equal(sellerRequests, 0);
  assert.equal(report.ok, true);
  assert.equal(report.machineBuyable, false);
  assert.equal(report.routes[0].purchaseEvidence.status, "verified");
  assert.equal(report.routes[0].purchaseEvidence.source, "openapi_entrypoint");
});

test("returns bounded repair actions without inventing missing property types", async () => {
  const missingProperty = postDocuments();
  delete missingProperty.x402Document.paths["/simulate"].post.responses[200].content["application/json"].schema.properties.data.properties.attributes;
  const result = await auditIntegrity({
    origin: "https://api.example.com",
    ...missingProperty,
    method: "POST",
    route: "/simulate",
    requiredPaths: ["data.attributes.value"],
    maxRoutes: 1,
  });
  assert.deepEqual(result.routes[0].repairPlan.actions, [{
    requiredPath: "data.attributes.value",
    action: "define_and_require_property",
    parentPath: "data",
    property: "attributes",
    propertyDeclared: false,
    propertyType: null,
  }]);
  assert.equal(result.routes[0].repairPlan.boundary.propertyTypesInferred, false);
});

test("rejects unsafe POST method and required-path selections", async () => {
  await assert.rejects(auditIntegrity({ origin: "https://example.com", ...documents(), method: "DELETE" }), /GET or POST/);
  await assert.rejects(auditIntegrity({ origin: "https://example.com", ...documents(), requiredPaths: ["data..secret"] }), /safe dotted JSON paths/);
  await assert.rejects(auditIntegrity({ origin: "https://example.com", ...documents(), requiredPaths: Array(17).fill("data") }), /at most 16/);
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
  assert.equal(sarif.runs[0].tool.driver.version, "0.1.0-candidate.10");
  assert.equal(JSON.stringify(sarif).includes("payment-required"), false);
});
