# Threat model

The audited seller is untrusted. Its DNS, OpenAPI documents, HTTP response
headers, and embedded Bazaar examples may be malformed, oversized, stale, or
crafted to redirect a CI runner into a private network.

The package therefore:

- accepts only credential-free HTTPS origins on port 443;
- rejects user information and credential-like required query parameters;
- resolves DNS, rejects non-public addresses, and pins one approved address for
  the TLS request;
- preserves the original hostname for TLS SNI and certificate validation;
- refuses redirects and caps time, headers, and body bytes;
- stores no raw payment credentials or opaque server state;
- sends no payment header and has no wallet or signing code.

Purchase-evidence discovery accepts only one link that combines registered
`describedby` with the exact absolute relation published by
`agent-payment-policy`. The target must be same-origin. Generic API
documentation, duplicate matches, cross-origin targets, redirects, malformed
manifests, digest drift, operation drift, and current-OpenAPI schema or
required-path drift fail closed when the gate is required.

POST operations receive static OpenAPI contract analysis only. The package does
not synthesize or transmit a POST body, because even an unpaid request can
create work or mutate state before payment middleware runs. A POST result is
therefore never labeled machine-buyable until a separate controlled runtime
challenge probe supplies an explicit non-secret fixture.
The optional purchase-evidence gate for POST reads only the free OpenAPI
entry-point response and the same-origin manifest. It does not weaken the
no-POST boundary.

An unpaid challenge proves only the seller's advertised contract at one point
in time. It does not prove paid delivery, settlement, catalog indexing, seller
identity, or future availability.

The optional `--public-dns` mode is an explicit operator choice for CI
sandboxes whose system resolver maps public hosts into reserved synthetic
addresses. It resolves through DNS-over-HTTPS and pins the public result. Do not
use it when auditing intentional split-horizon or private DNS names.

The reusable GitHub Action is the same CLI. It accepts only bounded origin and
route inputs, runs `audit`, and never exposes `scaffold`. Nested actions are
pinned by commit SHA. The audit step clears `GITHUB_TOKEN`, `GH_TOKEN`,
`NPM_TOKEN`, and `NODE_AUTH_TOKEN` before `npm ci --ignore-scripts` and before
the CLI. Failures emit `::error::` annotations and always write a GitHub-safe
SARIF file, including when the CLI throws before `--out`. Artifact URIs are
relative `seller-contract/...` paths so code scanning does not reject an
`https` scheme against a `file://` checkout. Optional SARIF upload uses the
caller job's default GitHub token and requires `security-events: write`. The
action has no secret inputs, wallet, signer, payment executor, write request,
or production mutation.
