// @ts-nocheck
// Base de conhecimento - Empresas Nick - Bot Suporte
// ATENÇÃO: valores NUNCA fixos aqui — preços oficiais vivem no backend
// (GET /api/pix-config, data/pix-config.json) e aparecem no checkout.
// O bot responde "valores atuais no checkout" (answerFor 'preco').
export const supportKnowledge = {
  empresa: 'Empresas Nick',
  planos: [
    { nome: 'Start', valor: null, desc: '1 página', features: ['1 página', 'Design responsivo', 'Entrega em 5 dias'] },
    { nome: 'Pro', valor: null, desc: 'até 5 páginas + WhatsApp', features: ['Até 5 páginas', 'Botão WhatsApp', 'Entrega em 7 dias'] },
    { nome: 'Premium', valor: null, desc: 'completo + SEO', features: ['Páginas ilimitadas', 'SEO otimizado', 'Suporte 30 dias'] },
  ],
  fatura: {
    vencimento: 'Todo dia 10',
    comoPagar: 'Só via PIX. Acesse /dashboard → Pagamento, escaneie o QR ou use o copia e cola.',
    metodos: ['PIX'],
    atraso: 'Após dia 10, multa de 2% + juros de 1% ao mês. Site continua no ar por 5 dias.',
  },
  prazos: {
    rascunho: 'Após enviar descrição, seu pedido fica em rascunho até escolher plano.',
    em_obra: 'Previsão: 3 dias úteis após pagamento confirmado.',
    finalizando: '1 dia para ajustes finais.',
    no_ar: 'Link final liberado + verde "Acessar Meu Site" no dashboard.',
  },
  reembolso: '7 dias após pagamento (CDC). Solicite via suporte com motivo. Após site no ar, não reembolsável.',
  faq: [
    { q: 'como funciona o pagamento?', a: 'Escolha plano no checkout (Start/Pro/Premium). Pagamento só via PIX com QR Code. Admin confirma e o status avança.' },
    { q: 'quando vence a fatura?', a: 'Todo dia 10. Você recebe lembrete no e-mail e WhatsApp 3 dias antes.' },
    { q: 'quais métodos de pagamento?', a: 'Só PIX. QR Code + copia e cola gerados na tela de pagamento.' },
    { q: 'qual prazo de entrega?', a: 'Básico 5 dias, Profissional 7 dias, Premium 10 dias após pagamento. Em desenvolvimento = entrega em 5 dias com contador no dashboard.' },
    { q: 'posso pedir reembolso?', a: 'Sim, até 7 dias após pagamento se site ainda não foi para o ar. Fale com suporte.' },
    { q: 'como falo com humano?', a: 'Digite "falar com humano" ou aguarde 3 tentativas sem solução — te conecto no WhatsApp.' },
  ],
}

// Helpers para busca simples (por nome do plano; valor é dinâmico do backend)
export function findPlanByPrice(valor) {
  return supportKnowledge.planos.find(p => p.valor === valor) || null
}

export function findPlanByName(nome) {
  const t = String(nome || '').trim().toLowerCase()
  return supportKnowledge.planos.find(p => String(p.nome).toLowerCase() === t) || null
}
