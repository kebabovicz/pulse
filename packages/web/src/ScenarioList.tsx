import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FixtureItem, ScenarioListItem } from '@pulse/shared'
import { createFolder, deleteFolder, importScenario, renameScenario, uploadFixture } from './api'
import {
  Check,
  ChevronDown,
  Paperclip,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  MoreVertical,
  Play,
  Spinner,
  Trash,
  Upload,
  Warning,
} from './icons'
import { dateLocale, t } from './i18n'
import { fileLabel } from './runState'
import { ScenarioMenu } from './ScenarioMenu'
import { buildTree, type TreeFolder } from './scenarioTree'
import { useClipped } from './ui/useClipped'
import { notify } from './ui/toast'

/** Sidebar: scenario search, import and the grouped scenario list. */
export function ScenarioList({
  projectId,
  scenarios,
  folders,
  fixtures,
  selectedPath,
  running,
  seen,
  onOpen,
  onRun,
  onRunFolder,
  onChanged,
  onMarkAllSeen,
}: {
  projectId: string
  scenarios: ScenarioListItem[]
  folders: string[]
  fixtures: FixtureItem[]
  selectedPath: string | null
  /** steps finished out of steps planned, for every run going right now */
  running: Record<string, { done: number; total: number; finished?: boolean }>
  /** run number of the last run opened for a scenario: a fresher one stays bright */
  seen: Record<string, number>
  onOpen: (path: string) => void
  onRun: (path: string) => void
  onRunFolder: (paths: string[]) => void
  onChanged: () => void
  onMarkAllSeen: () => void
}) {
  const [search, setSearch] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState<string | null>(null)
  const [createError, setCreateError] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameError, setRenameError] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const slide = useSlide(navRef, scenarios, folders)

  const tree = useMemo(() => {
    const query = search.trim().toLowerCase()
    const visible = query
      ? scenarios.filter((s) => s.path.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
      : scenarios
    const visibleFixtures = query ? fixtures.filter((f) => f.path.toLowerCase().includes(query)) : fixtures
    return buildTree(visible, folders, visibleFixtures)
  }, [scenarios, folders, fixtures, search])

  // every folder of the tree, so one button can fold or unfold the lot
  const everyFolder = useMemo(() => {
    const paths: string[] = []
    const walk = (folder: TreeFolder) => {
      for (const child of folder.folders) {
        paths.push(child.path)
        walk(child)
      }
    }
    walk(tree)
    return paths
  }, [tree])
  const allCollapsed = everyFolder.length > 0 && everyFolder.every((path) => collapsed.has(path))

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  /** A drop opens the folder it landed in, so the moved row stays in sight. */
  const expand = (path: string) =>
    setCollapsed((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })

  /** Where a new folder appears: next to what is selected, or at the top level. */
  const creationParent = (): string => {
    if (!selectedPath) return ''
    return selectedPath.includes('/') ? selectedPath.slice(0, selectedPath.lastIndexOf('/') + 1) : ''
  }

  const submitNewFolder = async (parent: string, typed: string) => {
    const name = typed.trim()
    if (!name) return setCreating(null) // nothing typed: the row just goes away
    try {
      await createFolder(projectId, `${parent}${name}`)
      setCreating(null)
      onChanged()
    } catch {
      // the row stays open and turns red: the name is taken
      setCreateError(true)
    }
  }

  /** Renaming a folder keeps it where it is: only the last part of the path changes. */
  const submitRenameFolder = async (path: string, typed: string) => {
    const name = typed.trim()
    const from = path.replace(/\/$/, '')
    const parent = from.slice(0, from.lastIndexOf('/') + 1)
    const to = `${parent}${name}`
    if (!name || to === from) return setRenaming(null)
    slide.expect(path, `${to}/`)
    try {
      await renameScenario(projectId, from, to)
      setRenaming(null)
      onChanged()
    } catch {
      // the row stays open and turns red: the name is taken
      setRenameError(true)
    }
  }

  /** Moving keeps the file name and only changes the folder it sits in. */
  const move = async (from: string, toFolder: string) => {
    const base = from.split('/').pop()!
    const to = `${toFolder}${base}`
    if (to === from) return
    slide.expect(from, to)
    expand(toFolder)
    try {
      await renameScenario(projectId, from, to)
      onChanged()
    } catch (e) {
      notify((e as Error).message)
    }
  }

  /** The tree asks before this runs: a folder takes its scenarios with it. */
  const removeFolder = async (folder: TreeFolder) => {
    try {
      await deleteFolder(projectId, folder.path.replace(/\/$/, ''))
      onChanged()
    } catch (e) {
      notify((e as Error).message)
    }
  }

  /** A folder moves with everything inside it. */
  const moveFolder = async (from: string, toFolder: string) => {
    const name = from.replace(/\/$/, '').split('/').pop()!
    const to = `${toFolder}${name}`
    if (to + '/' === from || toFolder.startsWith(from)) return
    slide.expect(from, `${to}/`)
    expand(toFolder)
    try {
      await renameScenario(projectId, from.replace(/\/$/, ''), to)
      onChanged()
    } catch (e) {
      notify((e as Error).message)
    }
  }

  /** A dropped .yaml is a scenario; anything else lands as a fixture beside them. */
  const importFiles = async (files: File[], folder = '') => {
    const failures: string[] = []
    for (const file of files) {
      const target = `${folder}${file.name}`
      const put = /\.ya?ml$/i.test(file.name)
        ? importScenario(projectId, target, await file.text())
        : uploadFixture(projectId, target, await toBase64(file))
      await put.catch((err: Error) => failures.push(err.message))
    }
    for (const failure of failures) notify(failure)
    onChanged()
  }

  return (
    <nav className="sidebar" ref={navRef}>
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
        <button className="icon-btn" title={t('markAllSeen')} onClick={onMarkAllSeen}>
          <Check size={13} />
        </button>
        <button
          className="icon-btn"
          title={allCollapsed ? t('expandGroups') : t('collapseGroups')}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(everyFolder))}
        >
          {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
        <button
          className="icon-btn"
          title={t('newFolder')}
          onClick={() => {
            setCreateError(false)
            setCreating(creationParent())
          }}
        >
          <FolderPlus size={13} />
        </button>
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
        running={running}
        seen={seen}
        menuPath={menuPath}
        onMenu={setMenuPath}
        onOpen={onOpen}
        onRun={onRun}
        onRunFolder={onRunFolder}
        onMove={(from, to) => void move(from, to)}
        onMoveFolder={(from, to) => void moveFolder(from, to)}
        onImportFiles={(files, folder) => void importFiles(files, folder)}
        onDeleteFolder={(folder) => void removeFolder(folder)}
        creating={creating}
        createError={createError}
        onCreateSubmit={(parent, name) => void submitNewFolder(parent, name)}
        onCreateCancel={() => setCreating(null)}
        onCreateTyping={() => setCreateError(false)}
        renaming={renaming}
        renameError={renameError}
        onRenameStart={(path) => {
          setRenameError(false)
          setRenaming(path)
        }}
        onRenameSubmit={(path, name) => void submitRenameFolder(path, name)}
        onRenameCancel={() => setRenaming(null)}
        onRenameTyping={() => setRenameError(false)}
        onChanged={onChanged}
      />
    </nav>
  )
}

