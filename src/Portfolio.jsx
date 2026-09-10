// Página Portfólio — Sites Criados (rota /portfolio).
// Lista pública de GET /api/portfolio. JS puro, sem lib nova.

import { useEffect, useState } from 'react'
import { apiFetch, BASE_URL } from './services/api.js'

const WHATSAPP_CTA = 'https://wa.me/5511916572015'

function Portfolio() {
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [selecionado, setSelecionado] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch('/api/portfolio?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) {
          setItens([])
          setErro('Não foi possível carregar o portfólio.')
          return
        }
        const data = await res.json()
        setItens(Array.isArray(data) ? data : [])
      } catch {
        setItens([])
        setErro('Erro de conexão com o servidor.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setSelecionado(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="main">
      <section className="hero container">
        <div className="hero-text">
          <span className="badge">Portfólio</span>
          <h2 className="hero-title">Conheça nossos trabalhos - {itens.length} site{itens.length === 1 ? '' : 's'} criado{itens.length === 1 ? '' : 's'}</h2>
          <p className="hero-subtitle">Uma seleção dos sites que a Empresas Nick já entregou para clientes.</p>
        </div>

        {loading && <p style={{ textAlign: 'center', color: 'var(--cinza-500)' }}>Carregando portfólio...</p>}
        {erro && <p className="erro" style={{ textAlign: 'center' }}>{erro}</p>}

        {!loading && !erro && itens.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--cinza-500)' }}>Nenhum trabalho publicado ainda. Volte em breve!</p>
        )}

        <div className="portfolio-grid">
          {(Array.isArray(itens) ? itens : []).map((item) => (
            <div key={item.id} className="portfolio-card" onClick={() => setSelecionado(item)}>
              {item.tipo === 'video' ? (
                <video className="portfolio-midia" src={`${BASE_URL}${item.url_arquivo}`} preload="metadata" playsInline />
              ) : (
                <img className="portfolio-midia portfolio-zoom" src={`${BASE_URL}${item.url_arquivo}`} alt={item.titulo} loading="lazy" />
              )}
              <div className="portfolio-info">
                <strong>{item.titulo}</strong>
                {item.cliente_nome && <span>{item.cliente_nome}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {selecionado && (
        <div className="portfolio-modal-overlay" onClick={() => setSelecionado(null)}>
          <div className="portfolio-modal" onClick={(e) => e.stopPropagation()}>
            <button className="portfolio-modal-fechar" onClick={() => setSelecionado(null)} aria-label="Fechar">✕</button>
            {selecionado.tipo === 'video' ? (
              <video className="portfolio-modal-midia" src={`${BASE_URL}${selecionado.url_arquivo}`} controls autoPlay playsInline />
            ) : (
              <img className="portfolio-modal-midia" src={`${BASE_URL}${selecionado.url_arquivo}`} alt={selecionado.titulo} />
            )}
            <h3>{selecionado.titulo}</h3>
            {selecionado.cliente_nome && <p className="muted">Cliente: {selecionado.cliente_nome}</p>}
            {selecionado.descricao && <p>{selecionado.descricao}</p>}
            {selecionado.link_site && (
              <p><a href={selecionado.link_site} target="_blank" rel="noopener noreferrer">Visitar site →</a></p>
            )}
            <a
              className="btn btn-primary btn-large"
              href={WHATSAPP_CTA}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginTop: '12px', textDecoration: 'none' }}
            >
              Quero um site igual
            </a>
          </div>
        </div>
      )}
    </main>
  )
}

export default Portfolio
