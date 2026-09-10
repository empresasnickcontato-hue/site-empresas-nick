// Helper WhatsApp — Suporte Empresa Nick
// Número oficial do suporte: +55 11 91657-2015
// Link final: https://wa.me/5511916572015?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20na%20Empresa%20Nick
import { apiFetch } from './api.js'

export const SUPPORT_WHATSAPP_NUMBER = '5511916572015'
export const SUPPORT_WHATSAPP_TEXT = 'Olá, preciso de suporte na Empresa Nick'
export const SUPPORT_WHATSAPP_URL =
  'https://wa.me/5511916572015?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20na%20Empresa%20Nick'

export function getSupportWhatsAppUrl(customText) {
  if (!customText) return SUPPORT_WHATSAPP_URL
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(customText)}`
}

export function openSupportWhatsApp(customText) {
  const url = getSupportWhatsAppUrl(customText)
  window.open(url, '_blank', 'noopener,noreferrer')
  return url
}

export function formatEscalationMessage(customerName, customerPhone, history) {
  const nome = customerName || 'Cliente'
  const fone = customerPhone || 'não informado'
  const hist = Array.isArray(history)
    ? history.map((m) => `*${m.role === 'user' ? 'Cliente' : 'Bot'}* (${m.at || ''}): ${m.text}`).join('\n')
    : ''
  return `*Novo atendimento escalado — Empresas Nick*\n*Nome:* ${nome}\n*WhatsApp:* ${fone}\n*Histórico:*\n${hist}`
}

export async function sendWhatsAppMessage(message) {
  const text = typeof message === 'string' ? message : String(message ?? '')
  // 1) Tenta enviar via backend (persiste + encaminha se o Zap estiver conectado)
  try {
    const res = await apiFetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: SUPPORT_WHATSAPP_NUMBER,
        message: text,
        type: 'text',
      }),
    })
    if (res.ok) return true
  } catch {
    // cai para o fallback wa.me abaixo
  }
  // 2) Fallback: abre conversa com o suporte (funciona mobile + desktop)
  try {
    window.open(getSupportWhatsAppUrl(text || SUPPORT_WHATSAPP_TEXT), '_blank', 'noopener,noreferrer')
  } catch {
    // ambiente sem window (SSR/teste)
  }
  return true
}

export async function sendToOwner(phone: string, resumo: string, customerPhone: string) {
  // Formata o número pra garantir o 55
  const numeroLimpo = String(phone || SUPPORT_WHATSAPP_NUMBER).replace(/\D/g, '');

  const texto = `*NOVO SUPORTE - EMPRESAS NICK*%0A%0ACliente: ${customerPhone}%0A%0AResumo:%0A${encodeURIComponent(resumo)}`;

  const link = `https://wa.me/${numeroLimpo}?text=${texto}`;

  // Abre o zap no celular do cliente, mas com mensagem pro seu número
  window.open(link, '_blank', 'noopener,noreferrer');

  console.log("Link gerado:", link);
  return true;
}
