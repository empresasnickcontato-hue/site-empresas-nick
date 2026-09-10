import { useEffect, useState } from 'react'
import { limparDescricao } from './utils/limparDescricao.js'
import { api, apiFetch } from './services/api.js'
import { carregarPlanos } from './config/planos.js'

function Checkout({ projetoId, onEscolhido, onVoltar }) {
  const [projeto, setProjeto] = useState(null)
  // Planos começam VAZIOS: nenhum preço antigo/hardcodado aparece na tela.
  // Valores 100% dinâmicos do backend (GET /api/planos -> data/planos.json).
  const [planos, setPlanos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [erroPrecos, setErroPrecos] = useState('')
  const [enviando, setEnviando] = useState(null)
  const [tentar, setTentar] = useState(0)

  useEffect(() => {
    let ativo = true
    // Preços SEMPRE dinâmicos do backend (data/*.json), sem cache:
    // query ?t=Date.now() + cache:'no-store' impede exibir valor antigo após o admin alterar.
    // Fonte: config/planos.js -> GET /api/planos (CRUD do ConfigPixPayment). Fallback: /api/pix-config.
    async function fetchPrecos() {
      try {
        const lista = await carregarPlanos()
        if (!ativo) return
        setPlanos(lista)
        setErroPrecos('')
      } catch {
        // sem fallback fixo: não exibe preço antigo; mostra erro + retry
        if (ativo && planos.length === 0) setErroPrecos('Não foi possível carregar os valores. Tente de novo.')
      }
    }
    async function load() {
      try {
        const res = await apiFetch(`/api/projetos/${projetoId}?t=` + Date.now(), { cache: 'no-store' })
        const data = await res.json()
        if (!ativo) return
        if (!res.ok) setErro(data.erro || 'Projeto não encontrado')
        else setProjeto(data)
      } catch {
        if (ativo) setErro('Erro de conexão')
      } finally {
        if (ativo) setLoading(false)
      }
      // Valores dinâmicos de /api/pix-config (admin define, QR usa o mesmo valor)
      await fetchPrecos()
    }
    if (projetoId) {
      load()
      // Atualização SILENCIOSA sem setInterval (intervalo fazia a tela pular):
      // só revalida preços ao voltar na aba / focar a janela.
      const onFocus = () => fetchPrecos()
      const onVis = () => { if (!document.hidden) fetchPrecos() }
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVis)
      return () => { ativo = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
    }
  }, [projetoId, tentar])

  async function escolher(valor) {
    setEnviando(valor)
    setErro('')
    try {
      const res = await api.put(`/api/projetos/${projetoId}`, { valor })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.erro || 'Erro ao escolher plano')
        return
      }
      if (onEscolhido) onEscolhido(projetoId, valor)
      else window.location.href = `/pagamento?projetoId=${projetoId}`
    } catch {
      setErro('Erro de conexão')
    } finally {
      setEnviando(null)
    }
  }

  if (loading) return <div className="container" style={{ padding: '40px', textAlign: 'center', color: 'var(--cinza-500)' }}>Carregando checkout...</div>
  if (erro) return <div className="container" style={{ padding: '40px', textAlign: 'center' }}><p className="erro">{erro}</p><button className="btn btn-outline" onClick={onVoltar} style={{marginTop:'12px'}}>Voltar</button></div>
  if (!projeto) return null

  return (
    <div className="container" style={{ padding: '28px 0', overflowAnchor: 'none' }}>
      <button onClick={onVoltar} className="voltar-link" style={{ marginBottom: '16px' }}>← Voltar</button>
      <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--cinza-900)', textAlign: 'center' }}>Escolha seu plano</h2>
      <p style={{ textAlign: 'center', color: 'var(--cinza-500)', marginTop: '6px', fontSize: '.92rem' }}>
        Projeto #{String(projeto.id || '').slice(-6)} — <em>{String(limparDescricao(projeto.descricaoSite || projeto.descricao) || '').slice(0, 80)}...</em>
      </p>
      <p style={{ textAlign: 'center', marginTop: '10px' }}>
        <span style={{ display: 'inline-block', background: '#dcfce7', color: '#059669', fontWeight: 800, fontSize: '.8rem', padding: '6px 14px', borderRadius: '999px' }}>Pagamento via Pix</span>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: '16px', marginTop: '22px' }}>
        {planos.length === 0 ? (
          <div className="dash-card" style={{ textAlign: 'center', padding: '28px' }}>
            <p style={{ color: 'var(--cinza-500)' }}>{erroPrecos || 'Carregando valores...'}</p>
            {erroPrecos && (
              <button onClick={() => setTentar((t) => t + 1)} className="btn btn-primary" style={{ marginTop: '12px', borderRadius: '999px', padding: '10px 26px' }}>
                Tentar de novo
              </button>
            )}
          </div>
        ) : planos.map((p) => (
          <div key={p.id} className="dash-card" style={{ textAlign: 'center', border: p.destaque ? '2px solid var(--ciano)' : '1px solid var(--cinza-200)', position: 'relative', paddingTop: '22px' }}>
            {p.destaque && <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: 'var(--ciano)', color: '#fff', fontSize: '.7rem', fontWeight: 800, padding: '3px 10px', borderRadius: '999px' }}>MAIS POPULAR</span>}
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--cinza-900)' }}>{p.nome}</h3>
            <p style={{ color: 'var(--ciano-hover)', fontWeight: 700, fontSize: '.85rem', marginTop: '4px' }}>{p.desc}</p>
            <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--cinza-900)', margin: '10px 0' }}>{p.valor !== null ? `R$${p.valor}` : '...'}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 16px', fontSize: '.85rem', color: 'var(--cinza-500)', lineHeight: 1.6 }}>
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <button onClick={() => escolher(p.valor)} disabled={!!enviando || p.valor === null} className="btn btn-primary" style={{ width: '100%', borderRadius: '999px', padding: '10px' }}>
              {enviando === p.valor ? 'Processando...' : 'Pagar com Pix'}
            </button>
          </div>
        ))}
      </div>
      <p style={{ marginTop: '16px', textAlign: 'center', fontSize: '.85rem', color: 'var(--cinza-500)' }}>Ao escolher, geramos seu QR Code Pix + código copia e cola na próxima tela.</p>
      {erro && <p className="erro" style={{ marginTop: '16px', textAlign: 'center' }}>{erro}</p>}
    </div>
  )
}

export default Checkout
