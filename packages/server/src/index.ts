import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import chokidar from 'chokidar'
import { configPath, loadConfig } from './config.js'
import { EventBus } from './events.js'
import { HealthMonitor } from './health.js'
import { Auth } from './auth.js'
import { registerRoutes, type AppContext } from './routes.js'
import { Runner } from './runner.js'
import { ScenarioStore } from './scenarios.js'
import { StateStore } from './state.js'
import { RunStore } from './storage.js'

const dataDir = process.env.PULSE_DATA_DIR ?? '/data'
const port = Number(process.env.PULSE_PORT ?? 7100)

let config = loadConfig(dataDir)
const bus = new EventBus()
const scenarios = new ScenarioStore(bus)
const health = new HealthMonitor(bus)
const runs = new RunStore(dataDir)
const runner = new Runner(bus, runs, () => config.settings)
const state = new StateStore(dataDir)

const appCtx: AppContext = { config: () => config, scenarios, health, bus, runner, runs, dataDir, state }
const apply = async () => {
  await scenarios.start(config.projects)
  health.start(
    config.projects,
    config.settings.healthIntervalMs,
    (p) => appCtx.resolveBaseUrl?.(p) ?? Object.values(p.hosts)[0],
  )
}

// config reloads are serialised: two quick edits must not race the watchers
let applying: Promise<void> = Promise.resolve()
chokidar.watch(configPath(dataDir), { ignoreInitial: true }).on('all', () => {
  config = loadConfig(dataDir)
  applying = applying.then(apply).catch((e: unknown) => console.error('config reload failed:', e))
})

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
await app.register(fastifyCookie)

// single account from the environment; without PULSE_PASSWORD auth is disabled
const auth = new Auth(dataDir)
const SESSION_COOKIE = 'pulse_session'
const YEAR = 60 * 60 * 24 * 365

app.post<{ Body: { user?: string; password?: string } }>('/api/login', (req, reply) => {
  if (!auth.enabled) return { ok: true }
  const token = auth.login(req.body?.user ?? '', req.body?.password ?? '')
  if (!token) return reply.code(401).send({ message: 'wrong login or password' })
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: YEAR })
  return { ok: true }
})

app.addHook('onRequest', (req, reply, done) => {
  if (!auth.enabled || !req.url.startsWith('/api') || req.url === '/api/login') return done()
  // CI calls without a cookie: Authorization: Bearer <PULSE_PASSWORD>
  if (req.headers.authorization === `Bearer ${process.env.PULSE_PASSWORD}`) return done()
  if (!auth.verify(req.cookies[SESSION_COOKIE])) return reply.code(401).send({ message: 'unauthorized' })
  done()
})

registerRoutes(app, appCtx)
await apply()

const webDir = process.env.PULSE_WEB_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url))
if (fs.existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir })
}

for (const message of config.errors) app.log.warn(`config: ${message}`)
await app.listen({ port, host: '0.0.0.0' })
