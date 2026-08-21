import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { toSarif } from "./integrity.mjs";
import {
  assertWorkspaceOut,
  buildCliArgs,
  inputErrorSarif,
  parseInputs,
  runAction,
  sanitizeEnv,
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
  assert.match(source, /^branding:\n  icon: shield\n  color: blue\n/m);
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
  assert.ok(source.includes("if: ${{ always() && inputs.upload-sarif == 'true' && inputs.format == 'sarif' && steps.audit.outputs.sarif-path != '' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}"));
  assert.ok(source.includes("sarif_file: ${{ steps.audit.outputs.sarif-path }}"));
  assert.equal(source.includes("sarif_file: ${{ inputs.out }}"), false);
  assert.ok(source.includes("NODE_OPTIONS: \"\""));
  assert.ok(source.includes("working-directory: ${{ github.action_path }}"));
  assert.match(source, /default: "false"/);
});

test("example seller workflow is credential-free and does not use npx or main", async () => {
  const source = await read("examples/seller-github-action.yml");
  assert.match(source, /uses: epistemedeus\/agent-payment-integrity@REPLACE_WITH_COMMIT_SHA/);
  const uses = extractUses(source);
  assert.equal(uses.some((spec) => spec.includes("@main") || /@v\d/.test(spec)), false);
  assert.equal(source.includes("npx"), false);
  assert.equal(source.includes("npm install"), false);
  assert.equal(source.includes("secrets."), false);
  assert.match(source, /permissions:\n  contents: read\n  security-events: write/);
  assert.match(source, /origin: https:\/\/seller\.example/);
  assert.match(source, /upload-sarif: "true"/);
  assert.match(source, /v0\.1\.0-candidate\.9/);
  assert.match(source, /Marketplace or tag syntax is a convenience/);
  assert.doesNotMatch(source, /grok\/integrity-distribution-convergence-corrected-20260820/);
  assert.doesNotMatch(source, /c10f996|c725c8d/);
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
  assert.equal("NODE_OPTIONS" in sanitizeEnv({ NODE_OPTIONS: "--require ./evil.js" }), false);
  assert.equal("GITHUB_ENV" in sanitizeEnv({ GITHUB_ENV: "/tmp/env" }), false);
  assert.equal("GITHUB_OUTPUT" in cleaned, false);
  assert.equal("ACTIONS_RUNTIME_TOKEN" in sanitizeEnv({ ACTIONS_RUNTIME_TOKEN: "gha_secret" }), false);
  assert.equal(cleaned.PATH, "/usr/bin");
  assert.equal(cleaned.GITHUB_WORKSPACE, "/tmp/ws");
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
  assert.equal(sarif.runs[0].tool.driver.version, "0.1.0-candidate.9");
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
    assert.match(summary, /origin: \(invalid\)/);
    assert.equal(summary.includes("user:token"), false);
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
    }), /seller contract audit failed/);
    const outputs = await fs.readFile(outputFile, "utf8");
    assert.match(outputs, /ok=false/);
    assert.match(outputs, /sarif-path=audit-result.sarif/);
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "audit-result.sarif"), "utf8"));
    assert.equal(sarif.runs[0].results.length, 1);
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
  assert.equal(sarif.runs[0].tool.driver.version, "0.1.0-candidate.9");
  assert.equal(sarif.runs[0].results[0].ruleId, "action_input_invalid");
});

test("runAction creates parent directories for workspace-relative out", async () => {
  const failing = JSON.parse(await read("action/fixtures/harmless-failing-report.json"));
  await withTempDir(async (dir) => {
    let sawDir = false;
    await assert.rejects(runAction({
      INPUT_ORIGIN: "https://seller.example",
      INPUT_ROUTE: "/read",
      INPUT_OUT: "reports/nested/audit.sarif",
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: path.join(dir, "github-output"),
    }, {
      spawnImpl: async ({ args, env }) => {
        const out = args[args.indexOf("--out") + 1];
        assert.equal(out, "reports/nested/audit.sarif");
        assert.equal("NODE_OPTIONS" in env, false);
        assert.equal("GITHUB_ENV" in env, false);
        await fs.stat(path.join(dir, "reports/nested"));
        sawDir = true;
        await fs.writeFile(
          path.join(dir, out),
          `${JSON.stringify(toSarif(failing), null, 2)}\n`,
        );
        return { status: 1, stdout: "", stderr: "seller contract audit failed\n" };
      },
    }), /seller contract audit failed/);
    assert.equal(sawDir, true);
  });
});

