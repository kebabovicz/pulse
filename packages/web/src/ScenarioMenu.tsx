import { useRef, useState } from 'react'
import { deleteScenario, renameScenario, saveScenarioName, toggleCi } from './api'
import { Check } from './icons'
import { t } from './i18n'
import { notify } from './ui/toast'
import { useDismiss } from './ui/useDismiss'

/**
 * Scenario actions: rename the scenario (the `name:` inside the file, which is
 * what the list shows), rename the file itself, and delete. Folders are changed
 * by dragging.
 */
export function ScenarioMenu({
  project,
  path,
  name,
  ci,
  onChanged,
  onClose,
}: {
  project: string
  path: string
  name: string
  ci: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState<'scenario' | 'file' | null>(null)
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const baseName = path.slice(folder.length).replace(/\.ya?ml$/, '')
  const [newName, setNewName] = useState(name)
  const rootRef = useRef<HTMLDivElement>(null)

  useDismiss(rootRef, onClose)

  const startRename = (mode: 'scenario' | 'file') => {
    setNewName(mode === 'scenario' ? name : baseName)
    setRenaming(mode)
  }

  const submitRename = async () => {
    const trimmed = newName.trim()
    const current = renaming === 'scenario' ? name : baseName
    if (trimmed && trimmed !== current) {
      const change =
        renaming === 'scenario'
          ? saveScenarioName(project, path, trimmed)
          : // the extension and the folder stay put: only the file name is editable here
            renameScenario(project, path, `${folder}${trimmed}.yaml`)
      await change.catch((e: Error) => notify(e.message))
    }
    onChanged()
    onClose()
  }

  if (renaming) {
    return (
      <div className="scenario-menu" ref={rootRef}>
        <div className="modal-section">{renaming === 'scenario' ? t('renameTo') : t('renameFileTo')}</div>
        <input
          className="filter-input menu-input"
          autoComplete="off"
          spellCheck={false}
          data-bwignore="true"
          data-1p-ignore="true"
          data-lpignore="true"
          value={newName}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
        />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={() => void submitRename()}>
            {t('save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="scenario-menu" ref={rootRef}>
      <button
        className="select-item"
        onClick={() => {
          void toggleCi(project, path, !ci)
            .catch((e: Error) => notify(e.message))
            .then(() => {
              onChanged()
              onClose()
            })
        }}
      >
        {t('runOnDeploy')}
        {ci && (
          <span className="menu-check">
            <Check size={12} />
          </span>
        )}
      </button>
      <button className="select-item" onClick={() => startRename('scenario')}>
        {t('rename')}
      </button>
      <button className="select-item" onClick={() => startRename('file')}>
        {t('renameFile')}
      </button>
      <button
        className="select-item bad"
        onClick={() => {
          if (!confirming) return setConfirming(true)
          void deleteScenario(project, path)
            .catch((e: Error) => notify(e.message))
            .then(() => {
              onChanged()
              onClose()
            })
        }}
      >
        {confirming ? t('confirmDelete') : t('deleteBtn')}
      </button>
    </div>
  )
}
