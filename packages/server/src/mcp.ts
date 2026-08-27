import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { CheckResult, RunRecord } from '@pulse/shared'
import type { AppContext } from './routes.js'
import { validateScenario } from './scenarios.js'
import { RunStore } from './storage.js'

/** Long values are cut before they reach the agent: a context window is not a log file. */
const VALUE_CUT = 200
const BODY_CUT = 4000

/** How long a synchronous run may take before the agent gets a run number instead. */
const RUN_TIMEOUT_MS = 120_000

const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../shared/scenario.schema.json', import.meta.url))

const cut = (text: string, limit = VALUE_CUT): string => (text.length > limit ? `${text.slice(0, limit)}…` : text)

const ok = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] })

const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
})

/** Only the checks that did not pass, and only as much of them as tells the story. */
function failedChecks(checks: CheckResult[] | undefined) {
  return (checks ?? [])
    .filter((c) => !c.passed)
    .map((c) => ({
      check: c.kind === 'status' ? 'status' : c.kind === 'header' ? `header ${c.name}` : c.kind === 'body-path' ? `body ${c.path}` : 'body text',
      expected: cut(String(c.expected)),
      actual: c.actual === null ? null : cut(String(c.actual)),
    }))
}

/**
 * A run as an agent needs it: verdict, timings and what failed — without the
 * bodies. Full request and response of one step come from the `step` tool.
 */
function runSummary(record: RunRecord) {
  return {
    run: record.run,
    scenario: record.scenario,
    status: record.status,
    durationMs: record.durationMs,
    host: record.host,
    failedStep: record.failedStep,
    message: record.message,
    steps: record.steps.map((step) => ({
      id: step.stepId,
      request: step.kind === 'request' ? `${step.method} ${step.path ?? ''}`.trim() : `pause ${step.durationMs ?? 0}ms`,
      status: step.status,
      code: step.response?.status,
      durationMs: step.durationMs,
      attempts: step.attempts && step.attempts > 1 ? step.attempts : undefined,
      failed: step.status === 'failed' ? failedChecks(step.checks) : undefined,
      error: step.error?.message,
      captured: step.captures?.map((c) => c.name),
    })),
  }
}

/**
 * Pulse over MCP: the agent learns the format, writes a scenario, runs it and
 * reads back what did not match — without a human relaying files between steps.
 */
