# pulse

Visual e2e runner for HTTP APIs. Agents or humans drop YAML scenarios into a
folder — Pulse picks them up, runs them against your backend and shows every
step live: requests, responses, checks, captured variables, timings.

![run screen](.github/screenshot.png)

## Why

Poking a business flow by hand — curl, Postman, Swagger — is slow, and the
result disappears the moment you close the terminal. Pulse turns a flow like
*"sign in, create an order, verify the totals and access rules"*
into a YAML file that runs in seconds and leaves a browsable record: what was
called, with which payload, what came back, which check failed and where the
time went.

Scenarios are written by hand or by a coding agent working from [SPEC.md](SPEC.md) —
the format is deliberately small: linear steps, explicit expectations, variable
capture between steps, retries, a cookie jar and teardown. No branching, no
embedded scripts.

## Features

- **Live runs** — every step streams to the browser as it executes; expected
  negative responses (401 on a burned token) count as passing steps
- **Full step detail** — request as fields / cURL / raw, response as tree /
  JSON / raw, every check with expected vs actual, captured variables with
  their consumers
- **History and diff** — every run is stored; compare two runs step by step
  with durations and deltas
- **Multiple hosts per project** — run the same scenarios against localhost or
  a stand, switch in the header, add hosts ad hoc
- **Deploy suite** — mark scenarios "Run on deploy" and trigger them from CI
  with a single request; non-zero suite result fails the pipeline
- **Teardown** — `cleanup:` steps run even after a failure and keep test data
  from piling up, strictly through the API
- **Single-account auth** — Postgres-style `PULSE_USER` / `PULSE_PASSWORD`
  env vars; sessions survive restarts; no password — no login screen

## Quick start

```sh
docker run -d --name pulse -p 7100:7100 \
  -v pulse-data:/data \
  --add-host host.docker.internal:host-gateway \
  ghcr.io/kebabovicz/pulse:latest
```

The image is published by CI on every push to `main` (and `vX.Y.Z` git tags).
While the repository is private the package is private too — `docker login ghcr.io`
with a token that has `read:packages` first. Or build from source:

```sh
docker build -t pulse .
```

Open http://localhost:7100 — the empty state points you to the config.
Describe your project in `/data/projects.yaml`:

```yaml
projects:
  - id: myapi
    name: my-api
    hosts:
      local: http://host.docker.internal:8080
    healthPath: /health
```

Put a scenario into `/data/scenarios/myapi/` (or use the import button):

```yaml
name: smoke
steps:
  - id: health
    request: { method: GET, path: /health }
    expect: { status: 200 }
```

It appears in the sidebar by itself. Press run.

The full scenario format — checks, captures, retries, cookies, cleanup — is in
[SPEC.md](SPEC.md). Configuration, storage layout and the CI endpoint are in
[spec/config.md](spec/config.md).

## CI integration

Mark scenarios as "Run on deploy" in the UI, then call from your pipeline after
a deploy:

```sh
curl --fail-with-body -sS -X POST \
  -H "Authorization: Bearer $PULSE_PASSWORD" \
  -H "content-type: application/json" \
  -d '{"host":"stand"}' \
  https://pulse.example.com/api/projects/myapi/ci/run
```

200 — all scenarios passed; 422 — the body tells you which scenario and step
failed, and the run is waiting in the Pulse history with full detail.

## Development

```sh
npm install
npm run dev     # server :7100 + vite dev server :5173 with /api proxy
npm run build   # shared types, server, web bundle
```

Monorepo: `packages/shared` (types + scenario JSON Schema), `packages/server`
(Fastify, runner, SSE), `packages/web` (React + Vite). Local dev config lives
in `.local/data/projects.yaml`.

---

Author: [kebabovicz](https://github.com/kebabovicz)
