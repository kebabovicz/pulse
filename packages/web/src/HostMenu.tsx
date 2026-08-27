import { useEffect, useRef, useState } from 'react'
import type { ProjectView } from '@pulse/shared'
import { addHost, deleteHost, setActiveHost } from './api'
import { Check, ChevronDown, Cross } from './icons'
import { t } from './i18n'
import { notify } from './ui/toast'

// Active host picker plus adding and removing manually entered hosts.
export function HostMenu({ project, onChanged }: { project: ProjectView; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('http://')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = async (host: string) => {
    setOpen(false)
    await setActiveHost(project.id, host).catch((e: Error) => notify(e.message))
    onChanged()
  }

  const submitAdd = async () => {
    try {
      await addHost(project.id, name.trim(), url.trim())
      await setActiveHost(project.id, name.trim())
    } catch (e) {
      return notify((e as Error).message)
    }
    setAdding(false)
    setName('')
    setUrl('http://')
    setOpen(false)
    onChanged()
  }

  return (
    <div className="select" ref={rootRef}>
      <button className="select-trigger host-trigger" onClick={() => setOpen(!open)}>
        <span className="base-url">
          {Object.keys(project.hosts).length > 1 && <b>{project.activeHost} · </b>}
          {project.baseUrl}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="select-menu host-menu">
          {Object.entries(project.hosts).map(([hostName, hostUrl]) => (
            <div key={hostName} className="host-row">
              <button
                className={`select-item${hostName === project.activeHost ? ' active' : ''}`}
                onClick={() => void pick(hostName)}
              >
                <span className="select-check">{hostName === project.activeHost && <Check size={12} />}</span>
                {hostName}
                <span className="muted host-url">{hostUrl}</span>
              </button>
              {project.customHosts.includes(hostName) && (
                <button
                  className="icon-btn"
                  title={t('deleteBtn')}
                  onClick={() => {
                    void deleteHost(project.id, hostName)
                      .catch((e: Error) => notify(e.message))
                      .then(onChanged)
                  }}
                >
                  <Cross size={11} />
                </button>
              )}
            </div>
          ))}
          {adding ? (
            <div className="host-add">
              <input
                className="filter-input menu-input"
                autoComplete="off"
                spellCheck={false}
                data-bwignore="true"
                data-1p-ignore="true"
                data-lpignore="true"
                placeholder={t('hostName')}
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="filter-input menu-input"
                autoComplete="off"
                spellCheck={false}
                data-bwignore="true"
                data-1p-ignore="true"
                data-lpignore="true"
                placeholder="http://host:port"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitAdd()}
              />
              <div className="modal-actions">
                <button className="btn" onClick={() => setAdding(false)}>
                  {t('cancel')}
                </button>
                <button className="btn primary" onClick={() => void submitAdd()}>
                  {t('save')}
                </button>
              </div>
            </div>
          ) : (
            <button className="select-item accent" onClick={() => setAdding(true)}>
              ＋ {t('addHost')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
