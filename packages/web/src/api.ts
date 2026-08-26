import type {
  ProjectView,
  RunIndexEntry,
  RunRecord,
  RunsGroup,
  Scenario,
  ScenarioListItem,
  ScenarioSummary,
} from '@pulse/shared'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new ApiError(body?.message ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

const post = <T>(url: string, body?: unknown): Promise<T> =>
  request<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

export interface ScenarioVar {
  name: string
  default: string
  secret: boolean
}

export const login = (user: string, password: string) => post<{ ok: boolean }>('/api/login', { user, password })

export const fetchProjects = () =>
  request<{ projects: ProjectView[]; errors: string[]; configPath: string }>('/api/projects')

export const fetchScenarios = (project: string) =>
  request<{ scenarios: ScenarioListItem[] }>(`/api/projects/${project}/scenarios`)

export interface FileFragment {
  startLine: number
  lines: string[]
}

export interface ScenarioDetail {
  summary: ScenarioSummary
  description: string | null
  vars: ScenarioVar[]
  fragment: FileFragment | null
  scenario: Scenario | null
  raw: string
}

export const fetchScenarioDetail = (project: string, path: string) =>
  request<ScenarioDetail>(`/api/projects/${project}/scenario?path=${encodeURIComponent(path)}`)

export const toggleCi = (project: string, path: string, enabled: boolean) =>
  post<{ path: string; ci: boolean }>(`/api/projects/${project}/scenarios/ci-toggle`, { path, enabled })

export const clearRuns = (project: string, scenario?: string) =>
  post<{ cleared: string }>(`/api/projects/${project}/runs/clear`, scenario ? { scenario } : {})

export const fetchAllRuns = (project: string) => request<{ groups: RunsGroup[] }>(`/api/projects/${project}/all-runs`)

export const fetchRuns = (project: string, path: string) =>
  request<{ runs: RunIndexEntry[] }>(`/api/projects/${project}/runs?scenario=${encodeURIComponent(path)}`)

export const fetchRun = (project: string, path: string, run: number) =>
  request<RunRecord>(`/api/projects/${project}/runs/${run}?scenario=${encodeURIComponent(path)}`)

export const startRun = (project: string, path: string, vars: Record<string, string>) =>
  post<{ run: number }>(`/api/projects/${project}/run`, { scenario: path, vars })

export const stopRun = (project: string) => post<{ stopped: boolean }>(`/api/projects/${project}/stop`)

export const setActiveHost = (project: string, host: string) =>
  request<{ activeHost: string; baseUrl: string }>(`/api/projects/${project}/host`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host }),
  })

export const addHost = (project: string, name: string, url: string) =>
  post<{ name: string }>(`/api/projects/${project}/hosts`, { name, url })

export const deleteHost = (project: string, name: string) =>
  post<{ deleted: string }>(`/api/projects/${project}/hosts/delete`, { name })

export const saveVarDefaults = (project: string, path: string, values: Record<string, string>) =>
  request<{ updated: string[] }>(`/api/projects/${project}/scenario/vars`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, values }),
  })

export const importScenario = (project: string, path: string, content: string) =>
  post<{ path: string }>(`/api/projects/${project}/scenarios/import`, { path, content })

export const renameScenario = (project: string, from: string, to: string) =>
  post<{ from: string; to: string }>(`/api/projects/${project}/scenarios/rename`, { from, to })

export const deleteScenario = (project: string, path: string) =>
  post<{ deleted: string }>(`/api/projects/${project}/scenarios/delete`, { path })
