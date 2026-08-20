import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TOOL_VERSION, normalizeOrigin } from "../integrity.mjs";

const ACTION_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ACTION_DIR, "..");
const ROUTE_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/;
const REQUIRED_PATH = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/;
const SAFE_OUT = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const STRIP_EXACT = /^(GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|GITHUB_ENV|GITHUB_PATH|GITHUB_OUTPUT|GITHUB_STEP_SUMMARY)$/i;
const STRIP_PREFIX = /^(AWS_|PAYMENT|WALLET|PRIVATE_KEY|SECRET)/i;

export function parseBoolean(name, value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

export function parseOut(value, fallback = "audit-result.sarif") {
  const out = String(value ?? "").trim() || fallback;
  if (path.isAbsolute(out) || out.split(/[\\/]/).includes("..") || !SAFE_OUT.test(out)) {
    throw new Error("out must be a workspace-relative file without parent segments");
  }
  return out;
}

function escapesWorkspace(workspace, candidate) {
  const relative = path.relative(workspace, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export async function assertWorkspaceOut(cwd, out, deps = {}) {
  const lstat = deps.lstat || fs.lstat;
  const mkdir = deps.mkdir || fs.mkdir;
  const realpath = deps.realpath || fs.realpath;
  const workspace = await realpath(cwd);
  const target = path.resolve(workspace, out);
  if (escapesWorkspace(workspace, target) || target === workspace) {
    throw new Error("out must be a workspace-relative file without parent segments");
  }

  let cursor = path.dirname(target);
  while (cursor.startsWith(`${workspace}${path.sep}`) || cursor === workspace) {
    try {
      const st = await lstat(cursor);
      if (st.isSymbolicLink()) {
        const real = await realpath(cursor);
        if (escapesWorkspace(workspace, real)) {
          throw new Error("out must stay inside the workspace");
        }
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (cursor === workspace) break;
    cursor = path.dirname(cursor);
  }

  await mkdir(path.dirname(target), { recursive: true });
  const realDir = await realpath(path.dirname(target));
  if (escapesWorkspace(workspace, realDir)) {
    throw new Error("out must stay inside the workspace");
  }
  try {
    const st = await lstat(target);
    if (st.isSymbolicLink()) throw new Error("out must not be a symlink");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return out;
}

export function parseInputs(env = process.env) {
  const originRaw = String(env.INPUT_ORIGIN || "").trim();
  if (!originRaw) throw new Error("origin is required");
  const origin = normalizeOrigin(originRaw).origin.replace(/\/$/, "");
  const method = String(env.INPUT_METHOD || "GET").trim().toUpperCase();
  if (!["GET", "POST"].includes(method)) throw new Error("method must be GET or POST");
  const format = String(env.INPUT_FORMAT || "sarif").trim().toLowerCase();
  if (!["sarif", "json", "text"].includes(format)) throw new Error("format must be json, text, or sarif");
  const maxRoutesRaw = String(env.INPUT_MAX_ROUTES || "64").trim();
  if (!/^[1-9][0-9]*$/.test(maxRoutesRaw)) throw new Error("max-routes must be an integer from 1 to 64");
  const maxRoutes = Number(maxRoutesRaw);
  if (maxRoutes < 1 || maxRoutes > 64) throw new Error("max-routes must be an integer from 1 to 64");
  const routeRaw = String(env.INPUT_ROUTE || "").trim();
  let route = null;
  if (routeRaw) {
    if (
      !ROUTE_PATTERN.test(routeRaw)
      || !routeRaw.startsWith("/")
      || routeRaw.startsWith("//")
      || routeRaw.includes("{")
      || routeRaw.includes("?")
      || routeRaw.includes("#")
    ) {
      throw new Error("route must be one exact absolute path without parameters, query, or fragment");
    }
    route = routeRaw;
  }
  const requiredPathsRaw = String(env.INPUT_REQUIRED_PATHS || "").trim();
  const requiredPaths = requiredPathsRaw
    ? requiredPathsRaw.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  if (requiredPaths.length > 16 || requiredPaths.some((item) => !REQUIRED_PATH.test(item))) {
    throw new Error("required-paths must contain at most 16 safe dotted JSON paths");
  }
  return {
    origin,
    route,
    method,
    requiredPaths,
    maxRoutes,
    format,
    out: parseOut(env.INPUT_OUT),
    publicDns: parseBoolean("public-dns", env.INPUT_PUBLIC_DNS, false),
    requireBazaar: parseBoolean("require-bazaar", env.INPUT_REQUIRE_BAZAAR, false),
    requirePurchaseEvidence: parseBoolean("require-purchase-evidence", env.INPUT_REQUIRE_PURCHASE_EVIDENCE, false),
  };
}

export function buildCliArgs(inputs) {
  const args = [
    "audit",
    "--origin",
    inputs.origin,
    "--method",
    inputs.method,
    "--format",
    inputs.format,
    "--out",
    inputs.out,
    "--max-routes",
    String(inputs.maxRoutes),
  ];
  if (inputs.route) args.push("--route", inputs.route);
  if (inputs.requiredPaths.length) args.push("--required-paths", inputs.requiredPaths.join(","));
  if (inputs.publicDns) args.push("--public-dns");
  if (inputs.requireBazaar) args.push("--require-bazaar");
  if (inputs.requirePurchaseEvidence) args.push("--require-purchase-evidence");
  if (args[0] !== "audit" || args.includes("scaffold") || args.includes("--assert-read-only-post")) {
    throw new Error("action may only run a credential-free audit");
  }
  return args;
}

export function sanitizeEnv(env = process.env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (STRIP_EXACT.test(key) || STRIP_PREFIX.test(key)) delete next[key];
  }
  return next;
}

export function inputErrorSarif(message, ruleId = "action_input_invalid") {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "agent-payment-integrity", version: TOOL_VERSION, rules: [] } },
      results: [{
        ruleId,
        level: "error",
        message: { text: String(message) },
      }],
    }],
  };
}