const SLIDE_MS = 180
/** A rename reaches the list in steps — file gone, file back — so the snapshot outlives the first of them. */
const SLIDE_WINDOW_MS = 2000

/**
 * A moved row is still the same row, so it travels instead of blinking out and
 * back: every position is measured before the move, and afterwards each row that
 * ended up elsewhere is animated from where it used to be.
 */
function useSlide(root: React.RefObject<HTMLElement | null>, scenarios: ScenarioListItem[], folders: string[]) {
  const before = useRef<{ rects: Map<string, DOMRect>; from: string; to: string; at: number } | null>(null)

  const rows = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-node]') ?? [])]

  useLayoutEffect(() => {
    const snapshot = before.current
    if (!snapshot) return
    if (performance.now() - snapshot.at > SLIDE_WINDOW_MS) {
      before.current = null
      return
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const el of rows()) {
      const id = el.dataset.node ?? ''
      const was = snapshot.rects.get(id) ?? snapshot.rects.get(formerPath(id, snapshot))
      if (!was) continue
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      for (const running of el.getAnimations()) running.cancel()
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: SLIDE_MS,
        easing: 'ease-out',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, folders])

  return {
    /** Call right before a move: it records where every row sits and what is about to be renamed. */
    expect(from: string, to: string) {
      const rects = new Map(rows().map((el) => [el.dataset.node ?? '', el.getBoundingClientRect()]))
      before.current = { rects, from, to, at: performance.now() }
    },
  }
}

