import { useEffect, useState } from 'react'
import { apiFetch } from './services/api.js'
import PixPagamento from './components/PixPagamento.jsx'
import { normalizarStatus } from './utils/projetoStatus.js'
import { limparDescricao, valorDoProjeto } from './utils/limparDescricao.js'

function Pagamento({ projetoId, onVoltar }) {
  const [projeto, setProjeto] = useState(null)
  // Preço ao vivo SEM re-render do projeto: evita a tela pular (anti-jump).
  const [precoLive, setPrecoLive] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const res = await apiFetch(`/api/projetos/${projetoId}?t=` + Date.now(), { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setProjeto(data)
        const v = valorDoProjeto(data)
        if (v !== null) setPrecoLive(v)
      }
    } finally {
      setLoading(false)
    }
  }

  // Atualização SILENCIOSA: só o preço (setPrecoLive), NUNCA setProjeto
  // completo — não treme a tela. Sem setInterval (causava scroll pular).
  async function recarregarPrecoSilencioso() {
    try {
      const res = await apiFetch(`/api/projetos/${projetoId}?t=` + Date.now(), { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const v = valorDoProjeto(data)
      setPrecoLive((atual) => (v !== null && v !== atual ? v : atual))
    } catch {
      // silencioso: mantém valor exibido
    }
  }

  // fetch com ?t=Date.now() e cache:'no-store' SÓ no useEffect inicial [], sem loop.
  useEffect(() => {
    if (projetoId) {
      load()
      const onFocus = () => recarregarPrecoSilencioso()
      const onVis = () => { if (!document.hidden) recarregarPrecoSilencioso() }
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVis)
      return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
    }
  }, [projetoId])

  if (loading) return <div className="container" style={{ padding: '40px', textAlign: 'center', color: 'var(--cinza-500)' }}>Carregando pagamento...</div>
  if (!projeto) return <div className="container" style={{ padding: '40px', textAlign: 'center' }}><p>Projeto não encontrado</p><button className="btn btn-outline" onClick={onVoltar}>Voltar</button></div>

  const st = normalizarStatus(projeto.status)
  const aguardando = st === 'pendente'
  const emFila = st === 'em_andamento' || projeto.pagamentoConfirmado === true
  // Preço dinâmico do backend (data/*.json); ao vivo sem re-render.
  const valorPago = precoLive !== null ? precoLive : valorDoProjeto(projeto)
  const mostraPix = aguardando && !emFila

  return (
    <div className="container" style={{ padding: '28px 0', textAlign: 'center', overflowAnchor: 'none' }}>
      <button onClick={onVoltar} className="voltar-link" style={{ marginBottom: '16px' }}>← Voltar ao dashboard</button>
      <div className="dash-card" style={{ maxWidth: '560px', margin: '0 auto', padding: '28px', overflowAnchor: 'none' }}>
        <div style={{ fontSize: '2.2rem' }}>💠</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--cinza-900)', marginTop: '8px' }}>Pagamento via Pix</h2>
        <p style={{ color: 'var(--cinza-500)', marginTop: '6px' }}>Projeto #{String(projeto.id || '').slice(-6)} — {projeto.status}</p>
        <div style={{ background: 'var(--cinza-50)', border: '1px solid var(--cinza-200)', borderRadius: '12px', padding: '16px', marginTop: '16px', textAlign: 'left' }}>
          <p><strong>Status:</strong> {projeto.status}</p>
          <p style={{ marginTop: '4px' }}><strong>Situação atual:</strong> {emFila ? 'Em andamento' : aguardando ? 'Aguardando pagamento' : projeto.status}</p>
          <p style={{ marginTop: '8px' }}><strong>Descrição:</strong> {limparDescricao(projeto.descricaoSite || projeto.descricao)}</p>
          {!mostraPix && <p style={{ marginTop: '8px', fontSize: '1.15rem' }}><strong>{aguardando ? 'Valor a pagar: ' : 'Valor pago: '}</strong><span style={{ color: 'var(--ciano-hover)', fontWeight: 800 }}>{valorPago !== null ? `R$${valorPago}` : '— aguardando escolha de plano'}</span></p>}
          {(projeto.linkFinal || projeto.link_final) && <p style={{ marginTop: '6px' }}><strong>Link:</strong> <a href={projeto.linkFinal || projeto.link_final} target="_blank" rel="noreferrer" style={{ color: 'var(--ciano-hover)' }}>{projeto.linkFinal || projeto.link_final}</a></p>}
        </div>
        {mostraPix && <PixPagamento projetoId={projeto.id} />}
        {emFila && st !== 'concluido' && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '12px', padding: '18px', marginTop: '14px' }}>
            <p style={{ fontWeight: 800, color: '#059669', fontSize: '1.05rem' }}>Pagamento Concluído! Entrou na fila ✅</p>
            <p style={{ fontSize: '.85rem', color: '#047857', marginTop: '6px' }}>Nossa equipe já vai iniciar o desenvolvimento do seu site.</p>
          </div>
        )}
        {st === 'concluido' && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '12px', padding: '18px', marginTop: '14px' }}>
            <p style={{ fontWeight: 800, color: '#059669', fontSize: '1.05rem' }}>Site entregue! 🎉</p>
            <p style={{ fontSize: '.85rem', color: '#047857', marginTop: '6px' }}>Veja em "Seus Sites Online" no dashboard.</p>
          </div>
        )}
        <button className="btn btn-primary" style={{ marginTop: '16px', borderRadius: '999px', padding: '12px 28px' }} onClick={onVoltar}>Voltar ao dashboard</button>
      </div>
    </div>
  )
}

export default Pagamento
