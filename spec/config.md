# Pulse — configuration and storage

## projects.yaml

Lives in the data directory (`/data/projects.yaml` in the container).
Reloaded on the fly. Invalid entries don't crash the app — they are listed
as errors while valid projects keep working.

```yaml
settings:                     # optional
  healthInterval: 30s         # availability check period (default 30s)
  stepTimeout: 10s            # default step timeout (10s)
  runTimeout: 5m              # whole-run safety cap (5m): main steps are aborted,
                              # the run is marked failed with a timeout message,
                              # cleanup still executes
  bodyLimit: 256kb            # stored response body cap, longer bodies are truncated

projects:
  - id: myapi                 # stable key, [a-z0-9-]; runs are stored under it —
                              # do not change after the first run
    name: my-api              # UI name, defaults to id
    hosts:                    # named hosts; the active one is switched in the header,
      local: http://host.docker.internal:8080   # the choice persists in state.json
      stand: https://stand.example.com
    # baseUrl: http://…       # shorthand for a single host (same as hosts: {local: …})
    # scenariosDir: /path     # optional override; by default scenarios live in
                              # Pulse's own storage /data/scenarios/<id>
    healthPath: /health       # optional; without it the active host root is probed
    stepTimeout: 15s          # optional per-project override
    runTimeout: 10m           # optional per-project override
```

Hosts can also be added from the UI ("add host…" in the host menu) — those are
stored in `state.json`, not in this file. Switching hosts does not touch
absolute `url:` values inside scenarios — use a scenario variable for those.

## Environment variables

- `PULSE_PORT` — HTTP port (default 7100). The only exposed port: UI, API and SSE.
- `PULSE_DATA_DIR` — data directory (default `/data`).
- `PULSE_USER` / `PULSE_PASSWORD` — the single account, Postgres-style.
  No password → auth is off (local mode). With a password the API requires
  a session: the UI shows a login form, the session cookie lasts a year,
  tokens are stored in `/data/sessions.json` and survive restarts; changing
  the password revokes all sessions. CI can skip cookies and send
  `Authorization: Bearer <PULSE_PASSWORD>`.

## Data directory layout

```
/data
  projects.yaml
  scenarios/<projectId>/**    # Pulse-owned scenario storage: written by agents,
                              # the UI import button, or copied by hand;
                              # folders become groups. Rename/move/delete happens
                              # in the UI; run history follows renames
  runs/<projectId>/<scenarioKey>/
    index.jsonl               # one summary line per run (status, minimap, host, trigger)
    000129/
      run.json                # full run record (see events.md)
      scenario.yaml           # copy of the scenario at launch time
  state.json                  # active host per project, UI-added hosts, deploy suite
  sessions.json               # auth session tokens (sha256), when auth is on
```

`scenarioKey` is the relative file path with `/` replaced by `__` and the
extension dropped: `auth/login.yaml` → `auth__login`. Run numbers are
a per-scenario monotonic counter.

## Secrets

Values of `secret: true` variables never reach the data directory: in
run records and events they are replaced with `•••` everywhere they were
interpolated. Values captured from responses (tokens) are stored as-is —
the Raw view shows them unmasked by design.

## Docker

```yaml
services:
  pulse:
    image: pulse
    ports: ["7100:7100"]
    # environment:
    #   PULSE_PASSWORD: change-me   # auth is off without it
    volumes:
      - pulse-data:/data
    extra_hosts: ["host.docker.internal:host-gateway"]
volumes:
  pulse-data:
```

Services on the Docker host are addressed as `host.docker.internal`; on a stand
where everything shares one network — by service name. For agents writing
scenario files from the host, a bind mount (`~/pulse-data:/data`) is more
convenient than a named volume.

## CI / deploy suite

Scenarios marked "Run on deploy" in the UI form the deploy suite (stored in
`state.json`). A pipeline triggers it after a deploy:

```
POST /api/projects/<id>/ci/run
Authorization: Bearer $PULSE_PASSWORD
{"host": "stand"}                # optional; also accepts "scenarios": [paths]
```

Pulse runs the suite sequentially and waits: HTTP 200 when everything passed,
422 when something failed — `curl --fail` breaks the job. The body lists every
scenario with its run number, status, failed step and duration. Suite runs are
recorded in the shared history with a `ci` trigger mark.
