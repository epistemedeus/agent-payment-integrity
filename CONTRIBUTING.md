# Contributing

Open an issue with the exact public resource URL, expected result, observed
controlled finding code, and whether the failure reproduces without credentials
or payment. Do not attach payment headers, wallet material, API keys, cookies,
or private response bodies.

Run `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run` before a pull
request. New failure classes require a credential-free fixture. Skill changes
must keep `skill.test.mjs` passing without adding wallet, signing, or paid
probe instructions. Action contract tests live in `action.test.mjs` and must
keep nested `uses:` lines pinned to full commit SHAs, with no secret or
`token:` inputs. SARIF upload must consume `steps.audit.outputs.sarif-path`,
not the raw `out` input, and must skip fork `pull_request` jobs. Do not add
`.github/workflows` files from an OAuth app token that lacks `workflow`
scope. Packed npm contents must include `skills/` and exclude the GitHub
Action tree; the action is consumed from git. The optional release-smoke
workflow must remain `workflow_dispatch` only, must check out an explicit
full 40-character commit SHA, must verify the resulting `HEAD` before it runs
the local composite Action with `upload-sarif` false, and must not use secrets,
wallets, or payments.

For releases, update the version in the package manifest and lockfile.
The SARIF tool version and packed filename follow the manifest. Keep skill
CLI instructions tied to the same checkout. Run full CI and the release
smoke on the exact candidate tree before tagging. After the tested release
is published, verify that the annotated tag resolves to the tested commit,
then update the recommended Action pin in the README, workflow example and
skill together. Do not retag or move pins already used by customers.

Set `pack_cli=true` on that same smoke dispatch to produce the Git-free CLI
archive. The workflow checks source and dependency-lock identity, installs the
archive in an empty directory and receives a live unpaid quote. Download the
`verified-integrity-cli` artifact from the successful run. Check its
`RECEIVING.json` source and version against the signed tag and verify
`SHA256SUMS`. Attach only the versioned archive and checksum to the new GitHub
release. Never replace a previously published archive to roll forward.
