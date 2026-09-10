import { useState } from 'react'
import { useAuth } from './context/AuthContext.jsx'
import { api, persistToken } from './services/api.js'
import './Cadastros.css'

function isSenhaFraca(senha) {
  const norm = senha.toLowerCase().trim()
  const comuns = [
    '1234',
    '12345',
    '123456',
    '12345678',
    '123456789',
    '0000',
    '111111',
    '123123',
    'password',
    'password123',
    'qwerty',
    'abc123',
    'abcd1234',
    'admin',
    'letmein',
    'senha',
    'senha123',
    'senha1234',
    '654321',
    '987654321',
    '1234qwer',
  ]
  if (comuns.includes(norm)) return true
  if (senha.length < 8) return true
  if (/^\d+$/.test(senha)) return true
  if (/^(.)\1+$/.test(senha)) return true
  const seq = '0123456789abcdefghijklmnopqrstuvwxyz'
  const rev = seq.split('').reverse().join('')
  if (seq.includes(norm) || rev.includes(norm)) return true
  const temLetra = /[a-zA-Z]/.test(senha)
  const temNumero = /\d/.test(senha)
  if (!temLetra || !temNumero) return true
  return false
}

function Cadastro({ onVoltar, onIrLogin, onCadastrado }) {
  const { setUser } = useAuth()
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    confirmar: '',
  })
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.nome || !form.email || !form.senha || !form.confirmar) {
      setErro('Preencha todos os campos obrigatórios.')
      return
    }
    if (form.senha !== form.confirmar) {
      setErro('As senhas não coincidem.')
      return
    }
    if (form.senha.length < 8) {
      setErro('Senha fraca: use no mínimo 8 caracteres.')
      return
    }
    if (isSenhaFraca(form.senha)) {
      setErro('Senha muito fraca. Não use sequências como 1234 ou senha1234. Use letras + números (ex: Nick@2024!).')
      return
    }
    setLoading(true)
    setErro('')
    try {
      const res = await api.post('/cadastro', { nome: form.nome.trim(), email: form.email.trim(), senha: form.senha })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.erro || 'Erro ao cadastrar.')
        return
      }
      setUser(data.user)
      // Persiste JWT nas chaves 'token', 'adminToken', 'authToken' e 'en_token'
      // (padrão Authorization: Bearer das abas admin/Portfolio/Bot — sem divergência)
      try { if (data.token) persistToken(data.token) } catch {}
      if (onCadastrado) onCadastrado(data)
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cadastro-page">
      <div className="cadastro-card">
        <div className="cadastro-header">
          {onVoltar && (
            <button type="button" className="voltar-link" onClick={onVoltar}>
              ← Voltar ao início
            </button>
          )}
          <h1>Empresas Nick</h1>
          <p>Crie sua conta</p>
          <span className="linha-ciano"></span>
        </div>

        <form onSubmit={handleSubmit} className="cadastro-form">
          <div className="field">
            <label htmlFor="nome">Nome completo *</label>
            <input id="nome" name="nome" type="text" placeholder="Ex: Nick Silva" value={form.nome} onChange={handleChange} />
          </div>

          <div className="field">
            <label htmlFor="email">E-mail *</label>
            <input id="email" name="email" type="email" placeholder="seu@email.com" value={form.email} onChange={handleChange} />
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="senha">Senha *</label>
              <input id="senha" name="senha" type="password" placeholder="mín. 8 chars, letras + números" value={form.senha} onChange={handleChange} />
            </div>

            <div className="field">
              <label htmlFor="confirmar">Confirmar senha *</label>
              <input id="confirmar" name="confirmar" type="password" placeholder="••••••••" value={form.confirmar} onChange={handleChange} />
            </div>
          </div>

          <p style={{ fontSize: '0.78rem', color: 'var(--cinza-500)', lineHeight: 1.4 }}>
            Senha forte: ≥8 caracteres, letras e números. Não aceitamos 1234, senha1234 etc.
          </p>

          <label className="check">
            <input type="checkbox" required />
            <span>Li e aceito os <a href="#">termos de uso</a> e <a href="#">política de privacidade</a></span>
          </label>

          {erro && <p className="erro">{erro}</p>}

          <button type="submit" className="btn-cadastro" disabled={loading}>
            {loading ? 'Cadastrando...' : 'Cadastrar'}
          </button>

          <p className="link-login">
            Já tem uma conta?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); if (onIrLogin) onIrLogin() }}>
              Logar-se
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}

export default Cadastro
