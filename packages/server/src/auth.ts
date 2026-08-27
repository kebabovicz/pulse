import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

interface SessionsFile {
  passwordHash: string
  tokens: string[] // sha256 of issued tokens
}

/**
 * A single account, Postgres-style: PULSE_USER / PULSE_PASSWORD from the
 * environment. Without a password auth is disabled. Sessions live in /data and
 * survive restarts; changing the password revokes all of them.
 */
export class Auth {
  readonly enabled: boolean
  private readonly user: string
  private readonly password: string
  private readonly file: string
  private tokens = new Set<string>()

  constructor(dataDir: string) {
    this.user = process.env.PULSE_USER ?? 'pulse'
    this.password = process.env.PULSE_PASSWORD ?? ''
    this.enabled = this.password !== ''
    this.file = path.join(dataDir, 'sessions.json')
    if (!this.enabled) return
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SessionsFile
      if (stored.passwordHash === sha256(this.password)) this.tokens = new Set(stored.tokens)
    } catch {
      /* missing or corrupted file: start with no sessions */
    }
    this.persist()
  }

  login(user: string, password: string): string | null {
    if (user !== this.user || password !== this.password) return null
    const token = randomBytes(32).toString('hex')
    this.tokens.add(sha256(token))
    this.persist()
    return token
  }

  /** Ends one session; the other browsers of the same user keep theirs. */
  logout(token: string | undefined): void {
    if (!token) return
    this.tokens.delete(sha256(token))
    this.persist()
  }

  verify(token: string | undefined): boolean {
    return token !== undefined && this.tokens.has(sha256(token))
  }

  private persist(): void {
    const data: SessionsFile = { passwordHash: sha256(this.password), tokens: [...this.tokens] }
    fs.writeFileSync(this.file, JSON.stringify(data))
  }
}
