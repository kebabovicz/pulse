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
  cache: 15m # optional: reuse this step's captures across runs, see below
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
  # multipart: { ... }            # file upload instead of body, see below
```

### multipart

A file upload — `multipart/form-data`. Use it instead of `body`; the two exclude
each other, and `contentType` is not set by hand (the boundary comes from Pulse).

```yaml
request:
  method: POST
  path: /api/v1/documents
  multipart:
    title: '{{title}}' # a scalar is a plain field; interpolation works
    published: true
    scan: { file: fixtures/passport.pdf } # a file from the scenarios folder
    photo:
      file: fixtures/photo.jpg # path is relative to the project's scenarios folder
      filename: avatar.jpg #   optional: how the field is named for the server
      contentType: image/jpeg #   optional: guessed from the extension otherwise
    meta:
      text: '{"kind":"passport"}' # inline content instead of a file
      filename: meta.json
    thumb:
      base64: 'iVBORw0KGgo…' # inline binary
      filename: thumb.png
    files: # a list repeats the field — many files under one name
      - { file: fixtures/page-1.jpg }
      - { file: fixtures/page-2.jpg }
```

- **Files live next to the scenarios**, in the project's scenarios folder
  (a `fixtures/` subfolder is the usual place). They appear in the sidebar
  beside the scenarios, with their size and who uploads them; drag a file onto a
  folder to add it, and Pulse marks a scenario whose file is missing before the
  run rather than during it. A path outside the folder, or a file that is not
  there, fails that step with an explicit error, not the whole run. The limit is
  64 MB per file.
- **`filename` defaults** to the file name for `file:`, and to the field name for
  `text:` and `base64:` — set it explicitly when the server checks the extension.
- The run screen shows every part: name, file name, type and size, so a failed
  upload tells you what actually went over the wire.

### expect

```yaml
expect:
  status: 201 # number or list: [200, 201]
  headers:
    content-type: application/json # substring match
    location: null # null — the header must be absent
  body:
    - path: $.id # JSONPath into the body; exactly one predicate per check:
      exists: true #   exists: true | false
    - path: $.phoneNumber
      equals: '{{phone}}' #   equality (interpolation works)
    - path: $.token
      notEquals: '{{oldToken}}' #   negation (interpolation works)
    - path: $.ownerId
      equalsPath: $.author.id #   equals another field of the same body
    - path: $.error
      matches: 'token_.*' #   regular expression
    - path: $.items
      type: array #   string | number | boolean | object | array | null
    - path: $.items
      minLength: 1 #   at least N items — the usual "not empty" check
    - path: $.slots
      length: 18 #   exactly N; maxLength — at most N
    - path: $.createdAt
      gt: '{{runStartedAt}}' #   greater / less than: numbers numerically,
      #   strings lexicographically (ISO dates work).
      #   A value of another type fails the check.
    - text: true # whole non-JSON body
      matches: 'code: \d{6}'
```

All checks of a step are evaluated even after the first failure — the report
shows every one.

Redirects are not followed: a 3xx is the step's own outcome. Write
`status: 302`, capture `location` from the header and make the next step go
there — the redirect chain stays visible instead of collapsing into one step.

JSONPath supports filter expressions, so a scenario can find an element by a
field value instead of hardcoding an id — both in checks and in captures:

```yaml
- path: "$.items[?(@.name=='Delivery')].id"
  exists: true
```

An array of plain values is filtered by the value itself — this is how a role,
a tag or a status is checked without knowing its position:

```yaml
- path: "$.roles[?(@=='Admin')]"
  exists: true
```

When the collection may hold a `null`, guard the filter — `[?(@ && @.name=='X')]`.
Without the guard the whole expression dies on the first null, and the step
fails naming the path instead of reporting the check.

### capture

Capture values from the response for later steps.

```yaml
capture:
  userId: { from: body, path: $.id } # JSON body field
  foundId: { from: body, path: "$.items[?(@.name=='X')].id" } # filters work here too
  otpCode: { from: body, regex: 'code: (\d{6})' } # first regex group
  createdId: { from: body, json: true } # bare JSON scalar: "guid" → guid
  rawBody: { from: body } # whole body as a string, byte for byte
  requestId: { from: header, name: x-request-id }
  refreshToken: { from: cookie, name: refreshToken } # from the response Set-Cookie
  accessToken:
    { from: body, path: $.token, secret: true } # masked in the UI and in stored runs,
    # including every request that later carries it
```

`secret: true` works on any capture. Use it for tokens: without it the value is
stored in the run history and shown in the request that carries it.

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

### cache

A sign-in every scenario repeats is a sign-in the API serves thirty times for
one useful token. Mark the step and its captures are reused by the runs that
follow:

```yaml
- id: sign-in
  request: { method: POST, path: /api/auth/login, body: { login: '{{login}}', password: '{{password}}' } }
  cache: 15m # reuse what this step captured for the next quarter of an hour
  expect: { status: 200 }
  capture:
    token: { from: body, path: $.token, secret: true }
```

- The entry belongs to **this request on this host**: the method, the URL, the
  body as it was actually sent and the captures asked for. Two accounts, two
  entries; an edited request starts its own.
- A cached step sends nothing. The run screen marks it `cached` and says which
  run filled the entry and when, its checks do not run, and the captured values
  arrive as they were.
- If a request that carries a cached value comes back 401 or 403 where the
  scenario did not expect it, the entry is dropped, so the next run signs in
  again. The run that hit the stale token still fails — give the step a `retry`
  if a single stale attempt should not fail the scenario.
- Values live in memory: restarting Pulse signs in again.
- `cache` needs a `capture` — a step that captures nothing has nothing to reuse.

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
  `query`, `headers`, `body`, `multipart` (field values, inline `text` and the
  `file` path), `equals`, `matches`, `cookies.set`, and inside a
  JSONPath expression — both in a check's `path` and in a capture's `path`:
  `"$.items[?(@.id=='{{orderId}}')].name"`. In `matches` the value is inserted
  into the regex as-is, unescaped.
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
7. Collection checks use `minLength: 1` ("not empty") rather than a hardcoded
   size, unless the exact count is the point of the test.
8. Ids of reference data are found by a JSONPath filter instead of being pasted
   as literals — a stand can be reseeded at any time.
