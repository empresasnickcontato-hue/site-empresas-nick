// Status canônico de projetos — espelha backend/server.js (sem lib nova).
// Enum oficial: ['pendente', 'em_andamento', 'concluido', 'cancelado']
// Valores legados (rascunho, aguardando_pagamento, PAGAMENTO_CONCLUIDO,
// EM_DESENVOLVIMENTO, NO_AR...) são normalizados — nunca quebram a tela.

export const STATUS_VALIDOS = ['pendente', 'em_andamento', 'concluido', 'cancelado']

const LEGADO_PARA_NOVO = {
  rascunho: 'pendente',
  aguardando_pagamento: 'pendente',
  pagamento_concluido: 'em_andamento',
  em_desenvolvimento: 'em_andamento',
  em_obra: 'em_andamento',
  finalizando: 'em_andamento',
  em_analise: 'em_andamento',
  no_ar: 'concluido',
}

export function normalizarStatus(s) {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return 'pendente'
  if (STATUS_VALIDOS.includes(t)) return t
  if (LEGADO_PARA_NOVO[t]) return LEGADO_PARA_NOVO[t]
  return 'pendente'
}

// Ativos = pendente + em_andamento (+ legado aguardando_pagamento).
export function isProjetoAtivo(p) {
  const s = normalizarStatus(p && p.status)
  return s === 'pendente' || s === 'em_andamento'
}

export function isProjetoConcluido(p) {
  return normalizarStatus(p && p.status) === 'concluido'
}

// Suporte oficial Empresa Nick — wa.me funciona no mobile e no desktop.
export const SUPPORT_WHATSAPP_NUMBER = '5511916572015'
export const SUPPORT_WHATSAPP_URL =
  'https://wa.me/5511916572015?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20na%20Empresa%20Nick'

export function handleSupportWhatsApp() {
  window.open('https://wa.me/5511916572015?text=Olá, preciso de suporte na Empresa Nick', '_blank', 'noopener,noreferrer')
}
