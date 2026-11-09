# agent-payment-integrity

[![verify](https://github.com/epistemedeus/agent-payment-integrity/actions/workflows/ci.yml/badge.svg)](https://github.com/epistemedeus/agent-payment-integrity/actions/workflows/ci.yml)

Credential-free CI checks for machine-payment sellers using x402 and MPP.

The candidate CLI binds seller-owned declarations to the live unpaid HTTP 402
response and checks:

1. The declared crawler request reaches HTTP 402 rather than an accidental 400.
2. The x402 v2 challenge binds the complete request, including query values.
3. Every advertised Bazaar declaration passes official validators. Omission is
   recorded as a discovery state rather than a payment-integrity failure because
   Bazaar is an optional x402 extension.
4. Advertised Bazaar input and output examples satisfy their declared JSON
   Schemas.
5. Live x402 and MPP offers agree on amount, asset, network, recipient, and
   decimals where both are present.
6. MPP OpenAPI offers agree with the live challenges.
7. Each exact paid GET or POST operation declares an admissible self-contained JSON
   success schema with typed required fields and recursively guaranteed paths.
8. Caller-required dotted output paths are recursively guaranteed, rather than
   merely described or shown in an example.
9. Optional neutral purchase evidence is advertised through registered
   `describedby` plus the exact `agent-payment-policy` extension relation, binds
   the exact method and path, and still matches the seller's current OpenAPI
   schema digest and complete recursively required-path set.

It emits text, JSON, or SARIF and exits nonzero on a contract failure. It has no
wallet, signer, facilitator credential, payment executor, or paid probe.

Response-contract and purchase-evidence contracts come from
`agent-payment-policy@0.12.0`. Reports
retain only the exact route binding, schema digest, required fields and paths,
controlled structural findings, and example consistency. They do not retain the
seller schema, example values, query values, credentials, or payment material.

For caller-required paths, audit v4 also returns a bounded advisory repair plan.
It identifies declared properties that need an OpenAPI `required` membership and
missing nested properties that still need a seller-confirmed schema. It does not
infer property types, mutate seller files, or claim that a static repair matches
runtime behavior.

## Try it

For a CLI-only run without Git, use the [versioned release package and checksum](https://github.com/epistemedeus/agent-payment-integrity/releases/tag/v0.1.0-candidate.15).
Use the source checkout below when developing the checker or running its tests.

```bash
git clone https://github.com/epistemedeus/agent-payment-integrity.git
cd agent-payment-integrity
npm ci --ignore-scripts
npm test
node cli.mjs audit --origin https://agents.samedaydesk.com
node cli.mjs audit --origin https://agents.samedaydesk.com --route /commerce/payment-offer-preflight --max-routes 1
node cli.mjs audit --origin https://api.zerion.io --method POST --route /v1/wallets/simulation/transaction/ --required-paths data.attributes --max-routes 1 --public-dns
node cli.mjs audit --origin https://agents.samedaydesk.com --require-bazaar
node cli.mjs audit --origin https://agents.samedaydesk.com --require-purchase-evidence
node cli.mjs audit --origin https://agents.samedaydesk.com --format sarif --out audit-result.sarif
node cli.mjs scaffold --origin https://agents.samedaydesk.com --service-version 1.23.11 --out agent-payment-evidence.json
```

Use `--require-bazaar` when catalog eligibility is an explicit deployment gate.
Without it, a missing Bazaar extension remains visible in the report but does
not make an otherwise coherent payment transport fail.

Use `--require-purchase-evidence` when a seller release must publish the
neutral pre-purchase profile. For GET, the CLI selects the exact relation from
the live unpaid 402. For POST, it selects the same relation from the free
OpenAPI entry-point response and does not transmit a seller POST. In both cases
it verifies the manifest digest and exact operation, then cross-checks the
manifest's schema digest and complete required-path set against the current
OpenAPI declaration. A generic unrelated `describedby` link is ignored.

A matching seller manifest does not mean the route meets your requested
output. If a caller-required path is missing, the audit still fails for that
path. The manifest can remain verified when it accurately describes the
seller's narrower contract.

Use `scaffold` when a source-owning seller needs a conservative starting
manifest rather than only a verifier. It emits a deterministic manifest from a
passing audit, copies only the exact method, path, response-schema digest,
recursively required paths, and observed x402 or MPP protocol names, and leaves
the evidence and replay objects empty. It labels every claim seller-declared and
does not claim settlement, paid delivery, external verification, or permission
to spend. Review the JSON, serve it from the same HTTPS origin, advertise it
with registered `describedby` plus the exact `agent-payment-policy` relation,
and rerun `audit --require-purchase-evidence` before release. POST scaffolding
requires one exact `--route` and `--assert-read-only-post`; the flag is the
seller's explicit assertion and the tool still sends no POST.

Use `--route` to audit one exact declared paid route. Whole-origin audits
are capped at 64 paid routes by default, and `--max-routes` can lower that bound
for CI or hosted execution.

POST audits are contract-only by default. They read the seller's public OpenAPI
declaration but do not transmit a target request or synthesize a request body.
The report therefore keeps `runtimeChallengeVerified: false` and
`machineBuyable: false` even when the static contract passes. This avoids
triggering an arbitrary seller action while still identifying missing or
underconstrained success fields. GET audits retain the live unpaid 402 probe.

### Explicit MPP-only routes

An OpenAPI operation that declares MPP without x402 is audited against its
unpaid Payment challenges, not required to send an x402 header. The report
retains all normalized MPP options for this case. Exact declared Tempo/EVM
offers must match a live option on method, intent, atomic amount, token,
recipient and any explicitly declared network. An omitted declaration
network does not establish chain agreement. The x402 transport budget and
Bazaar requirement remain x402-specific. A 402 alone never sets
`runtimeChallengeVerified`: the required offers must parse and bind to the
actual x402 request or MPP realm. That flag does not replace the remaining
seller-contract checks, authorize payment, or prove delivery.

If OpenAPI declares only `x-payment-info: {"authMode":"none"}` and a live 402
contains only a same-origin zero-amount Tempo challenge, the audit reports
`zero_amount_mpp_challenge_not_paid`. It does not count a wallet-identity
challenge as a paid offer, establish that the service is anonymous, or sign
anything. A positive live offer against that declaration remains a mismatch.

### Optional x402 quote transport budget

```bash
node cli.mjs audit --origin https://seller.example --route /read --quote-transport measure
node cli.mjs audit --origin https://seller.example --route /read --quote-transport 8190 --format json
```

Use `measure` to record a size without a limit, or choose a budget of 1 to
65536 bytes for seller CI. The Action accepts the same optional
`quote-transport` input. The audit counts the observed encoded x402 value
and its actual field name, plus the two bytes in `: `. This is the canonical
HTTP/1.1 line size before its CRLF terminator. Node's parser strips surrounding
optional whitespace. The count excludes other headers and HTTP/2 framing.

JSON and SARIF retain a separate `quoteTransport` result. A budget failure,
missing or ambiguous field, unreadable quote, or unprobed POST exits nonzero
when this check is requested. The existing JSON `ok` and route findings
continue to describe the contract audit. A size fit establishes fit to the
chosen budget only. Choose a limit for your buyers and ingress. The example
8190 is a conservative full-line budget, independent of any client's parser
settings.

The unpaid check ends at the response. For paid-retry coverage, test the
actual buyer SDK with a stub signer and your local seller ingress limits,
including the whole inbound request header block. See the separate [x402
retry example](https://github.com/x402-foundation/x402/issues/3803#issuecomment-6726883152).

CI sandboxes that intentionally synthesize public DNS into reserved addresses
can add `--public-dns`. That explicit mode resolves through DNS-over-HTTPS and
still pins a public result into the TLS request. The default honors the system
resolver and fails closed on any non-public answer.

## External seller GitHub Action

For a GitHub seller repository, copy the [complete workflow](examples/seller-github-action.yml)
and set `origin` and `route` to your own HTTPS service. This example pins the
tested Action from [candidate.15](https://github.com/epistemedeus/agent-payment-integrity/releases/tag/v0.1.0-candidate.15):

```yaml
permissions:
  contents: read
  security-events: write
jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: epistemedeus/agent-payment-integrity@7081ff96e5f5c130265e2be7d32d0847e06aac5b # v0.1.0-candidate.15
        with:
          origin: https://seller.example
          route: /read
          max-routes: "1"
          upload-sarif: "true"
```

Keep the full commit SHA in CI; change it only when you choose a tested
release. Do not use `@main` or a floating tag. The Marketplace entry is a
discovery path, not the recommended pin. A passing run is seller-declared
unpaid contract evidence. It is not runtime, settlement, delivery, demand,
or adoption proof. The action accepts no secrets, installs this CLI with
`npm ci --ignore-scripts` inside the action directory, runs only `audit`,
writes SARIF, and optionally uploads the validated `sarif-path` output with
the default `GITHUB_TOKEN`. Rejected `out` paths never reach upload. Nested
report directories are created inside the workspace. Rejected origin
userinfo is not written to the job summary. Fork `pull_request` jobs skip
upload. Do not switch the example to `pull_request_target`. It has no
wallet, signer, payment, or production mutation. `upload-sarif` defaults to
false; set it true only when the job grants `security-events: write`. Copy
`examples/seller-github-action.yml` for the full workflow. The installable
skill is a separate agent-discovery surface; it does not replace this SHA
pin. The packed npm tarball ships the skill and excludes the action. The
package remains unpublished on npm.

## CI example

In this repository, or after a local clone:

```yaml
- run: npm ci --ignore-scripts
- run: node cli.mjs audit --origin https://seller.example --format sarif --out audit-result.sarif
```

The network client accepts only credential-free HTTPS origins on port 443,
rejects required query parameters that resemble credentials, blocks literal or
resolved private addresses, pins an approved DNS result into the TLS request,
refuses redirects, and caps response time, headers, and bytes.

## Install the agent skill

```bash
npx skills add epistemedeus/agent-payment-integrity
```

The skill teaches seller CI and unpaid exact-route audit. It does not treat
seller declarations as runtime, settlement, or delivery proof. The packed
package also includes `skills/agent-payment-integrity/SKILL.md`. GitHub
sellers who want a workflow pin should use the composite action above rather
than copying clone steps into application CI.

## When the check does not resolve a release

For a checker bug, [open a GitHub issue](https://github.com/epistemedeus/agent-payment-integrity/issues/new)
with a public or synthetic reproduction. For help reproducing or repairing a
specific release in your own stack, use the email under **Official identity**
in the [SameDayDesk machine guide](https://samedaydesk.com/llms.txt). Include the
HTTP method, redacted route, client and version, one expected result, one
observed failure, and the checker's version and finding code if available.
Do not include credentials, payment proofs, or private inputs. A finding
does not submit an inquiry, commission work, or authorize a retry.

## Candidate status

This is a reference candidate, not a catalog-indexing guarantee or paid-service
quality score. An unpaid challenge cannot prove settlement or paid delivery.
The package will remain unpublished on npm until an external integration or
design review establishes that the interface is worth stabilizing. The public
GitHub Marketplace listing is a discovery convenience. It does not change this
candidate boundary, publish the package
to npm, or convert a passing Action run into runtime, settlement, delivery,
demand, or adoption proof.

See [the threat model](docs/threat-model.md) and
[data-handling boundary](docs/data-handling.md). The
[incumbent boundary](docs/incumbent-boundary.md) states what this package does
not replace and the condition that stops further public expansion.
