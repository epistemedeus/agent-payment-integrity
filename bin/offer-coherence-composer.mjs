#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  composeFromFixture,
  composeLiveGet,
} from "../src/offer-coherence-composer/compose.mjs";

function usage() {
  return `offer-coherence-composer

Usage:
  offer-coherence-composer --url https://seller.example/route?q=value
  offer-coherence-composer --fixture path/to/observation.json

Fail-closed composition of OpenAPI input names, Bazaar in/out, live unpaid 402,
canonical GET binding, example price, and required success paths.

GET live mode performs one credential-free unpaid 402 probe plus OpenAPI read.
POST sellers are fixture-only; the composer never transmits a seller POST,
never signs, and never pays. Bazaar call counts are not conversion.
Policy offer-coherence-check is not the CI oracle: drifted observations fail here.`;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const help = process.argv.includes("--help") || process.argv.includes("-h");
  if (help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const url = option("url");
  const fixturePath = option("fixture");
  if ((url && fixturePath) || (!url && !fixturePath) || process.argv.includes("--pay")) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (url && /^POST$/i.test(option("method") || "")) {
    throw new Error("composer does not transmit seller POST; pin a fixture");
  }
  const report = fixturePath
    ? await composeFromFixture(JSON.parse(readFileSync(fixturePath, "utf8")))
    : await composeLiveGet(url);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`offer-coherence-composer failed: ${error.message}`);
  process.exitCode = 1;
});
