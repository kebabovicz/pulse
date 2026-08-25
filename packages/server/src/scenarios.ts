import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { load as loadYaml, YAMLException } from 'js-yaml'
import { Ajv2020 } from 'ajv/dist/2020.js'
import chokidar, { type FSWatcher } from 'chokidar'
import { isRequestStep, type Scenario, type ScenarioSummary, type Step } from '@pulse/shared'
import type { Project } from './config.js'
import type { EventBus } from './events.js'

const require = createRequire(import.meta.url)
const schema = require('@pulse/shared/scenario.schema.json')

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true })
const validateSchema = ajv.compile<Scenario>(schema)

const SCENARIO_EXT = /\.ya?ml$/

export interface LoadedScenario {
  summary: ScenarioSummary
  scenario: Scenario | null // null у невалидных
  raw: string
}

/** Полная проверка содержимого сценария: YAML → схема → семантика. */
export function validateScenario(raw: string): { scenario: Scenario } | { error: { message: string; line?: number; column?: number } } {
  let doc: unknown
  try {
    doc = loadYaml(raw)
  } catch (e) {
    if (e instanceof YAMLException) {
      return { error: { message: e.reason ?? e.message, line: e.mark && e.mark.line + 1, column: e.mark && e.mark.column + 1 } }
    }
    throw e
  }
  if (!validateSchema(doc)) {
    const first = validateSchema.errors?.[0]
    return { error: { message: first ? `${first.instancePath || 'корень'}: ${first.message}` : 'не соответствует схеме' } }
  }
  const semantic = semanticError(doc as Scenario)
  if (semantic) return { error: { message: semantic } }
  return { scenario: doc as Scenario }
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
    summary: { path: relPath, name: result.scenario.name, stepCount: result.scenario.steps.length, valid: true, modifiedAt, hash },
    scenario: result.scenario,
    raw,
  }
}

// Правила, которые JSON Schema выразить не может (SPEC.md):
// уникальность id, ссылки только назад, захват в занятое имя, известные генераторы.
const BUILTIN = /^(random\.(phone|uuid|digits\(\d+\)|string\(\d+\))|timestamp|runStartedAt)$/

export function semanticError(scenario: Scenario): string | null {
  const allSteps = [...scenario.steps, ...(scenario.cleanup ?? [])]
  const ids = new Set<string>()
  for (const step of allSteps) {
    if (ids.has(step.id)) return `шаг "${step.id}": id не уникален`
    ids.add(step.id)
  }

  const known = new Set(Object.keys(scenario.vars ?? {}))
  for (const [name, def] of Object.entries(scenario.vars ?? {})) {
    for (const ref of collectRefs(def.default)) {
      if (!BUILTIN.test(ref)) return `vars.${name}: неизвестная подстановка {{${ref}}}`
    }
  }
  for (const step of allSteps) {
    for (const ref of stepRefs(step)) {
      if (BUILTIN.test(ref) || known.has(ref)) continue
      return `шаг "${step.id}": {{${ref}}} не определена выше (vars или capture предыдущих шагов)`
    }
    if (isRequestStep(step)) {
      for (const name of Object.keys(step.capture ?? {})) {
        if (known.has(name)) return `шаг "${step.id}": capture в занятое имя "${name}"`
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
