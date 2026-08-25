import fs from 'node:fs'
import path from 'node:path'

interface AppState {
  activeHost?: Record<string, string> // projectId → имя хоста
  customHosts?: Record<string, Record<string, string>> // projectId → {имя: url}, добавленные из UI
  ciScenarios?: Record<string, string[]> // projectId → пути сценариев деплой-набора
}

// Мелкое персистентное состояние приложения (spec/config.md: /data/state.json).
export class StateStore {
  private file: string

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'state.json')
  }

  getActiveHost(projectId: string): string | undefined {
    return this.read().activeHost?.[projectId]
  }

  setActiveHost(projectId: string, host: string): void {
    const state = this.read()
    state.activeHost = { ...state.activeHost, [projectId]: host }
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2))
  }

  getCustomHosts(projectId: string): Record<string, string> {
    return this.read().customHosts?.[projectId] ?? {}
  }

  addCustomHost(projectId: string, name: string, url: string): void {
    const state = this.read()
    state.customHosts = { ...state.customHosts, [projectId]: { ...state.customHosts?.[projectId], [name]: url } }
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2))
  }

  removeCustomHost(projectId: string, name: string): void {
    const state = this.read()
    const hosts = { ...state.customHosts?.[projectId] }
    delete hosts[name]
    state.customHosts = { ...state.customHosts, [projectId]: hosts }
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2))
  }

  getCiScenarios(projectId: string): string[] {
    return this.read().ciScenarios?.[projectId] ?? []
  }

  setCiScenario(projectId: string, path: string, enabled: boolean): void {
    const state = this.read()
    const current = new Set(state.ciScenarios?.[projectId] ?? [])
    if (enabled) current.add(path)
    else current.delete(path)
    state.ciScenarios = { ...state.ciScenarios, [projectId]: [...current] }
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2))
  }

  private read(): AppState {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as AppState
    } catch {
      return {}
    }
  }
}
