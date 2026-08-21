import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { TOOL_VERSION } from "./integrity.mjs";
import { parseOut, runAction } from "./action/run.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const readme = readFileSync(join(root, "README.md"), "utf8");
const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
const skill = readFileSync(join(root, "skills/agent-payment-integrity/SKILL.md"), "utf8");
const actionYml = readFileSync(join(root, "action.yml"), "utf8");
const example = readFileSync(join(root, "examples/seller-github-action.yml"), "utf8");

const PACKED = [
  "package/cli.mjs",
  "package/integrity.mjs",
  "package/README.md",
  "package/LICENSE",
  "package/SECURITY.md",
  "package/skills/agent-payment-integrity/SKILL.md",
];
const UNPACKED = [
  "package/action.yml",
  "package/action/run.mjs",
  "package/action.test.mjs",
  "package/skill.test.mjs",
  "package/distribution.test.mjs",
  "package/examples/seller-github-action.yml",
  "package/.github/workflows/ci.yml",
  "package/.github/workflows/release-smoke.yml",
];
const FORBIDDEN = /\b(privateKey|BEGIN PRIVATE KEY|signAndSend|eth_sendRawTransaction|X-PAYMENT\s*:)\b/;
const OBSOLETE_GUIDANCE = /grok\/integrity-distribution-convergence-corrected-20260820|c10f996|c725c8d/;

function isolatedNpmEnv(cwd, cache) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PWD: cwd,
    INIT_CWD: cwd,
    npm_config_cache: cache,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

