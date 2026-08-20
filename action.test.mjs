import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { githubRelativeArtifactUri, toSarif } from "./integrity.mjs";
import {
  buildCliArgs,
  collectSarifResults,
  githubSafeSarif,
  inputErrorSarif,
  parseInputs,
  runAction,
  sanitizeEnv,
  workflowAnnotation,
} from "./action/run.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PINNED_SHA = /^[0-9a-f]{40}$/;
const FORBIDDEN_SOURCE = /\b(wallet|privateKey|BEGIN PRIVATE KEY|facilitator|scaffold|npm publish|gh release)\b/;

async function read(relative) {
  return fs.readFile(path.join(ROOT, relative), "utf8");
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "integrity-action-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function extractUses(source) {
  return [...source.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
}

test("action.yml is a pinned composite action with no secret or token inputs", async () => {
  const source = await read("action.yml");
  assert.match(source, /^name: agent-payment-integrity/m);
  assert.match(source, /using: composite/);
  assert.match(source, /npm ci --ignore-scripts --omit=dev/);
  assert.ok(source.includes("run: node \"$GITHUB_ACTION_PATH/action/run.mjs\""));
  assert.ok(source.includes("INPUT_ORIGIN: ${{ inputs.origin }}"));
  assert.equal(source.includes("secrets."), false);
  assert.equal(/\btoken:/i.test(source), false);
  assert.equal(source.includes("scaffold"), false);
  assert.equal(source.includes("persist-credentials"), false);
  assert.ok(source.includes("GITHUB_TOKEN: \"\""));
});

test("action.yml pins nested actions to full commit SHAs", async () => {
  const source = await read("action.yml");
  const uses = extractUses(source);
  assert.deepEqual(uses, [
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "github/codeql-action/upload-sarif@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd",
  ]);
  for (const spec of uses) {
    const sha = spec.split("@")[1];
    assert.match(sha, PINNED_SHA);
    assert.equal(spec.includes("@v"), false);
    assert.equal(spec.endsWith("@main"), false);
  }
  assert.match(source, /node-version: "22"/);
  assert.match(source, /wait-for-processing: "false"/);
  assert.ok(source.includes("if: ${{ always() && inputs.upload-sarif == 'true' && inputs.format == 'sarif' }}"));
  assert.match(source, /default: "false"/);
});

test("example seller workflow is credential-free and does not use npx, main, or a placeholder SHA", async () => {
  const source = await read("examples/seller-github-action.yml");
  const uses = extractUses(source);
  assert.equal(uses.length, 1);
  assert.match(uses[0], /^epistemedeus\/agent-payment-integrity@(PIN_40_CHAR_COMMIT_SHA|[0-9a-f]{40})$/);
  assert.equal(uses.some((spec) => spec.includes("@main") || /@v\d/.test(spec)), false);
  assert.equal(source.includes("REPLACE_WITH_COMMIT_SHA"), false);
  assert.equal(source.includes("npx"), false);
  assert.equal(source.includes("npm install"), false);
  assert.equal(source.includes("secrets."), false);
  assert.match(source, /^name: seller-contract-integrity/m);
  assert.match(source, /^on:/m);
  assert.match(source, /permissions:\n  contents: read/);
  assert.equal(source.includes("upload-sarif: \"true\""), false);
});

test("action sources contain no wallet, signing, scaffold, or publish commands", async () => {
  for (const file of ["action.yml", "examples/seller-github-action.yml"]) {
    assert.equal(FORBIDDEN_SOURCE.test(await read(file)), false, file);
  }
  const runner = await read("action/run.mjs");
  assert.match(runner, /args\[0] !== "audit"/);
  assert.match(runner, /args\.includes\("scaffold"\)/);
});

test("parseInputs bounds origin, route, method, max-routes, and out", () => {
  const valid = parseInputs({
    INPUT_ORIGIN: "https://seller.example",
    INPUT_ROUTE: "/read",
    INPUT_METHOD: "GET",
    INPUT_MAX_ROUTES: "1",
    INPUT_FORMAT: "sarif",
    INPUT_OUT: "reports/audit.sarif",
    INPUT_PUBLIC_DNS: "false",
  });
  assert.equal(valid.origin, "https://seller.example");
  assert.equal(valid.route, "/read");
  assert.equal(valid.maxRoutes, 1);
  assert.equal(valid.out, "reports/audit.sarif");
  assert.equal(valid.publicDns, false);

  assert.throws(() => parseInputs({}), /origin is required/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "http://seller.example" }), /credential-free HTTPS origin/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://user:pass@seller.example" }), /credential-free HTTPS origin/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://127.0.0.1" }), /not public/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_ROUTE: "//evil.example/read" }), /exact absolute path/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_ROUTE: "/read?x=1" }), /exact absolute path/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_METHOD: "DELETE" }), /GET or POST/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_MAX_ROUTES: "0" }), /1 to 64/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_MAX_ROUTES: "65" }), /1 to 64/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_OUT: "../escape.sarif" }), /workspace-relative/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_OUT: "/tmp/audit.sarif" }), /workspace-relative/);
  assert.throws(() => parseInputs({ INPUT_ORIGIN: "https://seller.example", INPUT_PUBLIC_DNS: "yes" }), /exactly true or false/);
});