/** Where a row lived before the move: the moved row itself, or anything inside a moved folder. */
function formerPath(id: string, rename: { from: string; to: string }): string {
  if (id === rename.to) return rename.from
  if (rename.to.endsWith('/') && id.startsWith(rename.to)) return rename.from + id.slice(rename.to.length)
  return id
}

interface ViewProps {
  folder: TreeFolder
  collapsed: Set<string>
  onToggleFolder: (path: string) => void
  projectId: string
  selectedPath: string | null
  running: Record<string, { done: number; total: number; finished?: boolean }>
  seen: Record<string, number>
  menuPath: string | null
  onMenu: (path: string | null) => void
  onOpen: (path: string) => void
  onRun: (path: string) => void
  onRunFolder: (paths: string[]) => void
  onMove: (from: string, toFolder: string) => void
  onMoveFolder: (from: string, toFolder: string) => void
  onImportFiles: (files: File[], folder: string) => void
  onDeleteFolder: (folder: TreeFolder) => void
  /** path of the folder a new one is being typed into, or null */
  creating: string | null
  createError: boolean
  onCreateSubmit: (parent: string, name: string) => void
  onCreateCancel: () => void
  onCreateTyping: () => void
  /** path of the folder whose name is being typed over, or null */
  renaming: string | null
  renameError: boolean
  onRenameStart: (path: string) => void
  onRenameSubmit: (path: string, name: string) => void
  onRenameCancel: () => void
  onRenameTyping: () => void
  onChanged: () => void
}

