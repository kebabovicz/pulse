import { useEffect, useRef, useState } from 'react'
import { deleteScenario, renameScenario, toggleCi } from './api'
import { Check } from './icons'
import { t } from './i18n'

// Меню операций со сценарием: переименовать/перенести (правкой пути) и удалить.
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
  const [newPath, setNewPath] = useState(path)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const submitRename = async () => {
    if (newPath !== path) await renameScenario(project, path, newPath).catch((e: Error) => alert(e.message))
    onChanged()
    onClose()
  }

  if (renaming) {
    return (
      <div className="scenario-menu" ref={rootRef}>
        <div className="modal-section">{t('newPath')}</div>
        <input
          className="filter-input menu-input"
          autoComplete="off"
          spellCheck={false}
          data-bwignore="true"
          data-1p-ignore="true"
          data-lpignore="true"
          value={newPath}
          autoFocus
          onChange={(e) => setNewPath(e.target.value)}
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
            .catch((e: Error) => alert(e.message))
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
            .catch((e: Error) => alert(e.message))
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
