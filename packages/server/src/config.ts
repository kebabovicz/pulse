import fs from 'node:fs'
import path from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { parseDuration, parseSize } from './util.js'

export interface Settings {
  healthIntervalMs: number
  stepTimeoutMs: number
  runTimeoutMs: number
  bodyLimitBytes: number
}

export interface Project {
  id: string
  name: string
  hosts: Record<string, string> // имя хоста → base URL; первый — по умолчанию
  scenariosDir: string
  healthPath?: string
  stepTimeoutMs: number
  runTimeoutMs: number
}

export interface AppConfig {
  settings: Settings
  projects: Project[]
  errors: string[] // невалидные записи не роняют приложение, а показываются
}

export function configPath(dataDir: string): string {
  return path.join(dataDir, 'projects.yaml')
}

export function loadConfig(dataDir: string): AppConfig {
  const errors: string[] = []
  let raw: Record<string, unknown> = {}
  try {
    raw = (loadYaml(fs.readFileSync(configPath(dataDir), 'utf8')) ?? {}) as Record<string, unknown>
  } catch (e) {
    errors.push(`projects.yaml: ${(e as Error).message}`)
  }

  const rawSettings = (raw.settings ?? {}) as Record<string, string>
  const settings: Settings = {
    healthIntervalMs: parseDuration(rawSettings.healthInterval ?? '30s'),
    stepTimeoutMs: parseDuration(rawSettings.stepTimeout ?? '10s'),
    runTimeoutMs: parseDuration(rawSettings.runTimeout ?? '5m'),
    bodyLimitBytes: parseSize(rawSettings.bodyLimit ?? '256kb'),
  }

  const projects: Project[] = []
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : []
  for (const [i, p] of (rawProjects as Record<string, unknown>[]).entries()) {
    const label = `projects[${i}]${typeof p?.id === 'string' ? ` (${p.id})` : ''}`
    const problems: string[] = []
    if (typeof p?.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.id)) problems.push('id: латиница/цифры/дефис')

    // hosts: {имя: url} либо baseUrl как сокращение для единственного хоста
    const isUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)
    let hosts: Record<string, string> = {}
    if (p?.hosts && typeof p.hosts === 'object') {
      for (const [name, url] of Object.entries(p.hosts as Record<string, unknown>)) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`hosts.${name}: имя — латиница/цифры/дефис`)
        else if (!isUrl(url)) problems.push(`hosts.${name}: не URL`)
        else hosts[name] = url.replace(/\/+$/, '')
      }
    } else if (isUrl(p?.baseUrl)) {
      hosts = { local: (p.baseUrl as string).replace(/\/+$/, '') }
    }
    if (Object.keys(hosts).length === 0) problems.push('нужен baseUrl или hosts')

    // по умолчанию сценарии живут в хранилище Pulse: /data/scenarios/<id>
    const scenariosDir =
      typeof p?.scenariosDir === 'string' && p.scenariosDir
        ? p.scenariosDir
        : path.join(dataDir, 'scenarios', String(p?.id ?? ''))
    if (typeof p?.scenariosDir === 'string' && !fs.existsSync(p.scenariosDir)) {
      problems.push(`scenariosDir не существует: ${p.scenariosDir}`)
    }
    if (projects.some((x) => x.id === p?.id)) problems.push('id не уникален')
    if (problems.length) {
      errors.push(`${label}: ${problems.join('; ')}`)
      continue
    }
    fs.mkdirSync(scenariosDir, { recursive: true })
    projects.push({
      id: p.id as string,
      name: typeof p.name === 'string' ? p.name : (p.id as string),
      hosts,
      scenariosDir,
      healthPath: typeof p.healthPath === 'string' ? p.healthPath : undefined,
      stepTimeoutMs: typeof p.stepTimeout === 'string' ? parseDuration(p.stepTimeout) : settings.stepTimeoutMs,
      runTimeoutMs: typeof p.runTimeout === 'string' ? parseDuration(p.runTimeout) : settings.runTimeoutMs,
    })
  }
  return { settings, projects, errors }
}