test("runAction writes fail-closed SARIF when the CLI exits without creating out", async () => {
  await withTempDir(async (dir) => {
    const outputFile = path.join(dir, "github-output");
    await assert.rejects(runAction({
      INPUT_ORIGIN: "https://seller.example",
      INPUT_ROUTE: "/read",
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: outputFile,
    }, {
      spawnImpl: async () => ({ status: 1, stdout: "", stderr: "hostname did not resolve\n" }),
    }), /hostname did not resolve/);
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "audit-result.sarif"), "utf8"));
    assert.equal(sarif.runs[0].results[0].ruleId, "action_audit_failed");
    assert.match(await fs.readFile(outputFile, "utf8"), /sarif-path=audit-result.sarif/);
  });
});

test("assertWorkspaceOut refuses symlinks and parent escapes", async () => {
  await withTempDir(async (dir) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "integrity-escape-"));
    try {
      await fs.symlink(path.join(outside, "pwn.sarif"), path.join(dir, "link.sarif"));
      await assert.rejects(assertWorkspaceOut(dir, "link.sarif"), /symlink/);
      const reports = path.join(dir, "reports");
      await fs.symlink(outside, reports);
      await assert.rejects(assertWorkspaceOut(dir, "reports/audit.sarif"), /workspace/);
      await assertWorkspaceOut(dir, "ok/audit.sarif");
      const st = await fs.stat(path.join(dir, "ok"));
      assert.equal(st.isDirectory(), true);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("example seller workflow warns against pull_request_target and documents fork upload skip", async () => {
  const source = await read("examples/seller-github-action.yml");
  assert.match(source, /pull_request_target/);
  assert.match(source, /Fork pull_request/);
  assert.equal(source.includes("pull_request_target:"), false);
  assert.match(source, /uses: epistemedeus\/agent-payment-integrity@REPLACE_WITH_COMMIT_SHA/);
});

test("action.yml Marketplace branding is allowed shield/blue and does not change behavior", async () => {
  const source = await read("action.yml");
  const description = source.match(/^description: (.+)$/m);
  assert.ok(description, "description must be present");
  assert.equal(description[1], "Credential-free x402 and MPP request, payment, and output contract audit with SARIF. Never signs or sends payment.");
  assert.equal(description[1].length < 125, true, "Marketplace description must be less than 125 characters");
  const allowedIcons = new Set(["shield", "lock", "check-circle", "alert-triangle", "eye"]);
  const allowedColors = new Set(["white", "black", "yellow", "blue", "green", "orange", "red", "purple", "gray-dark"]);
  const icon = source.match(/^branding:\n  icon: ([a-z0-9-]+)\n  color: ([a-z0-9-]+)\n/m);
  assert.ok(icon, "branding.icon and branding.color must be present");
  assert.equal(icon[1], "shield");
  assert.equal(icon[2], "blue");
  assert.equal(allowedIcons.has(icon[1]), true);
  assert.equal(allowedColors.has(icon[2]), true);
  const uses = extractUses(source);
  assert.deepEqual(uses, [
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "github/codeql-action/upload-sarif@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd",
  ]);
  assert.match(source, /using: composite/);
  assert.equal(source.includes("secrets."), false);
});

test("release-smoke is manual-only, pins and verifies a full commit SHA, and runs the local unpaid Action", async () => {
  const source = await read(".github/workflows/release-smoke.yml");
  assert.match(source, /^name: release-smoke/m);
  assert.match(source, /^on:\n  workflow_dispatch:\n    inputs:\n      commit_sha:\n/m);
  assert.doesNotMatch(source, /^\s+(push|pull_request|schedule|workflow_call|release):/m);
  assert.equal(source.includes("secrets."), false);
  assert.doesNotMatch(source, /^\s+environment:/m);
  assert.equal(/\btoken:/i.test(source), false);
  assert.match(source, /permissions:\n  contents: read\n/);
  assert.equal(source.includes("security-events"), false);
  assert.match(source, /ACTION_COMMIT_SHA: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(source, /\^\[0-9a-fA-F\]\{40\}\$/);
  assert.match(source, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(source, /ref: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /actual_commit_sha="\$\(git rev-parse HEAD\)"/);
  assert.match(source, /\$\{actual_commit_sha,,\}/);
  assert.match(source, /\$\{ACTION_COMMIT_SHA,,\}/);
  assert.equal(source.includes("inputs.ref"), false);
  assert.match(source, /uses: \.\//);
  assert.equal(source.includes("uses: $/"), false);
  assert.match(source, /origin: https:\/\/agents\.samedaydesk\.com/);
  assert.match(source, /route: \/extract/);
  assert.match(source, /method: GET/);
  assert.match(source, /required-paths: ok,url,title/);
  assert.match(source, /max-routes: "1"/);
  assert.match(source, /upload-sarif: "false"/);
  assert.equal(FORBIDDEN_SOURCE.test(source), false);
  assert.match(source, /seller-declared unpaid contract evidence/);
  const uses = extractUses(source);
  assert.deepEqual(uses, [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "./",
  ]);
  for (const spec of uses) {
    if (spec === "./") continue;
    const sha = spec.split("@")[1];
    assert.match(sha, PINNED_SHA);
  }
});
