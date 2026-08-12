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
7. Each exact paid GET operation declares an admissible self-contained JSON
   success schema with typed required fields and recursively guaranteed paths.

It emits text, JSON, or SARIF and exits nonzero on a contract failure. It has no
wallet, signer, facilitator credential, payment executor, or paid probe.

Response-contract evidence comes from `agent-payment-policy@0.11.1`. Reports
retain only the exact route binding, schema digest, required fields and paths,
controlled structural findings, and example consistency. They do not retain the
seller schema, example values, query values, credentials, or payment material.

## Try it

```bash
git clone https://github.com/epistemedeus/agent-payment-integrity.git
cd agent-payment-integrity
npm ci --ignore-scripts
npm test
node cli.mjs audit --origin https://agents.samedaydesk.com
node cli.mjs audit --origin https://agents.samedaydesk.com --route /commerce/payment-offer-preflight --max-routes 1
node cli.mjs audit --origin https://agents.samedaydesk.com --require-bazaar
node cli.mjs audit --origin https://agents.samedaydesk.com --format sarif --out audit-result.sarif
```

Use `--require-bazaar` when catalog eligibility is an explicit deployment gate.
Without it, a missing Bazaar extension remains visible in the report but does
not make an otherwise coherent payment transport fail.

Use `--route` to audit one exact declared paid GET route. Whole-origin audits
are capped at 64 paid routes by default, and `--max-routes` can lower that bound
for CI or hosted execution.

CI sandboxes that intentionally synthesize public DNS into reserved addresses
can add `--public-dns`. That explicit mode resolves through DNS-over-HTTPS and
still pins a public result into the TLS request. The default honors the system
resolver and fails closed on any non-public answer.

## CI example

```yaml
- run: npm ci --ignore-scripts
- run: node cli.mjs audit --origin https://seller.example --format sarif --out audit-result.sarif
```

The network client accepts only credential-free HTTPS origins on port 443,
rejects required query parameters that resemble credentials, blocks literal or
resolved private addresses, pins an approved DNS result into the TLS request,
refuses redirects, and caps response time, headers, and bytes.

## Candidate status

This is a reference candidate, not a catalog-indexing guarantee or paid-service
quality score. An unpaid challenge cannot prove settlement or paid delivery.
The package will remain unpublished on npm until an external integration or
design review establishes that the interface is worth stabilizing.

See [the threat model](docs/threat-model.md) and
[data-handling boundary](docs/data-handling.md). The
[incumbent boundary](docs/incumbent-boundary.md) states what this package does
not replace and the condition that stops further public expansion.
