import { useMemo, useRef, useState } from 'react'
import type { ScenarioListItem } from '@pulse/shared'
import { importScenario } from './api'
import { Check, ChevronDown, Cross, MoreVertical, Play, Spinner, Upload, Warning } from './icons'
import { dateLocale, t } from './i18n'
import { fileLabel } from './runState'
import { ScenarioMenu } from './ScenarioMenu'
import { buildTree, type TreeFolder } from './scenarioTree'
import { useClipped } from './ui/useClipped'

/** Sidebar: scenario search, import and the grouped scenario list. */
export function ScenarioList({
  projectId,
  scenarios,
  selectedPath,
  runningPath,
  onOpen,
  onRun,
  onRunFolder,
  onChanged,
}: {
  projectId: string
  scenarios: ScenarioListItem[]
  selectedPath: string | null
  runningPath: string | null
  onOpen: (path: string) => void
  onRun: (path: string) => void
  onRunFolder: (paths: string[]) => void
  onChanged: () => void
}) {
  const [search, setSearch] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const importRef = useRef<HTMLInputElement>(null)

  const tree = useMemo(() => {
    const query = search.trim().toLowerCase()
    const visible = query
      ? scenarios.filter((s) => s.path.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
      : scenarios
    return buildTree(visible)
  }, [scenarios, search])

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

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
      <FolderView
        folder={tree}
        collapsed={collapsed}
        onToggleFolder={toggleFolder}
        projectId={projectId}
        selectedPath={selectedPath}
        runningPath={runningPath}
        menuPath={menuPath}
        onMenu={setMenuPath}
        onOpen={onOpen}
        onRun={onRun}
        onRunFolder={onRunFolder}
        onChanged={onChanged}
      />
    </nav>
  )
}

interface ViewProps {
  folder: TreeFolder
  collapsed: Set<string>
  onToggleFolder: (path: string) => void
  projectId: string
  selectedPath: string | null
  runningPath: string | null
  menuPath: string | null
  onMenu: (path: string | null) => void
  onOpen: (path: string) => void
  onRun: (path: string) => void
  onRunFolder: (paths: string[]) => void
  onChanged: () => void
}

/** A folder and everything under it; folders nest, so the indent carries the depth. */
function FolderView(props: ViewProps) {
  const { folder, collapsed, onToggleFolder, onRunFolder } = props
  const open = !collapsed.has(folder.path)
  const isRoot = folder.path === ''

  return (
    <>
      {!isRoot && (
        <div className="scn-folder" style={{ paddingLeft: 8 + folder.depth * 12 }}>
          <button className="scn-folder-row" onClick={() => onToggleFolder(folder.path)}>
            <span className={`scn-folder-chevron${open ? ' open' : ''}`}>
              <ChevronDown size={11} />
            </span>
            <span className="scn-folder-name">{folder.name}/</span>
            <span className="muted scn-folder-count">{folder.runnable.length}</span>
          </button>
          {folder.runnable.length > 0 && (
            <button className="row-action" title={t('runFolder')} onClick={() => onRunFolder(folder.runnable)}>
              <Play size={12} />
            </button>
          )}
        </div>
      )}
      {open && (
        <>
          {folder.folders.map((child) => (
            <FolderView key={child.path} {...props} folder={child} />
          ))}
          {folder.scenarios.map((item) => (
            <ScenarioRow key={item.path} {...props} item={item} />
          ))}
        </>
      )}
    </>
  )
}

function ScenarioRow({
  item,
  folder,
  projectId,
  selectedPath,
  runningPath,
  menuPath,
  onMenu,
  onOpen,
  onRun,
  onChanged,
}: ViewProps & { item: ScenarioListItem }) {
  return (
    <div
      className={`scenario-item${item.path === selectedPath ? ' selected' : ''}${
        !item.valid ? ' invalid' : item.lastRun?.status === 'failed' ? ' failed' : ''
      }`}
      style={{ paddingLeft: folder.depth >= 0 ? 8 + (folder.depth + 1) * 12 : 0 }}
    >
      <button className="scenario-row" onClick={() => onOpen(item.path)}>
        <span className="scenario-title">
          <ScenarioName label={fileLabel(item.path)} />
          <ScenarioStatus item={item} running={item.path === runningPath} />
        </span>
        <ScenarioMeta item={item} />
      </button>
      <button className="row-action" onClick={() => onMenu(menuPath === item.path ? null : item.path)}>
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
          onClose={() => onMenu(null)}
        />
      )}
    </div>
  )
}

/** The name carries a tooltip only when the column cuts it off. */
function ScenarioName({ label }: { label: string }) {
  const [ref, clipped] = useClipped<HTMLSpanElement>(label)
  return (
    <span ref={ref} className="scenario-name" title={clipped ? label : undefined}>
      {label}
    </span>
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
      <span className="meta-main">
        {t('steps', item.stepCount)}
        {item.lastRun && ` · ${lastRunLabel(item.lastRun)}`}
      </span>
      {item.ci && <span className="accent meta-ci">· ci</span>}
    </span>
  )
}

/** Only when it ran: the outcome is already carried by the status icon. */
function lastRunLabel(last: NonNullable<ScenarioListItem['lastRun']>): string {
  const when = new Date(last.startedAt)
  const sameDay = when.toDateString() === new Date().toDateString()
  return sameDay
    ? when.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })
}
