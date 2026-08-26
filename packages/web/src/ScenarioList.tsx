import { useMemo, useRef, useState } from 'react'
import type { ScenarioListItem } from '@pulse/shared'
import { importScenario } from './api'
import { Check, Cross, MoreVertical, Play, Spinner, Upload, Warning } from './icons'
import { dateLocale, t } from './i18n'
import { fileLabel } from './runState'
import { ScenarioMenu } from './ScenarioMenu'

/** Sidebar: scenario search, import and the grouped scenario list. */
export function ScenarioList({
  projectId,
  scenarios,
  selectedPath,
  runningPath,
  onOpen,
  onRun,
  onChanged,
}: {
  projectId: string
  scenarios: ScenarioListItem[]
  selectedPath: string | null
  runningPath: string | null
  onOpen: (path: string) => void
  onRun: (path: string) => void
  onChanged: () => void
}) {
  const [search, setSearch] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const visible = query
      ? scenarios.filter((s) => s.path.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
      : scenarios
    const byDir = new Map<string, ScenarioListItem[]>()
    for (const s of visible) {
      const dir = s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/') + 1) : ''
      byDir.set(dir, [...(byDir.get(dir) ?? []), s])
    }
    return [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [scenarios, search])

  const importFiles = async (files: File[]) => {
    const failures: string[] = []
    for (const file of files) {
      await importScenario(projectId, file.name, await file.text()).catch((err: Error) => failures.push(err.message))
    }
    if (failures.length) alert(failures.join('\n'))
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-tools">
        <input
          className="filter-input sidebar-search"
          type="search"
          name="scenario-search"
          autoComplete="off"
          spellCheck={false}
          data-bwignore="true"
          data-1p-ignore="true"
          data-lpignore="true"
          placeholder={t('searchScenarios')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
            void importFiles(files)
          }}
        />
      </div>
      {groups.map(([dir, items]) => (
        <div key={dir}>
          {dir && <div className="group">{dir}</div>}
          {items.map((item) => (
            <div
              key={item.path}
              className={`scenario-item${item.path === selectedPath ? ' selected' : ''}${
                !item.valid ? ' invalid' : item.lastRun?.status === 'failed' ? ' failed' : ''
              }`}
            >
              <button className="scenario-row" title={item.name} onClick={() => onOpen(item.path)}>
                <span className="scenario-title">
                  {fileLabel(item.path)}
                  <ScenarioStatus item={item} running={item.path === runningPath} />
                </span>
                <ScenarioMeta item={item} />
              </button>
              <button className="row-action" onClick={() => setMenuPath(menuPath === item.path ? null : item.path)}>
                <MoreVertical size={13} />
              </button>
              {item.valid && (
                <button className="row-action" title={t('run')} onClick={() => onRun(item.path)}>
                  <Play size={13} />
                </button>
              )}
              {menuPath === item.path && (
                <ScenarioMenu
                  project={projectId}
                  path={item.path}
                  ci={item.ci}
                  onChanged={onChanged}
                  onClose={() => setMenuPath(null)}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </nav>
  )
}

function ScenarioStatus({ item, running }: { item: ScenarioListItem; running: boolean }) {
  if (running)
    return (
      <span className="accent">
        <Spinner size={12} />
      </span>
    )
  if (!item.valid)
    return (
      <span className="warn">
        <Warning size={12} />
      </span>
    )
  if (!item.lastRun) return null
  if (item.lastRun.status === 'passed')
    return (
      <span className="ok">
        <Check size={12} />
      </span>
    )
  if (item.lastRun.status === 'failed')
    return (
      <span className="bad">
        <Cross size={12} />
      </span>
    )
  return null
}

function ScenarioMeta({ item }: { item: ScenarioListItem }) {
  if (!item.valid) {
    return (
      <span className="meta invalid">
        {t('invalidShort')}
        {item.error?.line != null && ` · ${t('line')} ${item.error.line}`}
      </span>
    )
  }
  return (
    <span className="meta">
      {t('steps', item.stepCount)}
      {item.lastRun && ` · ${lastRunLabel(item.lastRun)}`}
      {item.ci && <span className="accent"> · ci</span>}
    </span>
  )
}

function lastRunLabel(last: NonNullable<ScenarioListItem['lastRun']>): string {
  const when = new Date(last.startedAt)
  const sameDay = when.toDateString() === new Date().toDateString()
  const date = sameDay
    ? when.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })
  if (last.status === 'passed') return `${t('passed')} · ${date}`
  if (last.status === 'failed') return `${t('failed')} · ${date}`
  return date
}
