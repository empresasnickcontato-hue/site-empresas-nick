import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext.jsx'
import PixPagamento from './components/PixPagamento.jsx'
import { api, apiFetch, clearToken } from './services/api.js'
import { limparDescricao, valorDoProjeto } from './utils/limparDescricao.js'
import './DashboarClient.css'

function DashboarClient({ onCheckout }) {
  const { user, setUser } = useAuth()
  const [projetos, setProjetos] = useState([])
  const [loadingProj, setLoadingProj] = useState(true)
  const [descricao, setDescricao] = useState('')
  const [erroProj, setErroProj] = useState('')
  const [enviando, setEnviando] = useState(false)

  // silencioso=true: atualiza sem piscar "Carregando" (anti-jump)
  async function carregarProjetos(silencioso = false){
    if (!silencioso) setLoadingProj(true)
    try{
      const res = await apiFetch('/api/projetos/me?t=' + Date.now(), {cache:'no-store'})
      const data = await res.json()
      if(Array.isArray(data)) setProjetos(data)
      else if(Array.isArray(data.projetos)) setProjetos(data.projetos)
      else if(Array.isArray(data.data)) setProjetos(data.data)
      else setProjetos([])
    }catch{ if (!silencioso) setProjetos([]) }finally{ if (!silencioso) setLoadingProj(false) }
  }

  useEffect(() => {
    if (user) {
      carregarProjetos(false)
      // Sem setInterval (fazia a tela pular): só revalida ao voltar na aba.
      const onFocus = () => carregarProjetos(true)
      const onVis = () => { if (!document.hidden) carregarProjetos(true) }
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVis)
      return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
    }
  }, [user])

  async function handleLogout() {
    try {
      await apiFetch('/logout', { method: 'POST' })
    } finally {
      try { clearToken() } catch {}
      setUser(null)
    }
  }

  async function handleEnviar() {
    const descricaoSite = descricao.trim()
    if (!descricaoSite) {
      setErroProj('Descreva como quer seu site.')
      return
    }
    const promptMelhorado = `Você é designer de alta conversão. TAREFA: Criar site para: ${descricaoSite}. REGRAS: design moderno responsivo, cores do nicho, seções Hero com CTA forte + Sobre + Serviços + Prova Social + Contato com WhatsApp, textos persuasivos sem lorem ipsum, botão flutuante WhatsApp, SEO básico. Descrição original: ${descricaoSite}`
    setEnviando(true)
    setErroProj('')
    try {
      const res = await api.post('/api/projetos', { descricaoSite: promptMelhorado, descricao: promptMelhorado })
      const data = await res.json()
      if (!res.ok) {
        setErroProj(data.erro || 'Erro ao enviar')
        return
      }
      const id = data.projeto?.id
      setDescricao('')
      await carregarProjetos()
      if (onCheckout && id) onCheckout(id)
    } catch {
      setErroProj('Erro de conexão')
    } finally {
      setEnviando(false)
    }
  }

  if (!user) {
    return (
      <div className="container" style={{ padding: '40px 0', textAlign: 'center' }}>
        <p style={{ color: 'var(--cinza-500)' }}>Você precisa estar logado para acessar a dashboard.</p>
      </div>
    )
  }

  const iniciais = user.nome
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const projeto = projetos[0]

  const st = projeto ? String(projeto.status || '').toUpperCase() : ''
  const linkFinal = projeto ? (projeto.link_final || projeto.linkFinal) : null
  const slug = user.email.split('@')[0]
  const urlSite = projeto && st === 'NO_AR' && linkFinal ? linkFinal : `empresasnick.com/${slug}`
  const hrefSite = projeto && st === 'NO_AR' && linkFinal ? linkFinal : `https://empresasnick.com/${slug}`

  let dataEntregaFmt = null
  let faltamDias = null
  if (projeto && st === 'EM_DESENVOLVIMENTO' && projeto.dataInicioDev) {
    const dataEntrega = new Date(new Date(projeto.dataInicioDev).getTime() + 5 * 86400000)
    dataEntregaFmt = dataEntrega.toLocaleDateString('pt-BR')
    faltamDias = Math.ceil((dataEntrega - new Date()) / 86400000)
  }
  const progressoDev = faltamDias === null ? 0 : Math.min(100, Math.max(0, ((5 - faltamDias) / 5) * 100))

  function statusIndex(s) {
    const ordem = ['rascunho', 'aguardando_pagamento', 'em_obra', 'finalizando', 'no_ar']
    const idx = ordem.indexOf(s)
    return idx === -1 ? 0 : idx
  }

  const emObraLike = ['EM_DESENVOLVIMENTO', 'EM_OBRA', 'FINALIZANDO'].includes(st)
  const noAr = st === 'NO_AR'
  const passos = projeto
    ? [
        { label: 'Pedido Enviado', done: true },
        { label: 'Pagamento', done: valorDoProjeto(projeto) !== null },
        { label: 'Site em Obra', done: emObraLike || noAr, extra: st === 'EM_DESENVOLVIMENTO' || st === 'EM_OBRA' ? 'Previsão: 3 dias úteis' : null },
        { label: 'Finalizando', done: st === 'FINALIZANDO' || noAr },
        { label: 'No Ar', done: noAr || !!linkFinal },
      ]
    : []

  return (
    <div className="dash-page">
      <div className="dash-topbar container">
        <div className="dash-user">
          <div className="dash-avatar">{iniciais}</div>
          <div>
            <strong>{user.nome}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <button className="btn btn-outline" onClick={handleLogout}>
          Sair
        </button>
      </div>

      <div className="container dash-content">
        <div className="dash-welcome">
          <h2>Olá, {user.nome.split(' ')[0]}! 👋</h2>
          <p>Acompanhe aqui o andamento do seu site.</p>
        </div>

        {/* ÁREA DE PROJETOS */}
        {loadingProj ? (
          <div className="dash-card" style={{ textAlign: 'center', color: 'var(--cinza-500)' }}>Carregando projetos...</div>
        ) : projetos.length === 0 ? (
          <div className="dash-card" style={{ textAlign: 'center', padding: '28px 22px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--cinza-900)', marginBottom: '8px' }}>Vamos criar seu site?</h2>
            <p style={{ color: 'var(--cinza-500)', marginBottom: '16px', fontSize: '.92rem' }}>Você ainda não tem projetos. Crie o primeiro acima.</p>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva como quer seu site... ex: quero site de barbearia preto e dourado com agendamento"
              rows={5}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: '1.5px solid var(--cinza-200)',
                outline: 'none',
                fontSize: '.95rem',
                resize: 'vertical',
                minHeight: '110px',
                background: 'var(--branco)',
                color: 'var(--cinza-900)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--ciano)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--cinza-200)')}
            />
            {erroProj && <p className="erro" style={{ marginTop: '10px' }}>{erroProj}</p>}
            <button onClick={handleEnviar} disabled={enviando} className="btn btn-primary" style={{ marginTop: '14px', padding: '12px 28px', borderRadius: '999px', fontWeight: 700 }}>
              {enviando ? 'Enviando...' : 'Enviar Pedido'}
            </button>
          </div>
        ) : (
          <div className="dash-card" style={{ padding: '22px' }}>
            {/* LINHA DO TEMPO */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
              {passos.map((p, i) => (
                <div key={p.label} style={{ flex: 1, minWidth: '90px', textAlign: 'center' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '999px',
                      margin: '0 auto 6px',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 800,
                      fontSize: '.9rem',
                      background: p.done ? '#10b981' : 'var(--cinza-200)',
                      color: p.done ? '#fff' : 'var(--cinza-500)',
                      border: p.done ? '2px solid #059669' : '2px solid var(--cinza-300)',
                    }}
                  >
                    {p.done ? '✓' : i + 1}
                  </div>
                  <div style={{ fontSize: '.78rem', fontWeight: 700, color: p.done ? '#059669' : 'var(--cinza-500)' }}>{p.label}</div>
                  {p.extra && <div style={{ fontSize: '.72rem', color: 'var(--ciano-hover)', fontWeight: 600, marginTop: '2px' }}>{p.extra}</div>}
                </div>
              ))}
            </div>
            {/* DETALHES DO PROJETO — só dados dinâmicos do backend/projeto */}
            <div style={{ background: 'var(--cinza-50)', border: '1px solid var(--cinza-200)', borderRadius: '12px', padding: '16px', textAlign: 'left' }}>
              <p style={{ fontSize: '.85rem', color: 'var(--cinza-500)' }}>Status: <strong style={{ color: valorDoProjeto(projeto) ? '#059669' : 'var(--ciano-hover)', textTransform: 'uppercase' }}>{projeto.status}</strong></p>
              <p style={{ marginTop: '8px', color: 'var(--cinza-700)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}><strong>Descrição:</strong> {limparDescricao(projeto.descricaoSite || projeto.descricao)}</p>
              <p style={{ marginTop: '8px', color: 'var(--cinza-700)' }}><strong>Valor pago:</strong> {valorDoProjeto(projeto) !== null ? `R$${valorDoProjeto(projeto)}` : '— aguardando escolha de plano'}</p>
              {valorDoProjeto(projeto) === null && onCheckout && (
                <button onClick={() => onCheckout(projeto.id)} className="btn btn-primary btn-small" style={{ marginTop: '12px' }}>
                  Escolher plano → Checkout
                </button>
              )}
              {linkFinal && (
                <a
                  href={hrefSite}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block',
                    marginTop: '16px',
                    background: '#10b981',
                    color: '#fff',
                    textAlign: 'center',
                    padding: '14px',
                    borderRadius: '12px',
                    fontWeight: 800,
                    textDecoration: 'none',
                    fontSize: '1rem',
                  }}
                >
                  Acessar Meu Site →
                </a>
              )}
              {st === 'AGUARDANDO_PAGAMENTO' && projeto.pagamentoConfirmado !== true && (
                <PixPagamento projetoId={projeto.id} />
              )}
              {(st === 'PAGAMENTO_CONCLUIDO' || projeto.pagamentoConfirmado === true) && (
                <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '12px', padding: '14px', marginTop: '14px', textAlign: 'center' }}>
                  <p style={{ fontWeight: 800, color: '#059669' }}>Pagamento Concluído! Entrou na fila ✅</p>
                </div>
              )}
              {st === 'EM_DESENVOLVIMENTO' && dataEntregaFmt && (
                <div style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '12px', padding: '14px', marginTop: '14px' }}>
                  <p style={{ fontWeight: 800, color: 'var(--cinza-900)' }}>Seu site está em desenvolvimento</p>
                  <p style={{ marginTop: '6px', color: 'var(--cinza-700)' }}>Prazo de entrega: <strong>{dataEntregaFmt}</strong></p>
                  <p style={{ marginTop: '4px', color: 'var(--ciano-hover)', fontWeight: 700 }}>{faltamDias <= 0 ? 'Finalizando os últimos detalhes' : `Faltam ${faltamDias} dias`}</p>
                  <div className="progress-bar" style={{ marginTop: '8px' }}>
                    <div className="progress-fill" style={{ width: `${progressoDev}%` }}></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!loadingProj && projetos.length > 0 && (
          <div className="dash-card" style={{ padding: '22px', marginTop: '18px', textAlign: 'left' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cinza-900)', marginBottom: '12px' }}>Meus projetos</h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {projetos.map((p) => {
                const link = p.link_final || p.linkFinal
                return (
                  <div key={p.id} style={{ background: 'var(--cinza-50)', border: '1px solid var(--cinza-200)', borderRadius: '10px', padding: '12px 14px' }}>
                    <p style={{ fontWeight: 800, color: 'var(--cinza-900)' }}>{p.nome || p.titulo || p.descricaoSite || 'Projeto sem título'}</p>
                    <p style={{ fontSize: '.82rem', color: 'var(--cinza-500)', marginTop: '4px' }}>
                      Status: <strong style={{ color: 'var(--cinza-800)', textTransform: 'uppercase' }}>{p.status || '—'}</strong>
                    </p>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: '.85rem', color: 'var(--ciano-hover)', fontWeight: 700, wordBreak: 'break-all' }}>
                        {link}
                      </a>
                    ) : (
                      <p style={{ fontSize: '.82rem', color: 'var(--cinza-500)' }}>Link final: —</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {loadingProj ? (
          <div className="dash-card" style={{ textAlign: 'center', color: 'var(--cinza-500)', marginTop: '18px' }}>Carregando...</div>
        ) : (
        <div className="dash-grid" style={{ marginTop: '18px', overflowAnchor: 'none' }}>
          <div className="dash-card destaque">
            <span className="dash-label">Meu Site</span>
            <h3>{urlSite}</h3>
            {projeto && st === 'EM_DESENVOLVIMENTO' && dataEntregaFmt ? (
              <>
                <p>Seu site está em desenvolvimento</p>
                <p>
                  Prazo de entrega: <strong className="ciano">{dataEntregaFmt}</strong>
                </p>
                <p>{faltamDias <= 0 ? 'Finalizando os últimos detalhes' : `Faltam ${faltamDias} dias`}</p>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progressoDev}%` }}></div>
                </div>
                <small>{Math.round(progressoDev)}% concluído</small>
              </>
            ) : projeto && st === 'NO_AR' && linkFinal ? (
              <>
                <p>
                  Status: <strong className="ciano">No ar</strong>
                </p>
                <a href={hrefSite} target="_blank" rel="noreferrer" className="btn btn-primary btn-small" style={{ marginTop: '10px', display: 'inline-block', textDecoration: 'none' }}>
                  Acessar Meu Site →
                </a>
              </>
            ) : (
              <>
                <p>
                  Status: <strong className="ciano">Em andamento</strong>
                </p>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.round(progressoDev)}%` }}></div>
                </div>
                <small>{Math.round(progressoDev)}% concluído</small>
              </>
            )}
          </div>

          <div className="dash-card">
            <span className="dash-label">Tecnologias Contratadas</span>
            <ul className="dash-techs">
              {['HTML', 'CSS', 'JavaScript', 'React.js', 'Tailwind', 'Node.js', 'Express'].map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: '8px', fontSize: '.78rem' }}>
              {projeto ? `Incluídas no projeto #${String(projeto.id || '').slice(-6)} (${st})` : 'Nenhum projeto ativo no momento.'}
            </p>
          </div>

          <div className="dash-card">
            <span className="dash-label">Próxima etapa</span>
            <h3>
              {!projeto
                ? 'Descreva seu projeto'
                : st === 'NO_AR'
                  ? 'Site no ar'
                  : valorDoProjeto(projeto) === null
                    ? 'Escolha do plano'
                    : 'Desenvolvimento do site'}
            </h3>
            <p className="muted">
              {!projeto
                ? 'Envie a descrição para começar.'
                : st === 'NO_AR'
                  ? 'Acesse em Meus projetos.'
                  : valorDoProjeto(projeto) === null
                    ? 'Conclua o pagamento via Pix.'
                    : dataEntregaFmt
                      ? `Previsão: ${dataEntregaFmt}`
                      : 'Previsão: 3 dias úteis'}
            </p>
            <button className="btn btn-primary btn-small">Falar com suporte</button>
          </div>
        </div>
        )}

        <div className="dash-grid-2">
          <div className="dash-card">
            <h3>Segurança</h3>
            <p className="muted">Sua sessão é protegida e seus projetos são visíveis só para você.</p>
            {user.role === 'admin' ? (
              <a href="http://localhost:3001/admin" target="_blank" rel="noreferrer" className="btn btn-primary btn-small" style={{ marginTop: '12px', display: 'inline-block', textDecoration: 'none' }}>
                Acessar painel admin
              </a>
            ) : (
              <p style={{ marginTop: '12px', fontSize: '.85rem', color: 'var(--cinza-500)' }}>Você é <strong>{user.role}</strong> — acesso admin restrito.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboarClient
