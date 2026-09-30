# Seller repair fixtures

`action/fixtures/catalog-row-*.json` locks one catalog row to one repair
decision. A catalog row is a paid route declaration: method, path, success
schema, caller-required paths, and, for GET, an in-process unpaid 402 probe.
The checker returns a response-contract decision, an advisory OpenAPI repair
plan, and `ok`. `ok: false` is a refuse. `repairPlan.complete: true` does not
by itself pass the row.

No fixture contacts a live seller. Schemas in these files are inputs. Reports
do not retain the invalid example value `909091`, raw payment headers, query
values, or credentials. The repair plan does not mutate the schema or infer a
missing property type.

## Decisions

| Fixture | Result | Contract decision | Repair |
| --- | --- | --- | --- |
| `catalog-row-repair-complete.json` | pass | admissible | complete, no actions |
| `catalog-row-repair-add-required.json` | refuse | admissible | `add_property_to_required` for `quote` |
| `catalog-row-repair-define-property.json` | refuse | admissible | `define_and_require_property`, type null |
| `catalog-row-contract-absent.json` | refuse | absent | `define_nested_property_path` |
| `catalog-row-contract-partial.json` | refuse | partial | complete, no actions |
| `catalog-row-contract-invalid.json` | refuse | invalid | complete, no actions |
| `catalog-row-bazaar-missing.json` | refuse | admissible | complete; finding `bazaar_extension_missing` |
| `catalog-row-bazaar-present.json` | pass | admissible | complete; in-process 402 probe |
| `catalog-row-post-bazaar-unobserved.json` | pass | admissible | complete; Bazaar stays unobserved |
| `catalog-row-unsafe-query.json` | refuse | admissible | `define_and_require_property`, plus `target_invalid` |
| `catalog-row-probe-failed.json` | refuse | admissible | complete, plus `credential_free_probe_failed` |
| `catalog-row-unsafe-origin.json` | refuse | not audited | CLI and action exit 1 |

`catalog-row-bazaar-present.json` can report `machineBuyable: true` because
the in-process probe returned HTTP 402. `safety.paymentSent` and
`safety.paymentSigned` stay false.

## Early GET refusal

A caller-required repair plan is computed from the OpenAPI declaration before
any probe. Two GET refusals used to drop that plan and the response contract:

- the target could not be constructed, including a credential-like required
  query name;
- the unpaid probe function threw.

Those routes still fail closed. They now keep the contract findings, the
response contract, and the repair plan that were already computed. A healthy
schema plus a thrown probe still has the single finding
`credential_free_probe_failed`.

## Catalog gate

`--require-bazaar` refuses a GET challenge that omits the Bazaar extension.
POST audits do not send the target request and do not read a live extension.
An admissible POST row with `requireBazaar: true` stays `ok: true` and records
`discovery.bazaar.present: null`. That is not a catalog-eligibility pass.

## Run

```bash
npm test
CATALOG_ROW_CHECK=1 node integrity.catalog-repair.test.mjs action/fixtures/catalog-row-repair-add-required.json
CATALOG_ROW_CHECK=1 node integrity.catalog-repair.test.mjs action/fixtures/catalog-row-repair-complete.json
node cli.mjs audit --origin https://127.0.0.1 --route /read --max-routes 1 --format json
```

The add-required command exits 1. The complete command exits 0. The unsafe
origin command exits 1 and writes no report.
