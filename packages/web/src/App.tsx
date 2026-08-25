import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectView, PulseEvent, ScenarioListItem } from '@pulse/shared'
import type { RunRecord, RunsGroup } from '@pulse/shared'
import { clearRuns, fetchAllRuns, fetchProjects, fetchRun, fetchRuns, fetchScenarioDetail, fetchScenarios, importScenario, startRun, stopRun, type FileFragment } from './api'
import { CompareScreen } from './CompareScreen'
import { HistoryScreen } from './HistoryScreen'
import { Check, Cross, MoreVertical, Play, PulseIcon, Spinner, Upload } from './icons'
import { About } from './About'
import { ApiError } from './api'
import { Login } from './Login'
import { HostMenu } from './HostMenu'
import { ScenarioMenu } from './ScenarioMenu'
import { lang, setLang, t, dateLocale } from './i18n'
import { RunModal } from './RunModal'
import { RunScreen } from './RunScreen'
import { ScenarioScreen } from './ScenarioScreen'
import { Select } from './Select'
import { fileLabel, fromRecord, pendingRun, reduce, type RunState } from './runState'

const PROJECT_KEY = 'pulse.project'
const scenarioKey = (project: string) => `pulse.scenario.${project}`

export function App() {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(PROJECT_KEY))
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [runState, setRunState] = useState<RunState | null>(null)
  const [live, setLive] = useState(false)
  const [modalPath, setModalPath] = useState<string | null>(null)
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [needLogin, setNeedLogin] = useState(false)
  const [authed, setAuthed] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'run' | 'history' | 'compare' | 'scenario'>('run')
  const [historyGroups, setHistoryGroups] = useState<RunsGroup[]>([])
  const [historyFilter, setHistoryFilter] = useState<string | null>(null)
  const [compare, setCompare] = useState<[RunRecord, RunRecord] | null>(null)
  const [invalidFragment, setInvalidFragment] = useState<FileFragment | null>(null)
  const [configPath, setConfigPath] = useState('')

  const project = projects.find((p) => p.id === projectId) ?? projects[0]
  const projectRef = useRef<string | undefined>(undefined)
  projectRef.current = project?.id
  const liveRef = useRef(false)
  liveRef.current = live

  useEffect(() => {
    void fetchProjects()
      .then(({ projects, configPath }) => {
        setProjects(projects)
        setConfigPath(configPath)
        setAuthed(true)
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setNeedLogin(true)
      })
  }, [])

  useEffect(() => {
    if (!project) return
    localStorage.setItem(PROJECT_KEY, project.id)
    setSelectedPath(null)
    setRunState(null)
    void fetchScenarios(project.id).then(({ scenarios }) => {
      setScenarios(scenarios)
      // вернуть контекст после перезагрузки (в т.ч. смены языка)
      const saved = localStorage.getItem(scenarioKey(project.id))
      if (saved && scenarios.some((s) => s.path === saved)) void openScenario(saved, scenarios)
    })
  }, [project?.id])

  useEffect(() => {
    if (!authed) return
    const source = new EventSource('/api/events')
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data) as PulseEvent
      if (event.type === 'health-changed') {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === event.project ? { ...p, health: { status: event.status, reason: event.reason, checkedAt: event.ts } } : p,
          ),
        )
      } else if (event.type === 'scenario-changed') {
        if (event.project !== projectRef.current) return
        setScenarios((prev) => {
          const rest = prev.filter((s) => s.path !== event.path)
          if (event.action === 'removed' || !event.summary) return rest
          const ci = prev.find((s) => s.path === event.path)?.ci ?? false
          return [...rest, { ...event.summary, ci }].sort((a, b) => a.path.localeCompare(b.path))
        })
      } else if (liveRef.current && event.project === projectRef.current) {
        setRunState((prev) => (prev ? reduce(prev, event) : prev))
        if (event.type === 'run-finished') setLive(false)
      }
    }
    return () => source.close()
  }, [authed])

  const resetView = () => {
    setLive(false)
    setRunState(null)
    setInvalidFragment(null)
  }

  // клик по сценарию открывает последний прогон на вкладке Run (req 7)
  const openScenario = async (path: string, list: ScenarioListItem[] = scenarios) => {
    setSelectedPath(path)
    setTab('run')
    resetView()
    if (!project) return
    localStorage.setItem(scenarioKey(project.id), path)
    const item = list.find((s) => s.path === path)
    if (item && !item.valid) {
      setInvalidFragment((await fetchScenarioDetail(project.id, path)).fragment)
      return
    }
    const { runs } = await fetchRuns(project.id, path)
    if (runs.length > 0) setRunState(fromRecord(await fetchRun(project.id, path, runs[0].run)))
  }

  // вкладка History — вся история проекта; чип-фильтр ставится сам,
  // если пришли с выбранным сценарием (req 41)
  const openHistory = async (filterPath: string | null) => {
    setTab('history')
    setHistoryFilter(filterPath)
    if (!project) return
    setHistoryGroups((await fetchAllRuns(project.id)).groups)
  }

  const openRun = async (path: string, run: number) => {
    if (!project) return
    setSelectedPath(path)
    setTab('run')
    resetView()
    setRunState(fromRecord(await fetchRun(project.id, path, run)))
  }

  const openCompare = async (path: string, a: number, b: number) => {
    if (!project) return
    const [ra, rb] = await Promise.all([fetchRun(project.id, path, a), fetchRun(project.id, path, b)])
    setSelectedPath(path)
    setCompare([ra, rb])
    setTab('compare')
  }

  const launch = async (path: string, vars: Record<string, string>) => {
    if (!project) return
    setModalPath(null)
    setSelectedPath(path)
    setTab('run')
    // заготовка и live-флаг встают ДО запроса: события прогона могут обогнать ответ POST
    liveRef.current = true
    setLive(true)
    setRunState(pendingRun(path))
    try {
      await startRun(project.id, path, vars)
    } catch (e) {
      setLive(false)
      setRunState(null)
      alert((e as Error).message)
    }
  }

  const groups = useMemo(() => {
    const byDir = new Map<string, ScenarioListItem[]>()
    for (const s of scenarios) {
      const dir = s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/') + 1) : ''
      byDir.set(dir, [...(byDir.get(dir) ?? []), s])
    }
    return [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [scenarios])

  const selected = scenarios.find((s) => s.path === selectedPath)

  if (needLogin) return <Login />

  return (
    <>
      <header className="header">
        <button className="brand" title="pulse" onClick={() => setAboutOpen(true)}>
          <span className="brand-icon">
            <PulseIcon size={15} />
          </span>
          pulse
        </button>
        {project && (
          <>
            <span
              className="health-dot"
              style={{ background: { up: 'var(--ok)', down: 'var(--fail)', unknown: 'var(--skip)' }[project.health.status] }}
            />
            <Select
              value={project.id}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={setProjectId}
            />
            <HostMenu
              project={project}
              onChanged={() => void fetchProjects().then(({ projects }) => setProjects(projects))}
            />
            {project.health.checkedAt && (
              <span className="checked-at">
                {project.health.status === 'down' ? `${t('notResponding')} · ${project.health.reason}` : t('checked')}{' '}
                {new Date(project.health.checkedAt).toLocaleTimeString(dateLocale)}
              </span>
            )}
            <span className="seg lang-seg">
              {(['en', 'ru'] as const).map((l) => (
                <button key={l} className={`seg-item${lang === l ? ' active' : ''}`} onClick={() => lang !== l && setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </span>
          </>
        )}
      </header>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-tools">
            <button className="link" onClick={() => importRef.current?.click()}>
              <Upload size={12} /> {t('importBtn')}
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".yaml,.yml"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (!project) return
                void (async () => {
                  const failures: string[] = []
                  for (const f of files) {
                    await importScenario(project.id, f.name, await f.text()).catch((err: Error) =>
                      failures.push(err.message),
                    )
                  }
                  if (failures.length) alert(failures.join('\n'))
                })()
              }}
            />
          </div>
          {groups.map(([dir, items]) => (
            <div key={dir}>
              {dir && <div className="group">{dir}</div>}
              {items.map((s) => (
                <div key={s.path} className={`scenario-item${s.path === selectedPath ? ' selected' : ''}`} style={{ position: 'relative' }}>
                  <button className="scenario-row" title={s.name} onClick={() => void openScenario(s.path)}>
                    <span className="scenario-title">
                      {fileLabel(s.path)}
                      <ScenarioStatus item={s} runningPath={live ? selectedPath : null} />
                    </span>
                    {s.valid ? (
                      <span className="meta">
                        {t('steps', s.stepCount)}
                        {s.lastRun && ` · ${lastRunLabel(s.lastRun)}`}
                        {s.ci && <span className="accent"> · ci</span>}
                      </span>
                    ) : (
                      <span className="meta invalid">{t('invalidShort')}{s.error?.line != null && ` · ${t('line')} ${s.error.line}`}</span>
                    )}
                  </button>
                  <button className="row-action" title="⋯" onClick={() => setMenuPath(menuPath === s.path ? null : s.path)}>
                    <MoreVertical size={13} />
                  </button>
                  {s.valid && (
                    <button className="row-action" title={t('run')} onClick={() => setModalPath(s.path)}>
                      <Play size={13} />
                    </button>
                  )}
                  {menuPath === s.path && project && (
                    <ScenarioMenu
                      project={project.id}
                      path={s.path}
                      ci={s.ci}
                      onChanged={() => void fetchScenarios(project.id).then(({ scenarios }) => setScenarios(scenarios))}
                      onClose={() => setMenuPath(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>
        <main className="main">
          <div className="tabs">
            <button className={`tab${tab === 'run' ? ' active' : ''}`} onClick={() => setTab('run')}>
              {t('tabRun')}
            </button>
            <button className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => void openHistory(selectedPath)}>
              {t('tabHistory')}
            </button>
            <button className={`tab${tab === 'compare' ? ' active' : ''}`} disabled={!compare} onClick={() => setTab('compare')}>
              {t('tabCompare')}
            </button>
            <button
              className={`tab${tab === 'scenario' ? ' active' : ''}`}
              disabled={!selectedPath}
              onClick={() => setTab('scenario')}
            >
              {t('tabScenario')}
            </button>
          </div>
          {tab === 'scenario' && selectedPath && project ? (
            <ScenarioScreen project={project.id} path={selectedPath} />
          ) : tab === 'compare' && compare ? (
            <CompareScreen
              a={compare[0]}
              b={compare[1]}
              onClose={() => void openHistory(selectedPath)}
              onOpen={(run) => selectedPath && void openRun(selectedPath, run)}
            />
          ) : tab === 'history' ? (
            <HistoryScreen
              groups={historyGroups}
              filter={historyFilter}
              onFilter={setHistoryFilter}
              onOpen={(scenario, run) => void openRun(scenario, run)}
              onCompare={(scenario, a, b) => void openCompare(scenario, a, b)}
              onClear={(scenario) => {
                if (!project) return
                if (!scenario || scenario === selectedPath) setRunState(null)
                void clearRuns(project.id, scenario ?? undefined)
                  .catch((e: Error) => alert(e.message))
                  .then(() => Promise.all([openHistory(historyFilter), fetchScenarios(project.id).then(({ scenarios }) => setScenarios(scenarios))]))
              }}
            />
          ) : runState ? (
            <RunScreen
              state={runState}
              projectId={project?.id ?? ''}
              onStop={() => project && void stopRun(project.id)}
              onRepeat={() => selectedPath && setModalPath(selectedPath)}
            />
          ) : selected && !selected.valid ? (
            <div className="run-screen">
              <div className="run-header">
                <h1 className="mono">{selected.path}</h1>
                <span className="warn">{t('scenarioInvalid')}</span>
              </div>
              <div className="fail-banner">
                <div>
                  <b className="mono">{selected.error?.message}</b>
                  {selected.error?.line != null && (
                    <div className="fail-detail">
                      {t('line')} {selected.error.line}
                      {selected.error.column != null && `, ${t('column')} ${selected.error.column}`} · {t('parserStopped')}
                    </div>
                  )}
                </div>
              </div>
              {invalidFragment && (
                <section className="fragment">
                  <header className="muted">{t('fileFragment')}</header>
                  <pre className="body-text">
                    {invalidFragment.lines.map((line, i) => {
                      const n = invalidFragment.startLine + i
                      return (
                        <div key={n} className={`frag-line${n === selected.error?.line ? ' bad-line' : ''}`}>
                          <span className="frag-num">{n}</span>
                          {line || ' '}
                        </div>
                      )
                    })}
                  </pre>
                </section>
              )}
            </div>
          ) : selected ? (
            <div className="empty">
              <div>{t('notRunYet', selected.name)}</div>
              <div className="hint">{t('historyAfterFirst')}</div>
              <button className="btn primary" onClick={() => setModalPath(selected.path)}>
                {t('run')}
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty">
              <div>{t('noProjects')}</div>
              <div className="hint">{t('noProjectsHint')}</div>
              <code>{configPath}</code>
            </div>
          ) : (
            <div className="empty">
              {scenarios.length === 0 ? (
                <>
                  <div>{t('noScenarios')}</div>
                  <div className="hint">{t('noScenariosHint')}</div>
                </>
              ) : (
                <div className="hint">{t('pickScenario')}</div>
              )}
            </div>
          )}
        </main>
      </div>
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
      {modalPath && project && (
        <RunModal
          project={project.id}
          path={modalPath}
          onLaunch={(vars) => void launch(modalPath, vars)}
          onClose={() => setModalPath(null)}
        />
      )}
    </>
  )
}

function ScenarioStatus({ item, runningPath }: { item: ScenarioListItem; runningPath: string | null }) {
  if (item.path === runningPath) return <span className="accent"><Spinner size={12} /></span>
  if (!item.valid) return null
  if (!item.lastRun) return null
  if (item.lastRun.status === 'passed') return <span className="ok"><Check size={12} /></span>
  if (item.lastRun.status === 'failed') return <span className="bad"><Cross size={12} /></span>
  return null
}

function lastRunLabel(last: NonNullable<ScenarioListItem['lastRun']>): string {
  const when = new Date(last.startedAt)
  const sameDay = when.toDateString() === new Date().toDateString()
  const date = sameDay
    ? when.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })
  return last.status === 'passed' ? `${t('passed')} · ${date}` : last.status === 'failed' ? `${t('failed')} · ${date}` : date
}
