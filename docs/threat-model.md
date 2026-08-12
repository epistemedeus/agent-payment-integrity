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

POST operations receive static OpenAPI contract analysis only. The package does
not synthesize or transmit a POST body, because even an unpaid request can
create work or mutate state before payment middleware runs. A POST result is
therefore never labeled machine-buyable until a separate controlled runtime
challenge probe supplies an explicit non-secret fixture.

An unpaid challenge proves only the seller's advertised contract at one point
in time. It does not prove paid delivery, settlement, catalog indexing, seller
identity, or future availability.

The optional `--public-dns` mode is an explicit operator choice for CI
sandboxes whose system resolver maps public hosts into reserved synthetic
addresses. It resolves through DNS-over-HTTPS and pins the public result. Do not
use it when auditing intentional split-horizon or private DNS names.
