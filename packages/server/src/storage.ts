import fs from 'node:fs'
import path from 'node:path'
import type { RunIndexEntry, RunRecord } from '@pulse/shared'

// Layout of /data/runs is described in spec/config.md.
export class RunStore {
  constructor(private dataDir: string) {}

  static scenarioKey(relPath: string): string {
    return relPath
      .replace(/\.ya?ml$/, '')
      .split(path.sep)
      .join('__')
  }

  nextRun(projectId: string, key: string): number {
    const last = this.readIndex(projectId, key).at(-1)
    return (last?.run ?? 0) + 1
  }

  readIndex(projectId: string, key: string): RunIndexEntry[] {
    const file = path.join(this.dir(projectId, key), 'index.jsonl')
    if (!fs.existsSync(file)) return []
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunIndexEntry)
  }

  getRun(projectId: string, key: string, run: number): RunRecord | undefined {
    const file = path.join(this.runDir(projectId, key, run), 'run.json')
    if (!fs.existsSync(file)) return undefined
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord
  }

  save(record: RunRecord, scenarioYaml: string): void {
    const key = RunStore.scenarioKey(record.scenario)
    const dir = this.runDir(record.project, key, record.run)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(record))
    fs.writeFileSync(path.join(dir, 'scenario.yaml'), scenarioYaml)
    const entry: RunIndexEntry = {
      run: record.run,
      startedAt: record.startedAt,
      status: record.status,
      durationMs: record.durationMs,
      failedStep: record.failedStep,
      stepStatuses: record.steps.map((s) => s.status),
      scenarioHash: record.scenarioHash,
      host: record.host,
      trigger: record.trigger,
    }
    fs.appendFileSync(path.join(this.dir(record.project, key), 'index.jsonl'), JSON.stringify(entry) + '\n')
  }

  /** Clears history: for one scenario (by relative path) or for the whole project. */
  clear(projectId: string, scenarioRel?: string): void {
    const root = path.join(this.dataDir, 'runs', projectId)
    const target = scenarioRel ? path.join(root, RunStore.scenarioKey(scenarioRel)) : root
    fs.rmSync(target, { recursive: true, force: true })
  }

  /**
   * Moves run history for the given scenario paths. Callers pass exact
   * `[from, to]` pairs, so a folder rename never touches an unrelated scenario
   * whose name happens to share the prefix.
   */
  renamePaths(projectId: string, moves: [string, string][]): void {
    const root = path.join(this.dataDir, 'runs', projectId)
    if (!fs.existsSync(root)) return
    for (const [fromRel, toRel] of moves) {
      const from = path.join(root, RunStore.scenarioKey(fromRel))
      const to = path.join(root, RunStore.scenarioKey(toRel))
      if (!fs.existsSync(from) || fs.existsSync(to)) continue // nothing to move, or the target already has history
      fs.renameSync(from, to)
    }
  }

  private dir(projectId: string, key: string): string {
    return path.join(this.dataDir, 'runs', projectId, key)
  }

  private runDir(projectId: string, key: string, run: number): string {
    return path.join(this.dir(projectId, key), String(run).padStart(6, '0'))
  }
}
