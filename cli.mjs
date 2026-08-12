#!/usr/bin/env node

import fs from "node:fs/promises";

import { auditOrigin, createPurchaseEvidenceScaffold, toSarif } from "./integrity.mjs";

function usage() {
  return `agent-payment-integrity

Usage:
  agent-payment-integrity audit --origin https://seller.example [--method GET|POST] [--route /exact-path] [--required-paths data.attributes,data.type] [--max-routes 64] [--format json|text|sarif] [--out path] [--public-dns] [--require-bazaar] [--require-purchase-evidence]
  agent-payment-integrity scaffold --origin https://seller.example --service-version 1.0.0 [--method GET|POST] [--route /exact-path] [--required-paths data.attributes,data.type] [--max-routes 64] [--out path] [--public-dns] [--assert-read-only-post]

GET audits perform a credential-free unpaid challenge probe. POST audits inspect
the exact public OpenAPI contract without transmitting a target request. The CLI
never signs or sends a payment. Scaffold emits a conservative seller-declared
manifest only from a passing audit and requires an explicit assertion for POST.`;
}

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function textReport(report) {
  const lines = [
    `${report.ok ? "PASS" : "FAIL"} ${report.origin}`,
    `${report.validRoutes}/${report.routeCount} routes valid`,
  ];
  for (const route of report.routes) {
    lines.push(`${route.valid ? "PASS" : "FAIL"} ${route.method} ${route.route} [${route.protocols.join("+") || "none"}]${route.runtimeChallengeVerified ? "" : " [runtime unverified]"}`);
    for (const finding of route.findings) lines.push(`  ${finding}`);
  }
  lines.push("No credentials used. No payment signed. No payment sent.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const command = process.argv[2];
  if (!["audit", "scaffold"].includes(command)) {
    console.error(usage());
    process.exitCode = command === "--help" || command === "-h" ? 0 : 2;
    return;
  }
  const origin = option("origin");
  if (!origin) throw new Error("--origin is required");
  const format = option("format", command === "audit" ? "text" : "json");
  if (!["json", "text", "sarif"].includes(format)) throw new Error("--format must be json, text, or sarif");
  if (command === "scaffold" && format !== "json") throw new Error("scaffold format must be json");
  const maxRoutesRaw = option("max-routes", "64");
  if (!/^[1-9][0-9]*$/.test(maxRoutesRaw)) throw new Error("--max-routes must be an integer from 1 to 64");
  const requiredPathsRaw = option("required-paths", "");
  const requiredPaths = requiredPathsRaw ? requiredPathsRaw.split(",").map((path) => path.trim()) : [];
  const route = option("route", null);
  const method = option("method", "GET").toUpperCase();
  if (command === "scaffold" && method === "POST" && (!route || !process.argv.includes("--assert-read-only-post"))) {
    throw new Error("POST scaffolding requires one exact --route and --assert-read-only-post");
  }
  const report = await auditOrigin({
    origin,
    route,
    method,
    requiredPaths,
    maxRoutes: Number(maxRoutesRaw),
    publicDns: process.argv.includes("--public-dns"),
    requireBazaar: process.argv.includes("--require-bazaar"),
    requirePurchaseEvidence: process.argv.includes("--require-purchase-evidence"),
  });
  const result = command === "scaffold"
    ? createPurchaseEvidenceScaffold({
      report,
      serviceVersion: option("service-version"),
      assertReadOnlyPost: process.argv.includes("--assert-read-only-post"),
    })
    : report;
  const output = command === "audit" && format === "text"
    ? textReport(report)
    : `${JSON.stringify(command === "audit" && format === "sarif" ? toSarif(report) : result, null, 2)}\n`;
  const outputPath = option("out");
  if (outputPath) await fs.writeFile(outputPath, output, { encoding: "utf8", mode: 0o600 });
  else process.stdout.write(output);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`agent-payment-integrity failed: ${error.message}`);
  process.exitCode = 1;
});
