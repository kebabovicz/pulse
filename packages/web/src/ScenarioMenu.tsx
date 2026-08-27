import { useRef, useState } from 'react'
import { deleteScenario, renameScenario, toggleCi } from './api'
import { Check } from './icons'
import { t } from './i18n'
import { notify } from './ui/toast'
import { useDismiss } from './ui/useDismiss'

// Scenario actions: rename (the file name only — folders are changed by dragging) and delete.
export function ScenarioMenu({
  project,
  path,
  ci,
  onChanged,
  onClose,
}: {
  project: string
  path: string
  ci: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const baseName = path.slice(folder.length).replace(/\.ya?ml$/, '')
  const [newName, setNewName] = useState(baseName)
  const rootRef = useRef<HTMLDivElement>(null)

  useDismiss(rootRef, onClose)

  const submitRename = async () => {
    const trimmed = newName.trim()
    if (trimmed && trimmed !== baseName) {
      // the extension and the folder stay put: only the name is editable here
      await renameScenario(project, path, `${folder}${trimmed}.yaml`).catch((e: Error) => notify(e.message))
    }
    onChanged()
    onClose()
  }

  if (renaming) {
    return (
      <div className="scenario-menu" ref={rootRef}>
        <div className="modal-section">{t('renameTo')}</div>
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
      <button className="select-item" onClick={() => setRenaming(true)}>
        {t('rename')}
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