test("buildCliArgs runs only audit and never scaffold or payment flags", () => {
  const args = buildCliArgs(parseInputs({
    INPUT_ORIGIN: "https://seller.example",
    INPUT_ROUTE: "/read",
    INPUT_METHOD: "POST",
    INPUT_REQUIRED_PATHS: "data.attributes",
    INPUT_MAX_ROUTES: "1",
    INPUT_REQUIRE_PURCHASE_EVIDENCE: "true",
  }));
  assert.equal(args[0], "audit");
  assert.equal(args.includes("scaffold"), false);
  assert.equal(args.includes("--assert-read-only-post"), false);
  assert.deepEqual(args.slice(0, 11), [
    "audit",
    "--origin",
    "https://seller.example",
    "--method",
    "POST",
    "--format",
    "sarif",
    "--out",
    "audit-result.sarif",
    "--max-routes",
    "1",
  ]);
  assert.ok(args.includes("--route"));
  assert.ok(args.includes("--required-paths"));
  assert.ok(args.includes("--require-purchase-evidence"));
});

test("sanitizeEnv strips tokens and wallet-shaped names before spawning the CLI", () => {
  const cleaned = sanitizeEnv({
    PATH: "/usr/bin",
    GITHUB_TOKEN: "gho_secret",
    GH_TOKEN: "gho_secret",
    NPM_TOKEN: "npm_secret",
    NODE_AUTH_TOKEN: "npm_secret",
    WALLET_KEY: "0xabc",
    PRIVATE_KEY: "0xabc",
    PAYMENT_HEADER: "exact",
    GITHUB_OUTPUT: "/tmp/out",
    GITHUB_WORKSPACE: "/tmp/ws",
  });
  assert.equal("GITHUB_TOKEN" in cleaned, false);
  assert.equal("GH_TOKEN" in cleaned, false);
  assert.equal("NPM_TOKEN" in cleaned, false);
  assert.equal("WALLET_KEY" in cleaned, false);
  assert.equal("PRIVATE_KEY" in cleaned, false);
  assert.equal("PAYMENT_HEADER" in cleaned, false);
  assert.equal(cleaned.PATH, "/usr/bin");
  assert.equal(cleaned.GITHUB_OUTPUT, "/tmp/out");
});

test("harmless fixtures are unpaid, unsigned, and produce SARIF without raw headers", async () => {
  const passing = JSON.parse(await read("action/fixtures/harmless-report.json"));
  const failing = JSON.parse(await read("action/fixtures/harmless-failing-report.json"));
  for (const report of [passing, failing]) {
    assert.equal(report.origin, "https://seller.example");
    assert.equal(report.safety.credentialsUsed, false);
    assert.equal(report.safety.paymentSigned, false);
    assert.equal(report.safety.paymentSent, false);
    assert.equal(report.machineBuyable, false);
    assert.equal(report.routes[0].probe.attempted, false);
    assert.equal(JSON.stringify(report).includes("BEGIN PRIVATE KEY"), false);
    assert.equal(JSON.stringify(report).includes("payment-required"), false);
  }
  assert.equal(passing.ok, true);
  assert.equal(failing.ok, false);
  const sarif = toSarif(failing);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].ruleId, "seller_response_contract_absent");
  assert.equal(sarif.runs[0].tool.driver.version, "0.1.0-candidate.7");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "seller-contract/seller.example/read");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  assert.equal(/^https?:/i.test(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri), false);
  assert.ok(sarif.runs[0].tool.driver.rules.some((rule) => rule.id === "seller_response_contract_absent"));
});

