import { useEffect, useRef, useState } from 'react'
import type { ProjectView, RunRecord, RunsGroup, ScenarioListItem } from '@pulse/shared'
import {
  clearRuns,
  fetchAllRuns,
  fetchRun,
  fetchRuns,
  fetchScenarioDetail,
  fetchScenarios,
  startRun,
  stopRun,
  type FileFragment,
} from './api'
import { CompareScreen } from './CompareScreen'
import { subscribeToEvents } from './eventStream'
import { HistoryScreen } from './HistoryScreen'
import { t } from './i18n'
import { InvalidScenario } from './InvalidScenario'
import { RunModal } from './RunModal'
import { RunScreen } from './RunScreen'
import { fromRecord, pendingRun, reduce, type RunState } from './runState'
import { ScenarioList } from './ScenarioList'
import { Loading } from './ui/Loading'
import { notify } from './ui/toast'
import { ScenarioScreen } from './ScenarioScreen'
import { StatsScreen } from './StatsScreen'

type Tab = 'run' | 'history' | 'compare' | 'scenario' | 'stats'

const lastScenarioKey = (projectId: string) => `pulse.scenario.${projectId}`

/**
 * Everything scoped to one project: scenario list, tabs and screens.
 * Mounted with the project id as `key`, so switching projects resets the state.
 */
