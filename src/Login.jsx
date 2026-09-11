import { useState } from 'react'
import { useAuth } from './context/AuthContext.jsx'
import { api, persistToken } from './services/api.js'
import './Login.css'

function Login({ onVoltar, onIrCadastro, onLogado, onEsqueciSenha }) {
  const { setUser } = useAuth()
  const [form, setForm] = useState({ email: '', senha: '' })
  const [erro, setErro] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.email || !form.senha) {
      setErro('Preencha e-mail e senha.')
      return
    }
    setLoading(true)
    setErro('')
    try {
      const res = await api.post('/auth/login', { email: form.email.trim(), senha: form.senha })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.erro || 'E-mail ou senha incorretos.')
        return
      }
      setUser(data.user)
      // Persiste JWT nas chaves 'token', 'adminToken', 'authToken' e 'en_token'
      // (padrão Authorization: Bearer das abas admin/Portfolio/Bot — sem divergência)
      try { if (data.token) persistToken(data.token) } catch {}
      if (onLogado) onLogado(data)
    } catch (err) {
      console.error(err)
      setErro(err?.message || 'Erro de conexão com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          {onVoltar && (
            <button type="button" className="voltar-link" onClick={onVoltar}>
              ← Voltar ao início
            </button>
          )}
          <h1>Empresas Nick</h1>
          <p>Bem-vindo de volta!</p>
          <span className="linha-ciano"></span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" placeholder="seu@email.com" value={form.email} onChange={handleChange} />
          </div>

          <div className="field">
            <label htmlFor="senha">Senha</label>
            <div className="input-senha">
              <input
                id="senha"
                name="senha"
                type={mostrarSenha ? 'text' : 'password'}
                placeholder="••••••••"
                value={form.senha}
                onChange={handleChange}
              />
              <button type="button" className="toggle-senha" onClick={() => setMostrarSenha(!mostrarSenha)} aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                {mostrarSenha ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div className="login-options">
            <label className="remember">
              <input type="checkbox" />
              <span>Lembrar-me</span>
            </label>
            <a href="#" className="forgot" onClick={(e) => { e.preventDefault(); if (onEsqueciSenha) onEsqueciSenha() }}>Esqueceu a senha?</a>
          </div>

          {erro && <p className="erro">{erro}</p>}

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <p style={{ textAlign: 'center', marginTop: '10px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); if (onEsqueciSenha) onEsqueciSenha() }} style={{ color: '#2563eb', fontSize: '14px' }}>
              Esqueceu a senha?
            </a>
          </p>

          <div className="divisor">
            <span>ou</span>
          </div>

          <p className="link-cadastro">
            Não tem conta?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); if (onIrCadastro) onIrCadastro() }}>
              Cadastre-se
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}

export default Login
