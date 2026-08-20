# Contributing

Open an issue with the exact public resource URL, expected result, observed
controlled finding code, and whether the failure reproduces without credentials
or payment. Do not attach payment headers, wallet material, API keys, cookies,
or private response bodies.

Run `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run` before a pull
request. New failure classes require a credential-free fixture. Skill changes
must keep `skill.test.mjs` passing without adding wallet, signing, or paid
probe instructions. Action contract tests live in `action.test.mjs` and must
keep nested `uses:` lines pinned to full commit SHAs, with no secret inputs.
Do not add `.github/workflows` files from an OAuth app token that lacks
`workflow` scope. Packed npm contents must include `skills/` and exclude the
GitHub Action tree; the action is consumed from git.
