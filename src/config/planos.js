// Planos Empresas Nick — SOMENTE estrutura (nomes, descrições, features).
// Os VALORES vêm 100% do backend via GET /api/planos
// (CRUD do ConfigPixPayment no admin, dados em backend/data/planos.json).
// NUNCA hardcodar preço aqui: valor inicia null e carregarPlanos() preenche
// com o backend (sem cache) a cada entrada na página + polling.
// Planos mensais, pagamento só via Pix. JS puro, sem TypeScript.
import { apiFetch } from '../services/api.js'

export const PLANOS_LISTA = [
  { id: 'start', nome: 'Start', valor: null, desc: '1 página', features: ['1 página', 'Design responsivo', 'Entrega em 5 dias'] },
  { id: 'pro', nome: 'Pro', valor: null, desc: 'até 5 páginas + WhatsApp', features: ['Até 5 páginas', 'Botão WhatsApp', 'Entrega em 7 dias'] },
  { id: 'premium', nome: 'Premium', valor: null, desc: 'completo + SEO', features: ['Páginas ilimitadas', 'SEO otimizado', 'Suporte 30 dias'] },
]

// Normaliza plano da API (/api/planos) para o card.
// valor_do_pix = plano.preco — NUNCA fixo, sempre de data/planos.json.
export function normPlanoApi(p) {
  const preco = Number(String(p.preco ?? p.valor ?? '').replace(',', '.'))
  return {
    id: p.id,
    nome: p.nome,
    valor: Number.isFinite(preco) && preco > 0 ? preco : null,
    desc: p.descricao || p.desc || '',
    features: Array.isArray(p.recursos) ? p.recursos : (Array.isArray(p.features) ? p.features : []),
    destaque: !!p.destaque,
  }
}

// Busca planos ativos no backend (GET /api/planos -> data/planos.json,
// sem cache). Fallback dinâmico: GET /api/pix-config (valores do admin).
// Retorna [] se o backend estiver fora — nunca preço fixo/hardcodado.
export async function carregarPlanos() {
  const rp = await apiFetch('/api/planos?t=' + Date.now(), { cache: 'no-store' })
  if (rp.ok) {
    const lista = await rp.json()
    const validos = (Array.isArray(lista) ? lista : []).map(normPlanoApi).filter((p) => p.valor !== null)
    if (validos.length) return validos
  }
  const rc = await apiFetch('/api/pix-config?t=' + Date.now(), { cache: 'no-store' })
  if (!rc.ok) throw new Error('HTTP ' + rc.status)
  const cfg = await rc.json()
  const grupos = [
    { id: 'start', nome: 'Start', desc: '1 página', features: ['1 página', 'Design responsivo', 'Entrega em 5 dias'], v: cfg.valorStart },
    { id: 'pro', nome: 'Pro', desc: 'até 5 páginas + WhatsApp', features: ['Até 5 páginas', 'Botão WhatsApp', 'Entrega em 7 dias'], v: cfg.valorPro },
    { id: 'premium', nome: 'Premium', desc: 'completo + SEO', features: ['Páginas ilimitadas', 'SEO otimizado', 'Suporte 30 dias'], v: cfg.valorPremium },
  ]
  const val = (v) => {
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const fb = grupos.map((g) => ({ ...g, valor: val(g.v), destaque: g.id === 'pro' })).filter((p) => p.valor !== null)
  if (!fb.length) throw new Error('sem valores')
  return fb
}
