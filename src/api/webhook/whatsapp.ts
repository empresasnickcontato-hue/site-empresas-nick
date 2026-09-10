// @ts-nocheck
// Webhook WhatsApp — recebe resposta do dono via WhatsApp no formato "/responder JID mensagem"
// e persiste em disco via backend (POST /api/messages). Sem banco externo, sem supabase.
import { BASE_URL } from '../../services/api.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const body = await req.json().catch(() => ({}))
  const text = body.text || body.message || ''
  const match = String(text).match(/^\/responder\s+(\S+)\s+([\s\S]+)/)
  if (!match) {
    return new Response(JSON.stringify({ erro: 'Formato deve ser: /responder JID mensagem' }), { status: 400 })
  }
  const id = match[1]
  const mensagem = match[2]
  try {
    await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid: id, text: mensagem, fromMe: true })
    })
  } catch (e) {
    console.log('Erro ao persistir resposta do dono', e)
  }
  return new Response(JSON.stringify({ ok: true, id, mensagem }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
