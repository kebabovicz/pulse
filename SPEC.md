# Pulse scenario format

Pulse runs e2e scenarios against HTTP APIs and visualizes every run. A scenario
is a YAML file in the project's scenario folder. This document is the contract
for whoever writes scenarios — a human or an agent. Files are validated against
`packages/shared/scenario.schema.json`; a file that fails validation is marked
invalid and cannot run.

## Rules

- **One file — one scenario.** Files live in the project's scenario folder
  (`.yaml`), subfolders become groups in the UI. Changes are picked up on save.
- **Scenarios are linear.** Steps run strictly in order; there are no branches,
  conditions or loops. A flow that needs branching is two scenarios.
- **Intent is explicit.** Every request step must declare `expect.status`.
  An expected 401 is a passing step.
- **Step status comes from checks**, not from the response code.
- **Variables share one flat namespace.** `vars` values and captured values live
  in a single dictionary; interpolation is always `{{name}}`. You may only
  reference names defined above: `vars` or captures of earlier steps.
  A forward or unknown reference fails validation.
- **Capturing into a taken name fails validation.** New value — new name
  (`accessToken`, `accessToken2`).

## File structure

```yaml
name: string # required: short scenario name
description: string # optional: one sentence on what is verified
vars: {} # optional: run parameters
steps: [] # required: at least one step
cleanup: [] # optional: teardown steps, see below
```

### vars

Parameters the user sees and can override before a run.

```yaml
vars:
  phone:
    default: '{{random.phone}}' # default value; generators allowed
  devApiKey:
    secret: true # masked in the UI and in stored runs
    default: ''
```

### Step

Exactly one action per step: `request` or `sleep`.

```yaml
- id:
    create-user # required: [a-z0-9-], unique across steps and cleanup.
    # Runs are matched by id — don't rename without a reason.
  name: Create user # optional: human-readable name for the UI
  timeout: 10s # optional: request timeout (default from project config)
  request: { ... } # the action; or `sleep: 3s`
  retry: { ... } # optional
  expect: { ... } # required with request
  capture: { ... } # optional
  cookies: { ... } # optional
```

Durations everywhere: `500ms`, `3s`, `1m`.

### request

```yaml
request:
  method: POST # GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  path: /api/v1/users # relative to the project's active host
  # url: https://...              # absolute URL instead of path (not affected by host switching)
  query: { page: 1 }
  headers: { X-Dev-Key: '{{devApiKey}}' }
  body: { phoneNumber: '{{phone}}' } # object/array is sent as JSON
  # body: "raw text"              # string is sent as-is; set contentType
  # contentType: text/plain
```

### expect

```yaml
expect:
  status: 201 # number or list: [200, 201]
  headers:
    content-type: application/json # substring match
  body:
    - path: $.id # JSONPath into the body; exactly one predicate per check:
      exists: true #   exists: true | false
    - path: $.phoneNumber
      equals: '{{phone}}' #   equality (interpolation works)
    - path: $.error
      matches: 'token_.*' #   regular expression
    - path: $.items
      type: array #   string | number | boolean | object | array | null
    - text: true # whole non-JSON body
      matches: 'Auth code: \d{6}'
```

All checks of a step are evaluated even after the first failure — the report
shows every one.

### capture

Capture values from the response for later steps.

```yaml
capture:
  userId: { from: body, path: $.id } # JSON body field
  foundId: { from: body, path: "$.items[?(@.name=='X')].id" } # filters work here too
  otpCode: { from: body, regex: 'code: (\d{6})' } # first regex group
  accessToken:
    { from: body } # whole body as a string, byte for byte:
    # a JSON scalar keeps its quotes — use regex for the bare value
  requestId: { from: header, name: x-request-id }
  refreshToken: { from: cookie, name: refreshToken } # from the response Set-Cookie
```

### cookies

A cookie jar spans the whole run automatically: `Set-Cookie` from responses is
sent with subsequent requests. Override when needed:

```yaml
cookies:
  clear: true # empty the jar before this request
  set: { refreshToken: '{{oldToken}}' } # force a value over the jar
```

### retry

```yaml
retry:
  attempts: 10 # max attempts
  delay: 1s # pause between attempts
```

The step repeats until `expect` fully passes or attempts run out. Use it to
poll async results (a dev mailbox, a background job) instead of a long `sleep`.

### cleanup

Teardown steps — same shape as regular steps. They run **after** the main steps,
**including after a failure** (that is when teardown matters most); they are
skipped only when the run is stopped manually. A failed cleanup step does not
change the run verdict but flags the run with a warning; cleanup steps never
skip each other. Cleanup can reference every variable captured by main steps.

```yaml
cleanup:
  - id: delete-draft
    request: { method: DELETE, path: /api/v1/drafts/{{draftId}} }
    expect: { status: [204, 404] }   # 404 — nothing left to remove, also fine
```

Clean up through the API only: Pulse deliberately has no database access.

## Interpolation

- `{{name}}` — a variable from `vars` or `capture`. Works in `path`, `url`,
  `query`, `headers`, `body`, `equals`, `matches`, `cookies.set`. In `matches`
  the value is inserted into the regex as-is, unescaped.
- Generators (computed once per run, at first use):
  - `{{random.phone}}` — +79XXXXXXXXX, unique per run
  - `{{random.uuid}}` — UUID v4
  - `{{random.digits(6)}}` — N random digits
  - `{{random.string(8)}}` — N latin letters and digits
  - `{{timestamp}}` — unix time of the run start, seconds
  - `{{runStartedAt}}` — ISO time of the run start; with `gt` it verifies
    freshness — that data was produced by this run, not served from a cache
- An unknown interpolation fails validation before the run, naming the step.

## Full example

```yaml
name: order-flow
description: Sign in, create an order, wait for processing, tidy up

vars:
  login:
    default: demo
  password:
    secret: true
    default: ''

steps:
  - id: sign-in
    request:
      method: POST
      path: /api/auth/login
      body: { login: '{{login}}', password: '{{password}}' }
    expect:
      status: 200
      body:
        - path: $.token
          exists: true
    capture:
      token: { from: body, path: $.token }

  - id: create-order
    request:
      method: POST
      path: /api/orders
      headers: { Authorization: 'Bearer {{token}}', Idempotency-Key: '{{random.uuid}}' }
      body: { sku: 'demo-1', qty: 2 }
    expect:
      status: 201
      body:
        - path: $.id
          exists: true
    capture:
      orderId: { from: body, path: $.id }

  - id: order-processed
    request:
      method: GET
      path: /api/orders/{{orderId}}
      headers: { Authorization: 'Bearer {{token}}' }
    retry: { attempts: 10, delay: 1s }
    expect:
      status: 200
      body:
        - path: $.status
          equals: processed
        - path: $.qty
          equals: 2

  - id: unauthorized-read
    request:
      method: GET
      path: /api/orders/{{orderId}}
    expect:
      status: 401

cleanup:
  - id: delete-order
    request:
      method: DELETE
      path: /api/orders/{{orderId}}
      headers: { Authorization: 'Bearer {{token}}' }
    expect:
      status: [204, 404]
```

## Checklist before saving

1. Every step has a unique `id`; every `request` has `expect.status`.
2. Every `{{interpolation}}` is defined above it: in `vars` or an earlier `capture`.
3. Secrets are not hardcoded — they live in `vars` with `secret: true`.
4. Expected negative outcomes (401, 404, 409) are written as `expect.status` —
   they are step successes, not failures.
5. Async results are polled with `retry`, not a long `sleep`.
6. Data the scenario creates is removed in `cleanup` — through the API.