export function ProjectWorkspace({ project }: { project: ProjectView }) {
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('run')
  const [runState, setRunState] = useState<RunState | null>(null)
  const [historyGroups, setHistoryGroups] = useState<RunsGroup[]>([])
  const [compare, setCompare] = useState<[RunRecord, RunRecord] | null>(null)
  const [invalidFragment, setInvalidFragment] = useState<FileFragment | null>(null)
  const [modalPath, setModalPath] = useState<string | null>(null)
  // a run is on its way: the panel waits instead of claiming the scenario never ran
  const [loading, setLoading] = useState(false)
  // steps finished out of the steps planned, per scenario: with concurrency on,
  // several rows fill at once
  const [progress, setProgress] = useState<Record<string, { done: number; total: number; finished?: boolean }>>({})
  // guards against a stale scenario load landing after a newer one
  const openRequest = useRef(0)

  const reloadScenarios = () =>
    fetchScenarios(project.id).then(({ scenarios, folders }) => {
      setScenarios(scenarios)
      setFolders(folders)
    })

  useEffect(
    () =>
      subscribeToEvents((event) => {
        if (event.project !== project.id) return
        if (event.type === 'scenario-changed') {
          setScenarios((prev) => {
            const rest = prev.filter((s) => s.path !== event.path)
            if (event.action === 'removed' || !event.summary) return rest
            const ci = prev.find((s) => s.path === event.path)?.ci ?? false
            return [...rest, { ...event.summary, ci }].sort((a, b) => a.path.localeCompare(b.path))
          })
        } else if ('run' in event) {
          // no live flag in the condition: reduce() itself ignores events of
          // other runs, so an event arriving before React re-renders is not lost
          setRunState((prev) => (prev ? reduce(prev, event) : prev))
          // the sidebar follows every run, including the ones nobody is watching
          if (event.type === 'run-started')
            setProgress((p) => ({ ...p, [event.scenario]: { done: 0, total: event.steps.length } }))
          if (event.type === 'step-finished')
            setProgress((p) => {
              const entry = p[event.scenario]
              return entry ? { ...p, [event.scenario]: { ...entry, done: entry.done + 1 } } : p
            })
          if (event.type === 'run-finished') {
            // the bar reaches the end and fades instead of vanishing mid-way:
            // a run that took a blink still reads as a run that completed
            const scenario = event.scenario
            setProgress((p) => {
              const entry = p[scenario]
              return entry ? { ...p, [scenario]: { ...entry, done: entry.total, finished: true } } : p
            })
            setTimeout(() => setProgress(({ [scenario]: _done, ...rest }) => rest), 500)
            void reloadScenarios() // the row picks up the outcome of the run that just ended
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per project
    [project.id],
  )

  const resetView = () => {
    setRunState(null)
    setInvalidFragment(null)
  }

  // clicking a scenario loads its latest run but leaves the tab alone: only the
  // Run tab follows the selection, the others keep showing what they showed
  const openScenario = async (path: string, list: ScenarioListItem[] = scenarios) => {
    setSelectedPath(path)
    resetView()
    localStorage.setItem(lastScenarioKey(project.id), path)
    const request = ++openRequest.current
    setLoading(true)
    try {
      const item = list.find((s) => s.path === path)
      if (item && !item.valid) {
        const { fragment } = await fetchScenarioDetail(project.id, path)
        if (request === openRequest.current) setInvalidFragment(fragment)
        return
      }
      const { runs } = await fetchRuns(project.id, path)
      if (runs.length === 0) return
      const record = await fetchRun(project.id, path, runs[0].run)
      // a slower earlier request must not overwrite what the user opened since
      if (request === openRequest.current) setRunState(fromRecord(record))
    } finally {
      if (request === openRequest.current) setLoading(false)
    }
  }

  // the History tab shows the whole project history, every scenario at once (req 41)
  const openHistory = async () => {
    setTab('history')
    setHistoryGroups((await fetchAllRuns(project.id)).groups)
  }

  const openRun = async (path: string, run: number) => {
    setSelectedPath(path)
    setTab('run')
    resetView()
    const request = ++openRequest.current
    setLoading(true)
    try {
      const record = await fetchRun(project.id, path, run)
      if (request === openRequest.current) setRunState(fromRecord(record))
    } finally {
      if (request === openRequest.current) setLoading(false)
    }
  }

  const openCompare = async (path: string, a: number, b: number) => {
    const [first, second] = await Promise.all([fetchRun(project.id, path, a), fetchRun(project.id, path, b)])
    setSelectedPath(path)
    setCompare([first, second])
    setTab('compare')
  }

  /**
   * Every scenario of the folder goes to the runner at once: it starts as many
   * as the project's concurrency allows and queues the rest. The screen stays
   * where the reader left it — the sidebar rows carry the progress.
   */
  const runFolder = async (paths: string[]) => {
    const failures = await Promise.all(
      paths.map((path) =>
        startRun(project.id, path, {}).then(
          () => null,
          (e: Error) => e.message,
        ),
      ),
    )
    const failed = failures.find(Boolean)
    if (failed) notify(failed)
  }

  const launch = async (path: string, vars: Record<string, string>) => {
    setModalPath(null)
    setSelectedPath(path)
    setTab('run')
    // the placeholder goes up BEFORE the request: run events can outrun the POST response
    openRequest.current++ // a pending scenario load must not overwrite this run
    setLoading(false)
    setRunState(pendingRun(path))
    try {
      await startRun(project.id, path, vars)
    } catch (e) {
      setRunState(null)
      notify((e as Error).message)
    }
  }

  useEffect(() => {
    void fetchScenarios(project.id).then(({ scenarios, folders }) => {
      setScenarios(scenarios)
      setFolders(folders)
      // restore context after a reload (a language switch reloads the page)
      const saved = localStorage.getItem(lastScenarioKey(project.id))
      if (saved && scenarios.some((s) => s.path === saved)) void openScenario(saved, scenarios)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load for this project only
  }, [project.id])

  const clearHistory = async (scenario: string | null) => {
    if (!scenario || scenario === selectedPath) setRunState(null)
    await clearRuns(project.id, scenario ?? undefined).catch((e: Error) => notify(e.message))
    await Promise.all([openHistory(), reloadScenarios()])
  }

  const selected = scenarios.find((s) => s.path === selectedPath)

  return (
    <div className="layout">
      <ScenarioList
        projectId={project.id}
        scenarios={scenarios}
        folders={folders}
        selectedPath={selectedPath}
        running={progress}
        onOpen={(path) => void openScenario(path)}
        onRun={setModalPath}
        onRunFolder={(paths) => void runFolder(paths)}
        onChanged={() => void reloadScenarios()}
      />
      <main className="main">
        <div className="tabs">
          <TabButton active={tab === 'run'} onClick={() => setTab('run')} label={t('tabRun')} />
          <TabButton active={tab === 'history'} onClick={() => void openHistory()} label={t('tabHistory')} />
          <TabButton
            active={tab === 'compare'}
            disabled={!compare}
            onClick={() => setTab('compare')}
            label={t('tabCompare')}
          />
          <TabButton active={tab === 'stats'} onClick={() => setTab('stats')} label={t('tabStats')} />
          <TabButton
            active={tab === 'scenario'}
            disabled={!selectedPath}
            onClick={() => setTab('scenario')}
            label={t('tabScenario')}
          />
        </div>
        {/* the key restarts the fade on every tab switch, but not while a tab updates in place */}
        <div className="tab-panel" key={tab}>
          {tab === 'stats' ? (
            <StatsScreen project={project.id} onOpenRun={(scenario, run) => void openRun(scenario, run)} />
          ) : tab === 'scenario' && selectedPath ? (
            <ScenarioScreen project={project.id} path={selectedPath} />
          ) : tab === 'compare' && compare ? (
            <CompareScreen
              a={compare[0]}
              b={compare[1]}
              onClose={() => void openHistory()}
              onOpen={(run) => selectedPath && void openRun(selectedPath, run)}
            />
          ) : tab === 'history' ? (
            <HistoryScreen
              groups={historyGroups}
              onOpen={(scenario, run) => void openRun(scenario, run)}
              onCompare={(scenario, a, b) => void openCompare(scenario, a, b)}
              onClear={(scenario) => void clearHistory(scenario)}
            />
          ) : runState ? (
            <RunScreen
              state={runState}
              projectId={project.id}
              onStop={() => void stopRun(project.id)}
              onRepeat={() => selectedPath && setModalPath(selectedPath)}
            />
          ) : loading ? (
            <Loading />
          ) : selected && !selected.valid ? (
            <InvalidScenario scenario={selected} fragment={invalidFragment} />
          ) : selected ? (
            <div className="empty">
              <div>{t('notRunYet', selected.name)}</div>
              <div className="hint">{t('historyAfterFirst')}</div>
              <button className="btn primary" onClick={() => setModalPath(selected.path)}>
                {t('run')}
              </button>
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
        </div>
      </main>
      {modalPath && (
        <RunModal
          project={project.id}
          path={modalPath}
          onLaunch={(vars) => void launch(modalPath, vars)}
          onClose={() => setModalPath(null)}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button className={`tab${active ? ' active' : ''}`} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}
