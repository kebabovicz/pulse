import type { FastifyInstance } from 'fastify'
import type { ProjectView, RunsGroup, ScenarioListItem } from '@pulse/shared'
import fs from 'node:fs'
import path from 'node:path'
import { configPath, type AppConfig, type Project } from './config.js'
import type { EventBus } from './events.js'
import type { HealthMonitor } from './health.js'
import type { Runner } from './runner.js'
import type { StateStore } from './state.js'
import { updateVarDefaults } from './scenarioEditor.js'
import { validateScenario, type ScenarioStore } from './scenarios.js'
import { projectStats } from './stats.js'
import { RunStore } from './storage.js'

export interface AppContext {
  /** whether the server was started with a password — the UI shows a sign-out button */
  authEnabled: boolean
  config: () => AppConfig
  scenarios: ScenarioStore
  health: HealthMonitor
  bus: EventBus
  runner: Runner
  runs: RunStore
  dataDir: string
  state: StateStore
  resolveBaseUrl?: (p: Project) => string
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  // config hosts plus UI-added ones; on a name clash the config wins
  const mergedHosts = (p: Project): Record<string, string> => ({ ...ctx.state.getCustomHosts(p.id), ...p.hosts })
  const activeHost = (p: Project): string => {
    const hosts = mergedHosts(p)
    const saved = ctx.state.getActiveHost(p.id)
    return saved && hosts[saved] ? saved : Object.keys(p.hosts)[0]
  }
  const baseUrl = (p: Project): string => mergedHosts(p)[activeHost(p)]
  ctx.resolveBaseUrl = baseUrl

  /**
   * A relative path that provably stays inside `root`. Backslashes are folded
   * first (they are ordinary characters on POSIX, so normalize would keep them),
   * and the resolved result is checked against the root itself.
   */
  const safeRel = (rel: unknown, root: string): string | null => {
    if (typeof rel !== 'string' || rel === '') return null
    const normalized = path.normalize(rel.replaceAll('\\', '/'))
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null
    const base = path.resolve(root)
    const resolved = path.resolve(base, normalized)
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null
    return normalized
  }

  /** Every route that touches project data resolves the id first. */
  const findProject = (id: string): Project | undefined => ctx.config().projects.find((p) => p.id === id)

