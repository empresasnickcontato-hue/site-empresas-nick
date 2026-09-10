// @ts-nocheck
// Hook do chat de suporte — persistência em disco via backend (backend/data/messages.json).
// Sem supabase, sem localStorage, sem sessionStorage. JS puro.
import { useState, useEffect, useRef } from 'react'
import { supportKnowledge } from '../data/supportKnowledge'
import { sendWhatsAppMessage, formatEscalationMessage } from '../services/myWhatsAppApi'
import { apiFetch } from '../services/api.js'

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '')
}

function jidOf(phone) {
  const d = soDigitos(phone)
  if (!d) return ''
  return d + '@s.whatsapp.net'
}

function agora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function salvarNoBackend(jid, text, fromMe) {
  if (!jid || !text) return Promise.resolve({ ok: false })
  return apiFetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, text, fromMe })
  }).then((r) => ({ ok: r.ok })).catch(() => ({ ok: false }))
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Normaliza e tenta casar a mensagem do cliente com o FAQ do banco
// (GET /api/support-options, editável no painel admin).
// 1) pergunta contida na mensagem (ou vice-versa); 2) overlap de palavras relevantes.
function matchOption(input, options) {
  const t = norm(input).replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const lista = Array.isArray(options) ? options : []
  for (const o of lista) {
    const p = norm(o.pergunta).replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!p) continue
    if (t.includes(p) || (p.length > 8 && p.includes(t))) return o
  }
  const stop = new Set(['como', 'para', 'qual', 'quais', 'quando', 'onde', 'meu', 'minha', 'seu', 'sua', 'uma', 'dos', 'das', 'que', 'com', 'por', 'tem', 'sao', 'faco', 'posso', 'quero', 'sobre', 'mais', 'muito', 'isso', 'este', 'esta', 'esse', 'essa', 'entre', 'ate', 'aos', 'nas', 'nos'])
  const words = (s) => norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !stop.has(w))
  const tw = words(t)
  if (!tw.length) return null
  let best = null
  let bestScore = 0
  for (const o of lista) {
    const ow = new Set(words((o.pergunta || '') + ' ' + (o.resposta || '')))
    let score = 0
    tw.forEach((w) => { if (ow.has(w)) score++ })
    if (score > bestScore) { bestScore = score; best = o }
  }
  if (best && bestScore >= Math.min(2, tw.length)) return best
  return null
}

function detectIntent(input) {
  const t = String(input || '').toLowerCase()
  if (/(preço|valor|plano|quanto custa|297|497|997)/.test(t)) return 'preco'
  if (/(fatura|vencimento|vence|dia 10|boleto)/.test(t)) return 'fatura'
  if (/(como pagar|pix|cartão|cartao|método|metodo)/.test(t)) return 'pagamento'
  if (/(prazo|entrega|quanto tempo|obra|previsão)/.test(t)) return 'prazo'
  if (/(reembolso|estorno|cancelar)/.test(t)) return 'reembolso'
  if (/(humano|atendente|pessoa)/.test(t)) return 'humano'
  return 'outro'
}

function answerFor(intent) {
  const k = supportKnowledge
  switch (intent) {
    case 'preco':
      return `*Planos Empresas Nick:*\n• Start • Pro • Premium\nValores atuais no checkout — pagamento só via Pix. Qual se encaixa pra você?`
    case 'fatura':
      return `*Fatura vence todo dia 10.*\n${k.fatura.comoPagar}\nMétodos: ${k.fatura.metodos.join(', ')}.\nAtraso: ${k.fatura.atraso}`
    case 'pagamento':
      return `Pagamento é só via *PIX* (QR Code + copia e cola na tela de pagamento).\nApós pagar, o admin confirma e seu site entra em desenvolvimento (prazo de 5 dias).`
    case 'prazo':
      return `*Prazos:* Básico 5 dias, Profissional 7 dias, Premium 10 dias após pagamento. Status *em_obra* = Previsão: 3 dias úteis.`
    case 'reembolso':
      return `*Reembolso:* ${k.reembolso}`
    case 'humano':
      return 'Te conecto com humano agora — só confirmar seu WhatsApp que já escalo.'
    default:
      return `Não entendi bem. Tenta perguntar sobre *preços, fatura dia 10, pagamento, prazo ou reembolso* — ou digite "humano".`
  }
}

