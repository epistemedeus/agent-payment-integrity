# Contributing

Open an issue with the exact public resource URL, expected result, observed
controlled finding code, and whether the failure reproduces without credentials
or payment. Do not attach payment headers, wallet material, API keys, cookies,
or private response bodies.

Run `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run` before a pull
request. New failure classes require a credential-free fixture.
