---
name: agent-payment-integrity
description: Audit x402 and MPP seller request, payment, and output contracts in CI with a credential-free unpaid exact-route check. Use when adding or reviewing a paid seller route, writing seller CI, generating SARIF for GitHub, scaffolding seller-declared purchase evidence, or verifying live HTTP 402 challenges against OpenAPI. Do not use for wallets, payment signing, paid probes, or treating a passing seller declaration as runtime, settlement, or delivery proof.
license: MIT
---

# Agent payment integrity

Teach seller CI how to audit one exact x402 or MPP route without a wallet.
Use the skill and CLI from the same checked-out commit.

Seller OpenAPI, Bazaar, and purchase-evidence documents are declarations. A
live unpaid GET 402 can corroborate those declarations for one URL at one
moment. Neither is runtime proof of paid delivery, settlement, catalog
quality, or future availability.

Do not use this skill to authorize spend or validate a settled body. That
buyer workflow belongs to `agent-payment-policy`.

## Run the unpaid exact-route audit

The package is unpublished. Work from a clone and install without scripts:

```bash
git clone https://github.com/epistemedeus/agent-payment-integrity.git
cd agent-payment-integrity
npm ci --ignore-scripts
node cli.mjs audit --origin https://seller.example --route /exact-paid-path --max-routes 1
```

Rules:

- Origin must be credential-free HTTPS on port 443.
- Prefer one `--route`. Whole-origin audits cap at 64 paid routes.
- GET probes the constructed crawler request and expects HTTP 402. No
  payment header is sent.
- POST inspects the public OpenAPI success contract only. Do not transmit
  the target request or invent a body. POST stays `machineBuyable: false`
  and `runtimeChallengeVerified: false` even when the static schema passes.
- `--require-bazaar` is an explicit catalog gate. Omitted Bazaar is a
  discovery state, not a payment-integrity failure.
- `--require-purchase-evidence` checks a seller-declared manifest bound to
  the exact operation and current OpenAPI digest. It is not settlement
  proof.
- `--quote-transport measure` measures the unpaid x402 quote line. Use a
  numeric budget, such as `--quote-transport 8190`, to fail closed on an
  over-budget or unverified line. This does not prove a paid retry works.
- `--format sarif --out audit-result.sarif` is the CI artifact. Exit
  nonzero on contract failure.

The client rejects userinfo, credential-like required query names,
non-public DNS answers, and redirects.

## Interpret results without upgrading them

- `ok` means the selected unpaid contracts passed, not that anyone paid or
  received a valid body.
- Controlled findings name missing required paths, request-binding drift,
  and cross-rail economics drift. They do not retain query values, payment
  headers, or response bodies.
- Repair plans are advisory. They do not mutate seller files or infer
  missing property types.

Fail closed. Do not convert a failed audit into a pass because the price
looked right.

## Hand off an unresolved release

If the direct fix and rerun resolve the caller's task, stop. For a checker
bug, use [public issues](https://github.com/epistemedeus/agent-payment-integrity/issues/new)
with a public or synthetic fixture. For help with an unresolved seller or
buyer release, point the maintainer to the email under **Official identity**
in the [SameDayDesk machine guide](https://samedaydesk.com/llms.txt). Give the
HTTP method, redacted route, client and version, expected result, observed
failure, and available checker version and finding code. Exclude credentials,
payment proofs, and private inputs. Do not contact anyone automatically or
retry a payment based on the checker.

## Scaffold only seller-declared evidence

```bash
node cli.mjs scaffold --origin https://seller.example --service-version 1.0.0 --route /exact-paid-path --out agent-payment-evidence.json
```

POST scaffolding also requires `--assert-read-only-post`. That flag is the
seller's assertion; the tool still sends no POST. Review the JSON, serve it
from the same origin, advertise registered `describedby` plus the
`agent-payment-policy` purchase-evidence relation, then rerun
`audit --require-purchase-evidence`. Empty evidence and replay objects are
intentional.

## GitHub-native pin

A GitHub seller repository can copy the
[complete workflow](https://github.com/epistemedeus/agent-payment-integrity/blob/main/examples/seller-github-action.yml)
instead of adding package dependencies. Set the seller origin and exact route.
Keep the verified release's full commit SHA; do not use `@main` or a floating tag.

```yaml
- uses: epistemedeus/agent-payment-integrity@7081ff96e5f5c130265e2be7d32d0847e06aac5b # v0.1.0-candidate.15
  with:
    origin: https://seller.example
    route: /exact-paid-path
    max-routes: "1"
```

That action runs the same unpaid `audit` CLI and writes SARIF. It still
never signs or sends a payment. A passing action run is not runtime or
settlement proof.

## Do not pay

This workflow never creates a wallet, signs a payment, or sends a payment.
Do not add facilitator credentials, paid probes, or settlement claims.