export function summaryText({ inputs, ok, findingCount }) {
  return [
    "## agent-payment-integrity",
    "",
    `- origin: ${inputs.origin}`,
    `- method: ${inputs.method}`,
    `- route: ${inputs.route || "(declared paid routes)"}`,
    `- result: ${ok ? "PASS" : "FAIL"}`,
    `- findings: ${findingCount}`,
    "",
    "No credentials used. No payment signed. No payment sent. No seller POST transmitted. No production mutation.",
    "",
  ].join("\n");
}

function countSarifFindings(payload) {
  const runs = Array.isArray(payload?.runs) ? payload.runs : [];
  return runs.reduce((total, run) => total + (Array.isArray(run?.results) ? run.results.length : 0), 0);
}

async function writeGithubFile(file, body, { appendFile }) {
  if (!file) return;
  await appendFile(file, body.endsWith("\n") ? body : `${body}\n`);
}

async function writeOutputs(env, outputs, deps) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  await writeGithubFile(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, deps);
}

export function defaultSpawn({ execPath, cliPath, args, cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, [cliPath, ...args], {
      cwd,
      env: sanitizeEnv(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function writeReportFile(cwd, out, body, writeFile, mkdir) {
  const target = path.resolve(cwd, out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

async function failClosed(env, deps, io, { out, format, error, ruleId = "action_input_invalid" }) {
  const writeFile = deps.writeFile || fs.writeFile;
  const mkdir = deps.mkdir || fs.mkdir;
  const cwd = env.GITHUB_WORKSPACE || process.cwd();
  if (format === "sarif") {
    try {
      await assertWorkspaceOut(cwd, out, deps);
      await writeReportFile(cwd, out, `${JSON.stringify(inputErrorSarif(error.message, ruleId), null, 2)}\n`, writeFile, mkdir);
    } catch {
      out = "";
    }
  } else {
    out = "";
  }
  await writeOutputs(env, {
    "sarif-path": format === "sarif" ? out : "",
    ok: "false",
    origin: "",
  }, io);
  await writeGithubFile(env.GITHUB_STEP_SUMMARY, summaryText({
    inputs: { origin: "(invalid)", method: "GET", route: null },
    ok: false,
    findingCount: 1,
  }), io);
}

export async function runAction(env = process.env, deps = {}) {
  const writeFile = deps.writeFile || fs.writeFile;
  const mkdir = deps.mkdir || fs.mkdir;
  const spawnImpl = deps.spawnImpl || defaultSpawn;
  const cwd = env.GITHUB_WORKSPACE || process.cwd();
  const actionRoot = env.GITHUB_ACTION_PATH || REPO_ROOT;
  const io = { appendFile: deps.appendFile || fs.appendFile };
  let inputs;
  try {
    inputs = parseInputs(env);
    await assertWorkspaceOut(cwd, inputs.out, deps);
  } catch (error) {
    let out;
    try {
      out = parseOut(env.INPUT_OUT);
    } catch {
      out = "audit-result.sarif";
    }
    const format = String(env.INPUT_FORMAT || "sarif").trim().toLowerCase() || "sarif";
    await failClosed(env, deps, io, { out, format, error });
    throw error;
  }

  const args = buildCliArgs(inputs);
  const cliPath = path.join(actionRoot, "cli.mjs");
  const result = await spawnImpl({
    execPath: process.execPath,
    cliPath,
    args,
    cwd,
    env: sanitizeEnv(env),
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);

  let ok = result.status === 0;
  let findingCount = 0;
  if (inputs.format === "sarif") {
    try {
      const raw = await fs.readFile(path.resolve(cwd, inputs.out), "utf8");
      findingCount = countSarifFindings(JSON.parse(raw));
    } catch {
      ok = false;
      findingCount = 1;
      await writeReportFile(
        cwd,
        inputs.out,
        `${JSON.stringify(inputErrorSarif("seller contract audit failed", "action_audit_failed"), null, 2)}\n`,
        writeFile,
        mkdir,
      );
    }
  }

  await writeOutputs(env, {
    "sarif-path": inputs.out,
    ok: ok ? "true" : "false",
    origin: inputs.origin,
  }, io);
  await writeGithubFile(env.GITHUB_STEP_SUMMARY, summaryText({ inputs, ok, findingCount }), io);
  if (!ok) {
    const error = new Error(result.stderr.trim() || "seller contract audit failed");
    error.exitCode = result.status || 1;
    throw error;
  }
  return { inputs, args, result };
}

export async function main() {
  try {
    await runAction(process.env);
  } catch (error) {
    console.error(`agent-payment-integrity action failed: ${error.message}`);
    process.exitCode = Number(error.exitCode) || 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
