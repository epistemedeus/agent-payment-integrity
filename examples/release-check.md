# Worked example: is this release ready for a buyer who needs a watch ID?

**Sample only.** This is a fictional `GET /watch` operation. Run it without a
seller account or a wallet. It does not make an HTTP request, buy an API result
or represent a completed customer job.

The buyer needs `deliverable.watch_id` to keep using the watch. Both revisions
return the same simulated, correctly bound unsigned payment challenge. Both
show an ID in their example response. The result differs:

| Evidence | Candidate | After fixing the declaration |
| --- | --- | --- |
| Unsigned challenge binds to `GET /watch` in the fixture | Yes | Yes |
| Success schema guarantees `deliverable.watch_id` | No, the declared property is optional | Yes |
| Decision for this requirement | Hold | Declared contract passes |

**One correction:** if the live seller confirms it always returns the ID on
success, add `watch_id` to the `deliverable` object's `required` list, then rerun
the check. If the seller cannot guarantee the ID, keep the decision on hold or
use another operation. The revised declaration alone does not prove a live
response, paid delivery or settlement.

**Rerun from this repository:** after `npm ci --ignore-scripts`, run
`node examples/release-check.mjs`. The command prints both machine-readable
verdicts using the same checker as the CLI. Dependencies are needed for setup;
the worked example itself is offline and does not use real buyer inputs.
