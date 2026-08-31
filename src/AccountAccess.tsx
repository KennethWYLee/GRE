import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  Clock3,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sprout,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
  X,
} from 'lucide-react'

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'revoked'

export type ApprovedSession = {
  authenticated: true
  email: string
  fullName: string
  status: 'approved'
  isAdmin: boolean
  role: 'admin' | 'member'
}

type AccessSession = {
  authenticated: boolean
  email?: string
  fullName?: string
  status?: AccountStatus
  isAdmin?: boolean
  role?: 'admin' | 'member'
  requestedAt?: string | null
  reviewedAt?: string | null
}

type AccountRecord = {
  email: string
  full_name: string | null
  status: AccountStatus
  role: 'admin' | 'member'
  requested_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  last_seen_at: string | null
}

type AccountAccessProps = {
  children: (context: { session: ApprovedSession; openAdmin: () => void }) => ReactNode
}

const SIGN_IN_PATH = '/signin-with-chatgpt?return_to=/'
const SIGN_OUT_PATH = '/signout-with-chatgpt?return_to=/'

export function AccountAccess({ children }: AccountAccessProps) {
  const [session, setSession] = useState<AccessSession | null>(null)
  const [error, setError] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)

  const loadSession = useCallback(async () => {
    setError('')
    try {
      const response = await fetch('/api/session', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSession(await response.json() as AccessSession)
    } catch {
      setError('帳號服務暫時無法連線，請稍後再試。')
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadSession(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadSession])

  if (error) {
    return (
      <AccessScreen icon={<X size={24} />} kicker="ACCOUNT SERVICE" title="暫時無法確認帳號">
        <p>{error}</p>
        <button className="access-primary" onClick={() => void loadSession()} type="button">
          <RefreshCw size={17} /> 重新連線
        </button>
      </AccessScreen>
    )
  }

  if (!session) {
    return <main className="status-screen"><Sprout className="loading-mark" size={22} /> 正在確認帳號…</main>
  }

  if (!session.authenticated) {
    return (
      <AccessScreen icon={<ShieldCheck size={24} />} kicker="GRE ROOTS · PRIVATE STUDY" title="登入後開始背單字">
        <p>使用 ChatGPT 帳號登入。第一次登入會自動送出申請，通過管理員審核後才能讀取 GRE 單字內容。</p>
        <a className="access-primary" href={SIGN_IN_PATH} target="_top">
          <LogIn size={17} /> 使用 ChatGPT 登入
        </a>
        <small>本站會接收你的 ChatGPT 顯示名稱與電子郵件，只用於帳號審核與存取控制。</small>
      </AccessScreen>
    )
  }

  if (session.status !== 'approved') {
    const rejected = session.status === 'rejected' || session.status === 'revoked'
    return (
      <AccessScreen
        icon={rejected ? <UserRoundX size={24} /> : <Clock3 size={24} />}
        kicker={rejected ? 'ACCESS NOT APPROVED' : 'APPLICATION RECEIVED'}
        title={rejected ? '這個帳號目前不能使用' : '申請已送出，等待審核'}
      >
        <p>{rejected ? '管理員尚未核准或已撤銷此帳號。' : '管理員核准後，按下重新確認就能開始使用。'}</p>
        <div className="access-email">{session.email}</div>
        <button className="access-primary" onClick={() => void loadSession()} type="button">
          <RefreshCw size={17} /> 重新確認
        </button>
        <a className="access-secondary" href={SIGN_OUT_PATH} target="_top"><LogOut size={15} /> 改用其他帳號</a>
      </AccessScreen>
    )
  }

  const approvedSession = session as ApprovedSession
  if (adminOpen && approvedSession.isAdmin) {
    return <AdminPanel currentSession={approvedSession} onClose={() => setAdminOpen(false)} />
  }

  return children({ session: approvedSession, openAdmin: () => setAdminOpen(true) })
}

function AccessScreen({
  children,
  icon,
  kicker,
  title,
}: {
  children: ReactNode
  icon: ReactNode
  kicker: string
  title: string
}) {
  return (
    <main className="access-shell">
      <section className="access-card">
        <div className="access-brand"><span><Sprout size={17} /></span> GRE ROOTS</div>
        <div className="access-icon">{icon}</div>
        <p className="access-kicker">{kicker}</p>
        <h1>{title}</h1>
        <div className="access-content">{children}</div>
      </section>
    </main>
  )
}

function AdminPanel({ currentSession, onClose }: { currentSession: ApprovedSession; onClose: () => void }) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyEmail, setBusyEmail] = useState('')

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/accounts', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { accounts: AccountRecord[] }
      setAccounts(payload.accounts)
    } catch {
      setError('無法載入帳號名單，請重新整理。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadAccounts(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadAccounts])

  const changeStatus = async (email: string, status: Exclude<AccountStatus, 'pending'>) => {
    setBusyEmail(email)
    setError('')
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await loadAccounts()
    } catch {
      setError(`無法更新 ${email}，請再試一次。`)
    } finally {
      setBusyEmail('')
    }
  }

  const pendingCount = accounts.filter((account) => account.status === 'pending').length
  const approvedCount = accounts.filter((account) => account.status === 'approved').length

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <button aria-label="回到 GRE App" className="admin-back" onClick={onClose} type="button"><ArrowLeft size={19} /></button>
        <div><span>ACCOUNT REVIEW</span><h1>帳號審核</h1></div>
        <a aria-label="登出" className="admin-signout" href={SIGN_OUT_PATH} target="_top"><LogOut size={17} /></a>
      </header>

      <section className="admin-summary" aria-label="帳號審核統計">
        <div><span>等待審核</span><strong>{pendingCount}</strong></div>
        <div><span>已核准</span><strong>{approvedCount}</strong></div>
        <div><span>目前管理員</span><strong>{accounts.filter((account) => account.role === 'admin').length}</strong></div>
      </section>

      <div className="admin-toolbar">
        <p><ShieldCheck size={15} /> 管理員：{currentSession.email}</p>
        <button disabled={loading} onClick={() => void loadAccounts()} type="button"><RefreshCw size={15} /> 重新整理</button>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}

      {loading ? (
        <div className="admin-loading"><RefreshCw className="pronounce-spinner" size={20} /> 載入帳號名單…</div>
      ) : (
        <section className="account-list" aria-label="帳號名單">
          {accounts.map((account) => (
            <article className="account-row" key={account.email}>
              <div className="account-identity">
                <span className={`account-status status-${account.status}`}>{statusLabel(account)}</span>
                <strong>{account.full_name || account.email}</strong>
                <small>{account.email}</small>
                <time>{account.role === 'admin' ? '系統管理員' : `申請：${formatDate(account.requested_at)}`}</time>
              </div>
              <div className="account-actions">
                {account.role === 'admin' ? (
                  <span className="protected-admin"><ShieldCheck size={15} /> 固定管理員</span>
                ) : (
                  <>
                    {account.status !== 'approved' && (
                      <button
                        className="approve-account"
                        disabled={busyEmail === account.email}
                        onClick={() => void changeStatus(account.email, 'approved')}
                        type="button"
                      ><UserRoundCheck size={16} /> 核准</button>
                    )}
                    {account.status === 'pending' && (
                      <button
                        className="reject-account"
                        disabled={busyEmail === account.email}
                        onClick={() => void changeStatus(account.email, 'rejected')}
                        type="button"
                      ><UserRoundX size={16} /> 拒絕</button>
                    )}
                    {account.status === 'approved' && (
                      <button
                        className="revoke-account"
                        disabled={busyEmail === account.email}
                        onClick={() => void changeStatus(account.email, 'revoked')}
                        type="button"
                      ><X size={16} /> 撤銷</button>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
          {!accounts.length && <div className="admin-loading"><UsersRound size={20} /> 尚無帳號申請</div>}
        </section>
      )}

      <footer className="admin-footer"><Check size={14} /> 所有核准與撤銷都由伺服器即時執行</footer>
    </main>
  )
}

function statusLabel(account: AccountRecord) {
  if (account.role === 'admin') return '管理員'
  if (account.status === 'approved') return '已核准'
  if (account.status === 'rejected') return '已拒絕'
  if (account.status === 'revoked') return '已撤銷'
  return '待審核'
}

function formatDate(value: string) {
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(date)
}
