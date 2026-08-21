import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("./", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const skillPath = join(root, "skills/agent-payment-integrity/SKILL.md");
const skill = readFileSync(skillPath, "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const index = line.indexOf(":");
    assert.notEqual(index, -1, `invalid frontmatter line: ${line}`);
    fields[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return { fields, body: markdown.slice(match[0].length) };
}

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

function packedSkillFromTarball() {
  const dir = mkdtempSync(join(tmpdir(), "integrity-skill-pack-"));
  try {
    const packed = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir], {
      cwd: root,
      encoding: "utf8",
      env: isolatedNpmEnv(root, join(dir, "pack-cache")),
    });
    const jsonStart = packed.indexOf("[");
    const [{ filename }] = JSON.parse(jsonStart >= 0 ? packed.slice(jsonStart) : packed);
    const tarball = join(dir, filename);
    const listing = execFileSync("tar", ["-tf", tarball], { encoding: "utf8" });
    const consumer = join(dir, "app");
    mkdirSync(consumer);
    execFileSync("npm", ["install", tarball, "--ignore-scripts", "--prefix", consumer], {
      cwd: consumer,
      encoding: "utf8",
      stdio: "pipe",
      env: isolatedNpmEnv(consumer, join(dir, "install-cache")),
    });
    const installedSkill = readFileSync(
      join(consumer, "node_modules/agent-payment-integrity/skills/agent-payment-integrity/SKILL.md"),
      "utf8",
    );
    return { listing, installedSkill, filename };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("structural: skill frontmatter, path, and package files are valid", () => {
  const { fields, body } = parseFrontmatter(skill);
  assert.equal(fields.name, "agent-payment-integrity");
  assert.equal(fields.name, packageJson.name);
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(fields.name.length <= 64);
  assert.ok(fields.description.length > 0 && fields.description.length <= 1024);
  assert.equal(fields.license, "MIT");
  assert.match(fields.description, /seller CI/);
  assert.match(fields.description, /unpaid exact-route/);
  assert.match(fields.description, /x402/);
  assert.match(fields.description, /MPP/);
  assert.match(fields.description, /Do not use for wallets, payment signing, paid probes/);
  assert.doesNotMatch(skill, /\bTODO\b/);
  assert.ok(body.includes(`agent-payment-integrity ${packageJson.version}`));
  assert.ok(packageJson.files.includes("skills"));
  assert.match(packageJson.scripts.test, /\*\.test\.mjs/);
  assert.match(readme, /npx skills add epistemedeus\/agent-payment-integrity/);
  assert.ok(skill.split("\n").length < 500);
});

test("security: skill stays credential-free and does not pre-approve shell", () => {
  const { fields } = parseFrontmatter(skill);
  assert.equal(fields["allowed-tools"], undefined);
  assert.doesNotMatch(skill, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(skill, /\b(mnemonic|seed phrase|facilitator key|api[_-]?key)\b/i);
  assert.doesNotMatch(skill, /Authorization:\s/i);
  assert.doesNotMatch(skill, /X-PAYMENT\s*:/i);
  assert.doesNotMatch(skill, /process\.env/);
  assert.match(skill, /credential-free HTTPS/);
  assert.match(skill, /rejects userinfo, credential-like required query names,\nnon-public DNS answers, and redirects/);
});

test("no-payment: skill and default CLI never sign or send a payment", () => {
  assert.match(skill, /never creates a wallet, signs a payment, or sends a payment/);
  assert.match(skill, /Neither is runtime proof of paid delivery, settlement/);
  assert.match(skill, /seller-declared/);
  assert.match(skill, /Do not transmit\n  the target request/);
  assert.match(skill, /buyer workflow belongs to `agent-payment-policy`/);
  assert.doesNotMatch(skill, /\b(signAndSend|sendTransaction|eth_sendRawTransaction)\b/);
  assert.doesNotMatch(skill, /npx agent-payment-integrity audit --origin https:\/\/agents\.samedaydesk\.com/);

  const help = spawnSync(process.execPath, [join(root, "cli.mjs")], { encoding: "utf8" });
  assert.equal(help.status, 2);
  assert.equal(help.stdout, "");
  assert.match(help.stderr, /never signs or sends a payment/);
  assert.doesNotMatch(help.stderr, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(help.stdout + help.stderr, /\bpayment sent\b/i);
});

test("clean-install: packed package ships the skill and a consumer can read it", { timeout: 120_000 }, () => {
  const { listing, installedSkill, filename } = packedSkillFromTarball();
  assert.match(filename, /^agent-payment-integrity-0\.1\.0-candidate\.8\.tgz$/);
  assert.match(listing, /package\/skills\/agent-payment-integrity\/SKILL\.md/);
  assert.doesNotMatch(listing, /package\/skill\.test\.mjs/);
  assert.equal(installedSkill, skill);
});
