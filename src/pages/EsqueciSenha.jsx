import { useState } from 'react'
import { api, BASE_URL } from '../services/api.js'
import '../Login.css'

function EsqueciSenha({ onVoltarLogin }) {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) {
      setErro('Informe seu e-mail.')
      return
    }
    setLoading(true)
    setErro('')
    setMsg('')
    try {
      const url = BASE_URL + '/api/forgot-password'
      console.log('[forgot] chamando URL:', url)
      const res = await api.post('/api/forgot-password', { email: email.trim() }, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      console.log('[forgot] resposta do back:', res.status, data)
      if (!res.ok) {
        setErro(data.erro || 'Erro ao enviar. Tente de novo.')
        return
      }
      setMsg(data.message || 'Se o email existir, enviamos o link para seu email')
    } catch (e) {
      console.log('[forgot] erro de rede:', e)
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
          <p>Recuperar senha</p>
          <span className="linha-ciano"></span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="email-rec">E-mail</label>
            <input
              id="email-rec"
              name="email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {erro && <p className="erro">{erro}</p>}
          {msg && <p style={{ color: '#059669', fontSize: '.9rem' }}>{msg}</p>}

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Enviando...' : 'Enviar link'}
          </button>

          <p className="link-cadastro" style={{ marginTop: '14px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); if (onVoltarLogin) onVoltarLogin() }}>
              ← Voltar ao login
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}

export default EsqueciSenha
