#!/usr/bin/env node

import fs from "node:fs/promises";

import { auditOrigin, toSarif } from "./integrity.mjs";

function usage() {
  return `agent-payment-integrity

Usage:
  agent-payment-integrity audit --origin https://seller.example [--format json|text|sarif] [--out path] [--public-dns] [--require-bazaar]

The audit fetches /openapi.json and optional /mpp-openapi.json, then performs
credential-free GET probes. It never signs or sends a payment.`;
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
    lines.push(`${route.valid ? "PASS" : "FAIL"} GET ${route.route} [${route.protocols.join("+") || "none"}]`);
    for (const finding of route.findings) lines.push(`  ${finding}`);
  }
  lines.push("No credentials used. No payment signed. No payment sent.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const command = process.argv[2];
  if (command !== "audit") {
    console.error(usage());
    process.exitCode = command === "--help" || command === "-h" ? 0 : 2;
    return;
  }
  const origin = option("origin");
  if (!origin) throw new Error("--origin is required");
  const format = option("format", "text");
  if (!["json", "text", "sarif"].includes(format)) throw new Error("--format must be json, text, or sarif");
  const report = await auditOrigin({
    origin,
    publicDns: process.argv.includes("--public-dns"),
    requireBazaar: process.argv.includes("--require-bazaar"),
  });
  const output = format === "text"
    ? textReport(report)
    : `${JSON.stringify(format === "sarif" ? toSarif(report) : report, null, 2)}\n`;
  const outputPath = option("out");
  if (outputPath) await fs.writeFile(outputPath, output, { encoding: "utf8", mode: 0o600 });
  else process.stdout.write(output);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`agent-payment-integrity failed: ${error.message}`);
  process.exitCode = 1;
});
