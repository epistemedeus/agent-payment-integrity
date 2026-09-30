import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

import { SCHEMA_VERSION, auditIntegrity, normalizeOrigin } from "./integrity.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(ROOT, "action/fixtures");
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const ALLOWED_ORIGINS = new Set(["https://seller.example", "https://127.0.0.1"]);
const REPAIR_BOUNDARY = {
  schemaMutationApplied: false,
  propertyTypesInferred: false,
  sellerRuntimeVerified: false,
  statement: "Apply only after the seller confirms each property's real runtime type and semantics, then rerun integrity CI.",
};

function fixtureNames() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.startsWith("catalog-row-") && name.endsWith(".json"))
    .sort();
}

function readFixture(name) {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
  assert.equal(raw.includes("BEGIN PRIVATE KEY"), false, name);
  assert.equal(/gh[opsu]_|x-access-token|sk_live_|AKIA/.test(raw), false, name);
  const row = JSON.parse(raw);
  assert.equal(row.schemaVersion, "agent-payment-integrity.catalog-row.v1", name);
  assert.equal(ALLOWED_ORIGINS.has(row.origin), true, row.origin);
  return row;
}

function discoveryExtension() {
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

function x402Header(target, extension) {
  const payload = {
    x402Version: 2,
    resource: { url: String(target), description: "fixture", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "50000",
      asset: ASSET,
      payTo: RECIPIENT,
      maxTimeoutSeconds: 300,
    }],
  };
  if (extension) payload.extensions = { bazaar: extension };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function buildDocument(row) {
  const media = { schema: row.schema };
  if (Object.hasOwn(row, "example")) media.example = row.example;
  const operation = {
    responses: { 200: { content: { "application/json": media } } },
    "x-payment-info": {
      protocols: [{ x402: { asset: ASSET, network: "eip155:8453", scheme: "exact" } }],
    },
  };
  if (Array.isArray(row.parameters) && row.parameters.length) operation.parameters = row.parameters;
  return {
    openapi: "3.1.0",
    info: { title: "catalog-row-fixture", version: "1.0.0" },
    paths: { [row.route]: { [row.method.toLowerCase()]: operation } },
  };
}

async function evaluateIntegrity(row) {
  let requests = 0;
  const schemaBefore = JSON.stringify(row.schema);
  const requestImpl = async (url) => {
    requests += 1;
    if (row.probe === "fail") throw new Error("seeded probe failure");
    if (row.probe === "none" || row.probe === "must-not-send") throw new Error("must not send");
    if (row.probe === "unpaid_402_bazaar_omitted" || row.probe === "unpaid_402_bazaar_present") {
      const extension = row.probe === "unpaid_402_bazaar_present" ? discoveryExtension() : null;
      return {
        status: 402,
        headers: { "payment-required": x402Header(url, extension) },
        body: Buffer.alloc(0),
      };
    }
    throw new Error(`unknown probe ${row.probe}`);
  };
  const report = await auditIntegrity({
    origin: row.origin,
    x402Document: buildDocument(row),
    method: row.method,
    route: row.route,
    requiredPaths: row.requiredPaths,
    requireBazaar: row.requireBazaar,
    maxRoutes: row.maxRoutes,
    requestImpl,
  });
  assert.equal(JSON.stringify(row.schema), schemaBefore, row.id);
  return { report, requests };
}

function assertIntegrity(row, report, requests) {
  const expected = row.expect;
  const route = report.routes[0];
  assert.equal(report.schemaVersion, SCHEMA_VERSION, row.id);
  assert.equal(report.ok, expected.ok, row.id);
  assert.equal(report.machineBuyable, expected.machineBuyable, row.id);
  assert.equal(report.policy.requireBazaar, row.requireBazaar, row.id);
  assert.equal(report.policy.requirePurchaseEvidence, false, row.id);
  assert.equal(report.safety.credentialsUsed, false, row.id);
  assert.equal(report.safety.paymentSigned, false, row.id);
  assert.equal(report.safety.paymentSent, false, row.id);
  assert.equal(report.safety.rawPaymentHeadersRetained, false, row.id);
  assert.equal(report.safety.queryValuesRetained, false, row.id);
  assert.equal(report.safety.opaqueStateRetained, false, row.id);
  assert.equal(report.boundary, "Unpaid point-in-time contract integrity only. No claim about settlement, paid delivery, catalog indexing, identity, or future availability.", row.id);
  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes("payment-required"), false, row.id);
  assert.equal(encoded.includes("BEGIN PRIVATE KEY"), false, row.id);
  assert.equal(encoded.includes("909091"), false, row.id);
  assert.equal(requests, expected.requests, row.id);
  assert.ok(route, row.id);
  assert.equal(route.valid, expected.ok, row.id);
  assert.equal(route.runtimeChallengeVerified, expected.runtimeChallengeVerified, row.id);
  assert.equal(route.status, expected.status, row.id);
  assert.deepEqual(route.findings, expected.findings, row.id);
  assert.deepEqual(route.queryKeys, [], row.id);
  assert.deepEqual(route.probe, expected.probe, row.id);
  assert.deepEqual(route.protocols, expected.protocols, row.id);
  if (expected.bazaar === null) assert.equal(route.discovery, undefined, row.id);
  else assert.deepEqual(route.discovery.bazaar, expected.bazaar, row.id);
  assert.equal(route.responseContract.decision, expected.decision, row.id);
  assert.equal(route.responseContract.nextAction, expected.nextAction, row.id);
  assert.equal(Object.hasOwn(route.responseContract, "schema"), false, row.id);
  if (expected.decision === "absent") assert.equal(route.responseContract.schemaDigest, null, row.id);
  else assert.match(route.responseContract.schemaDigest, /^sha256:[0-9a-f]{64}$/, row.id);
  assert.equal(Boolean(route.repairPlan), expected.repairPresent, row.id);
  assert.equal(route.repairPlan.mode, "advisory_openapi_repair", row.id);
  assert.equal(route.repairPlan.complete, expected.repairComplete, row.id);
  assert.deepEqual(route.repairPlan.requiredPaths, row.requiredPaths, row.id);
  assert.deepEqual(route.repairPlan.guaranteedPaths, expected.guaranteedPaths, row.id);
  assert.deepEqual(route.repairPlan.actions, expected.repairActions, row.id);
  assert.deepEqual(route.repairPlan.boundary, REPAIR_BOUNDARY, row.id);
  if (String(row.probe).startsWith("unpaid_402")) {
    assert.equal(route.status, 402, row.id);
    assert.equal(route.economics.x402.amountAtomic, "50000", row.id);
    assert.equal(route.economics.mpp, null, row.id);
  }
  assert.equal(row.class, expected.ok ? "positive" : "negative", row.id);
}

