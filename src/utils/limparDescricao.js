// Limpa o prompt técnico interno antes de exibir para o cliente.
// Se a descrição do banco/projeto contiver marcadores internos
// ("Você é designer", "TAREFA:", "REGRAS:", "núcleo", "CTA forte",
// "lorem ipsum"), extrai só a intenção do cliente de forma leiga e curta.
// Ex: prompt gigante -> "Site institucional moderno para gabinete".
// Sem marcadores -> devolve o texto original (limitado a 140 chars).
export function limparDescricao(texto) {
  const raw = String(texto ?? '').trim()
  if (!raw) return '—'
  const marcadores = ['você é designer', 'voce e designer', 'tarefa:', 'regras:', 'núcleo', 'nucleo', 'cta forte', 'lorem ipsum']
  const lower = raw.toLowerCase()
  const temPrompt = marcadores.some((m) => lower.includes(m))
  if (!temPrompt) return raw.length > 140 ? raw.slice(0, 140).trim() + '…' : raw
  // 1) Prefere "Descrição original: X" (é a fala literal do cliente)
  let m = raw.match(/descri[çc][aã]o original:\s*([\s\S]+)/i)
  let intencao = m ? String(m[1]).trim() : ''
  // 2) Senão, "Criar site para: X"
  if (!intencao) {
    m = raw.match(/criar site para:\s*([^.\n]+)/i)
    intencao = m ? String(m[1]).trim() : ''
  }
  // Remove resíduo técnico que possa ter sobrado
  intencao = intencao
    .replace(/regras:[\s\S]*/i, '')
    .replace(/tarefa:[\s\S]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[."']+$/, '')
  if (!intencao) return 'Site institucional moderno'
  if (intencao.length > 120) intencao = intencao.slice(0, 120).trim() + '…'
  return intencao
}

// Valor dinâmico do projeto — NUNCA hardcodar preço no código.
// Ordem: valorPago > preco > amount > valor (legado).
export function valorDoProjeto(p) {
  if (!p) return null
  const candidatos = [p.valorPago, p.preco, p.amount, p.valor]
  for (const c of candidatos) {
    const n = Number(String(c ?? '').replace(',', '.'))
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}
