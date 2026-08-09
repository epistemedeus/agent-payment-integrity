# Incumbent boundary

This package is not a replacement for the proposed x402 Foundation
`x402-doctor`, Coinbase's validation endpoint, AgentCash discovery checks,
`mppx validate`, or AgentMint Verify.

The deliberately narrow residual is one local CI run that:

- enumerates paid GET operations from seller-owned OpenAPI documents;
- constructs the complete credential-free crawler request;
- applies the official Bazaar extension and spec validators;
- checks Bazaar input and output examples against their own JSON Schemas;
- binds the complete x402 request URL, including query values;
- compares live x402 and MPP public economics; and
- compares live MPP economics with the seller's MPP OpenAPI offers.

The x402 doctor proposal goes further on x402 catalog digests and discovery-path
diagnostics. AgentMint provides a hosted single-endpoint challenge and discovery
check. `mppx` remains the authoritative MPP validator and dual-protocol client.
If one mature free tool covers the combined residual, this public package should
stop expanding and remain only an internal release gate.
