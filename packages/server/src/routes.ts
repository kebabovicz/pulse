import type { FastifyInstance } from 'fastify'
import type { ProjectView, RunsGroup, ScenarioListItem } from '@pulse/shared'
import fs from 'node:fs'
import path from 'node:path'
import { configPath, type AppConfig, type Project } from './config.js'
import type { EventBus } from './events.js'
import type { HealthMonitor } from './health.js'
import type { Runner } from './runner.js'
import type { StateStore } from './state.js'
import { validateScenario, type ScenarioStore } from './scenarios.js'
import { RunStore } from './storage.js'

export interface AppContext {
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
  // хосты из конфига + добавленные из UI; при совпадении имён конфиг главнее
  const mergedHosts = (p: Project): Record<string, string> => ({ ...ctx.state.getCustomHosts(p.id), ...p.hosts })
  const activeHost = (p: Project): string => {
    const hosts = mergedHosts(p)
    const saved = ctx.state.getActiveHost(p.id)
    return saved && hosts[saved] ? saved : Object.keys(p.hosts)[0]
  }
  const baseUrl = (p: Project): string => mergedHosts(p)[activeHost(p)]
  ctx.resolveBaseUrl = baseUrl

  // относительный путь внутри папки сценариев, без выходов наружу
  const safeRel = (rel: unknown): string | null => {
    if (typeof rel !== 'string' || rel === '') return null
    const normalized = path.normalize(rel).replaceAll('\\', '/')
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null
    return normalized
  }

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
    return { projects: views, errors, configPath: configPath(ctx.dataDir) }
  })

  // смена активного хоста проекта (сохраняется, сразу перепроверяет доступность)
  app.put<{ Params: { id: string }; Body: { host: string } }>('/api/projects/:id/host', async (req, reply) => {
    const project = ctx.config().projects.find((p) => p.id === req.params.id)
    if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
    if (!mergedHosts(project)[req.body.host]) return reply.code(400).send({ message: `нет хоста "${req.body.host}"` })
    ctx.state.setActiveHost(project.id, req.body.host)
    return { activeHost: req.body.host, baseUrl: baseUrl(project), health: await ctx.health.check(project) }
  })

  // добавление/удаление хоста из интерфейса (хранится в state.json, конфиг не трогается)
  app.post<{ Params: { id: string }; Body: { name: string; url: string } }>(
    '/api/projects/:id/hosts',
    (req, reply) => {
      const project = ctx.config().projects.find((p) => p.id === req.params.id)
      if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
      const { name, url } = req.body
      if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name))
        return reply.code(400).send({ message: 'имя хоста: латиница/цифры/дефис' })
      if (mergedHosts(project)[name]) return reply.code(409).send({ message: `хост "${name}" уже есть` })
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return reply.code(400).send({ message: 'не URL' })
      ctx.state.addCustomHost(project.id, name, url.replace(/\/+$/, ''))
      return { name }
    },
  )

  app.post<{ Params: { id: string }; Body: { name: string } }>('/api/projects/:id/hosts/delete', (req, reply) => {
    const project = ctx.config().projects.find((p) => p.id === req.params.id)
    if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
    if (project.hosts[req.body.name]) return reply.code(400).send({ message: 'хост из конфига удаляется только в projects.yaml' })
    ctx.state.removeCustomHost(project.id, req.body.name)
    return { deleted: req.body.name }
  })

  // импорт сценария в хранилище Pulse
  app.post<{ Params: { id: string }; Body: { path: string; content: string } }>(
    '/api/projects/:id/scenarios/import',
    (req, reply) => {
      const project = ctx.config().projects.find((p) => p.id === req.params.id)
      if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
      const rel = safeRel(req.body.path)
      if (!rel || !/\.ya?ml$/.test(rel)) return reply.code(400).send({ message: 'путь должен быть .yaml внутри папки сценариев' })
      const { content } = req.body
      if (typeof content !== 'string' || content.length === 0) return reply.code(400).send({ message: `${rel}: пустой файл` })
      if (content.length > 512 * 1024) return reply.code(400).send({ message: `${rel}: файл больше 512 KB` })
      // не принимать что попало: файл проверяется целиком до записи
      const result = validateScenario(content)
      if ('error' in result) {
        const where = result.error.line != null ? ` (строка ${result.error.line})` : ''
        return reply.code(400).send({ message: `${rel}: ${result.error.message}${where}` })
      }
      const abs = path.join(project.scenariosDir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content)
      return { path: rel }
    },
  )

  // переименование/перенос файла или папки; история прогонов переезжает следом
  app.post<{ Params: { id: string }; Body: { from: string; to: string } }>(
    '/api/projects/:id/scenarios/rename',
    (req, reply) => {
      const project = ctx.config().projects.find((p) => p.id === req.params.id)
      if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
      const from = safeRel(req.body.from)
      const to = safeRel(req.body.to)
      if (!from || !to) return reply.code(400).send({ message: 'некорректный путь' })
      const absFrom = path.join(project.scenariosDir, from)
      const absTo = path.join(project.scenariosDir, to)
      if (!fs.existsSync(absFrom)) return reply.code(404).send({ message: `нет "${from}"` })
      if (fs.existsSync(absTo)) return reply.code(409).send({ message: `"${to}" уже существует` })
      const isDir = fs.statSync(absFrom).isDirectory()
      if (!isDir && !/\.ya?ml$/.test(to)) return reply.code(400).send({ message: 'путь должен оканчиваться на .yaml' })
      fs.mkdirSync(path.dirname(absTo), { recursive: true })
      fs.renameSync(absFrom, absTo)
      // подчистить опустевшие папки
      let dir = path.dirname(absFrom)
      while (dir !== project.scenariosDir && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir)
        dir = path.dirname(dir)
      }
      ctx.runs.renamePaths(project.id, from, to, isDir)
      return { from, to }
    },
  )

  app.post<{ Params: { id: string }; Body: { path: string } }>('/api/projects/:id/scenarios/delete', (req, reply) => {
    const project = ctx.config().projects.find((p) => p.id === req.params.id)
    if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
    const rel = safeRel(req.body.path)
    if (!rel) return reply.code(400).send({ message: 'некорректный путь' })
    const abs = path.join(project.scenariosDir, rel)
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return reply.code(404).send({ message: `нет "${rel}"` })
    fs.rmSync(abs)
    return { deleted: rel }
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/scenarios', (req, reply) => {
    const list = ctx.scenarios.list(req.params.id)
    if (!list) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
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
    const project = ctx.config().projects.find((p) => p.id === req.params.id)
    if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
    return ctx.health.check(project)
  })

  app.get('/api/events', (_req, reply) => {
    reply.hijack()
    ctx.bus.subscribe(reply)
  })

  // Пути сценариев содержат «/», поэтому сценарий передаётся в теле/query, не в URL.
  // Детали сценария для модалки запуска: переменные с дефолтами.
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/scenario', (req, reply) => {
    const loaded = ctx.scenarios.get(req.params.id, req.query.path)
    if (!loaded) return reply.code(404).send({ message: `нет сценария "${req.query.path}"` })
    const vars = Object.entries(loaded.scenario?.vars ?? {}).map(([name, def]) => ({
      name,
      default: String(def.default ?? ''),
      secret: def.secret ?? false,
    }))
    // фрагмент файла вокруг строки ошибки — для экрана «сценарий невалиден»
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
      const project = ctx.config().projects.find((p) => p.id === req.params.id)
      if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
      const loaded = ctx.scenarios.get(project.id, req.body.scenario)
      if (!loaded) return reply.code(404).send({ message: `нет сценария "${req.body.scenario}"` })
      if (!loaded.scenario) return reply.code(400).send({ message: 'сценарий невалиден', error: loaded.summary.error })
      if (ctx.runner.isBusy(project.id)) return reply.code(409).send({ message: 'прогон уже идёт' })
      const { run } = ctx.runner.start(project, loaded, req.body.vars ?? {}, activeHost(project), baseUrl(project))
      return { run }
    },
  )

  // вся история проекта, сгруппированная по сценариям (вкладка History)
  app.get<{ Params: { id: string } }>('/api/projects/:id/all-runs', (req, reply) => {
    const list = ctx.scenarios.list(req.params.id)
    if (!list) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
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

  // флажок «гонять после деплоя» (хранится в state.json)
  app.post<{ Params: { id: string }; Body: { path: string; enabled: boolean } }>(
    '/api/projects/:id/scenarios/ci-toggle',
    (req, reply) => {
      const project = ctx.config().projects.find((p) => p.id === req.params.id)
      if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
      const rel = safeRel(req.body.path)
      if (!rel || !ctx.scenarios.get(project.id, rel)) return reply.code(404).send({ message: `нет сценария` })
      ctx.state.setCiScenario(project.id, rel, Boolean(req.body.enabled))
      return { path: rel, ci: Boolean(req.body.enabled) }
    },
  )

  // Деплой-прогон для CI: последовательно гонит набор сценариев и ждёт конца.
  // 200 — все зелёные, 422 — есть провалы (тело — отчёт в обоих случаях).
  app.post<{ Params: { id: string }; Body?: { host?: string; scenarios?: string[] } }>(
    '/api/projects/:id/ci/run',
    async (req, reply) => {
      const project = ctx.config().projects.find((p) => p.id === req.params.id)
      if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
      if (ctx.runner.isBusy(project.id)) return reply.code(409).send({ message: 'идёт прогон — попробуй позже' })

      const hostName = req.body?.host ?? activeHost(project)
      const hostUrl = mergedHosts(project)[hostName]
      if (!hostUrl) return reply.code(400).send({ message: `нет хоста "${hostName}"` })

      const paths = req.body?.scenarios ?? ctx.state.getCiScenarios(project.id)
      if (paths.length === 0) return reply.code(400).send({ message: 'деплой-набор пуст: отметь сценарии или передай scenarios[]' })

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

  // очистка истории: тело {scenario} — одного сценария, пустое — всего проекта
  app.post<{ Params: { id: string }; Body: { scenario?: string } }>('/api/projects/:id/runs/clear', (req, reply) => {
    const project = ctx.config().projects.find((p) => p.id === req.params.id)
    if (!project) return reply.code(404).send({ message: `нет проекта "${req.params.id}"` })
    if (ctx.runner.isBusy(project.id)) return reply.code(409).send({ message: 'идёт прогон — сначала останови' })
    const scenario = req.body?.scenario ? safeRel(req.body.scenario) : undefined
    if (req.body?.scenario && !scenario) return reply.code(400).send({ message: 'некорректный путь' })
    ctx.runs.clear(project.id, scenario ?? undefined)
    return { cleared: scenario ?? '*' }
  })

  app.get<{ Params: { id: string }; Querystring: { scenario: string } }>('/api/projects/:id/runs', (req) => ({
    runs: ctx.runs.readIndex(req.params.id, RunStore.scenarioKey(req.query.scenario)).reverse(),
  }))

  app.get<{ Params: { id: string; run: string }; Querystring: { scenario: string } }>(
    '/api/projects/:id/runs/:run',
    (req, reply) => {
      const record = ctx.runs.getRun(req.params.id, RunStore.scenarioKey(req.query.scenario), Number(req.params.run))
      if (!record) return reply.code(404).send({ message: 'нет такого прогона' })
      return record
    },
  )
}