function packedListing() {
  const dir = mkdtempSync(join(tmpdir(), "integrity-distribution-pack-"));
  try {
    const packed = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir], {
      cwd: root,
      encoding: "utf8",
      env: isolatedNpmEnv(root, join(dir, "pack-cache")),
    });
    const jsonStart = packed.indexOf("[");
    const [{ filename, files }] = JSON.parse(jsonStart >= 0 ? packed.slice(jsonStart) : packed);
    const listing = execFileSync("tar", ["-tf", join(dir, filename)], { encoding: "utf8" });
    return { filename, files, listing, tarball: join(dir, filename), dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("packaging: skill ships in npm; action stays git-consumed", { timeout: 60_000 }, () => {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(packageJson.version, "0.1.0-candidate.9");
  assert.equal(TOOL_VERSION, packageJson.version);
  assert.equal(lock.version, packageJson.version);
  assert.equal(lock.packages[""].version, packageJson.version);
  assert.equal(packageJson.private, true);
  assert.ok(packageJson.files.includes("skills"));
  assert.equal(packageJson.files.includes("action.yml"), false);
  assert.equal(packageJson.files.includes("action"), false);
  assert.equal(packageJson.files.includes("examples"), false);
  assert.match(packageJson.scripts.test, /\*\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts.test, /integrity\.test\.mjs action\.test\.mjs/);

  const { filename, listing, dir } = packedListing();
  try {
    assert.match(filename, /^agent-payment-integrity-0\.1\.0-candidate\.9\.tgz$/);
    for (const path of PACKED) {
      assert.match(listing, new RegExp(`^${path}$`, "m"), path);
    }
    assert.match(listing, /^package\/docs\//m);
    for (const path of UNPACKED) {
      assert.doesNotMatch(listing, new RegExp(`^${path}$`, "m"), path);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: skill install and SHA-pinned action are both documented", () => {
  assert.match(readme, /npx skills add epistemedeus\/agent-payment-integrity/);
  assert.match(readme, /uses: epistemedeus\/agent-payment-integrity@REPLACE_WITH_COMMIT_SHA/);
  assert.match(readme, /v0\.1\.0-candidate\.8` is the first tag that contains this Action/);
  assert.match(readme, /v0\.1\.0-candidate\.9` is the first tag whose metadata\npasses GitHub Marketplace publication/);
  assert.match(readme, /Marketplace or tag syntax/);
  assert.match(readme, /Pin the full commit SHA of that tagged tree/);
  assert.match(readme, /A passing run is seller-declared\nunpaid contract evidence/);
  assert.match(readme, /not runtime, settlement, delivery, demand,\nor adoption proof/);
  assert.match(readme, /package remains unpublished on npm/);
  assert.match(readme, /validated `sarif-path` output/);
  assert.match(readme, /Fork `pull_request` jobs skip\nupload/);
  assert.match(readme, /Rejected origin\nuserinfo is not written to the job summary/);
  assert.match(readme, /Rejected `out` paths never reach upload/);
  assert.doesNotMatch(readme, /grok\/github-action-20260820/);
  assert.doesNotMatch(readme, OBSOLETE_GUIDANCE);
  assert.doesNotMatch(readme, /agent-payment-integrity@main/);
  assert.match(example, /uses: epistemedeus\/agent-payment-integrity@REPLACE_WITH_COMMIT_SHA/);
  assert.match(example, /v0\.1\.0-candidate\.9 tree/);
  assert.match(example, /Marketplace or tag syntax is a convenience/);
  assert.doesNotMatch(example, OBSOLETE_GUIDANCE);
  assert.doesNotMatch(example, /agent-payment-integrity@main/);
  assert.match(skill, /uses: epistemedeus\/agent-payment-integrity@COMMIT_SHA/);
  assert.match(skill, /Do not use `@main`/);
  assert.match(skill, /v0\.1\.0-candidate\.8` is the first\ntag that contains the Action/);
  assert.match(skill, /v0\.1\.0-candidate\.9` is the first tag whose\nmetadata passes Marketplace publication/);
  assert.match(contributing, /skill\.test\.mjs/);
  assert.match(contributing, /action\.test\.mjs/);
  assert.match(contributing, /Packed npm contents must include `skills\/`/);
  assert.match(contributing, /steps\.audit\.outputs\.sarif-path/);
  assert.match(contributing, /workflow_dispatch/);
});

test("no-wallet: default CLI, skill, and action stay unpaid", () => {
  assert.doesNotMatch(skill, FORBIDDEN);
  assert.doesNotMatch(actionYml, FORBIDDEN);
  assert.doesNotMatch(example, FORBIDDEN);
  assert.match(actionYml, /using: composite/);
  assert.match(actionYml, /npm ci --ignore-scripts --omit=dev/);
  assert.equal(actionYml.includes("scaffold"), false);
  assert.equal(actionYml.includes("secrets."), false);
  assert.match(skill, /never creates a wallet, signs a payment, or sends a payment/);
  assert.match(skill, /A passing action run is not runtime or\nsettlement proof/);

  const help = spawnSync(process.execPath, [join(root, "cli.mjs")], { encoding: "utf8" });
  assert.equal(help.status, 2);
  assert.equal(help.stdout, "");
  assert.match(help.stderr, /never signs or sends a payment/);
});

test("rejected SARIF paths never reach upload; fork jobs do not overclaim", () => {
  assert.ok(actionYml.includes("sarif_file: ${{ steps.audit.outputs.sarif-path }}"));
  assert.equal(actionYml.includes("sarif_file: ${{ inputs.out }}"), false);
  assert.ok(actionYml.includes("steps.audit.outputs.sarif-path != ''"));
  assert.ok(actionYml.includes("github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"));
  assert.match(example, /Fork pull_request/);
  assert.match(example, /pull_request_target/);
  assert.equal(example.includes("pull_request_target:"), false);
  assert.throws(() => parseOut("../escape.sarif"), /workspace-relative/);
  assert.throws(() => parseOut("/tmp/audit.sarif"), /workspace-relative/);
});

test("local composite runner fail-closes without a wallet or passing report", { timeout: 15_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "integrity-action-local-"));
  try {
    mkdirSync(join(dir, "seller"));
    const output = join(dir, "github-output");
    const summary = join(dir, "summary");
    const result = spawnSync(process.execPath, [join(root, "action/run.mjs")], {
      cwd: join(dir, "seller"),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        INPUT_ORIGIN: "https://127.0.0.1",
        INPUT_ROUTE: "/read",
        INPUT_MAX_ROUTES: "1",
        INPUT_FORMAT: "sarif",
        INPUT_OUT: "audit-result.sarif",
        GITHUB_ACTION_PATH: root,
        GITHUB_WORKSPACE: join(dir, "seller"),
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_TOKEN: "gho_must_not_leak",
      },
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not public|failed/i);
    assert.doesNotMatch(result.stdout + result.stderr, /gho_must_not_leak/);
    const sarif = JSON.parse(readFileSync(join(dir, "seller", "audit-result.sarif"), "utf8"));
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].results[0].ruleId, "action_input_invalid");
    const outputs = readFileSync(output, "utf8");
    assert.match(outputs, /ok=false/);
    assert.match(outputs, /sarif-path=audit-result.sarif/);
    assert.match(readFileSync(summary, "utf8"), /FAIL/);
    assert.match(readFileSync(summary, "utf8"), /No payment sent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nested out dirs work; rejected out never becomes sarif-path; userinfo is redacted", { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "integrity-action-adv-"));
  try {
    const nestedSeller = join(dir, "nested");
    mkdirSync(nestedSeller);
    const nestedOutput = join(dir, "nested-github-output");
    const nestedSummary = join(dir, "nested-summary");
    const nested = spawnSync(process.execPath, [join(root, "action/run.mjs")], {
      cwd: nestedSeller,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        INPUT_ORIGIN: "https://127.0.0.1",
        INPUT_ROUTE: "/read",
        INPUT_MAX_ROUTES: "1",
        INPUT_FORMAT: "sarif",
        INPUT_OUT: "reports/nested/audit.sarif",
        GITHUB_ACTION_PATH: root,
        GITHUB_WORKSPACE: nestedSeller,
        GITHUB_OUTPUT: nestedOutput,
        GITHUB_STEP_SUMMARY: nestedSummary,
      },
      timeout: 10_000,
    });
    assert.equal(nested.status, 1);
    const nestedSarif = JSON.parse(readFileSync(join(nestedSeller, "reports/nested/audit.sarif"), "utf8"));
    assert.equal(nestedSarif.version, "2.1.0");
    assert.equal(nestedSarif.runs[0].results[0].ruleId, "action_input_invalid");
    assert.match(readFileSync(nestedOutput, "utf8"), /sarif-path=reports\/nested\/audit\.sarif/);

    const escapeSeller = join(dir, "escape");
    mkdirSync(escapeSeller);
    const escapeOutput = join(dir, "escape-github-output");
    await assert.rejects(runAction({
      INPUT_ORIGIN: "https://seller.example",
      INPUT_OUT: "../escape.sarif",
      GITHUB_WORKSPACE: escapeSeller,
      GITHUB_OUTPUT: escapeOutput,
      GITHUB_STEP_SUMMARY: join(dir, "escape-summary"),
    }), /workspace-relative/);
    const escapeOut = readFileSync(escapeOutput, "utf8");
    assert.match(escapeOut, /ok=false/);
    assert.match(escapeOut, /sarif-path=audit-result\.sarif/);
    assert.doesNotMatch(escapeOut, /\.\.\/escape\.sarif/);
    const fallback = JSON.parse(readFileSync(join(escapeSeller, "audit-result.sarif"), "utf8"));
    assert.equal(fallback.runs[0].results[0].ruleId, "action_input_invalid");

    const secretSeller = join(dir, "secret");
    mkdirSync(secretSeller);
    const secretSummary = join(dir, "secret-summary");
    const secret = spawnSync(process.execPath, [join(root, "action/run.mjs")], {
      cwd: secretSeller,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        INPUT_ORIGIN: "https://user:s3cret-token@seller.example",
        INPUT_FORMAT: "sarif",
        INPUT_OUT: "audit-result.sarif",
        GITHUB_ACTION_PATH: root,
        GITHUB_WORKSPACE: secretSeller,
        GITHUB_OUTPUT: join(dir, "secret-github-output"),
        GITHUB_STEP_SUMMARY: secretSummary,
      },
      timeout: 10_000,
    });
    assert.equal(secret.status, 1);
    const summary = readFileSync(secretSummary, "utf8");
    assert.match(summary, /origin: \(invalid\)/);
    assert.equal(summary.includes("s3cret-token"), false);
    assert.equal(summary.includes("user:s3cret"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