test("runAction fail-closes on invalid origin, writes SARIF, and does not spawn the CLI", async () => {
  await withTempDir(async (dir) => {
    const outputFile = path.join(dir, "github-output");
    const summaryFile = path.join(dir, "summary");
    let spawned = 0;
    await assert.rejects(runAction({
      INPUT_ORIGIN: "https://user:token@seller.example",
      INPUT_OUT: "audit-result.sarif",
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    }, {
      spawnImpl: async () => {
        spawned += 1;
        return { status: 0, stdout: "", stderr: "" };
      },
    }), /credential-free HTTPS origin/);
    assert.equal(spawned, 0);
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "audit-result.sarif"), "utf8"));
    assert.equal(sarif.runs[0].results[0].ruleId, "action_input_invalid");
    const outputs = await fs.readFile(outputFile, "utf8");
    assert.match(outputs, /ok=false/);
    const summary = await fs.readFile(summaryFile, "utf8");
    assert.match(summary, /FAIL/);
    assert.match(summary, /action_input_invalid/);
    const sarifUri = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    assert.equal(/^https?:/i.test(sarifUri), false);
    assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  });
});

test("runAction fail-closes when the CLI exits nonzero and still exposes SARIF", async () => {
  const failing = JSON.parse(await read("action/fixtures/harmless-failing-report.json"));
  await withTempDir(async (dir) => {
    const outputFile = path.join(dir, "github-output");
    await assert.rejects(runAction({
      INPUT_ORIGIN: "https://seller.example",
      INPUT_ROUTE: "/read",
      INPUT_MAX_ROUTES: "1",
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: outputFile,
    }, {
      spawnImpl: async ({ args, env }) => {
        assert.equal(args[0], "audit");
        assert.equal("GITHUB_TOKEN" in env, false);
        assert.equal(args.includes("scaffold"), false);
        await fs.writeFile(path.join(dir, "audit-result.sarif"), `${JSON.stringify(toSarif(failing), null, 2)}\n`);
        return { status: 1, stdout: "", stderr: "seller contract audit failed\n" };
      },
    }), /seller_response_contract_absent/);
    const outputs = await fs.readFile(outputFile, "utf8");
    assert.match(outputs, /ok=false/);
    assert.match(outputs, /sarif-path=audit-result.sarif/);
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "audit-result.sarif"), "utf8"));
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(/^https?:/i.test(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri), false);
    assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  });
});