/** The row a folder is named in — when it is born and when it is renamed. */
function FolderNameRow({
  initial,
  depth,
  error,
  onSubmit,
  onCancel,
  onTyping,
}: {
  initial: string
  depth: number
  error: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
  onTyping: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  // the old name comes up selected, so typing replaces it
  useEffect(() => inputRef.current?.select(), [])
  return (
    <div className={`scn-folder scn-folder-new${error ? ' invalid' : ''}`} style={indent(depth)}>
      <input
        ref={inputRef}
        className="scn-folder-input"
        autoFocus
        value={value}
        placeholder={t('newFolderDefault')}
        title={error ? t('folderExists') : undefined}
        onChange={(e) => {
          setValue(e.target.value)
          onTyping()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => onSubmit(value)}
      />
    </div>
  )
}

/** Rows are indented by their depth, and the guides are drawn from the same number. */
const indent = (depth: number): React.CSSProperties => {
  const px = 8 + depth * 12
  return { paddingLeft: px, ['--indent' as string]: `${px}px` }
}

/** Renaming waits for a second click, but not as long as the system double click does. */
const DOUBLE_CLICK_MS = 200

/** What is being dragged: a scenario file or a whole folder. */
const DRAG_SCENARIO = 'application/x-pulse-scenario'
const DRAG_FOLDER = 'application/x-pulse-folder'

/** A folder and everything under it; folders nest, so the indent carries the depth. */
function FolderView(props: ViewProps) {
  const { folder, collapsed, onToggleFolder, onRunFolder, onMove, onMoveFolder } = props
  const [over, setOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [asking, setAsking] = useState(false)
  const lastClick = useRef(0)
  const open = !collapsed.has(folder.path)
  const isRoot = folder.path === ''

  const accept = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(DRAG_SCENARIO) && !types.includes(DRAG_FOLDER)) return
    e.preventDefault()
    e.stopPropagation()
    setOver(true)
  }

  // moving between child elements fires dragleave; ignore it unless the pointer really left
  const leave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setOver(false)
  }

  const drop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    // files dragged from the desktop land in this folder: yaml as scenarios, the rest as fixtures
    const files = [...(e.dataTransfer.files ?? [])]
    if (files.length > 0) return void props.onImportFiles(files, folder.path)
    const scenario = e.dataTransfer.getData(DRAG_SCENARIO)
    if (scenario) return onMove(scenario, folder.path)
    const dragged = e.dataTransfer.getData(DRAG_FOLDER)
    if (dragged) onMoveFolder(dragged, folder.path)
  }

  const renaming = props.renaming === folder.path

  return (
    <>
      {!isRoot && renaming && (
        <FolderNameRow
          initial={folder.name}
          depth={folder.depth}
          error={props.renameError}
          onSubmit={(name) => props.onRenameSubmit(folder.path, name)}
          onCancel={props.onRenameCancel}
          onTyping={props.onRenameTyping}
        />
      )}
      {!isRoot && !renaming && (
        <div
          className={`scn-folder${over ? ' drop-target' : ''}${dragging ? ' dragging' : ''}`}
          style={indent(folder.depth)}
          data-node={folder.path}
          draggable
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.setData(DRAG_FOLDER, folder.path)
            e.dataTransfer.effectAllowed = 'move'
            // after the drag image is taken, so the ghost stays solid
            requestAnimationFrame(() => setDragging(true))
          }}
          onDragEnd={() => setDragging(false)}
          onDragOver={accept}
          onDragLeave={leave}
          onDrop={drop}
          onMouseLeave={() => setAsking(false)}
        >
          <button
            className="scn-folder-row"
            onClick={() => {
              const now = performance.now()
              const second = now - lastClick.current < DOUBLE_CLICK_MS
              lastClick.current = second ? 0 : now
              // the first click already toggled the folder; undo that and rename instead
              onToggleFolder(folder.path)
              if (second) props.onRenameStart(folder.path)
            }}
          >
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
          <button
            className={`row-action row-ask${asking ? ' asking' : ''}`}
            title={asking ? undefined : t('deleteFolder')}
            onClick={() => {
              if (!asking) return setAsking(true)
              setAsking(false)
              props.onDeleteFolder(folder)
            }}
          >
            <Trash size={11} />
            <span className="row-ask-text">{t('sure')}</span>
          </button>
        </div>
      )}
      {open && (
        <>
          {props.creating === folder.path && (
            <FolderNameRow
              initial=""
              depth={folder.depth + 1}
              error={props.createError}
              onSubmit={(name) => props.onCreateSubmit(folder.path, name)}
              onCancel={props.onCreateCancel}
              onTyping={props.onCreateTyping}
            />
          )}
          {/* scenarios first: a file after a nested subtree reads as if it lived inside it */}
          {folder.scenarios.map((item) => (
            <ScenarioRow key={item.path} {...props} item={item} />
          ))}
          {folder.fixtures.map((fixture) => (
            <FixtureRow
              key={fixture.path}
              fixture={fixture}
              depth={folder.depth + 1}
              selected={fixture.path === props.selectedPath}
              onOpen={props.onOpen}
            />
          ))}
          {folder.folders.map((child) => (
            <FolderView key={child.path} {...props} folder={child} />
          ))}
          {isRoot && (
            <div
              className={`scn-drop-root${over ? ' drop-target' : ''}`}
              onDragOver={accept}
              onDragLeave={leave}
              onDrop={drop}
            />
          )}
        </>
      )}
    </>
  )
}

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

/**
 * A file a scenario uploads. It cannot be run or edited here, so the row only
 * says what it is and who reads it — a fixture nobody names is dimmed, because
 * that is usually a leftover.
 */
function FixtureRow({
  fixture,
  depth,
  selected,
  onOpen,
}: {
  fixture: FixtureItem
  depth: number
  selected: boolean
  onOpen: (path: string) => void
}) {
  const orphan = fixture.usedBy.length === 0
  return (
    <div
      className={`scenario-item fixture-item${selected ? ' selected' : ''}${orphan ? ' orphan' : ''}`}
      style={indent(depth)}
    >
      <button className="scenario-row" onClick={() => onOpen(fixture.path)}>
        <span className="scenario-title">
          <span className="scenario-name">{fileLabel(fixture.path)}</span>
          <span className="muted fixture-mark">
            <Paperclip size={11} />
          </span>
        </span>
        <span className="meta">
          <span className="meta-main">
            {fmtBytes(fixture.sizeBytes)}
            {' · '}
            {orphan ? t('fixtureUnused') : t('fixtureUsedBy', fixture.usedBy.length)}
          </span>
        </span>
      </button>
    </div>
  )
}