export function useSupportBot(customerName, customerPhone) {
  const [messages, setMessages] = useState([
    { role: 'bot', text: `Olá ${customerName || 'por aqui'}! Sou o bot da Empresas Nick 🤖\nPosso te ajudar com preços, fatura dia 10, pagamento e prazos.`, at: agora() },
  ])
  const [tentativas, setTentativas] = useState(0)
  const [escalado, setEscalado] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  // Opções do FAQ vindas do banco (GET /api/support-options) — sem array fixo.
  const [options, setOptions] = useState([])
  const optionsRef = useRef([])
  const [, setConversationId] = useState(null)
  const carregadoRef = useRef(false)

  function jidAtual() {
    return jidOf(customerPhone)
  }

  // Carrega o FAQ do banco (admin edita sem mexer no código)
  useEffect(() => {
    apiFetch('/api/support-options')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const ativas = (Array.isArray(list) ? list : [])
          .filter((o) => o && o.ativo !== false && o.pergunta && o.resposta)
          .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
        setOptions(ativas)
        optionsRef.current = ativas
      })
      .catch(() => {})
  }, [])

  // Carrega histórico do backend (sobrevive ao F5) quando o telefone é conhecido
  useEffect(() => {
    const jid = jidOf(customerPhone)
    if (!jid || carregadoRef.current) return
    carregadoRef.current = true
    apiFetch(`/api/messages?jid=${encodeURIComponent(jid)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((hist) => {
        const lista = Array.isArray(hist) ? hist : (hist && Array.isArray(hist.ultimas_mensagens) ? hist.ultimas_mensagens : [])
        if (lista.length) setMessages(lista)
        setConversationId(jid)
      })
      .catch(() => {})
  }, [customerPhone])

  // Cliente recebe resposta do dono em tempo real via polling no backend
  useEffect(() => {
    const jid = jidOf(customerPhone)
    if (!jid) return
    const t = setInterval(() => {
      apiFetch(`/api/messages?jid=${encodeURIComponent(jid)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((hist) => {
          const lista = Array.isArray(hist) ? hist : null
          if (!lista) return
          setMessages((prev) => {
            if (lista.length > prev.length) return lista
            return prev
          })
        })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [customerPhone])

  async function escalate(history) {
    setEscalado(true)
    const jid = jidAtual()
    const formatted = formatEscalationMessage(customerName, customerPhone, history.map((m) => ({ role: m.role, text: m.text, at: m.at })))
    // garante contato em disco
    try {
      await apiFetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, name: customerName })
      })
    } catch (e) {
      console.log('Erro ao salvar contato', e)
    }
    if (jid) setConversationId(jid)
    await sendWhatsAppMessage(formatted)
    const msg = { role: 'bot', text: `*Escalado para humano!* ✅\nEnviei seu resumo para nosso WhatsApp. Já te chamamos em *${customerPhone}* em instantes.`, at: agora() }
    setMessages((prev) => [...prev, msg])
    // persiste resposta de escalada no disco (admin vê após F5)
    salvarNoBackend(jid, msg.text, true)
  }

  async function sendUserMessage(text) {
    const at = agora()
    const userMsg = { role: 'user', text, at }
    const nextHistory = [...messages, userMsg]
    setMessages(nextHistory)
    // persiste mensagem do cliente em disco imediatamente (admin vê via polling)
    salvarNoBackend(jidAtual(), text, false)

    if (escalado) {
      const aviso = { role: 'bot', text: 'Já escalamos para humano — aguarde contato no WhatsApp!', at }
      setMessages((prev) => [...prev, aviso])
      salvarNoBackend(jidAtual(), aviso.text, true)
      return
    }

    const intent = detectIntent(text)
    if (intent === 'humano') {
      await escalate(nextHistory)
      return
    }

    // FAQ do banco primeiro (admin edita sem mexer no código); fallback: intents fixos
    const opt = matchOption(text, optionsRef.current)
    const answer = opt ? opt.resposta : answerFor(intent)
    const isOutro = !opt && intent === 'outro'
    const nextTentativas = isOutro ? tentativas + 1 : 0
    setTentativas(nextTentativas)

    if (nextTentativas >= 3) {
      await escalate(nextHistory)
      return
    }

    setIsTyping(true)
    setTimeout(() => {
      setIsTyping(false)
      const botMsg = { role: 'bot', text: answer, at: agora() }
      const jid = jidAtual()
      setMessages((prev) => [...prev, botMsg])
      // persiste resposta do bot em disco
      salvarNoBackend(jid, answer, true)
    }, 800)
  }

  return { messages, sendUserMessage, isTyping, escalado, tentativas, options }
}
