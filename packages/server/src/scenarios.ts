import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { load as loadYaml, YAMLException } from 'js-yaml'
import { Ajv2020 } from 'ajv/dist/2020.js'
import chokidar, { type FSWatcher } from 'chokidar'
import { isRequestStep, type Scenario, type ScenarioSummary, type Step } from '@pulse/shared'
import { jsonQuery } from './jsonpath.js'
import type { Project } from './config.js'
import type { EventBus } from './events.js'

const require = createRequire(import.meta.url)
const schema = require('@pulse/shared/scenario.schema.json') as object

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true })
const validateSchema = ajv.compile<Scenario>(schema)

const SCENARIO_EXT = /\.ya?ml$/

export interface LoadedScenario {
  summary: ScenarioSummary
  scenario: Scenario | null // null for invalid files
  raw: string
}

/** Full validation of scenario content: YAML -> schema -> semantics. */
export function validateScenario(
  raw: string,
): { scenario: Scenario } | { error: { message: string; line?: number; column?: number } } {
  let doc: unknown
  try {
    doc = loadYaml(raw)
  } catch (e) {
    if (e instanceof YAMLException) {
      return {
        error: { message: e.reason ?? e.message, line: e.mark && e.mark.line + 1, column: e.mark && e.mark.column + 1 },
      }
    }
    throw e
  }
  if (!validateSchema(doc)) {
    const first = validateSchema.errors?.[0]
    return {
      error: { message: first ? `${first.instancePath || 'root'}: ${first.message}` : 'does not match the schema' },
    }
  }
  const semantic = semanticError(doc)
  if (semantic) return { error: { message: semantic } }
  return { scenario: doc }
}

export function loadScenarioFile(absPath: string, relPath: string): LoadedScenario {
  const modifiedAt = fs.statSync(absPath).mtime.toISOString()
  const raw = fs.readFileSync(absPath, 'utf8')
  const hash = `sha256:${createHash('sha256').update(raw).digest('hex')}`
  const result = validateScenario(raw)
  if ('error' in result) {
    return {
      summary: {
        path: relPath,
        name: path.basename(relPath).replace(SCENARIO_EXT, ''),
        stepCount: 0,
        valid: false,
        error: result.error,
        modifiedAt,
        hash,
      },
      scenario: null,
      raw,
    }
  }
  return {
    summary: {
      path: relPath,
      name: result.scenario.name,
      stepCount: result.scenario.steps.length,
      valid: true,
      modifiedAt,
      hash,
    },
    scenario: result.scenario,
    raw,
  }
}

// Rules JSON Schema cannot express (SPEC.md): unique ids, backward-only
// references, capturing into a used name, known generators.
const BUILTIN = /^(random\.(phone|uuid|digits\(\d+\)|string\(\d+\))|timestamp|runStartedAt)$/

/** A regex or JSONPath that only fails at run time would hang the run, so both are compiled up front. */
function expressionError(step: Step): string | null {
  if (!isRequestStep(step)) return null
  const patterns = [
    ...(step.expect.body ?? []).flatMap((check) => ('matches' in check && check.matches ? [check.matches] : [])),
    ...Object.values(step.capture ?? {}).flatMap((spec) => (spec.from === 'body' && spec.regex ? [spec.regex] : [])),
  ]
  for (const pattern of patterns) {
    // interpolations are only known at run time; validate the literal parts
    if (pattern.includes('{{')) continue
    try {
      new RegExp(pattern)
    } catch (e) {
      return `step "${step.id}": invalid regular expression ${JSON.stringify(pattern)} (${(e as Error).message})`
    }
  }
  const paths = [
    ...(step.expect.body ?? []).flatMap((check) =>
      'path' in check ? [check.path, ...('equalsPath' in check && check.equalsPath ? [check.equalsPath] : [])] : [],
    ),
    ...Object.values(step.capture ?? {}).flatMap((spec) => (spec.from === 'body' && spec.path ? [spec.path] : [])),
  ]
  for (const jsonPath of paths) {
    try {
      jsonQuery(jsonPath, {})
    } catch (e) {
      return `step "${step.id}": invalid JSONPath ${JSON.stringify(jsonPath)} (${(e as Error).message})`
    }
  }
  return null
}

