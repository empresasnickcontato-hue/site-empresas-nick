import { useEffect, useState } from 'react'
import { api } from '../../services/api.js'

// Aba Pagamentos (admin) — conectada em tempo real com ConfigPixPayment.
// - loadAll: GET /api/pix-config + GET /api/admin/planos em paralelo
// - Ouve 'pix-config-updated' / 'planos-updated' (CustomEvent + storage + BroadcastChannel)
// - Select de planos preenche o valor automaticamente; valor manual sobrescreve
// - GERAR QR PIX: POST /api/pix/gerar -> QR + copia e cola na mesma aba, sem F5
function Pagamentos() {
  const [pixConfig, setPixConfig] = useState(null)
  const [planos, setPlanos] = useState([])
  const [planoId, setPlanoId] = useState('')
  const [valorSelecionado, setValorSelecionado] = useState('')
  const [valorManual, setValorManual] = useState('')
  const [qrData, setQrData] = useState('')
  const [qrBase64, setQrBase64] = useState('')
  const [qrValor, setQrValor] = useState(null)
  const [qrStatus, setQrStatus] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [pixRes, planosRes] = await Promise.all([
          api.get('/api/pix-config?t=' + Date.now()),
          api.get('/api/admin/planos?t=' + Date.now()),
        ])
        if (pixRes.ok) setPixConfig(await pixRes.json())
        if (planosRes.ok) setPlanos(await planosRes.json())
      } catch {} finally {
        setLoading(false)
      }
    }
    const onPixCfg = (e) => {
      if (e && e.detail) setPixConfig(e.detail)
      else loadAll()
    }
    const onPlanos = () => loadAll()
    const onStorage = (e) => {
      if (e.key === 'pix-config-updated-at' || e.key === 'planos-updated-at') loadAll()
    }
    loadAll()
    window.addEventListener('pix-config-updated', onPixCfg)
    window.addEventListener('planos-updated', onPlanos)
    window.addEventListener('storage', onStorage)
    let bc = null
    try {
      if ('BroadcastChannel' in window) {
        bc = new BroadcastChannel('pix-admin')
        bc.onmessage = (ev) => {
          const d = (ev && ev.data) || {}
          if (d.type === 'pix-config-updated') {
            if (d.config) setPixConfig(d.config)
            else loadAll()
          } else if (d.type === 'planos-updated') {
            loadAll()
          }
        }
      }
    } catch {}
    return () => {
      window.removeEventListener('pix-config-updated', onPixCfg)
      window.removeEventListener('planos-updated', onPlanos)
      window.removeEventListener('storage', onStorage)
      try { if (bc) bc.close() } catch {}
    }
  }, [])

  function escolherPlano(id) {
    setPlanoId(id)
    const p = planos.find((x) => String(x.id) === String(id))
    if (p) setValorSelecionado(p.preco)
    else setValorSelecionado('')
  }

  async function gerarQr() {
    setMsg('Gerando...')
    setQrData('')
    setQrBase64('')
    setQrValor(null)
    setQrStatus('')
    const manual = String(valorManual || '').trim()
    const body = manual ? { valorManual: manual } : (planoId ? { planoId } : null)
    if (!body) {
      setMsg('Selecione um plano ou digite o valor manual.')
      return
    }
    try {
      const res = await api.post('/api/pix/gerar', body)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data.erro || 'Erro ao gerar QR')
        return
      }
      setQrData(data.copiaECola)
      setQrBase64(data.qrCodeBase64 || data.qrBase64)
      setQrValor(data.valor)
      setQrStatus(data.status || 'pendente')
      setMsg('QR gerado com sucesso!')
    } catch {
      setMsg('Erro de conexão')
    }
  }

  if (loading) return <p>Carregando pagamentos...</p>

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
        <h3>Pix atual (tempo real do backend)</h3>
        {pixConfig ? (
          <p style={{ fontSize: '.9rem' }}>
            Chave: <strong>{pixConfig.chavePix}</strong> | Start: <strong>R$ {pixConfig.valorStart}</strong> | Pro: <strong>R$ {pixConfig.valorPro}</strong> | Premium: <strong>R$ {pixConfig.valorPremium}</strong>
          </p>
        ) : (
          <p>Pix não configurado.</p>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
        <h3>Gerar QR Pix</h3>
        <label>Plano
          <select value={planoId} onChange={(e) => escolherPlano(e.target.value)} style={{ width: '100%' }}>
            <option value="">— Selecione um plano —</option>
            {planos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome} — R$ {p.preco}</option>
            ))}
          </select>
        </label>
        {valorSelecionado !== '' && <p style={{ fontSize: '.85rem' }}>Valor do plano: <strong>R$ {valorSelecionado}</strong></p>}
        <label>Valor manual (sobrescreve o plano se digitado)
          <input value={valorManual} onChange={(e) => setValorManual(e.target.value)} inputMode="decimal" placeholder="ex: 800" style={{ width: '100%' }} />
        </label>
        <button onClick={gerarQr} className="btn btn-primary" style={{ marginTop: '12px' }}>GERAR QR PIX</button>
        {msg && <p style={{ fontSize: '.85rem', marginTop: '8px' }}>{msg}</p>}
        {qrBase64 && (
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <img src={qrBase64} alt="QR Code Pix" style={{ width: '220px', height: '220px' }} />
            <p style={{ fontWeight: 800 }}>R$ {qrValor} • Status: {qrStatus}</p>
            <div style={{ fontSize: '.72rem', wordBreak: 'break-all', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', textAlign: 'left' }}>{qrData}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Pagamentos
