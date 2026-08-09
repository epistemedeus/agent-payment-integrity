# Security

Report a vulnerability privately to `contact@samedaydesk.com` with the subject
`agent-payment-integrity security report`.

The CLI is credential-free and never signs or sends a payment. It probes URLs
declared by an operator, so run it in a CI environment that does not expose
cloud metadata or other privileged network services. The network client pins a
public DNS result for each request, refuses redirects, limits response bytes,
and rejects literal or resolved non-public addresses.
