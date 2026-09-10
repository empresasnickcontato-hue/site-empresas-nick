import { useState } from 'react'
import { api, BASE_URL } from '../services/api.js'
import '../Login.css'

function ResetarSenha({ token, onIrLogin }) {
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1>Empresas Nick</h1>
          <p className="erro" style={{ marginTop: '12px' }}>Link inválido</p>
          <p className="link-cadastro" style={{ marginTop: '14px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); if (onIrLogin) onIrLogin() }}>
              Voltar ao login
            </a>
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (novaSenha.length < 6) {
      setErro('Senha deve ter ao menos 6 caracteres.')
      return
    }
    if (novaSenha !== confirmarSenha) {
      setErro('As senhas não conferem.')
      return
    }
    setLoading(true)
    setErro('')
    setMsg('')
    try {
      const url = BASE_URL + '/api/reset-password'
      console.log('[reset] chamando URL:', url)
      const res = await api.post('/api/reset-password', { token, novaSenha }, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      console.log('[reset] resposta do back:', res.status, data)
      if (!res.ok) {
        setErro(data.error || 'Token expirado, solicite novamente')
        return
      }
      setMsg('Senha alterada!')
      setTimeout(() => { if (onIrLogin) onIrLogin() }, 2000)
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>Empresas Nick</h1>
          <p>Definir nova senha</p>
          <span className="linha-ciano"></span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="nova-senha">Nova senha</label>
            <input
              id="nova-senha"
              name="novaSenha"
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="confirmar-senha">Confirmar senha</label>
            <input
              id="confirmar-senha"
              name="confirmarSenha"
              type="password"
              placeholder="Repita a nova senha"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
            />
          </div>

          {erro && <p className="erro">{erro}</p>}
          {msg && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: '#059669', fontWeight: 700 }}>{msg}</p>
              <button type="button" className="btn-login" style={{ marginTop: '12px' }} onClick={() => { if (onIrLogin) onIrLogin() }}>
                Ir para login
              </button>
            </div>
          )}

          {!msg && (
            <button type="submit" className="btn-login" disabled={loading}>
              {loading ? 'Salvando...' : 'Trocar senha'}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

export default ResetarSenha
