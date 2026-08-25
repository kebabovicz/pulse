import type { HealthState } from '@pulse/shared'
import type { Project } from './config.js'
import type { EventBus } from './events.js'

export class HealthMonitor {
  private states = new Map<string, HealthState>()
  private timer: NodeJS.Timeout | undefined

  constructor(private bus: EventBus) {}

  start(projects: Project[], intervalMs: number, baseUrlOf: (p: Project) => string): void {
    this.stop()
    this.baseUrlOf = baseUrlOf
    void this.checkAll(projects)
    this.timer = setInterval(() => void this.checkAll(projects), intervalMs)
  }

  private baseUrlOf: (p: Project) => string = (p) => Object.values(p.hosts)[0]

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  get(projectId: string): HealthState {
    return this.states.get(projectId) ?? { status: 'unknown' }
  }

  async check(project: Project): Promise<HealthState> {
    const base = this.baseUrlOf(project)
    const url = project.healthPath ? base + project.healthPath : base
    let next: HealthState
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      next = res.ok ? { status: 'up' } : { status: 'down', reason: `HTTP ${res.status}` }
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause
      next = { status: 'down', reason: cause?.code ?? (e as Error).name }
    }
    next.checkedAt = new Date().toISOString()
    const prev = this.states.get(project.id)
    this.states.set(project.id, next)
    if (prev?.status !== next.status && next.status !== 'unknown') {
      this.bus.publish({ type: 'health-changed', project: project.id, status: next.status, reason: next.reason })
    }
    return next
  }

  private checkAll(projects: Project[]): Promise<unknown> {
    return Promise.all(projects.map((p) => this.check(p)))
  }
}
