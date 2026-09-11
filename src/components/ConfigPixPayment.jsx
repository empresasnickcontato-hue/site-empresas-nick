import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

// ConfigPixPayment — admin: salva chave/valores Pix + CRUD de planos.
// Tempo real: após salvar, dispara CustomEvent para a aba Pagamentos
// atualizar sem F5 (mesmo padrão do painel /admin via BroadcastChannel/localStorage).
// Token do ADMIN (evita tela preta no login): api.js já injeta sozinho,
// mas aqui vai explícito como garantia nas chamadas deste painel.
function getAdminToken() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('adminToken');
  try {
    return token || localStorage.getItem('en_token') || '';
  } catch { return token || '' }
}
function adminHeaders(extra) {
  const t = getAdminToken();
  return t ? { 'Authorization': `Bearer ${t}`, ...(extra || {}) } : { ...(extra || {}) };
}

function ConfigPixPayment() {
  const [form, setForm] = useState({
    chavePix: '',
    tipoChave: 'Email',
    nomeRecebedor: '',
    cidadeRecebedor: '',
    valorStart: '',
    valorPro: '',
    valorPremium: '',
    modoTeste: false,
  })
  const [plano, setPlano] = useState({ nome: '', preco: '', descricao: '', recursos: '', destaque: false, ativo: true, ordem: '' })
  const [msg, setMsg] = useState('')
  const [msgPlano, setMsgPlano] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get('/api/pix-config?t=' + Date.now(), { headers: adminHeaders() })
        if (!res.ok) return
        const c = await res.json()
        setForm({
          chavePix: c.chavePix || '',
          tipoChave: c.tipoChave || 'Email',
          nomeRecebedor: c.nomeRecebedor || '',
          cidadeRecebedor: c.cidadeRecebedor || '',
          valorStart: c.valorStart ?? '',
          valorPro: c.valorPro ?? '',
          valorPremium: c.valorPremium ?? '',
          modoTeste: !!c.modoTeste,
        })
      } catch {}
    }
    load()
  }, [])

  function broadcast(type, detail) {
    try {
      window.dispatchEvent(new CustomEvent(type, { detail: detail || null }))
      if (type === 'pix-config-updated') {
        localStorage.setItem('pix-config-updated-at', JSON.stringify({ at: Date.now(), config: detail || null }))
      } else if (type === 'planos-updated') {
        localStorage.setItem('planos-updated-at', String(Date.now()))
      }
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel('pix-admin')
        bc.postMessage(type === 'pix-config-updated' ? { type, config: detail || null } : { type })
        bc.close()
      }
    } catch {}
  }

  function setCampo(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function salvar(e) {
    if (e) e.preventDefault()
    setMsg('Salvando...')
    try {
      const res = await api.post('/api/admin/pix-config', form, { headers: adminHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data.erro || 'Erro ao salvar')
        return
      }
      // Confirmação no Turso: POST salvou, GET prova que o site já enxerga.
      // GET /api/pix-config é público e lê do Turso primeiro.
      try {
        const conf = await api.get('/api/pix-config?t=' + Date.now(), { headers: adminHeaders(), cache: 'no-store' })
        if (conf.ok) {
          const salva = await conf.json()
          setForm({
            chavePix: salva.chavePix || '',
            tipoChave: salva.tipoChave || 'Email',
            nomeRecebedor: salva.nomeRecebedor || '',
            cidadeRecebedor: salva.cidadeRecebedor || '',
            valorStart: salva.valorStart ?? '',
            valorPro: salva.valorPro ?? '',
            valorPremium: salva.valorPremium ?? '',
            modoTeste: !!salva.modoTeste,
          })
          setMsg('Configuração salva e confirmada no banco! Site atualizado em tempo real.')
          window.dispatchEvent(new CustomEvent('pix-config-updated', { detail: salva }))
          broadcast('pix-config-updated', salva)
          return
        }
      } catch {}
      setMsg('Configuração salva! Aba Pagamentos atualizada em tempo real.')
      window.dispatchEvent(new CustomEvent('pix-config-updated', { detail: data.config }))
      broadcast('pix-config-updated', data.config)
    } catch {
      setMsg('Erro de conexão')
    }
  }

  async function adicionarPlano(e) {
    if (e) e.preventDefault()
    if (!plano.nome.trim()) {
      setMsgPlano('Informe o nome do plano.')
      return
    }
    setMsgPlano('Salvando...')
    try {
      const res = await api.post('/api/admin/planos', plano, { headers: adminHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsgPlano(data.erro || 'Erro ao salvar plano')
        return
      }
      setMsgPlano('Plano adicionado! Já aparece no select da aba Pagamentos.')
      setPlano({ nome: '', preco: '', descricao: '', recursos: '', destaque: false, ativo: true, ordem: '' })
      window.dispatchEvent(new CustomEvent('planos-updated'))
      broadcast('planos-updated')
    } catch {
      setMsgPlano('Erro de conexão')
    }
  }

  return (
    <div style={{background: _t ? '#0f0' : '#f00', color:'#000', padding:'10px', fontWeight:'bold'}}>{_t ? `TOKEN OK: ${_t.slice(0,20)}...` : 'TOKEN VAZIO - FAÇA LOGOUT E LOGIN' } TOKEN DEBUG</div>
    <>
    <div style={{ display: 'grid', gap: '16px' }}>
      <form onSubmit={salvar} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
        <h3>Configuração Pix</h3>
        <label>Chave Pix<input value={form.chavePix} onChange={(e) => setCampo('chavePix', e.target.value)} placeholder="chave pix" style={{ width: '100%' }} /></label>
        <label>Tipo da chave
          <select value={form.tipoChave} onChange={(e) => setCampo('tipoChave', e.target.value)}>
            <option>CPF</option><option>CNPJ</option><option>Email</option><option>Telefone</option><option>Aleatória</option>
          </select>
        </label>
        <label>Nome do recebedor<input value={form.nomeRecebedor} onChange={(e) => setCampo('nomeRecebedor', e.target.value)} style={{ width: '100%' }} /></label>
        <label>Cidade<input value={form.cidadeRecebedor} onChange={(e) => setCampo('cidadeRecebedor', e.target.value)} style={{ width: '100%' }} /></label>
        <label>Valor Start (R$)<input value={form.valorStart} onChange={(e) => setCampo('valorStart', e.target.value)} inputMode="decimal" style={{ width: '100%' }} /></label>
        <label>Valor Pro (R$)<input value={form.valorPro} onChange={(e) => setCampo('valorPro', e.target.value)} inputMode="decimal" style={{ width: '100%' }} /></label>
        <label>Valor Premium (R$)<input value={form.valorPremium} onChange={(e) => setCampo('valorPremium', e.target.value)} inputMode="decimal" style={{ width: '100%' }} /></label>
        <button type="submit" className="btn btn-primary" style={{ marginTop: '12px' }}>SALVAR CONFIGURAÇÃO</button>
        {msg && <p style={{ fontSize: '.85rem', marginTop: '8px' }}>{msg}</p>}
      </form>

      <form onSubmit={adicionarPlano} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
        <h3>Adicionar plano</h3>
        <label>Nome *<input value={plano.nome} onChange={(e) => setPlano((p) => ({ ...p, nome: e.target.value }))} style={{ width: '100%' }} /></label>
        <label>Preço (R$) *<input value={plano.preco} onChange={(e) => setPlano((p) => ({ ...p, preco: e.target.value }))} inputMode="decimal" style={{ width: '100%' }} /></label>
        <label>Descrição<input value={plano.descricao} onChange={(e) => setPlano((p) => ({ ...p, descricao: e.target.value }))} style={{ width: '100%' }} /></label>
        <button type="submit" className="btn btn-primary" style={{ marginTop: '12px' }}>ADICIONAR PLANO</button>
        {msgPlano && <p style={{ fontSize: '.85rem', marginTop: '8px' }}>{msgPlano}</p>}
      </form>
    </div>
  )
}

export default ConfigPixPayment
