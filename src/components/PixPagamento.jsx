import { useEffect, useState } from 'react'
import { apiFetch } from '../services/api.js'

// Exibe QR Code Pix + copia e cola (GET /api/pix/:projetoId).
// JS puro, sem TypeScript, sem storage no navegador.
function PixPagamento({ projetoId }) {
  const [pix, setPix] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)

  // Atualização SILENCIOSA: só troca o Pix se valor/código mudou
  // (mesma referência = sem re-render, sem pulo de scroll). Sem setInterval.
  function aplicarPixSilencioso(data) {
    setPix((atual) => {
      if (atual && atual.valor === data.valor && atual.copiaECola === data.copiaECola && atual.qrBase64 === data.qrBase64) return atual
      return data
    })
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch(`/api/pix/${projetoId}?t=` + Date.now(), { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok) setErro(data.erro || 'Erro ao gerar Pix')
        else aplicarPixSilencioso(data)
      } catch {
        setErro('Erro de conexão')
      } finally {
        setLoading(false)
      }
    }
    async function recarregarPixSilencioso() {
      try {
        const res = await apiFetch(`/api/pix/${projetoId}?t=` + Date.now(), { cache: 'no-store' })
        if (!res.ok) return
        aplicarPixSilencioso(await res.json())
      } catch {
        // silencioso: mantém QR exibido
      }
    }
    if (projetoId) {
      load()
      const onFocus = () => recarregarPixSilencioso()
      const onVis = () => { if (!document.hidden) recarregarPixSilencioso() }
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVis)
      return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
    }
  }, [projetoId])

  function copiar() {
    if (!pix || !pix.copiaECola) return
    const texto = pix.copiaECola
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(() => {
        setCopiado(true)
        setTimeout(() => setCopiado(false), 2000)
      }).catch(() => {})
    } else {
      const ta = document.createElement('textarea')
      ta.value = texto
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    }
  }

  if (loading) return <p style={{ color: 'var(--cinza-500)', fontSize: '.9rem' }}>Gerando QR Code Pix...</p>
  if (erro) return <p className="erro">{erro}</p>
  if (!pix) return null

  return (
    <div style={{ background: '#fff', border: '1px solid var(--cinza-200)', borderRadius: '12px', padding: '18px', marginTop: '14px', textAlign: 'center', overflowAnchor: 'none' }}>
      <p style={{ fontWeight: 800, color: 'var(--cinza-900)', fontSize: '1rem' }}>Escaneie o QR Code Pix</p>
      <p style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--ciano-hover)', marginTop: '4px' }}>R${pix.valor}</p>
      {pix.qrBase64 && <img src={pix.qrBase64} alt="QR Code Pix" style={{ width: '100%', maxWidth: '320px', height: 'auto', aspectRatio: '1 / 1', margin: '12px auto', display: 'block' }} />}
      <p style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--cinza-500)', marginTop: '8px' }}>Ou use o código copia e cola:</p>
      <div style={{ background: 'var(--cinza-50)', border: '1px solid var(--cinza-200)', borderRadius: '8px', padding: '10px', marginTop: '6px', fontSize: '.72rem', color: 'var(--cinza-700)', wordBreak: 'break-all', maxHeight: '80px', overflowY: 'auto', textAlign: 'left' }}>
        {pix.copiaECola}
      </div>
      <button onClick={copiar} className="btn btn-primary" style={{ marginTop: '12px', borderRadius: '999px', padding: '10px 26px', fontWeight: 700 }}>
        {copiado ? 'Copiado!' : 'Copiar'}
      </button>
      <p style={{ marginTop: '10px', fontSize: '.78rem', color: 'var(--cinza-500)' }}>Após pagar, avise no suporte — o admin confirma e seu site entra na fila.</p>
    </div>
  )
}

export default PixPagamento
