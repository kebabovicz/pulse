# Pulse — run events and run.json

One principle: **screen state is a fold of the event stream**. A live run is
rendered from SSE events; `run.json` is the same fold carried to completion and
saved. Historical and live runs share the rendering code.

## Transport

A single SSE endpoint: `GET /api/events`. Every event is JSON with an envelope:

```json
{ "type": "step-finished", "ts": "2026-08-24T12:04:37.412+05:00",
  "project": "myapi", "scenario": "auth/login.yaml", "run": 129, "...": "payload" }
```

`project` is always present; `scenario` and `run` only on run events. On
reconnect the client refetches current state over REST; events are not replayed.

## Events outside a run

- `health-changed` — `{ status: "up" | "down", reason?, checkedAt }`
- `scenario-changed` — `{ path, action: "added" | "updated" | "removed", summary? }`
  where summary is the scenario list entry (name, stepCount, valid, error).

## Run events

- `run-started` — everything static in one event: `scenarioName`, `scenarioHash`,
  `host`, `vars` (secret values already masked), `varUsage` (who captured →
  who consumes, computed statically), `steps` — the full plan from YAML, so the
  UI renders all rows as pending immediately; cleanup steps carry `cleanup: true`.
- `step-started` — `{ stepId, attempt }`
- `step-progress` — sleep steps only, once a second: `{ stepId, remainingMs }`
- `step-retry` — `{ stepId, attempt, maxAttempts, failed: ["status", "body[0]"], nextDelayMs }`
- `step-finished` — the full step result; statuses `passed | failed | skipped`:
  - `request` — snapshot after interpolation; `substitutions` list
    `{location, var, fromStep}` powers the "← accessToken from step refresh" links
  - `response` — `{ status, durationMs, sizeBytes, contentType, headers, body,
    bodyEncoding?, bodyTruncated }`; body is always a string, binary is base64
  - `checks` — every check in YAML order with `expected`/`actual` (interpolated)
    and `passed`; all evaluated even after the first failure
  - `captures` — `{ name, from, detail, value }` previews
  - network failure: `response: null`, `error: { kind: "network", message }`
- `run-finished` — `{ status, durationMs, failedStep?, failedCheck?, cleanupFailed?, message? }`.
  Run statuses: `passed | failed | stopped | error`. The verdict is decided by
  main steps only; `cleanupFailed` flags teardown problems separately.

## run.json

The fold of the same stream, one file per run: run metadata (`host`, `trigger`
for CI runs, `scenarioHash`, vars, varUsage) plus `steps` — plan entries merged
with their `step-finished` payloads. Comparing two runs is stitching two
run.json files by `stepId`. The per-scenario history list is served from
`index.jsonl` summaries without reading full records.