test("runAction passes a bounded audit and records PASS without payment env", async () => {
  const passing = JSON.parse(await read("action/fixtures/harmless-report.json"));
  await withTempDir(async (dir) => {
    const outputFile = path.join(dir, "github-output");
    const summaryFile = path.join(dir, "summary");
    const captured = [];
    const result = await runAction({
      INPUT_ORIGIN: "https://seller.example",
      INPUT_ROUTE: "/read",
      INPUT_MAX_ROUTES: "1",
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_TOKEN: "gho_should_be_stripped",
    }, {
      spawnImpl: async (request) => {
        captured.push(request);
        assert.equal(request.args[0], "audit");
        assert.equal("GITHUB_TOKEN" in request.env, false);
        await fs.writeFile(path.join(dir, "audit-result.sarif"), `${JSON.stringify(toSarif(passing), null, 2)}\n`);
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.inputs.origin, "https://seller.example");
    assert.equal(captured.length, 1);
    const outputs = await fs.readFile(outputFile, "utf8");
    assert.match(outputs, /ok=true/);
    assert.match(await fs.readFile(summaryFile, "utf8"), /PASS/);
    assert.match(await fs.readFile(summaryFile, "utf8"), /No payment sent/);
  });
});

test("real CLI fail-closes on unsafe origin without writing a passing report", async () => {
  await withTempDir(async (dir) => {
    const out = path.join(dir, "audit-result.sarif");
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "cli.mjs"),
      "audit",
      "--origin",
      "https://127.0.0.1",
      "--format",
      "sarif",
      "--out",
      out,
    ], { encoding: "utf8", timeout: 10_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not public|failed/i);
    let exists = true;
    try {
      await fs.access(out);
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  });
});

test("requestPinned remains GET-only and inputErrorSarif names this candidate", async () => {
  const source = await read("integrity.mjs");
  const start = source.indexOf("export async function requestPinned");
  const end = source.indexOf("async function fetchJsonResponse");
  const requestPinned = source.slice(start, end);
  assert.match(requestPinned, /method: "GET"/);
  assert.equal(requestPinned.includes("POST"), false);
  const sarif = inputErrorSarif("origin is required");
  assert.equal(sarif.runs[0].tool.driver.version, "0.1.0-candidate.7");
  assert.equal(sarif.runs[0].results[0].ruleId, "action_input_invalid");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  assert.equal(/^https?:/i.test(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri), false);
});

test("GitHub-safe SARIF rewrites https artifact URIs and fills missing locations", () => {
  assert.equal(githubRelativeArtifactUri("https://post.seller.example", "/simulate"), "seller-contract/post.seller.example/simulate");
  const rewritten = githubSafeSarif({
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "agent-payment-integrity", version: "0.1.0-candidate.7", rules: [] } },
      results: [{
        ruleId: "seller_response_required_path_missing",
        level: "error",
        message: { text: "POST /simulate: seller_response_required_path_missing:data.attributes" },
        locations: [{ physicalLocation: { artifactLocation: { uri: "https://post.seller.example/simulate" } } }],
      }],
    }],
  });
  const uri = rewritten.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
  assert.equal(uri, "seller-contract/post.seller.example/simulate");
  assert.equal(/^https?:/i.test(uri), false);
  assert.equal(rewritten.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  assert.ok(rewritten.runs[0].tool.driver.rules.some((rule) => rule.id === "seller_response_required_path_missing"));
  assert.match(workflowAnnotation(rewritten.runs[0].results[0]), /^::error title=seller_response_required_path_missing::/);
});

test("runAction emits annotations and finding text when the CLI writes a failing SARIF", async () => {
  const failing = JSON.parse(await read("action/fixtures/harmless-failing-report.json"));
  await withTempDir(async (dir) => {
    const outputFile = path.join(dir, "github-output");
    const summaryFile = path.join(dir, "summary");
    const stderr = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, encoding, callback) => {
      stderr.push(String(chunk));
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();
      return true;
    };
    try {
      await assert.rejects(runAction({
        INPUT_ORIGIN: "https://seller.example",
        INPUT_ROUTE: "/read",
        INPUT_MAX_ROUTES: "1",
        GITHUB_WORKSPACE: dir,
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      }, {
        spawnImpl: async () => {
          await fs.writeFile(path.join(dir, "audit-result.sarif"), `${JSON.stringify(toSarif(failing), null, 2)}\n`);
          return { status: 1, stdout: "", stderr: "seller contract audit failed\n" };
        },
      }), /seller_response_contract_absent|seller contract audit failed/);
    } finally {
      process.stderr.write = originalWrite;
    }
    const summary = await fs.readFile(summaryFile, "utf8");
    assert.match(summary, /seller_response_contract_absent/);
    assert.ok(stderr.some((line) => line.includes("::error title=seller_response_contract_absent::")));
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "audit-result.sarif"), "utf8"));
    assert.equal(collectSarifResults(sarif)[0].ruleId, "seller_response_contract_absent");
    assert.equal(/^https?:/i.test(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri), false);
  });
});

test("runAction writes fail-closed SARIF when the real CLI throws without --out", async () => {
  await withTempDir(async (dir) => {
    const outputFile = path.join(dir, "github-output");
    const summaryFile = path.join(dir, "summary");
    await assert.rejects(runAction({
      INPUT_ORIGIN: "https://seller.example",
      INPUT_ROUTE: "/read",
      INPUT_MAX_ROUTES: "1",
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    }), /ENOTFOUND|not public|failed/i);
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "audit-result.sarif"), "utf8"));
    assert.equal(sarif.runs[0].results[0].ruleId, "action_cli_failed");
    assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
    const outputs = await fs.readFile(outputFile, "utf8");
    assert.match(outputs, /ok=false/);
    assert.match(outputs, /sarif-path=audit-result.sarif/);
    assert.match(await fs.readFile(summaryFile, "utf8"), /action_cli_failed/);
  });
});