  app.get('/api/projects', () => {
    const { projects, errors } = ctx.config()
    const views: ProjectView[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      hosts: mergedHosts(p),
      customHosts: Object.keys(ctx.state.getCustomHosts(p.id)).filter((n) => !p.hosts[n]),
      activeHost: activeHost(p),
      baseUrl: baseUrl(p),
      health: ctx.health.get(p.id),
    }))
    return { projects: views, errors, configPath: configPath(ctx.dataDir), authEnabled: ctx.authEnabled }
  })

  // switch the active host of a project (persisted, re-checks availability at once)
  app.put<{ Params: { id: string }; Body: { host: string } }>('/api/projects/:id/host', async (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    if (!mergedHosts(project)[req.body.host]) return reply.code(400).send({ message: `no host "${req.body.host}"` })
    ctx.state.setActiveHost(project.id, req.body.host)
    return { activeHost: req.body.host, baseUrl: baseUrl(project), health: await ctx.health.check(project) }
  })

  // add or remove a host from the UI (kept in state.json, the config is untouched)
  app.post<{ Params: { id: string }; Body: { name: string; url: string } }>('/api/projects/:id/hosts', (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    const { name, url } = req.body
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name))
      return reply.code(400).send({ message: 'host name: lowercase letters, digits, dashes' })
    if (mergedHosts(project)[name]) return reply.code(409).send({ message: `host "${name}" already exists` })
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return reply.code(400).send({ message: 'not a URL' })
    ctx.state.addCustomHost(project.id, name, url.replace(/\/+$/, ''))
    return { name }
  })

  app.post<{ Params: { id: string }; Body: { name: string } }>('/api/projects/:id/hosts/delete', (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    if (project.hosts[req.body.name])
      return reply.code(400).send({ message: 'hosts defined in the config are removed in projects.yaml' })
    ctx.state.removeCustomHost(project.id, req.body.name)
    return { deleted: req.body.name }
  })

  // import a scenario into Pulse's storage
  app.post<{ Params: { id: string }; Body: { path: string; content: string } }>(
    '/api/projects/:id/scenarios/import',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const rel = safeRel(req.body.path, project.scenariosDir)
      if (!rel || !/\.ya?ml$/.test(rel))
        return reply.code(400).send({ message: 'path must be a .yaml file inside the scenarios folder' })
      const { content } = req.body
      if (typeof content !== 'string' || content.length === 0)
        return reply.code(400).send({ message: `${rel}: empty file` })
      if (content.length > 512 * 1024) return reply.code(400).send({ message: `${rel}: file is larger than 512 KB` })
      // do not accept junk: the file is validated in full before being written
      const result = validateScenario(content)
      if ('error' in result) {
        const where = result.error.line != null ? ` (line ${result.error.line})` : ''
        return reply.code(400).send({ message: `${rel}: ${result.error.message}${where}` })
      }
      const abs = path.join(project.scenariosDir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content)
      return { path: rel }
    },
  )

  /**
   * Edits default values of scenario variables — the one edit Pulse allows in a
   * scenario file. Secrets on a stand live here: CI runs pick them up from the
   * file, and a human updates them in the UI.
   */
  app.put<{ Params: { id: string }; Body: { path: string; values: Record<string, string> } }>(
    '/api/projects/:id/scenario/vars',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const rel = safeRel(req.body.path, project.scenariosDir)
      const loaded = rel ? ctx.scenarios.get(project.id, rel) : undefined
      if (!rel || !loaded) return reply.code(404).send({ message: 'no such scenario' })
      if (!loaded.scenario) return reply.code(400).send({ message: 'scenario is invalid' })

      const values = req.body.values
      if (typeof values !== 'object' || values === null) return reply.code(400).send({ message: 'values object expected' })
      const declared = new Set(Object.keys(loaded.scenario.vars ?? {}))
      const unknown = Object.keys(values).filter((name) => !declared.has(name))
      if (unknown.length > 0) return reply.code(400).send({ message: `unknown variables: ${unknown.join(', ')}` })

      const abs = path.join(project.scenariosDir, rel)
      const { updated } = updateVarDefaults(abs, values)

      // the file must stay valid after the edit
      const check = validateScenario(fs.readFileSync(abs, 'utf8'))
      if ('error' in check) return reply.code(500).send({ message: `edit broke the scenario: ${check.error.message}` })
      return { updated }
    },
  )

  // rename or move a file or folder; run history follows along
  app.post<{ Params: { id: string }; Body: { from: string; to: string } }>(
    '/api/projects/:id/scenarios/rename',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const from = safeRel(req.body.from, project.scenariosDir)
      const to = safeRel(req.body.to, project.scenariosDir)
      if (!from || !to) return reply.code(400).send({ message: 'invalid path' })
      const absFrom = path.join(project.scenariosDir, from)
      const absTo = path.join(project.scenariosDir, to)
      if (!fs.existsSync(absFrom)) return reply.code(404).send({ message: `no "${from}"` })
      if (fs.existsSync(absTo)) return reply.code(409).send({ message: `"${to}" already exists` })
      const isDir = fs.statSync(absFrom).isDirectory()
      if (!isDir && !/\.ya?ml$/.test(to)) return reply.code(400).send({ message: 'path must end with .yaml' })
      fs.mkdirSync(path.dirname(absTo), { recursive: true })
      fs.renameSync(absFrom, absTo)
      // drop folders that became empty, never climbing past the scenarios root
      const root = path.resolve(project.scenariosDir)
      let dir = path.dirname(path.resolve(absFrom))
      while (
        dir !== root &&
        dir.startsWith(root + path.sep) &&
        fs.existsSync(dir) &&
        fs.readdirSync(dir).length === 0
      ) {
        fs.rmdirSync(dir)
        dir = path.dirname(dir)
      }
      const moved = isDir
        ? (ctx.scenarios.list(project.id) ?? [])
            .filter((s) => s.path === from || s.path.startsWith(from + '/'))
            .map((s) => [s.path, to + s.path.slice(from.length)] as [string, string])
        : [[from, to] as [string, string]]
      ctx.runs.renamePaths(project.id, moved)
      return { from, to }
    },
  )

  app.post<{ Params: { id: string }; Body: { path: string } }>('/api/projects/:id/scenarios/delete', (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    const rel = safeRel(req.body.path, project.scenariosDir)
    if (!rel) return reply.code(400).send({ message: 'invalid path' })
    const abs = path.join(project.scenariosDir, rel)
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return reply.code(404).send({ message: `no "${rel}"` })
    fs.rmSync(abs)
    return { deleted: rel }
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/scenarios', (req, reply) => {
    const list = ctx.scenarios.list(req.params.id)
    if (!list) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    const ciSet = new Set(ctx.state.getCiScenarios(req.params.id))
    const scenarios: ScenarioListItem[] = list.map((summary) => {
      const last = ctx.runs.readIndex(req.params.id, RunStore.scenarioKey(summary.path)).at(-1)
      return {
        ...summary,
        ci: ciSet.has(summary.path),
        ...(last && {
          lastRun: {
            run: last.run,
            status: last.status,
            durationMs: last.durationMs,
            startedAt: last.startedAt,
            failedStep: last.failedStep,
          },
        }),
      }
    })
    return { scenarios }
  })

  app.post<{ Params: { id: string } }>('/api/projects/:id/health-check', async (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    return ctx.health.check(project)
  })

  app.get('/api/events', (_req, reply) => {
    reply.hijack()
    ctx.bus.subscribe(reply)
  })

  // Scenario paths contain "/", so the scenario is passed in the body or query, not the URL.
  // Scenario details for the launch modal: variables with their defaults.
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/scenario', (req, reply) => {
    const loaded = ctx.scenarios.get(req.params.id, req.query.path)
    if (!loaded) return reply.code(404).send({ message: `no scenario "${req.query.path}"` })
    const vars = Object.entries(loaded.scenario?.vars ?? {}).map(([name, def]) => ({
      name,
      default: String(def.default ?? ''),
      secret: def.secret ?? false,
    }))
    // file fragment around the error line, for the "scenario is invalid" screen
    let fragment: { startLine: number; lines: string[] } | null = null
    if (!loaded.summary.valid) {
      const lines = loaded.raw.split('\n')
      const center = loaded.summary.error?.line ?? 1
      const start = Math.max(1, center - 4)
      fragment = { startLine: start, lines: lines.slice(start - 1, Math.min(lines.length, center + 4)) }
    }
    return {
      summary: loaded.summary,
      description: loaded.scenario?.description ?? null,
      vars,
      fragment,
      scenario: loaded.scenario,
      raw: loaded.raw,
    }
  })

  app.post<{ Params: { id: string }; Body: { scenario: string; vars?: Record<string, string> } }>(
    '/api/projects/:id/run',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const loaded = ctx.scenarios.get(project.id, req.body.scenario)
      if (!loaded) return reply.code(404).send({ message: `no scenario "${req.body.scenario}"` })
      if (!loaded.scenario) return reply.code(400).send({ message: 'scenario is invalid', error: loaded.summary.error })
      if (ctx.runner.isBusy(project.id)) return reply.code(409).send({ message: 'a run is already in progress' })
      const { run, finished } = ctx.runner.start(
        project,
        loaded,
        req.body.vars ?? {},
        activeHost(project),
        baseUrl(project),
      )
      // the run continues in the background; an internal failure must not become an unhandled rejection
      finished.catch((e: unknown) => app.log.error({ err: e }, 'run failed'))
      return { run }
    },
  )

  // the whole project history grouped by scenario (History tab)
  app.get<{ Params: { id: string } }>('/api/projects/:id/all-runs', (req, reply) => {
    const list = ctx.scenarios.list(req.params.id)
    if (!list) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    const groups: RunsGroup[] = list
      .map((summary) => ({
        scenario: summary.path,
        name: summary.name,
        runs: ctx.runs.readIndex(req.params.id, RunStore.scenarioKey(summary.path)).reverse(),
      }))
      .filter((g) => g.runs.length > 0)
      .sort((a, b) => (b.runs[0]?.startedAt ?? '').localeCompare(a.runs[0]?.startedAt ?? ''))
    return { groups }
  })

  // project statistics over the last N runs (Statistics tab)
  app.get<{ Params: { id: string }; Querystring: { window?: string; host?: string } }>(
    '/api/projects/:id/stats',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const list = ctx.scenarios.list(project.id) ?? []
      const window = Math.min(Math.max(Number(req.query.window) || 50, 1), 500)
      const host = req.query.host && req.query.host !== 'all' ? req.query.host : null
      return projectStats(
        ctx.runs,
        project.id,
        list.map((s) => ({ path: s.path, name: s.name })),
        window,
        host,
      )
    },
  )

  // the "run on deploy" flag (kept in state.json)
  app.post<{ Params: { id: string }; Body: { path: string; enabled: boolean } }>(
    '/api/projects/:id/scenarios/ci-toggle',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const rel = safeRel(req.body.path, project.scenariosDir)
      if (!rel || !ctx.scenarios.get(project.id, rel)) return reply.code(404).send({ message: `no such scenario` })
      ctx.state.setCiScenario(project.id, rel, Boolean(req.body.enabled))
      return { path: rel, ci: Boolean(req.body.enabled) }
    },
  )

  // Deploy suite for CI: runs the marked scenarios one by one and waits.
  // 200 when all passed, 422 when something failed (the body reports either way).
  app.post<{ Params: { id: string }; Body?: { host?: string; scenarios?: string[] } }>(
    '/api/projects/:id/ci/run',
    async (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      if (ctx.runner.isBusy(project.id))
        return reply.code(409).send({ message: 'a run is in progress — try again later' })

      const hostName = req.body?.host ?? activeHost(project)
      const hostUrl = mergedHosts(project)[hostName]
      if (!hostUrl) return reply.code(400).send({ message: `no host "${hostName}"` })

      const paths = req.body?.scenarios ?? ctx.state.getCiScenarios(project.id)
      if (paths.length === 0)
        return reply.code(400).send({ message: 'deploy suite is empty: mark scenarios in the UI or pass scenarios[]' })

      const results: { scenario: string; run?: number; status: string; durationMs?: number; failedStep?: string }[] = []
      for (const path of paths) {
        const loaded = ctx.scenarios.get(project.id, path)
        if (!loaded?.scenario) {
          results.push({ scenario: path, status: loaded ? 'invalid' : 'missing' })
          continue
        }
        const { run, finished } = ctx.runner.start(project, loaded, {}, hostName, hostUrl, 'ci')
        const record = await finished
        results.push({
          scenario: path,
          run,
          status: record.status,
          durationMs: record.durationMs,
          failedStep: record.failedStep,
        })
      }
      const ok = results.every((r) => r.status === 'passed')
      return reply.code(ok ? 200 : 422).send({ ok, host: hostName, results })
    },
  )

  app.post<{ Params: { id: string } }>('/api/projects/:id/stop', (req) => ({
    stopped: ctx.runner.stop(req.params.id),
  }))

  app.get<{ Params: { id: string } }>('/api/projects/:id/current-run', (req) => ({
    run: ctx.runner.current(req.params.id) ?? null,
  }))

  // clear history: body {scenario} for one scenario, empty body for the whole project
  app.post<{ Params: { id: string }; Body: { scenario?: string } }>('/api/projects/:id/runs/clear', (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    if (ctx.runner.isBusy(project.id)) return reply.code(409).send({ message: 'a run is in progress — stop it first' })
    const scenario = req.body?.scenario ? safeRel(req.body.scenario, project.scenariosDir) : undefined
    if (req.body?.scenario && !scenario) return reply.code(400).send({ message: 'invalid path' })
    ctx.runs.clear(project.id, scenario ?? undefined)
    return { cleared: scenario ?? '*' }
  })

  app.get<{ Params: { id: string }; Querystring: { scenario?: string } }>('/api/projects/:id/runs', (req, reply) => {
    const project = findProject(req.params.id)
    if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
    const scenario = safeRel(req.query.scenario, project.scenariosDir)
    if (!scenario) return reply.code(400).send({ message: 'scenario query parameter is required' })
    return { runs: ctx.runs.readIndex(project.id, RunStore.scenarioKey(scenario)).reverse() }
  })

  app.get<{ Params: { id: string; run: string }; Querystring: { scenario?: string } }>(
    '/api/projects/:id/runs/:run',
    (req, reply) => {
      const project = findProject(req.params.id)
      if (!project) return reply.code(404).send({ message: `no project "${req.params.id}"` })
      const scenario = safeRel(req.query.scenario, project.scenariosDir)
      if (!scenario) return reply.code(400).send({ message: 'scenario query parameter is required' })
      const record = ctx.runs.getRun(project.id, RunStore.scenarioKey(scenario), Number(req.params.run))
      if (!record) return reply.code(404).send({ message: 'no such run' })
      return record
    },
  )
}