export function semanticError(scenario: Scenario): string | null {
  const allSteps = [...scenario.steps, ...(scenario.cleanup ?? [])]
  const ids = new Set<string>()
  for (const step of allSteps) {
    if (ids.has(step.id)) return `step "${step.id}": id is not unique`
    ids.add(step.id)
  }

  const known = new Set(Object.keys(scenario.vars ?? {}))
  for (const [name, def] of Object.entries(scenario.vars ?? {})) {
    for (const ref of collectRefs(def.default)) {
      if (!BUILTIN.test(ref)) return `vars.${name}: unknown interpolation {{${ref}}}`
    }
  }
  for (const step of allSteps) {
    const expression = expressionError(step)
    if (expression) return expression
    for (const ref of stepRefs(step)) {
      if (BUILTIN.test(ref) || known.has(ref)) continue
      return `step "${step.id}": {{${ref}}} is not defined above (vars or an earlier capture)`
    }
    if (isRequestStep(step)) {
      for (const name of Object.keys(step.capture ?? {})) {
        if (known.has(name)) return `step "${step.id}": capture into an already used name "${name}"`
        known.add(name)
      }
    }
  }
  return null
}

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g

function* collectRefs(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(TEMPLATE)) yield m[1]
  } else if (Array.isArray(value)) {
    for (const item of value) yield* collectRefs(item)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) yield* collectRefs(item)
  }
}

export function* stepRefs(step: Step): Generator<string> {
  if (!isRequestStep(step)) return
  yield* collectRefs(step.request)
  yield* collectRefs(step.expect)
  yield* collectRefs(step.cookies)
}

export class ScenarioStore {
  private byProject = new Map<string, Map<string, LoadedScenario>>()
  private watchers: FSWatcher[] = []

  constructor(private bus: EventBus) {}

  async start(projects: Project[]): Promise<void> {
    await this.stop()
    this.byProject = new Map()
    for (const project of projects) {
      const files = new Map<string, LoadedScenario>()
      this.byProject.set(project.id, files)
      for (const absPath of walk(project.scenariosDir)) {
        const rel = path.relative(project.scenariosDir, absPath)
        files.set(rel, loadScenarioFile(absPath, rel))
      }
      const watcher = chokidar
        .watch(project.scenariosDir, { ignoreInitial: true })
        .on('add', (p) => this.upsert(project, p, 'added'))
        .on('change', (p) => this.upsert(project, p, 'updated'))
        .on('unlink', (p) => this.remove(project, p))
        .on('error', (e) => console.error(`scenario watcher for ${project.id}:`, e))
      this.watchers.push(watcher)
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.watchers.map((w) => w.close()))
    this.watchers = []
  }

  list(projectId: string): ScenarioSummary[] | undefined {
    const files = this.byProject.get(projectId)
    if (!files) return undefined
    return [...files.values()].map((s) => s.summary).sort((a, b) => a.path.localeCompare(b.path))
  }

  get(projectId: string, relPath: string): LoadedScenario | undefined {
    return this.byProject.get(projectId)?.get(relPath)
  }

  private upsert(project: Project, absPath: string, action: 'added' | 'updated'): void {
    if (!SCENARIO_EXT.test(absPath)) return
    const rel = path.relative(project.scenariosDir, absPath)
    const loaded = loadScenarioFile(absPath, rel)
    this.byProject.get(project.id)?.set(rel, loaded)
    this.bus.publish({ type: 'scenario-changed', project: project.id, path: rel, action, summary: loaded.summary })
  }

  private remove(project: Project, absPath: string): void {
    if (!SCENARIO_EXT.test(absPath)) return
    const rel = path.relative(project.scenariosDir, absPath)
    if (this.byProject.get(project.id)?.delete(rel)) {
      this.bus.publish({ type: 'scenario-changed', project: project.id, path: rel, action: 'removed' })
    }
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (SCENARIO_EXT.test(entry.name)) yield p
  }
}