function ScenarioRow({
  item,
  folder,
  projectId,
  selectedPath,
  running,
  seen,
  menuPath,
  onMenu,
  onOpen,
  onRun,
  onMove,
  onMoveFolder,
  onImportFiles,
  onChanged,
}: ViewProps & { item: ScenarioListItem }) {
  const [over, setOver] = useState(false)
  const [dragging, setDragging] = useState(false)

  /** Dropping onto a scenario means "put it where this one lives". */
  const accept = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(DRAG_SCENARIO) && !types.includes(DRAG_FOLDER)) return
    e.preventDefault()
    e.stopPropagation()
    setOver(true)
  }

  const drop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    // files dragged from the desktop land in this folder: yaml as scenarios, the rest as fixtures
    const files = [...(e.dataTransfer.files ?? [])]
    if (files.length > 0) return void onImportFiles(files, folder.path)
    const scenario = e.dataTransfer.getData(DRAG_SCENARIO)
    if (scenario) return onMove(scenario, folder.path)
    const dragged = e.dataTransfer.getData(DRAG_FOLDER)
    if (dragged) onMoveFolder(dragged, folder.path)
  }

  const run = running[item.path]

  return (
    <div
      className={`scenario-item${item.path === selectedPath ? ' selected' : ''} ${outcomeClass(item)}${
        item.lastRun && (seen[item.path] ?? 0) >= item.lastRun.run ? ' seen' : ''
      }${over ? ' drop-target' : ''}${dragging ? ' dragging' : ''}`}
      style={indent(folder.depth + 1)}
      data-node={item.path}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_SCENARIO, item.path)
        e.dataTransfer.effectAllowed = 'move'
        requestAnimationFrame(() => setDragging(true))
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={accept}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={drop}
    >
      {run && (
        <span
          className={`scn-progress${run.finished ? ' done' : ''}`}
          style={{ width: `${Math.round((run.done / Math.max(run.total, 1)) * 100)}%` }}
        />
      )}
      <button className="scenario-row" onClick={() => onOpen(item.path)}>
        <span className="scenario-title">
          <ScenarioName label={item.valid ? item.name : fileLabel(item.path)} />
          <ScenarioStatus item={item} running={Boolean(run)} />
          {/* always present, so the mark sits in one column instead of trailing
              the text at a different place in every row */}
          <span className={`ci-dot${item.ci ? ' on' : ''}`} title={item.ci ? t('runOnDeploy') : undefined} />
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
          name={item.name}
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

/**
 * The colour of the row's left edge is the outcome: green passed, red failed,
 * amber a run that limped through — noticeably slower than this scenario usually
 * is, or passing only because a step was repeated (or a file that does not parse
 * — it has no runs to colour).
 */
function outcomeClass(item: ScenarioListItem): string {
  if (!item.valid) return 'invalid'
  if (item.missingFixtures?.length) return 'invalid' // a file it uploads is not there
  if (!item.lastRun) return ''
  if (item.lastRun.status === 'failed') return 'failed'
  if (item.lastRun.slow || item.lastRun.retried) return 'slow'
  if (item.lastRun.status === 'passed') return 'passed'
  return ''
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
  // a fixture it names is not in the folder: the run would fail on that step
  if (item.missingFixtures?.length) {
    return (
      <span className="meta invalid" title={item.missingFixtures.join(', ')}>
        {t('fixtureMissing')}: {item.missingFixtures.join(', ')}
      </span>
    )
  }
  return (
    <span className="meta">
      <span className="meta-main">
        <span className="meta-file" title={item.path}>
          {fileLabel(item.path)}
        </span>
        {' · '}
        {t('steps', item.stepCount)}
        {item.lastRun && ` · ${lastRunLabel(item.lastRun)}`}
      </span>
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

/** A file as the fixture endpoint wants it: base64 without the data: prefix. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((typeof reader.result === 'string' ? reader.result : '').split(',')[1] ?? '')
    reader.onerror = () => reject(new Error(`${file.name}: could not be read`))
    reader.readAsDataURL(file)
  })
}
