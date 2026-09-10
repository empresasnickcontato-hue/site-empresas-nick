import { createContext, useContext, useState, useEffect } from 'react'
import { apiFetch, clearToken } from '../services/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // unauthorized=true SOMENTE com 401 (sessão inválida).
  // Erro de rede NÃO limpa o usuário nem manda para /login (evita tela branca).
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    async function checkMe() {
      try {
        const res = await apiFetch('/api/me?t=' + Date.now(), { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setUser(data.user)
          setUnauthorized(false)
        } else if (res.status === 401) {
          setUser(null)
          setUnauthorized(true)
        }
        // outro status (500, etc.) ou erro de rede: mantém estado atual
      } catch {
        // rede fora: NÃO limpa usuário, NÃO marca unauthorized
      } finally {
        setLoading(false)
      }
    }
    checkMe()
    // Revalida sessão ao voltar na aba sem limpar estado (sem cache)
    const onFocus = () => checkMe()
    const onVis = () => { if (!document.hidden) checkMe() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  function setAuth({ user }) {
    setUser(user)
    setUnauthorized(false)
  }

  function logout() {
    setUser(null)
    setUnauthorized(true)
    try { clearToken() } catch {}
  }

  return (
    <AuthContext.Provider value={{ user, loading, unauthorized, setUser, setAuth, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