function decisionLine(row, report) {
  const route = report.routes[0];
  return {
    id: row.id,
    ok: report.ok,
    findings: route.findings,
    decision: route.responseContract?.decision ?? null,
    repairComplete: route.repairPlan?.complete ?? null,
    repairActions: route.repairPlan?.actions?.map((action) => action.action) ?? null,
    paymentSent: report.safety.paymentSent,
    paymentSigned: report.safety.paymentSigned,
    credentialsUsed: report.safety.credentialsUsed,
  };
}

async function runCheck(fileArg) {
  const row = readFixture(path.basename(fileArg));
  if (row.channel === "cli") {
    try {
      normalizeOrigin(row.origin);
      console.log(JSON.stringify({
        id: row.id,
        ok: true,
        paymentSent: false,
        paymentSigned: false,
        credentialsUsed: false,
      }));
      return 0;
    } catch (error) {
      console.log(JSON.stringify({
        id: row.id,
        ok: false,
        error: error.message,
        paymentSent: false,
        paymentSigned: false,
        credentialsUsed: false,
      }));
      return 1;
    }
  }
  const { report } = await evaluateIntegrity(row);
  console.log(JSON.stringify(decisionLine(row, report)));
  return report.ok ? 0 : 1;
}

if (process.env.CATALOG_ROW_CHECK === "1") {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.log(JSON.stringify({ ok: false, error: "fixture path is required" }));
    process.exit(1);
  }
  runCheck(fileArg).then(
    (code) => process.exit(code),
    (error) => {
      console.log(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    },
  );
} else {
  test("catalog rows preserve repair decisions and refuse seeded negatives", async () => {
    const names = fixtureNames();
    assert.equal(names.length, 12);
    const ids = new Set();
    for (const name of names) {
      const row = readFixture(name);
      assert.equal(ids.has(row.id), false, row.id);
      ids.add(row.id);
      if (row.channel !== "integrity") continue;
      const { report, requests } = await evaluateIntegrity(row);
      assertIntegrity(row, report, requests);
    }
  });

  test("seeded catalog rows exit 0 only when the integrity decision passes", { timeout: 60_000 }, () => {
    const script = fileURLToPath(import.meta.url);
    for (const name of fixtureNames()) {
      const row = readFixture(name);
      const result = spawnSync(process.execPath, [script, path.join("action/fixtures", name)], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CATALOG_ROW_CHECK: "1",
        },
      });
      assert.equal(result.status, row.expect.ok ? 0 : 1, `${row.id}\n${result.stdout}\n${result.stderr}`);
      const decision = JSON.parse(result.stdout);
      assert.equal(decision.id, row.id);
      assert.equal(decision.ok, row.expect.ok, row.id);
      assert.equal(decision.paymentSent, false, row.id);
      assert.equal(decision.paymentSigned, false, row.id);
      assert.equal(decision.credentialsUsed, false, row.id);
      if (row.expect.error) assert.equal(decision.error, row.expect.error, row.id);
      if (row.channel === "integrity") {
        assert.deepEqual(decision.findings, row.expect.findings, row.id);
        assert.equal(decision.repairComplete, row.expect.repairComplete, row.id);
      }
    }
  });

  test("seeded unsafe origin is refused by the real CLI and action", () => {
    const row = readFixture("catalog-row-unsafe-origin.json");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-row-refuse-"));
    try {
      const out = path.join(dir, "audit-result.json");
      const cli = spawnSync(process.execPath, [
        path.join(ROOT, "cli.mjs"),
        "audit",
        "--origin",
        row.origin,
        "--route",
        row.route,
        "--max-routes",
        "1",
        "--format",
        "json",
        "--out",
        out,
      ], { encoding: "utf8", timeout: 10_000 });
      assert.equal(cli.status, row.expect.cliExit);
      assert.equal(cli.stdout, "");
      assert.match(cli.stderr, /origin address is not public/);
      assert.equal(fs.existsSync(out), false);

      const seller = path.join(dir, "seller");
      fs.mkdirSync(seller);
      const outputFile = path.join(dir, "github-output");
      const summaryFile = path.join(dir, "summary");
      const action = spawnSync(process.execPath, [path.join(ROOT, "action/run.mjs")], {
        cwd: seller,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          INPUT_ORIGIN: row.origin,
          INPUT_ROUTE: row.route,
          INPUT_MAX_ROUTES: "1",
          INPUT_FORMAT: "sarif",
          INPUT_OUT: "audit-result.sarif",
          GITHUB_ACTION_PATH: ROOT,
          GITHUB_WORKSPACE: seller,
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: summaryFile,
          GITHUB_TOKEN: "gho_must_not_leak",
        },
      });
      assert.equal(action.status, row.expect.actionExit);
      assert.equal(`${action.stdout}${action.stderr}`.includes("gho_must_not_leak"), false);
      const sarif = JSON.parse(fs.readFileSync(path.join(seller, "audit-result.sarif"), "utf8"));
      assert.equal(sarif.runs[0].results[0].ruleId, row.expect.actionRule);
      assert.match(sarif.runs[0].results[0].message.text, /not public/);
      assert.match(fs.readFileSync(outputFile, "utf8"), /ok=false/);
      const summary = fs.readFileSync(summaryFile, "utf8");
      assert.match(summary, /origin: \(invalid\)/);
      assert.match(summary, /FAIL/);
      assert.match(summary, /No payment sent/);
      assert.equal(summary.includes("gho_must_not_leak"), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
