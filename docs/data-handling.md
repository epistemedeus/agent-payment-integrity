# Data handling

The report retains the audited origin, HTTP method, route names, HTTP status, controlled
finding codes, and normalized public payment economics. It does not retain
query values, raw `Payment-Required` or `WWW-Authenticate` headers, MPP opaque
state, response bodies, payment credentials, addresses of callers, or secrets.

Caller-required response paths are retained only as bounded dotted field names.
For POST operations, no request body is constructed, transmitted, or retained;
the report records that the runtime challenge remains unverified.

Use non-sensitive examples in required OpenAPI query parameters. A parameter
whose name resembles a credential is rejected before any route probe.
