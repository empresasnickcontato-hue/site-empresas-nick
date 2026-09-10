import { useState, useEffect } from 'react'
import { useAuth } from './context/AuthContext.jsx'
import Cadastro from './Cadastro.jsx'
import Login from './Login.jsx'
import DashboarClient from './DashboarClient.jsx'
import Checkout from './Checkout.jsx'
import Pagamento from './Pagamento.jsx'
import SupportChat from './components/SupportChat.jsx'
import Portfolio from './Portfolio.jsx'
import EsqueciSenha from './pages/EsqueciSenha.jsx'
import ResetarSenha from './pages/ResetarSenha.jsx'
import { apiFetch } from './services/api.js'

// Painel admin unificado: SOMENTE em http://localhost:3001/admin (backend).
// O frontend (5173) não tem mais rota /admin — link abaixo redireciona.
const ADMIN_URL = 'http://localhost:3001/admin'

function App() {
  const { user, loading, unauthorized, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [page, setPage] = useState('home')
  const [checkoutId, setCheckoutId] = useState(null)
  const [pagamentoId, setPagamentoId] = useState(null)
  const [resetToken, setResetToken] = useState(null)
  const [supportOpen, setSupportOpen] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pid = params.get('projetoId')
    const token = params.get('token')
    if (token && window.location.pathname.includes('resetar-senha')) {
      setResetToken(token)
      setPage('resetar-senha')
    } else if (pid && window.location.pathname.includes('checkout')) {
      setCheckoutId(pid)
      setPage('checkout')
    } else if (pid && window.location.pathname.includes('pagamento')) {
      setPagamentoId(pid)
      setPage('pagamento')
    } else if (window.location.pathname.includes('/portfolio')) {
      setPage('portfolio')
    }
  }, [])

  const tecnologias = [
    { nome: 'HTML', sigla: 'HTML5', desc: 'Estrutura semântica' },
    { nome: 'CSS', sigla: 'CSS3', desc: 'Estilização moderna' },
    { nome: 'JavaScript', sigla: 'JS', desc: 'Interatividade e lógica' },
    { nome: 'React.js', sigla: 'React', desc: 'Biblioteca reativa' },
    { nome: 'Tailwind CSS', sigla: 'TW', desc: 'Framework utilitário' },
    { nome: 'Node.js', sigla: 'Node', desc: 'Runtime backend' },
    { nome: 'Express', sigla: 'EX', desc: 'Framework API' },
  ]

  function navigate(to) {
    // Só manda para /login com 401 confirmado; erro de rede NÃO desloga (sem tela branca)
    if (to === 'dashboard' && !user && !loading && unauthorized) {
      setPage('login')
      setMenuOpen(false)
      return
    }
    setPage(to)
    setMenuOpen(false)
    if (to === 'portfolio') window.history.pushState({}, '', '/portfolio')
    else if (to === 'home') window.history.pushState({}, '', '/')
    window.scrollTo(0, 0)
  }

  function handleAuthSuccess() {
    setPage('dashboard')
    window.scrollTo(0, 0)
  }

  function handleGoCheckout(projetoId) {
    setCheckoutId(projetoId)
    setPage('checkout')
    window.history.pushState({}, '', `/checkout?projetoId=${projetoId}`)
    window.scrollTo(0, 0)
  }

  function handleEscolhido(projetoId) {
    setPagamentoId(projetoId)
    setPage('pagamento')
    window.history.pushState({}, '', `/pagamento?projetoId=${projetoId}`)
    window.scrollTo(0, 0)
  }

  async function handleLogout() {
    try {
      await apiFetch('/logout', { method: 'POST' })
    } finally {
      logout()
      setPage('home')
      setMenuOpen(false)
      window.scrollTo(0, 0)
    }
  }

  if (loading) {
    return (
      <div style={{ background: '#f8fafc', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="animate-pulse">Carregando...</div>
      </div>
    )
  }

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <h1 className="brand" onClick={() => navigate(user ? 'dashboard' : 'home')} style={{ cursor: 'pointer' }}>
            Empresas Nick
          </h1>

          <button className="menu-toggle" aria-label="Abrir menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <span></span>
            <span></span>
            <span></span>
          </button>

          <nav className={`navbar ${menuOpen ? 'open' : ''}`}>
            {!user ? (
              <>
                <a href="#inicio" onClick={(e) => { e.preventDefault(); navigate('home') }} className={page === 'home' ? 'active' : ''}>
                  Início
                </a>
                <a href="#suporte" onClick={(e) => { e.preventDefault(); setSupportOpen(true) }}>
                  Suporte
                </a>
                <a href="#portfolio" onClick={(e) => { e.preventDefault(); navigate('portfolio') }} className={page === 'portfolio' ? 'active' : ''}>
                  Portfólio Sites Criados<span className="portfolio-novo-badge"><span className="ciano-dot"></span> NOVO</span>
                </a>
                <a href="#cadastro" className="btn btn-outline" onClick={(e) => { e.preventDefault(); navigate('cadastro') }}>
                  Cadastro
                </a>
                <a href="#login" className="btn btn-primary" onClick={(e) => { e.preventDefault(); navigate('login') }}>
                  Logar-se
                </a>
              </>
            ) : (
              <>
                <a href="#dashboard" onClick={(e) => { e.preventDefault(); navigate('dashboard') }} className={page === 'dashboard' ? 'active' : ''}>
                  Dashboard
                </a>
                <a href="#portfolio" onClick={(e) => { e.preventDefault(); navigate('portfolio') }} className={page === 'portfolio' ? 'active' : ''}>
                  Portfólio Sites Criados<span className="portfolio-novo-badge"><span className="ciano-dot"></span> NOVO</span>
                </a>
                {user.role === 'admin' && (
                  <a href={ADMIN_URL} onClick={(e) => { e.preventDefault(); window.open(ADMIN_URL, '_blank', 'noopener,noreferrer') }} style={{ fontSize: '.85rem', color: '#0891b2', fontWeight: 700 }}>
                    Painel Admin
                  </a>
                )}
                <span style={{ fontSize: '0.85rem', color: 'var(--cinza-500)', padding: '8px 6px' }}>{(user.nome || user.email || 'Conta').split(' ')[0]}</span>
                <a href="#sair" className="btn btn-outline" onClick={(e) => { e.preventDefault(); handleLogout() }}>
                  Sair
                </a>
              </>
            )}
          </nav>
        </div>
      </header>

      {page === 'home' && (
        <main className="main">
          <section className="hero container" id="inicio">
            <div className="hero-text">
              <span className="badge">Desenvolvimento Web Profissional</span>
              <h2 className="hero-title">Construímos seu site com as seguintes linguagens</h2>
              <p className="hero-subtitle">Da interface ao servidor, usamos as tecnologias mais modernas e requisitadas do mercado para tirar sua ideia do papel.</p>
            </div>

            <div className="tech-grid">
              {tecnologias.map((tech) => (
                <div key={tech.nome} className="tech-card">
                  <span className="tech-sigla">{tech.sigla}</span>
                  <h3>{tech.nome}</h3>
                  <p>{tech.desc}</p>
                </div>
              ))}
            </div>

            <div className="cta-area">
              <a
                href="#cadastro"
                className="btn btn-primary btn-large"
                onClick={(e) => {
                  e.preventDefault()
                  if (user) navigate('dashboard')
                  else navigate('cadastro')
                }}
              >
                Quero meu site agora
              </a>
              <a href="#suporte" className="btn btn-outline btn-large" onClick={(e) => { e.preventDefault(); setSupportOpen(true) }}>
                Falar com suporte
              </a>
            </div>
          </section>

          <section className="info-strip">
            <div className="container info-grid">
              <div>
                <h3>100% Responsivo</h3>
                <p>Seu site perfeito no celular, tablet e desktop.</p>
              </div>
              <div>
                <h3>Performance</h3>
                <p>Carregamento rápido com React + Vite e Node.</p>
              </div>
              <div>
                <h3>Design Moderno</h3>
                <p>Cores azul ciano, branco e cinza com estilo clean.</p>
              </div>
            </div>
          </section>
        </main>
      )}

      {page === 'cadastro' && <Cadastro onVoltar={() => navigate('home')} onIrLogin={() => navigate('login')} onCadastrado={handleAuthSuccess} />}

      {page === 'login' && <Login onVoltar={() => navigate('home')} onIrCadastro={() => navigate('cadastro')} onLogado={handleAuthSuccess} onEsqueciSenha={() => navigate('esqueci-senha')} />}

      {page === 'esqueci-senha' && <EsqueciSenha onVoltarLogin={() => navigate('login')} />}

      {page === 'resetar-senha' && <ResetarSenha token={resetToken || new URLSearchParams(window.location.search).get('token')} onIrLogin={() => navigate('login')} />}

      {page === 'portfolio' && <Portfolio />}

      {page === 'dashboard' && user && <DashboarClient onCheckout={handleGoCheckout} onSupport={() => setSupportOpen(true)} />}

      {page === 'checkout' && user && (
        <Checkout
          projetoId={checkoutId || new URLSearchParams(window.location.search).get('projetoId')}
          onEscolhido={handleEscolhido}
          onVoltar={() => navigate('dashboard')}
        />
      )}

      {page === 'pagamento' && user && (
        <Pagamento
          projetoId={pagamentoId || new URLSearchParams(window.location.search).get('projetoId')}
          onVoltar={() => navigate('dashboard')}
        />
      )}

      {page === 'dashboard' && !user && (
        <div className="container" style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--cinza-500)' }}>Você precisa estar logado para acessar a dashboard.</p>
          <button className="btn btn-primary" onClick={() => navigate('login')} style={{ marginTop: '12px' }}>
            Ir para Login
          </button>
        </div>
      )}

      <footer className="footer">
        <div className="container">
          <p>© {new Date().getFullYear()} Empresas Nick — Todos os direitos reservados.</p>
        </div>
      </footer>
      {supportOpen && <SupportChat onClose={() => setSupportOpen(false)} />}
    </>
  )
}

export default App
