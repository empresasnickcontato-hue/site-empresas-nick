// @ts-nocheck
import { useState } from 'react'
import { apiFetch } from '../services/api.js'
import { useSupportBot } from '../hooks/useSupportBot'

function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return `(${d}`
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

const sugestoesFallback = ['Preços dos planos', 'Fatura vence quando?', 'Como pagar?', 'Prazo de entrega', 'Reembolso']

async function salvarContato(nome, numero) {
  try {
    const digitos = String(numero).replace(/\D/g, '')
    const jid = digitos + '@s.whatsapp.net'
    await apiFetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, name: nome })
    })
  } catch (e) {
    console.error('Erro ao salvar contato', e)
  }
}

export default function SupportChat({ onClose }) {
  const [step, setStep] = useState('form')
  const [nome, setNome] = useState('')
  const [phone, setPhone] = useState('')
  const [input, setInput] = useState('')
  const { messages, sendUserMessage, isTyping, options } = useSupportBot(nome, phone)
  // Sugestões vêm do banco (GET /api/support-options, aba Suporte Bot no admin).
  // Fallback fixo só se o banco ainda não respondeu.
  const sugestoes = options && options.length ? options.map((o) => o.pergunta) : sugestoesFallback

  // Suporte Empresa Nick — WhatsApp oficial +5511916572015
  // Link final: https://wa.me/5511916572015?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20na%20Empresa%20Nick
  // wa.me funciona no mobile e no desktop (app ou WhatsApp Web).
  const handleWhatsApp = () => {
    window.open('https://wa.me/5511916572015?text=Olá, preciso de suporte na Empresa Nick', '_blank', 'noopener,noreferrer')
  }

  function startChat(e) {
    e.preventDefault()
    if (!nome.trim() || phone.replace(/\D/g, '').length < 10) return
    setStep('chat')
    // Salvar contato no backend
    salvarContato(nome, phone)
  }

  function send(text) {
    const t = (text ?? input).trim()
    if (!t) return
    setInput('')
    sendUserMessage(t)
  }

  return (
    <div style={{ position: 'fixed', bottom: '18px', right: '18px', width: 'min(360px, 92vw)', height: '480px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', boxShadow: '0 12px 40px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 9999 }}>
      <div style={{ background: '#0891b2', color: '#fff', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <strong style={{ fontSize: '.92rem' }}>Suporte Empresas Nick 🤖</strong>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleWhatsApp} title="Falar no WhatsApp (11) 91657-2015" style={{ background: '#25D366', border: 'none', color: '#fff', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer', fontWeight: 700, fontSize: '.75rem' }}>WhatsApp</button>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer' }}>✕</button>
        </div>
      </div>

      {step === 'form' ? (
        <form onSubmit={startChat} style={{ padding: '18px', display: 'grid', gap: '12px', flex: 1 }}>
          <p style={{ fontSize: '.88rem', color: '#64748b' }}>Para te atender melhor, informe nome e WhatsApp.</p>
          <label style={{ fontSize: '.8rem', fontWeight: 600, color: '#334155' }}>Nome</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" required style={{ padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', outline: 'none' }} />
          <label style={{ fontSize: '.8rem', fontWeight: 600, color: '#334155' }}>WhatsApp</label>
          <input value={phone} onChange={e => setPhone(maskPhone(e.target.value))} placeholder="(99) 99999-9999" required inputMode="numeric" style={{ padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', outline: 'none' }} />
          <button type="submit" style={{ marginTop: '6px', background: '#06b6d4', color: '#fff', border: 'none', borderRadius: '999px', padding: '11px', fontWeight: 700, cursor: 'pointer' }}>Iniciar chat</button>
          <button type="button" onClick={handleWhatsApp} style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: '999px', padding: '11px', fontWeight: 700, cursor: 'pointer' }}>💬 Chamar no WhatsApp</button>
          <a href="https://wa.me/5511916572015?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20na%20Empresa%20Nick" target="_blank" rel="noopener noreferrer" style={{ fontSize: '.78rem', color: '#0891b2', textAlign: 'center', fontWeight: 600 }}>ou abrir wa.me/5511916572015</a>
          <p style={{ fontSize: '.7rem', color: '#94a3b8', textAlign: 'center' }}>Histórico salvo no servidor (não apaga no F5)</p>
        </form>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'grid', gap: '10px', background: '#f8fafc' }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '82%', padding: '9px 12px', borderRadius: '12px', fontSize: '.86rem', whiteSpace: 'pre-wrap', lineHeight: 1.4, background: m.role === 'user' ? '#06b6d4' : '#fff', color: m.role === 'user' ? '#fff' : '#334155', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }}>
                  {m.text}
                </div>
                <span style={{ fontSize: '.65rem', color: '#94a3b8', marginTop: '3px' }}>{m.at}</span>
              </div>
            ))}
            {isTyping && <div style={{ fontSize: '.78rem', color: '#64748b', fontStyle: 'italic' }}>digitando...</div>}
          </div>

          <div style={{ padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
            {sugestoes.map(s => (
              <button key={s} onClick={() => send(s)} style={{ fontSize: '.72rem', background: '#ecfeff', color: '#0891b2', border: '1px solid #a5f3fc', borderRadius: '999px', padding: '6px 10px', cursor: 'pointer' }}>
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', padding: '10px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Digite sua mensagem..." style={{ flex: 1, padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: '999px', outline: 'none', fontSize: '.88rem' }} />
            <button onClick={() => send()} style={{ background: '#06b6d4', color: '#fff', border: 'none', borderRadius: '999px', padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>Enviar</button>
          </div>
        </>
      )}
    </div>
  )
}
