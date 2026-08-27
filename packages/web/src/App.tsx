import { useEffect, useState } from 'react'
import type { ProjectView } from '@pulse/shared'
import { About } from './About'
import { ApiError, fetchProjects, logout } from './api'
import { subscribeToEvents } from './eventStream'
import { HostMenu } from './HostMenu'
import { PulseIcon, SignOut } from './icons'
import { dateLocale, lang, setLang, t } from './i18n'
import { Login } from './Login'
import { ProjectWorkspace } from './ProjectWorkspace'
import { Select } from './Select'

const PROJECT_KEY = 'pulse.project'

const HEALTH_COLOR = { up: 'var(--ok)', down: 'var(--fail)', unknown: 'var(--skip)' } as const

/** App shell: authentication, project switching, header and the about dialog. */
export function App() {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(PROJECT_KEY))
  const [configPath, setConfigPath] = useState('')
  const [needLogin, setNeedLogin] = useState(false)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const project = projects.find((p) => p.id === projectId) ?? projects[0]

  const reloadProjects = () =>
    fetchProjects().then(({ projects, configPath, authEnabled }) => {
      setProjects(projects)
      setConfigPath(configPath)
      setAuthEnabled(authEnabled)
    })

  useEffect(() => {
    void reloadProjects()
      .then(() => setAuthed(true))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setNeedLogin(true)
      })
  }, [])

  useEffect(() => {
    if (project) localStorage.setItem(PROJECT_KEY, project.id)
  }, [project])

  useEffect(() => {
    if (!authed) return
    return subscribeToEvents((event) => {
      if (event.type !== 'health-changed') return
      setProjects((prev) =>
        prev.map((p) =>
          p.id === event.project
            ? { ...p, health: { status: event.status, reason: event.reason, checkedAt: event.ts } }
            : p,
        ),
      )
    })
  }, [authed])

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
            <span className="health-dot" style={{ background: HEALTH_COLOR[project.health.status] }} />
            <Select
              value={project.id}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={setProjectId}
            />
            <HostMenu project={project} onChanged={() => void reloadProjects()} />
            {project.health.checkedAt && (
              <span className="checked-at">
                {project.health.status === 'down' ? `${t('notResponding')} · ${project.health.reason}` : t('checked')}{' '}
                {new Date(project.health.checkedAt).toLocaleTimeString(dateLocale)}
              </span>
            )}
          </>
        )}
        <span className="seg lang-seg">
          {(['en', 'ru'] as const).map((code) => (
            <button
              key={code}
              className={`seg-item${lang === code ? ' active' : ''}`}
              onClick={() => lang !== code && setLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </span>
        {authEnabled && (
          <button
            className="icon-btn header-logout"
            title={t('signOut')}
            onClick={() => void logout().then(() => location.reload())}
          >
            <SignOut size={13} />
          </button>
        )}
      </header>
      {project ? (
        <ProjectWorkspace key={project.id} project={project} />
      ) : (
        <div className="layout">
          <nav className="sidebar" />
          <main className="main">
            <div className="empty">
              <div>{t('noProjects')}</div>
              <div className="hint">{t('noProjectsHint')}</div>
              <code>{configPath}</code>
            </div>
          </main>
        </div>
      )}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
    </>
  )
}