export function buildMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: 'pulse', version: '0.1.0' })
  const projectOf = (id: string) => ctx.config().projects.find((p) => p.id === id)

  /** A relative path that provably stays inside the scenarios folder. */
  const safeRel = (rel: string, root: string): string | null => {
    const normalized = path.normalize(rel.replaceAll('\\', '/'))
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null
    const base = path.resolve(root)
    const resolved = path.resolve(base, normalized)
    return resolved === base || resolved.startsWith(base + path.sep) ? normalized : null
  }

  server.registerTool(
    'spec',
    {
      description:
        'The Pulse scenario format: the full specification and the JSON Schema every scenario is validated against. Read this before writing a scenario.',
      inputSchema: z.object({}),
    },
    () => {
      if (!fs.existsSync(specPath)) return fail(`specification is missing at ${specPath}`)
      return ok({
        spec: fs.readFileSync(specPath, 'utf8'),
        schema: JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as unknown,
      })
    },
  )

  server.registerTool(
    'projects',
    {
      description: 'Projects known to Pulse: id, hosts a scenario can run against, and where its scenarios live.',
      inputSchema: z.object({}),
    },
    () =>
      ok(
        ctx.config().projects.map((p) => ({
          id: p.id,
          name: p.name,
          hosts: { ...ctx.state.getCustomHosts(p.id), ...p.hosts },
          activeHost: ctx.state.getActiveHost(p.id) ?? Object.keys(p.hosts)[0],
          scenariosDir: p.scenariosDir,
        })),
      ),
  )

  server.registerTool(
    'scenarios',
    {
      description: 'Scenarios of a project: path, name, step count, whether the file is valid and how it last ran.',
      inputSchema: z.object({ project: z.string() }),
    },
    ({ project }) => {
      const list = ctx.scenarios.list(project)
      if (!list) return fail(`no project "${project}"`)
      return ok(
        list.map((s) => {
          const last = ctx.runs.readIndex(project, RunStore.scenarioKey(s.path)).at(-1)
          return {
            path: s.path,
            name: s.name,
            steps: s.stepCount,
            valid: s.valid,
            error: s.error?.message,
            lastRun: last ? { run: last.run, status: last.status, at: last.startedAt } : undefined,
          }
        }),
      )
    },
  )

  server.registerTool(
    'read',
    {
      description: 'The YAML source of one scenario — read it before editing instead of rewriting from scratch.',
      inputSchema: z.object({ project: z.string(), path: z.string() }),
    },
    ({ project, path: rel }) => {
      const loaded = ctx.scenarios.get(project, rel)
      if (!loaded) return fail(`no scenario "${rel}" in project "${project}"`)
      return ok({ path: rel, yaml: loaded.raw, valid: loaded.summary.valid, error: loaded.summary.error })
    },
  )

  server.registerTool(
    'validate',
    {
      description: 'Check a scenario against the schema without saving it. Returns the parse or validation errors.',
      inputSchema: z.object({ yaml: z.string() }),
    },
    ({ yaml }) => {
      const result = validateScenario(yaml)
      return ok(
        'error' in result
          ? { valid: false, error: result.error }
          : { valid: true, steps: result.scenario.steps.length },
      )
    },
  )

  server.registerTool(
    'write',
    {
      description:
        'Save a scenario into the project folder. The file is written only when it passes the schema, so an invalid scenario never lands in the project.',
      inputSchema: z.object({
        project: z.string(),
        path: z.string().describe('path relative to the scenarios folder, e.g. "auth/otp-login.yaml"'),
        yaml: z.string(),
      }),
    },
    ({ project, path: rel, yaml }) => {
      const target = projectOf(project)
      if (!target) return fail(`no project "${project}"`)
      const safe = safeRel(rel, target.scenariosDir)
      if (!safe || !/\.ya?ml$/.test(safe)) return fail('path must be a .yaml file inside the scenarios folder')
      const result = validateScenario(yaml)
      if ('error' in result) {
        const where = result.error.line != null ? ` (line ${result.error.line})` : ''
        return fail(`scenario is invalid: ${result.error.message}${where}`)
      }
      const abs = path.join(target.scenariosDir, safe)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, yaml)
      return ok({ path: safe, steps: result.scenario.steps.length })
    },
  )

  server.registerTool(
    'run',
    {
      description:
        'Run a scenario and return the outcome: per-step status, code, duration and — for failed steps — which checks did not match. Long runs return a run number to read later.',
      inputSchema: z.object({
        project: z.string(),
        path: z.string(),
        vars: z.record(z.string(), z.string()).optional().describe('overrides for the scenario variables'),
        host: z.string().optional().describe('host name to run against; the active one by default'),
      }),
    },
    async ({ project, path: rel, vars, host }) => {
      const target = projectOf(project)
      if (!target) return fail(`no project "${project}"`)
      const loaded = ctx.scenarios.get(project, rel)
      if (!loaded?.scenario)
        return fail(`no runnable scenario "${rel}": ${loaded?.summary.error?.message ?? 'missing'}`)

      const hosts = { ...ctx.state.getCustomHosts(target.id), ...target.hosts }
      const saved = ctx.state.getActiveHost(target.id)
      const hostName = host ?? (saved && hosts[saved] ? saved : Object.keys(target.hosts)[0])
      let started: { run: number; finished: Promise<RunRecord> }
      try {
        started = ctx.runner.start(target, loaded, vars ?? {}, hostName, hosts[hostName])
      } catch (e) {
        return fail((e as Error).message)
      }
      const finished = await Promise.race([
        started.finished.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), RUN_TIMEOUT_MS)),
      ])
      if (!finished) return ok({ run: started.run, status: 'running', hint: 'read the result later with the run tool' })
      const record = ctx.runs.getRun(project, RunStore.scenarioKey(rel), started.run)
      return record ? ok(runSummary(record)) : fail(`run ${started.run} produced no record`)
    },
  )

  server.registerTool(
    'result',
    {
      description: 'The outcome of a stored run, in the same shape the run tool returns.',
      inputSchema: z.object({ project: z.string(), path: z.string(), run: z.number().int() }),
    },
    ({ project, path: rel, run }) => {
      const record = ctx.runs.getRun(project, RunStore.scenarioKey(rel), run)
      return record ? ok(runSummary(record)) : fail(`no run ${run} of "${rel}"`)
    },
  )

  server.registerTool(
    'step',
    {
      description:
        'The full request and response of one step of a run — reach for it when the summary does not explain the failure.',
      inputSchema: z.object({
        project: z.string(),
        path: z.string(),
        run: z.number().int(),
        stepId: z.string(),
      }),
    },
    ({ project, path: rel, run, stepId }) => {
      const record = ctx.runs.getRun(project, RunStore.scenarioKey(rel), run)
      const step = record?.steps.find((s) => s.stepId === stepId)
      if (!step) return fail(`no step "${stepId}" in run ${run} of "${rel}"`)
      return ok({
        id: step.stepId,
        status: step.status,
        attempts: step.attempts,
        durationMs: step.durationMs,
        request: step.request && {
          method: step.request.method,
          url: step.request.url,
          headers: step.request.headers,
          body: step.request.body === null ? null : cut(step.request.body, BODY_CUT),
        },
        response: step.response && {
          status: step.response.status,
          headers: step.response.headers,
          body: cut(step.response.body, BODY_CUT),
        },
        checks: step.checks?.map((c) => ({
          check: c.kind === 'status' ? 'status' : c.kind === 'header' ? `header ${c.name}` : c.kind === 'body-path' ? `body ${c.path}` : 'body text',
          passed: c.passed,
          expected: cut(String(c.expected)),
          actual: c.actual === null ? null : cut(String(c.actual)),
        })),
        error: step.error?.message,
      })
    },
  )

  return server
}

export const mcpSpecPath = specPath
export const mcpSchemaPath = path.resolve(schemaPath)
