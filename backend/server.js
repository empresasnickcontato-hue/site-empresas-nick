// @ts-nocheck
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { startWhatsApp, sendMessage, onIncomingMessage } from './src/whatsapp.js'
import QRCode from 'qrcode'
import multer from 'multer'
import crypto from 'crypto'
import { sendEmail, isEmailConfigured } from './src/lib/email.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '.env') })
dotenv.config()

// Turso DEPOIS do dotenv (import dinâmico): assim o backend/.env local é
// enxergado no boot. No Render as vars vêm do dashboard (já estão no
// process.env antes do boot). Falha aqui NUNCA derruba o servidor.
const { turso } = await import('./src/lib/turso.js').catch((e) => {
  console.error('[DB] Falha ao carregar módulo Turso:', (e && e.message) || e)
  return { turso: null }
})
if (!process.env.JWT_SECRET) {
  console.warn('[AUTH] JWT_SECRET não definido — usando fallback inseguro. Defina o MESMO JWT_SECRET no backend e no frontend/deploy, senão o login dá 401 e o /admin mostra zeros.')
}
console.log(`[DB] Turso ${turso ? 'conectado — sync JSON <-> Turso ATIVO' : 'DESABILITADO — usando só JSON local. Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no ambiente.'}`)

const app = express()
const PORT = process.env.PORT || 3001
const SECRET = process.env.JWT_SECRET || 'nick_secret_2024'
// Não desligar sozinho em erro inesperado (logar e seguir operando)
process.on('uncaughtException', (e) => console.error('[FATAL] uncaughtException:', e && e.message))
process.on('unhandledRejection', (e) => console.error('[FATAL] unhandledRejection:', (e && e.message) || e))
const DATA_FILE = path.join(__dirname, 'data', 'users.json')
const PROJECTS_FILE = path.join(__dirname, 'data', 'projects.json')
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json')
const CONTACTS_FILE = path.join(__dirname, 'data', 'contacts.json')
const PIXCONFIG_FILE = path.join(__dirname, 'data', 'pix-config.json')
const PORTFOLIO_FILE = path.join(__dirname, 'data', 'portfolio.json')
const PLANOS_FILE = path.join(__dirname, 'data', 'planos.json')
const PAGAMENTOS_PENDENTES_FILE = path.join(__dirname, 'data', 'pagamentos-pendentes.json')
const UPLOADS_PORTFOLIO_DIR = path.join(__dirname, 'uploads', 'portfolio')

app.use(cookieParser())
app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
// Arquivos do portfólio (foto/vídeo) servidos em /uploads/portfolio/...
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// Anti-cache em tempo real: preços/planos/projetos NUNCA podem vir do cache
// do navegador (ex: valor antigo após o admin alterar no painel).
function noCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}
app.use('/api', noCache)
app.use('/me', noCache)

app.get("/debug", async (req, res) => {
  try {
    if (!turso) return res.status(500).json({ status: "TURSO_OFF", erro: "Turso desabilitado: defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no ambiente. Veja os logs [DB] no boot." });
    const r = await turso.execute("SELECT COUNT(*) as total FROM users");
    const u = await turso.execute("SELECT * FROM users LIMIT 5");
    res.json({ status: "OK TURSO", total: r.rows[0], preview: u.rows });
  } catch (e) { res.status(500).json({ status: "TURSO_ERRO", erro: e.message }); }
});


function ensureDataFile() {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8')
}

function readUsers() {
  ensureDataFile()
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeUsers(users) {
  ensureDataFile()
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf-8')
  if (turso) {
    // salva no Turso também, pra não apagar no Render
    for (const u of users) {
      turso.execute({ sql: "INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)", args: [u.id, JSON.stringify(u)] }).catch(()=>{})
    }
  }
}

function ensureProjectsFile() {
  const dir = path.dirname(PROJECTS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]', 'utf-8')
}
function readProjects() {
  ensureProjectsFile()
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeProjects(projects) {
  ensureProjectsFile()
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8')
  if (turso) {
    for (const p of projects) {
      turso.execute({ sql: "INSERT OR REPLACE INTO projects (id, data) VALUES (?, ?)", args: [p.id, JSON.stringify(p)] }).catch(()=>{})
    }
  }
}

function ensureMessagesFile() {
  const dir = path.dirname(MESSAGES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '{}', 'utf-8')
}
function readMessagesRaw() {
  ensureMessagesFile()
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'))
  } catch {
    return {}
  }
}
// Mapa { jid: [{role,text,at}] }. Aceita legado em array e converte.
function readMessagesMap() {
  const raw = readMessagesRaw()
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    const map = {}
    for (const k of Object.keys(raw)) map[k] = Array.isArray(raw[k]) ? raw[k] : []
    return map
  }
  if (Array.isArray(raw)) {
    const map = {}
    for (const m of raw) {
      if (Array.isArray(m.ultimas_mensagens) && m.jid) {
        map[m.jid] = (map[m.jid] || []).concat(
          m.ultimas_mensagens.map((sub) => ({ role: sub.role || 'user', text: sub.text ?? '', at: sub.at || new Date().toISOString() }))
        )
      } else if (m && m.jid && m.text !== undefined) {
        if (!map[m.jid]) map[m.jid] = []
        map[m.jid].push({ role: m.role || 'user', text: m.text ?? '', at: m.at || new Date().toISOString() })
      }
    }
    return map
  }
  return {}
}
function writeMessagesMap(map) {
  ensureMessagesFile()
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(map, null, 2), 'utf-8')
}
// Compat: legado esperava array — mantém leitura/escrita via mapa convertido
function readMessages() {
  const map = readMessagesMap()
  return Object.keys(map).map((jid) => ({ jid, ultimas_mensagens: map[jid], ultima_mensagem: map[jid].length ? map[jid][map[jid].length - 1].text : '', ultima_acao: map[jid].length ? map[jid][map[jid].length - 1].at : null }))
}
function writeMessages(messages) {
  if (messages && !Array.isArray(messages) && typeof messages === 'object') {
    writeMessagesMap(messages)
    return
  }
  const map = {}
  for (const m of (Array.isArray(messages) ? messages : [])) {
    if (m && m.jid && Array.isArray(m.ultimas_mensagens)) map[m.jid] = m.ultimas_mensagens
    else if (m && m.jid && m.text !== undefined) {
      if (!map[m.jid]) map[m.jid] = []
      map[m.jid].push({ role: m.role || 'user', text: m.text ?? '', at: m.at || new Date().toISOString() })
    }
  }
  writeMessagesMap(map)
}

function ensureContactsFile() {
  const dir = path.dirname(CONTACTS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(CONTACTS_FILE)) fs.writeFileSync(CONTACTS_FILE, '[]', 'utf-8')
}
function readContacts() {
  ensureContactsFile()
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf-8'))
  } catch {
    return []
  }
}
function writeContacts(contacts) {
  ensureContactsFile()
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2), 'utf-8')
}
// Aliases no padrão pedido: loadContacts/saveContacts/loadMessages/saveMessages (fs em disco)
function loadContacts() {
  return readContacts()
}
function saveContacts(contacts) {
  writeContacts(contacts)
}
function loadMessages() {
  return readMessagesMap()
}
function saveMessages(map) {
  writeMessagesMap(map)
}
// --- CONFIG PIX (backend/data/pix-config.json) ---
function defaultPixConfig() {
  return {
    chavePix: process.env.PIX_CHAVE || '',
    tipoChave: 'Email',
    nomeRecebedor: process.env.PIX_NOME || 'EMPRESAS NICK',
    cidadeRecebedor: process.env.PIX_CIDADE || 'SAO PAULO',
    valorStart: 297,
    valorPro: 497,
    valorPremium: 997,
    modoTeste: false,
    atualizadoEm: new Date().toISOString(),
  }
}
function ensurePixConfigFile() {
  const dir = path.dirname(PIXCONFIG_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(PIXCONFIG_FILE)) fs.writeFileSync(PIXCONFIG_FILE, JSON.stringify(defaultPixConfig(), null, 2), 'utf-8')
}
function loadPixConfig() {
  ensurePixConfigFile()
  try {
    const raw = JSON.parse(fs.readFileSync(PIXCONFIG_FILE, 'utf-8'))
    return { ...defaultPixConfig(), ...raw }
  } catch {
    return defaultPixConfig()
  }
}
function savePixConfig(cfg) {
  ensurePixConfigFile()
  const agora = new Date().toISOString()
  const final = { ...defaultPixConfig(), ...cfg, atualizadoEm: agora, updatedAt: agora }
  fs.writeFileSync(PIXCONFIG_FILE, JSON.stringify(final, null, 2), 'utf-8')
  return final
}
// Alias compat: savePixConfigFile usado pelo prompt
function savePixConfigFile(cfg) {
  const final = savePixConfig(cfg)
  // Espelha no Turso (fonte oficial do GET público). Fire-and-forget: nunca derruba o save.
  gravarPixConfigTurso(final).catch(() => {})
  return final
}
// --- PIX-CONFIG NO TURSO (fonte oficial do GET público em tempo real) ---
// Tabela chave-valor: pix_config(id='atual', data=JSON). Criada sob demanda;
// se o Turso estiver OFF, segue só no JSON local sem quebrar nada.
async function ensurePixConfigTable() {
  if (!turso) return false
  try {
    await turso.execute('CREATE TABLE IF NOT EXISTS pix_config (id TEXT PRIMARY KEY, data TEXT)')
    return true
  } catch { return false }
}
async function gravarPixConfigTurso(cfg) {
  if (!turso) return false
  try {
    await ensurePixConfigTable()
    await turso.execute({ sql: 'INSERT OR REPLACE INTO pix_config (id, data) VALUES (?, ?)', args: ['atual', JSON.stringify(cfg)] })
    return true
  } catch (e) { console.error('[pix-config] falha ao gravar no Turso:', (e && e.message) || e); return false }
}
// Lê SEMPRE do Turso primeiro (tempo real p/ o site); fallback: JSON local.
// Retorna { config, fonte: 'turso'|'json' }.
async function lerPixConfigTempoReal() {
  if (turso) {
    try {
      await ensurePixConfigTable()
      const r = await turso.execute({ sql: 'SELECT data FROM pix_config WHERE id = ?', args: ['atual'] })
      const row = r && r.rows && r.rows[0]
      const raw = row && (row.data !== undefined ? row.data : row[0])
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        return { config: { ...defaultPixConfig(), ...parsed }, fonte: 'turso' }
      }
    } catch (e) { console.error('[pix-config] falha ao ler do Turso, usando JSON local:', (e && e.message) || e) }
  }
  return { config: loadPixConfig(), fonte: 'json' }
}
// --- PORTFÓLIO SITES CRIADOS (backend/data/portfolio.json + backend/uploads/portfolio) ---
// Item: { id, titulo, cliente_nome, descricao, tipo: 'foto'|'video', url_arquivo, link_site, data }
function ensureUploadsPortfolioDir() {
  if (!fs.existsSync(UPLOADS_PORTFOLIO_DIR)) fs.mkdirSync(UPLOADS_PORTFOLIO_DIR, { recursive: true })
}
function ensurePortfolioFile() {
  const dir = path.dirname(PORTFOLIO_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(PORTFOLIO_FILE)) fs.writeFileSync(PORTFOLIO_FILE, '[]', 'utf-8')
}
function readPortfolio() {
  ensurePortfolioFile()
  try {
    const raw = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function writePortfolio(list) {
  ensurePortfolioFile()
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(list, null, 2), 'utf-8')
}
function publicPortfolio(list) {
  return (Array.isArray(list) ? list : []).map((p) => ({
    id: p.id,
    titulo: p.titulo || p.nome || '',
    cliente_nome: p.cliente_nome || p.cliente || '',
    descricao: p.descricao || '',
    tipo: p.tipo === 'video' ? 'video' : 'foto',
    url_arquivo: p.url_arquivo || p.link || '',
    link_site: p.link_site || p.link || '',
    data: p.data || p.criadoEm || null,
  }))
}
// --- SUPPORT BOT FAQ (backend/data/support-options.json) ---
// Item: { id, pergunta, resposta, ordem, ativo, criadoEm }
const SUPPORTOPTIONS_FILE = path.join(__dirname, 'data', 'support-options.json')
function defaultSupportOptions() {
  const agora = new Date().toISOString()
  return [
    { id: 'faq-precos', pergunta: 'Quais são os planos e valores?', resposta: 'Planos: Start, Pro e Premium. Valores atuais no checkout — pagamento só via Pix.', ordem: 1, ativo: true, criadoEm: agora },
    { id: 'faq-fatura', pergunta: 'Quando vence a fatura?', resposta: 'Fatura vence todo dia 10. Só via PIX. Acesse /dashboard → Pagamento, escaneie o QR ou use o copia e cola.', ordem: 2, ativo: true, criadoEm: agora },
    { id: 'faq-pagar', pergunta: 'Como pagar?', resposta: 'Pagamento é só via PIX (QR Code + copia e cola na tela de pagamento). Após pagar, o admin confirma e seu site entra em desenvolvimento (prazo de 5 dias).', ordem: 3, ativo: true, criadoEm: agora },
    { id: 'faq-prazo', pergunta: 'Qual o prazo de entrega?', resposta: 'Básico 5 dias, Profissional 7 dias, Premium 10 dias após pagamento.', ordem: 4, ativo: true, criadoEm: agora },
    { id: 'faq-reembolso', pergunta: 'Posso pedir reembolso?', resposta: 'Sim, até 7 dias após pagamento se site ainda não foi para o ar. Fale com suporte.', ordem: 5, ativo: true, criadoEm: agora },
    { id: 'faq-humano', pergunta: 'Como falo com humano?', resposta: 'Digite "falar com humano" ou aguarde 3 tentativas sem solução — te conecto no WhatsApp.', ordem: 6, ativo: true, criadoEm: agora },
  ]
}
function ensureSupportOptionsFile() {
  const dir = path.dirname(SUPPORTOPTIONS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(SUPPORTOPTIONS_FILE)) fs.writeFileSync(SUPPORTOPTIONS_FILE, JSON.stringify(defaultSupportOptions(), null, 2), 'utf-8')
}
function readSupportOptions() {
  ensureSupportOptionsFile()
  try {
    const raw = JSON.parse(fs.readFileSync(SUPPORTOPTIONS_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function writeSupportOptions(list) {
  ensureSupportOptionsFile()
  fs.writeFileSync(SUPPORTOPTIONS_FILE, JSON.stringify(list, null, 2), 'utf-8')
}
function publicSupportOption(o) {
  return { id: o.id, pergunta: o.pergunta, resposta: o.resposta, ordem: Number(o.ordem) || 0, ativo: o.ativo !== false }
}
// --- PLANOS (backend/data/planos.json, CRUD no ConfigPixPayment) ---
// Item: { id, nome, preco, descricao, recursos[], destaque, ativo, ordem, criadoEm }
// Seed 100% dinâmico: preços vêm de data/pix-config.json (NUNCA fixos no código).
function defaultPlanos() {
  const cfg = loadPixConfig()
  const agora = new Date().toISOString()
  const num = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return [
    { id: 'plano-start', nome: 'Start', preco: num(cfg.valorStart), descricao: '1 página', recursos: ['1 página', 'Design responsivo', 'Entrega em 5 dias'], destaque: false, ativo: true, ordem: 1, criadoEm: agora },
    { id: 'plano-pro', nome: 'Pro', preco: num(cfg.valorPro), descricao: 'até 5 páginas + WhatsApp', recursos: ['Até 5 páginas', 'Botão WhatsApp', 'Entrega em 7 dias'], destaque: true, ativo: true, ordem: 2, criadoEm: agora },
    { id: 'plano-premium', nome: 'Premium', preco: num(cfg.valorPremium), descricao: 'completo + SEO', recursos: ['Páginas ilimitadas', 'SEO otimizado', 'Suporte 30 dias'], destaque: false, ativo: true, ordem: 3, criadoEm: agora },
  ]
}
function ensurePlanosFile() {
  const dir = path.dirname(PLANOS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(PLANOS_FILE)) fs.writeFileSync(PLANOS_FILE, JSON.stringify(defaultPlanos(), null, 2), 'utf-8')
}
function readPlanos() {
  ensurePlanosFile()
  try {
    const raw = JSON.parse(fs.readFileSync(PLANOS_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function writePlanos(list) {
  ensurePlanosFile()
  fs.writeFileSync(PLANOS_FILE, JSON.stringify(list, null, 2), 'utf-8')
}
function normRecursos(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  return String(v ?? '').split(/[,\n;]/).map((x) => String(x).trim()).filter(Boolean)
}
function publicPlano(p) {
  return {
    id: p.id, nome: p.nome, preco: Number(String(p.preco ?? '').replace(',', '.')) || 0,
    descricao: p.descricao || '', recursos: normRecursos(p.recursos),
    destaque: p.destaque === true || p.destaque === 'true',
    ativo: p.ativo !== false && p.ativo !== 'false',
    ordem: Number(p.ordem) || 0,
  }
}
function publicPlanos(list) {
  const out = (Array.isArray(list) ? list : []).map(publicPlano)
  out.sort((a, b) => a.ordem - b.ordem)
  return out
}
function writePlanosFile(list) {
  return writePlanos(list)
}
// --- PAGAMENTOS PENDENTES (backend/data/pagamentos-pendentes.json) ---
// Temporários do POST /api/pix/gerar: {id, valor, copiaECola, planoId, status:'pendente', createdAt, expiraEm}
function ensurePagamentosPendentesFile() {
  const dir = path.dirname(PAGAMENTOS_PENDENTES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(PAGAMENTOS_PENDENTES_FILE)) fs.writeFileSync(PAGAMENTOS_PENDENTES_FILE, '[]', 'utf-8')
}
function readPagamentosPendentes() {
  ensurePagamentosPendentesFile()
  try {
    const raw = JSON.parse(fs.readFileSync(PAGAMENTOS_PENDENTES_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function writePagamentosPendentes(list) {
  ensurePagamentosPendentesFile()
  fs.writeFileSync(PAGAMENTOS_PENDENTES_FILE, JSON.stringify(list, null, 2), 'utf-8')
}
function salvarPagamentoPendente({ valor, copiaECola, planoId }) {
  const list = readPagamentosPendentes()
  const agora = new Date()
  const expiraEm = new Date(agora.getTime() + 30 * 60 * 1000).toISOString()
  const item = {
    id: 'pix-' + Date.now(),
    valor: Number(valor),
    copiaECola: String(copiaECola || ''),
    planoId: planoId ? String(planoId) : null,
    status: 'pendente',
    createdAt: agora.toISOString(),
    expiraEm,
  }
  list.push(item)
  // Mantém só os últimos 100 para o arquivo não crescer sem limite
  while (list.length > 100) list.shift()
  writePagamentosPendentes(list)
  return item
}
const uploadPortfolio = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      ensureUploadsPortfolioDir()
      cb(null, UPLOADS_PORTFOLIO_DIR)
    },
    filename: (req, file, cb) => {
      const base = String(file.originalname || 'arquivo')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-').slice(-60)
      cb(null, Date.now() + '-' + base)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype || '')) return cb(null, true)
    cb(new Error('Tipo de arquivo inválido. Envie foto (image/*) ou vídeo (video/*).'))
  },
})
function isSenhaFraca(senha) {
  const norm = senha.toLowerCase().trim()
  const comuns = [
    '1234',
    '12345',
    '123456',
    '12345678',
    '123456789',
    '0000',
    '111111',
    '123123',
    'password',
    'password123',
    'qwerty',
    'abc123',
    'abcd1234',
    'admin',
    'letmein',
    'senha',
    'senha123',
    'senha1234',
    '654321',
    '987654321',
    '1234qwer',
  ]
  if (comuns.includes(norm)) return true
  if (senha.length < 8) return true
  if (/^\d+$/.test(senha)) return true
  if (/^(.)\1+$/.test(senha)) return true
  const seq = '0123456789abcdefghijklmnopqrstuvwxyz'
  const rev = seq.split('').reverse().join('')
  if (seq.includes(norm) || rev.includes(norm)) return true
  const temLetra = /[a-zA-Z]/.test(senha)
  const temNumero = /\d/.test(senha)
  if (!temLetra || !temNumero) return true
  return false
}

function normalizarLinkFinal(v) {
  let s = String(v || '').trim().toLowerCase()
  if (!s) return null
  if (!/^https?:\/\//.test(s)) s = 'https://' + s
  return s
}

// Espelha linkFinal/link_final para compat (spec usa link_final, legado usa linkFinal)
// e NORMALIZA o status para o enum canônico: ['pendente','em_andamento','concluido','cancelado']
function publicProjeto(p) {
  const link = p.link_final || p.linkFinal || null
  return { ...p, status: normalizarStatus(p.status), linkFinal: link, link_final: link }
}

// --- STATUS CANÔNICO DE PROJETOS ---
// Enum oficial da tabela projetos: ['pendente','em_andamento','concluido','cancelado']
// Valores legados (rascunho, aguardando_pagamento, PAGAMENTO_CONCLUIDO,
// EM_DESENVOLVIMENTO, NO_AR...) são normalizados abaixo — nunca quebram leitura.
const STATUS_VALIDOS = ['pendente', 'em_andamento', 'concluido', 'cancelado']
const STATUS_LEGADO_PARA_NOVO = {
  rascunho: 'pendente',
  aguardando_pagamento: 'pendente',
  pagamento_concluido: 'em_andamento',
  em_desenvolvimento: 'em_andamento',
  em_obra: 'em_andamento',
  finalizando: 'em_andamento',
  em_analise: 'em_andamento',
  no_ar: 'concluido',
}
function normalizarStatus(s) {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return 'pendente'
  if (STATUS_VALIDOS.includes(t)) return t
  if (STATUS_LEGADO_PARA_NOVO[t]) return STATUS_LEGADO_PARA_NOVO[t]
  return 'pendente'
}
// Ativos = tudo que NÃO é concluído/cancelado (inclui legado aguardando_pagamento).
function isProjetoAtivo(p) {
  const s = normalizarStatus(p && p.status)
  return s === 'pendente' || s === 'em_andamento'
}
function isProjetoConcluido(p) {
  return normalizarStatus(p && p.status) === 'concluido'
}
// Migração em disco (roda no boot): converte status legados para o canônico.
// Concluído nunca mais aparece em ativos.
function migrarProjetosParaStatusCanonico() {
  const projects = readProjects()
  let alterados = 0
  for (const p of projects) {
    const novo = normalizarStatus(p.status)
    if (p.status !== novo) {
      p.status = novo
      alterados++
    }
    if (novo === 'concluido' && !p.concluidoEm) {
      p.concluidoEm = p.dataInicioDev || p.criadoEm || new Date().toISOString()
      alterados++
    }
  }
  if (alterados > 0) {
    writeProjects(projects)
    console.log(`[Migração] ${alterados} ajuste(s): status legados -> enum canônico`)
  }
}

function gerarToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' })
}
const COOKIE_OPTS = { httpOnly: false, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' }

function extractToken(req) {
  // 1) Authorization: Bearer <token> (ou token puro)
  const header = req.headers.authorization || req.headers.Authorization
  let fromHeader = null
  if (header) {
    if (String(header).startsWith('Bearer ')) fromHeader = String(header).split(' ')[1]
    else fromHeader = String(header).trim() || null
  }
  // 2) ?token= na URL (link "Painel Admin" do frontend)
  const fromQuery = (req.query && req.query.token) ? String(req.query.token) : null
  // 3) x-access-token (raw ou Bearer)
  const xHead = req.headers['x-access-token']
  let fromX = null
  if (xHead) {
    if (String(xHead).startsWith('Bearer ')) fromX = String(xHead).split(' ')[1]
    else fromX = String(xHead).trim() || null
  }
  // 4) Cookie (primário em same-origin)
  const fromCookie = req.cookies?.token || req.cookies?.authToken || req.cookies?.adminToken || req.cookies?.session || null
  return { fromCookie, fromHeader, fromQuery, fromX, token: fromCookie || fromHeader || fromQuery || fromX || null }
}

function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const fromBearer = authHeader.startsWith('Bearer ')? authHeader.split(' ')[1] : null;
  const fromCookie = req.cookies?.token || req.cookies?.admintoken || req.cookies?.jwt || null;
  const fromQuery = req.query?.token || null;
  const fromX = req.headers['x-access-token'] || null;
  const token = fromBearer || fromCookie || fromQuery || fromX;
  if (!token) {
    console.log('[auth-debug] FALHOU em ' + req.path);
    return res.status(401).json({ error: 'token nao fornecido' });
  }
  try {
    const SECRET = process.env.JWT_SECRET || 'nick_secret_super_2024';
    const decoded = require('jsonwebtoken').verify(token, SECRET);
    req.userId = decoded.id || decoded.userId || decoded._id;
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'token invalido: ' + e.message });
  }
}
const autenticaToken = autenticarToken;
const authMiddleware = autenticarToken;
const authenticarToken = autenticarToken;

function isAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'nao autenticado' });
  const role = req.user.role || (req.user.isAdmin? 'admin' : null);
  if (role!== 'admin') return res.status(403).json({ error: 'Acesso negado - role: ' + (role || 'sem role') });
  next();
}







app.get('/', (req, res) => {
  res.json({ ok: true, msg: 'Empresas Nick API online' })
})

app.get('/me', autenticarToken, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const users = readUsers()
  const user = users.find((u) => u.id === req.user.id)
  if (!user) {
    return res.status(401).json({ erro: 'Usuário não encontrado.' })
  }
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...publicUser } = user
  const meusProjetos = readProjects().filter((p) => p.userId === req.user.id).map(publicProjeto)
  const comLink = meusProjetos.find((p) => p.link_final || p.linkFinal)
  res.json({ user: publicUser, projetos: meusProjetos, link_final: comLink ? (comLink.link_final || comLink.linkFinal) : null })
})

// Alias oficial: GET /api/me (mesma base de /me, sem cache — AuthContext usa no boot)
app.get('/api/me', autenticarToken, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const users = readUsers()
  const user = users.find((u) => u.id === req.user.id)
  if (!user) {
    return res.status(401).json({ erro: 'Usuário não encontrado.' })
  }
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...publicUser } = user
  const meusProjetos = readProjects().filter((p) => p.userId === req.user.id).map(publicProjeto)
  const comLink = meusProjetos.find((p) => p.link_final || p.linkFinal)
  res.json({ user: publicUser, projetos: meusProjetos, link_final: comLink ? (comLink.link_final || comLink.linkFinal) : null })
})

app.get('/users', autenticarToken, isAdmin, (req, res) => {
  const users = readUsers().map((u) => ({ id: u.id, nome: u.nome, email: u.email, criadoEm: u.criadoEm || u.createdAt, createdAt: u.createdAt || u.criadoEm, role: u.role }))
  res.json(users)
})

app.post('/cadastro', async (req, res) => {
  let { nome, email, senha } = req.body
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Preencha nome, email e senha.' })
  }
  email = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' })
  }
  if (senha.length < 8) {
    return res.status(400).json({ erro: 'Senha fraca: use no mínimo 8 caracteres.' })
  }
  if (isSenhaFraca(senha)) {
    return res.status(400).json({ erro: 'Senha muito fraca. Não use sequências como 1234 ou senha1234. Use letras + números.' })
  }
  const users = readUsers()
  if (users.find((u) => u.email.toLowerCase() === email)) {
    return res.status(400).json({ erro: 'Email já cadastrado' })
  }
  const senhaHash = await bcrypt.hash(senha, 10)
  const role = email === 'admin@empresasnick.com' ? 'admin' : 'user'
  const novo = {
    id: Date.now().toString(),
    nome: String(nome).trim(),
    email,
    senhaHash,
    role,
    createdAt: new Date().toISOString(),
    criadoEm: new Date().toISOString(),
  }
  users.push(novo)
  writeUsers(users)
  const { senhaHash: _, resetToken: _rt, resetTokenExpiry: _rte, ...publicUser } = novo
  const token = gerarToken({ id: novo.id, email: novo.email, role: novo.role })
  res.cookie('token', token, COOKIE_OPTS)
  return res.status(201).json({ msg: 'Cadastro realizado com sucesso!', user: publicUser, token })
})

app.post('/login', async (req, res) => {
  let { email, senha } = req.body
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Preencha e-mail e senha.' })
  }
  email = email.trim().toLowerCase()
  const users = readUsers()
  const user = users.find((u) => u.email.toLowerCase() === email)
  if (!user) {
    return res.status(404).json({ erro: 'Usuário não encontrado' })
  }
  const ok = await bcrypt.compare(senha, user.senhaHash)
  if (!ok) {
    return res.status(401).json({ erro: 'Senha incorreta' })
  }
  if (!user.role) {
    user.role = user.email === 'admin@empresasnick.com' ? 'admin' : 'user'
    if (!user.createdAt) user.createdAt = user.criadoEm || new Date().toISOString()
    if (!user.criadoEm) user.criadoEm = user.createdAt
    writeUsers(users)
  }
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...publicUser } = user
  const token = gerarToken({ id: user.id, email: user.email, role: user.role })
  res.cookie('token', token, COOKIE_OPTS)
  return res.json({ msg: 'Login realizado com sucesso!', user: publicUser, token })
})
// Aliases oficiais: POST /api/login e POST /api/auth/login (mesma base de /login)
async function loginAliasHandler(req, res) {
  let { email, senha } = req.body || {}
  if (!email || !senha) return res.status(400).json({ erro: 'Preencha e-mail e senha.', error: 'Preencha e-mail e senha.' })
  email = String(email).trim().toLowerCase()
  const users = readUsers()
  const user = users.find((u) => String(u.email || '').toLowerCase() === email)
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado', error: 'Usuário não encontrado' })
  const ok = await bcrypt.compare(String(senha), user.senhaHash)
  if (!ok) return res.status(401).json({ erro: 'Senha incorreta', error: 'Senha incorreta' })
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...publicUser } = user
  const token = gerarToken({ id: user.id, email: user.email, role: user.role })
  res.cookie('token', token, COOKIE_OPTS)
  return res.json({ msg: 'Login realizado com sucesso!', user: publicUser, token })
}
app.post('/api/login', loginAliasHandler)
app.post('/api/auth/login', loginAliasHandler)

app.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' })
  return res.json({ msg: 'Deslogado' })
})
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' })
  return res.json({ msg: 'Deslogado' })
})
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { path: '/' })
  return res.json({ msg: 'Deslogado' })
})

// --- ESQUECEU A SENHA (Gmail SMTP via nodemailer) ---
// POST /api/forgot-password { email } — sempre mensagem genérica (não revela se existe).
// Usa backend/data/users.json (sem SQL). Token de 15 min em resetToken/resetTokenExpiry.
async function forgotPasswordHandler(req, res) {
  console.log('CHEGOU NO BACKEND', req.body)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const GENERICA = 'Se o email existir, enviamos o link para seu email'
  const email = String((req.body && req.body.email) || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ message: GENERICA })
  const users = readUsers()
  const user = users.find((u) => String(u.email || '').toLowerCase() === email)
  if (!user) return res.json({ message: GENERICA })
  const token = crypto.randomBytes(32).toString('hex')
  user.resetToken = token
  user.resetTokenExpiry = Date.now() + 15 * 60 * 1000
  writeUsers(users)
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/resetar-senha?token=${token}`
  if (isEmailConfigured()) {
    try {
      await sendEmail({
        to: email,
        subject: 'Recuperação de senha - Empresas Nick',
        html: `
          <div style="font-family:Arial; max-width:600px; margin:0 auto; padding:20px; border:1px solid #eee; border-radius:12px">
            <h2 style="color:#2563eb">Recuperação de senha</h2>
            <p>Olá! Você solicitou para trocar sua senha.</p>
            <p>Clique no botão abaixo (válido por 15 minutos):</p>
            <a href="${link}" style="display:inline-block; background:#2563eb; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold">Trocar minha senha</a>
            <p style="margin-top:20px; color:#666; font-size:14px">Se não foi você, ignore este email.</p>
            <p style="color:#666; font-size:12px">Link: ${link}</p>
          </div>
        `,
      })
    } catch {
      return res.status(500).json({ erro: 'Falha ao enviar email. Tente de novo.' })
    }
    return res.json({ message: GENERICA })
  }
  // Sem EMAIL_USER/EMAIL_PASS (dev): não há envio; expõe o link só para teste local
  return res.json({ message: GENERICA, devResetLink: link })
}
app.post('/api/forgot-password', forgotPasswordHandler)
app.post('/api/auth/forgot-password', forgotPasswordHandler)

// POST /api/reset-password { token, novaSenha } — troca senha com bcrypt, token 1 uso.
async function resetPasswordHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const token = String((req.body && req.body.token) || '').trim()
  const novaSenha = String((req.body && req.body.novaSenha) || '')
  if (!token || !novaSenha) return res.status(400).json({ error: 'Token inválido ou expirado' })
  if (novaSenha.length < 6) return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' })
  const users = readUsers()
  const user = users.find((u) => u.resetToken === token && Number(u.resetTokenExpiry) > Date.now())
  if (!user) return res.status(400).json({ error: 'Token inválido ou expirado' })
  user.senhaHash = await bcrypt.hash(novaSenha, 10)
  user.resetToken = null
  user.resetTokenExpiry = null
  writeUsers(users)
  return res.json({ message: 'Senha alterada com sucesso' })
}
app.post('/api/reset-password', resetPasswordHandler)
app.post('/api/auth/reset-password', resetPasswordHandler)

// --- PROJETOS ---
// Model: { id, userId, nomeCliente, emailCliente, descricaoSite, valor, status, linkFinal, criadoEm, concluidoEm, dataEntrega }
// status: enum ['pendente','em_andamento','concluido','cancelado'] (legados normalizados via normalizarStatus)
app.post('/api/projetos', autenticarToken, async (req, res) => {
  const { descricaoSite } = req.body
  if (!descricaoSite || !String(descricaoSite).trim()) {
    return res.status(400).json({ erro: 'Descreva como quer seu site.' })
  }
  const users = readUsers()
  const user = users.find((u) => u.id === req.user.id)
  if (!user) return res.status(401).json({ erro: 'Usuário não encontrado.' })
  const projects = readProjects()
  const novo = {
    id: Date.now().toString(),
    userId: req.user.id,
    nomeCliente: user.nome,
    emailCliente: user.email,
    descricaoSite: String(descricaoSite).trim(),
    valor: null,
    status: 'pendente',
    linkFinal: null,
    criadoEm: new Date().toISOString(),
  }
  projects.push(novo)
  writeProjects(projects)
  return res.status(201).json({ msg: 'Projeto criado!', projeto: novo })
})

app.get('/api/projetos/me', autenticarToken, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const projects = readProjects().filter((p) => p.userId === req.user.id).map(publicProjeto)
  res.json(projects)
})

app.get('/api/projetos', autenticarToken, isAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const f = String(req.query.filtro || req.query.status || 'todos')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  let list = readProjects()
  if (f === 'ativos') list = list.filter(isProjetoAtivo)
  else if (f === 'concluidos' || f === 'concluido') list = list.filter(isProjetoConcluido)
  res.json(list.map(publicProjeto))
})

// Alias oficial do painel admin (3001): GET /api/admin/projetos[?filtro=ativos|concluidos|todos]
function listarProjetosAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const f = String(req.query.filtro || req.query.status || 'todos')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  let list = readProjects()
  if (f === 'ativos') list = list.filter(isProjetoAtivo)
  else if (f === 'concluidos' || f === 'concluido') list = list.filter(isProjetoConcluido)
  const out = list.map(publicProjeto)
  console.log(`[admin] GET ${req.path} filtro=${f} -> ${out.length} projeto(s) (${(req.user && req.user.email) || '?'})`)
  res.json(out)
}
app.get('/api/admin/projetos', autenticarToken, isAdmin, listarProjetosAdmin)
// Alias em inglês: GET /api/admin/projects (mesma base de /api/admin/projetos)
app.get('/api/admin/projects', autenticarToken, isAdmin, listarProjetosAdmin)

// DELETE /api/admin/projetos/:id -> deleta UM projeto do histórico (só admin)
app.delete('/api/admin/projetos/:id', autenticarToken, isAdmin, (req, res) => {
  const projects = readProjects()
  const idx = projects.findIndex((p) => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ erro: 'Projeto não encontrado' })
  const [removido] = projects.splice(idx, 1)
  writeProjects(projects)
  res.json({ msg: 'Projeto excluído do histórico.', projeto: publicProjeto(removido) })
})

// DELETE /api/admin/projetos -> deleta TODOS (zerar histórico) (só admin)
app.delete('/api/admin/projetos', autenticarToken, isAdmin, (req, res) => {
  const projects = readProjects()
  const total = projects.length
  writeProjects([])
  res.json({ msg: `Histórico zerado! ${total} projeto(s) excluído(s).`, excluidos: total })
})

// POST /api/admin/projetos/delete-many { ids: [] } -> deleta selecionados (só admin)
app.post('/api/admin/projetos/delete-many', autenticarToken, isAdmin, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : []
  if (!ids.length) return res.status(400).json({ erro: 'Informe ids: [..] para excluir.' })
  const projects = readProjects()
  const restantes = projects.filter((p) => !ids.includes(String(p.id)))
  const excluidos = projects.length - restantes.length
  writeProjects(restantes)
  res.json({ msg: `${excluidos} projeto(s) excluído(s) do histórico.`, excluidos })
})

// GET /admin/sites -> lista todos os sites criados (portfólio) (só admin).
// Rota oficial do clique "Portfólio Sites Criados"; mesma base do GET /api/portfolio público.
app.get('/admin/sites', autenticarToken, isAdmin, (req, res) => {
  const list = readPortfolio()
  list.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0))
  res.json(list.map((p) => ({
    ...p,
    nome: p.titulo,
    cliente: p.cliente_nome,
    link: p.link_site || p.url_arquivo,
    status: 'publicado',
  })))
})

// GET /api/admin/sites -> alias (só admin).
app.get('/api/admin/sites', autenticarToken, isAdmin, (req, res) => {
  const list = readPortfolio()
  list.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0))
  res.json(list.map((p) => ({
    ...p,
    nome: p.titulo,
    cliente: p.cliente_nome,
    link: p.link_site || p.url_arquivo,
    status: 'publicado',
  })))
})
app.get('/api/portfolio', noCache, (req, res) => {
  const list = readPortfolio() || []
  list.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0))
  res.json(publicPortfolio(list))
})
app.get('/api/portfolio/:id', noCache, (req, res) => {
  const list = readPortfolio() || []
  const item = list.find((p) => String(p.id) === String(req.params.id))
  if (!item) return res.status(404).json({ erro: 'Item não encontrado no portfólio.', error: 'Item não encontrado' })
  const found = publicPortfolio([item])[0]
  res.json(found)
})

// POST /api/admin/portfolio -> upload foto/vídeo (multer, até 50MB) (só admin)
// Form-data: arquivo (image/*|video/*), titulo, cliente_nome, descricao, link_site
app.post('/api/admin/portfolio', autenticarToken, isAdmin, (req, res) => {
  uploadPortfolio.single('arquivo')(req, res, (err) => {
    if (err) return res.status(400).json({ erro: err.message || 'Falha no upload.' })
    if (!req.file) return res.status(400).json({ erro: 'Envie o arquivo (foto ou vídeo) no campo "arquivo".' })
    const body = req.body || {}
    const titulo = String(body.titulo || '').trim()
    if (!titulo) {
      try { fs.unlinkSync(req.file.path) } catch {}
      return res.status(400).json({ erro: 'Informe o título.' })
    }
    const mime = req.file.mimetype || ''
    const item = {
      id: Date.now().toString(),
      titulo,
      cliente_nome: String(body.cliente_nome || '').trim(),
      descricao: String(body.descricao || '').trim(),
      tipo: mime.startsWith('video/') ? 'video' : 'foto',
      url_arquivo: '/uploads/portfolio/' + req.file.filename,
      link_site: String(body.link_site || '').trim(),
      data: new Date().toISOString(),
    }
    const list = readPortfolio()
    list.push(item)
    writePortfolio(list)
    res.status(201).json({ msg: 'Projeto publicado no portfólio!', item })
  })
})

// DELETE /api/admin/portfolio/:id -> remove item + arquivo (só admin)
app.delete('/api/admin/portfolio/:id', autenticarToken, isAdmin, (req, res) => {
  const list = readPortfolio()
  const idx = list.findIndex((p) => String(p.id) === String(req.params.id))
  if (idx === -1) return res.status(404).json({ erro: 'Item não encontrado no portfólio.' })
  const [removido] = list.splice(idx, 1)
  writePortfolio(list)
  if (removido && removido.url_arquivo) {
    const nome = String(removido.url_arquivo).split('/').pop()
    try { fs.unlinkSync(path.join(UPLOADS_PORTFOLIO_DIR, nome)) } catch {}
  }
  res.json({ msg: 'Item excluído do portfólio.', item: removido })
})

app.get('/api/projetos/:id', autenticarToken, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const project = readProjects().find((p) => p.id === req.params.id)
  if (!project) return res.status(404).json({ erro: 'Projeto não encontrado' })
  if (project.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' })
  }
  res.json(publicProjeto(project))
})

app.put('/api/projetos/:id', autenticarToken, (req, res) => {
  const { valor, status, linkFinal } = req.body
  const link_final = req.body.link_final !== undefined ? req.body.link_final : linkFinal
  const projects = readProjects()
  const idx = projects.findIndex((p) => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ erro: 'Projeto não encontrado' })
  const isOwner = projects[idx].userId === req.user.id
  const isAdminUser = req.user.role === 'admin'
  if (!isOwner && !isAdminUser) {
    return res.status(403).json({ erro: 'Acesso negado' })
  }
  // valor (checkout - cliente, só Pix; valor vem de /api/pix-config, qualquer valor > 0)
  if (valor !== undefined) {
    const v = Number(valor)
    if (!Number.isFinite(v) || v <= 0) {
      return res.status(400).json({ erro: 'Valor inválido. Use um valor maior que zero.' })
    }
    projects[idx].valor = v
    // Escolha de plano mantém o projeto ATIVO como pendente (aguardando pagamento)
    if (normalizarStatus(projects[idx].status) === 'pendente') projects[idx].status = 'pendente'
  }
  // status e linkFinal (admin)
  if (status !== undefined || link_final !== undefined) {
    if (!isAdminUser) return res.status(403).json({ erro: 'Acesso negado - só admin altera status/link' })
    if (status !== undefined) {
      const t = String(status).trim().toLowerCase()
      const legadoAceito = Object.keys(STATUS_LEGADO_PARA_NOVO)
      if (!STATUS_VALIDOS.includes(t) && !legadoAceito.includes(t)) {
        return res.status(400).json({ erro: 'Status inválido. Use: ' + STATUS_VALIDOS.join(', ') })
      }
      projects[idx].status = normalizarStatus(t)
      // Prazo 5 dias: ao entrar em desenvolvimento, marca início
      if (projects[idx].status === 'em_andamento' && !projects[idx].dataInicioDev) {
        projects[idx].dataInicioDev = new Date().toISOString()
      }
      if (projects[idx].status === 'concluido' && !projects[idx].concluidoEm) {
        projects[idx].concluidoEm = new Date().toISOString()
      }
      if (projects[idx].status === 'concluido' && !projects[idx].dataEntrega) {
        projects[idx].dataEntrega = new Date().toISOString()
      }
    }
    if (link_final !== undefined) {
      const link = normalizarLinkFinal(link_final)
      projects[idx].linkFinal = link
      projects[idx].link_final = link
    }
  }
  if (valor === undefined && status === undefined && link_final !== undefined && projects[idx].linkFinal === undefined) {
    return res.status(400).json({ erro: 'Nada para atualizar' })
  }
  if (valor === undefined && status === undefined && link_final === undefined) {
    return res.status(400).json({ erro: 'Nada para atualizar' })
  }
  writeProjects(projects)
  res.json({ msg: 'Projeto atualizado!', projeto: publicProjeto(projects[idx]) })
})

// --- CONTATOS / MENSAGENS (persistência em disco: backend/data/*.json) ---
function soDigitos(v) {
  return String(v || '').replace(/\D/g, '')
}
function normalizarJid(jidOuFone) {
  const s = String(jidOuFone || '').trim()
  if (s.includes('@')) return s
  return soDigitos(s) + '@s.whatsapp.net'
}
function salvarMensagem({ jid, role, text, at }) {
  const map = readMessagesMap()
  const msg = {
    role: role || 'user',
    text: String(text ?? ''),
    at: at || new Date().toISOString(),
  }
  if (!map[jid]) map[jid] = []
  map[jid].push(msg)
  if (map[jid].length > 200) map[jid] = map[jid].slice(-200)
  // salva em disco imediatamente a cada mensagem nova
  writeMessagesMap(map)
  // atualiza ultima_mensagem do contato
  try {
    const contacts = readContacts()
    const idx = contacts.findIndex(c => c.jid === jid || c.numero === soDigitos(jid))
    if (idx !== -1) {
      contacts[idx].ultima_mensagem = String(text).slice(0, 120)
      writeContacts(contacts)
    }
  } catch {}
  return msg
}
function upsertContato({ nome, numero, jid }) {
  const numeroLimpo = soDigitos(numero || jid || '')
  if (!numeroLimpo) return null
  const jidFinal = jid ? normalizarJid(jid) : numeroLimpo + '@s.whatsapp.net'
  const contacts = readContacts()
  const idx = contacts.findIndex(c => c.jid === jidFinal || c.numero === numeroLimpo)
  if (idx !== -1) {
    if (nome) contacts[idx].nome = String(nome).trim()
    writeContacts(contacts)
    return contacts[idx]
  }
  const novo = {
    id: Date.now().toString(),
    jid: jidFinal,
    nome: String(nome || ('Cliente ' + numeroLimpo.slice(-4))).trim(),
    numero: numeroLimpo,
    foto: '',
    ultima_mensagem: '',
    criado_em: new Date().toISOString(),
  }
  contacts.push(novo)
  writeContacts(contacts)
  return novo
}

// Zap -> painel: msg que o cliente manda no WhatsApp cai no messages.upsert (whatsapp.js)
// e é persistida aqui em disco — messages.json[jid] + garantia em contacts.json.
// Assim ela aparece no Admin (polling) e sobrevive ao F5.
onIncomingMessage(async ({ jid, text, pushName }) => {
  const jidFinal = normalizarJid(jid)
  const dig = soDigitos(jidFinal)
  if (!dig || !text) return
  try {
    const contacts = loadContacts()
    const existe = contacts.find((c) => c.jid === jidFinal || c.numero === dig)
    if (!existe) {
      upsertContato({ nome: pushName || undefined, numero: dig, jid: jidFinal })
    } else if (pushName && String(existe.nome || '') !== pushName) {
      // mantém nome real do Zap se o contato ainda tinha nome genérico
      if (String(existe.nome || '').startsWith('Cliente ')) {
        existe.nome = String(pushName).trim()
        saveContacts(contacts)
      }
    }
  } catch {
  }
  salvarMensagem({ jid: jidFinal, role: 'user', text: String(text), at: new Date().toISOString() })
})

// POST /api/contacts — aceita spec {jid, name} e legado {nome, numero, jid}. Público (chat sem token). Salva em disco na hora.
app.post('/api/contacts', (req, res) => {
  const body = req.body || {}
  const nome = body.nome || body.name
  const numero = body.numero || body.phone || body.jid
  const jid = body.jid
  if (!nome && !numero && !jid) return res.status(400).json({ erro: 'Preencha nome e número.' })
  const contato = upsertContato({ nome, numero, jid })
  if (!contato) return res.status(400).json({ erro: 'Número inválido.' })
  res.json({ msg: 'Contato salvo!', contato })
})

// GET /api/contacts -> retorna contacts.json (persistido em disco, sobrevive ao F5)
app.get('/api/contacts', (req, res) => {
  res.json(readContacts())
})

// legado sem /api (mantido p/ compat)
app.post('/contacts', autenticarToken, (req, res) => {
  const { nome, numero } = req.body
  if (!nome || !numero) return res.status(400).json({ erro: 'Preencha nome e número.' })
  const contato = upsertContato({ nome, numero })
  res.json({ msg: 'Contato salvo!', contato })
})

app.get('/contacts', autenticarToken, (req, res) => {
  res.json(readContacts())
})

app.put('/contacts/:jid', autenticarToken, (req, res) => {
  const contactJid = req.params.jid
  const { nome } = req.body
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' })
  const contacts = readContacts()
  const idx = contacts.findIndex(c => c.jid === contactJid)
  if (idx === -1) return res.status(404).json({ erro: 'Contato não encontrado.' })
  contacts[idx].nome = String(nome).trim()
  writeContacts(contacts)
  res.json({ msg: 'Contato atualizado!', contato: contacts[idx] })
})

// --- MENSAGENS (persistência em disco: backend/data/messages.json = { jid: [...] }) ---
// GET /api/messages?jid=NUMERO -> histórico daquele jid. Sem ?jid -> mapa completo.
app.get('/api/messages', (req, res) => {
  const map = readMessagesMap()
  const q = req.query && req.query.jid ? String(req.query.jid) : ''
  if (!q) return res.json(map)
  const qDig = soDigitos(q)
  const qJid = normalizarJid(q)
  for (const key of Object.keys(map)) {
    if (key === q || key === qJid || soDigitos(key) === qDig) return res.json(map[key])
  }
  return res.json([])
})

// POST /api/messages — recebe spec {jid, text, fromMe} (e legado {jid, role, text, at}).
// Salva em messages.json[jid] na hora E, se fromMe=true, ENVIA pro Zap real via sock existente.
app.post('/api/messages', async (req, res) => {
  const body = req.body || {}
  const jidRaw = body.jid
  const text = body.text
  if (!jidRaw || text === undefined || String(text).trim() === '') return res.status(400).json({ erro: 'Dados incompletos' })
  const jid = normalizarJid(jidRaw)
  let role = body.role
  if (!role) role = body.fromMe ? 'bot' : 'user'
  if (!['user', 'bot', 'admin', 'system'].includes(role)) role = body.fromMe ? 'bot' : 'user'
  if (role === 'admin') role = 'bot'
  // garante contato existente para o jid (aparece no GET /api/contacts após F5)
  try {
    const contacts = readContacts()
    const dig = soDigitos(jid)
    const existe = contacts.find((c) => c.jid === jid || c.numero === dig)
    if (!existe && dig) upsertContato({ numero: dig, jid })
  } catch {}
  const msg = salvarMensagem({ jid, role, text: String(text), at: body.at })
  // Admin -> Zap do cliente: usa o cliente WhatsApp que já existe no projeto
  let sent = false
  if (body.fromMe) {
    try {
      await sendMessage(jid, String(text))
      sent = true
    } catch {
    }
  }
  res.json({ ok: true, message: msg, sent })
})

// legado com auth (mantido p/ compat) — delega para o mesmo mapa em disco
app.post('/messages', autenticarToken, (req, res) => {
  const { jid, role, text, at, fromMe } = req.body || {}
  if (!jid || text === undefined) return res.status(400).json({ erro: 'Dados incompletos' })
  const finalRole = role || (fromMe ? 'bot' : 'user')
  const msg = salvarMensagem({ jid: normalizarJid(jid), role: finalRole === 'admin' ? 'bot' : finalRole, text: String(text), at })
  res.json({ ok: true, message: msg })
})

app.get('/messages/:jid', autenticarToken, (req, res) => {
  const targetJid = normalizarJid(req.params.jid)
  const map = readMessagesMap()
  const dig = soDigitos(targetJid)
  for (const key of Object.keys(map)) {
    if (key === targetJid || soDigitos(key) === dig) return res.json(map[key])
  }
  return res.json([])
})

// Baileys WhatsApp - enviar mensagem grátis (sem auth, para bot usar)
app.post('/api/whatsapp/send', async (req, res) => {
  const { message, text, number, to, phone } = req.body
  const msg = message || text
  let target = number || to || phone || process.env.OWNER_PHONE || process.env.VITE_OWNER_PHONE
  if (!msg) return res.status(400).json({ erro: 'Mensagem vazia' })
  if (!target || String(target).includes('http')) target = process.env.OWNER_PHONE || process.env.VITE_OWNER_PHONE || '5511999999999'
  target = String(target).replace(/\D/g, '')
  if (!target) return res.status(400).json({ erro: 'Telefone não configurado' })
  try {
    await sendMessage(target, msg)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ erro: e.message || 'WhatsApp não conectado - escaneie QR' })
  }
})

// --- SUPPORT BOT FAQ (CRUD) ---
// GET /api/support-options (pública) -> lista ordenada por `ordem`
app.get('/api/support-options', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const list = readSupportOptions().map(publicSupportOption)
  list.sort((a, b) => a.ordem - b.ordem)
  res.json(list)
})

// POST /api/support-options (só admin) { pergunta, resposta, ordem?, ativo? }
app.post('/api/support-options', autenticarToken, isAdmin, (req, res) => {
  const body = req.body || {}
  const pergunta = String(body.pergunta || '').trim()
  const resposta = String(body.resposta || '').trim()
  if (!pergunta || !resposta) return res.status(400).json({ erro: 'Informe pergunta e resposta.' })
  const list = readSupportOptions()
  const maxOrdem = list.reduce((m, o) => Math.max(m, Number(o.ordem) || 0), 0)
  const item = {
    id: Date.now().toString(),
    pergunta,
    resposta,
    ordem: body.ordem !== undefined && body.ordem !== '' ? Number(body.ordem) || 0 : maxOrdem + 1,
    ativo: body.ativo !== undefined ? body.ativo === true || body.ativo === 'true' : true,
    criadoEm: new Date().toISOString(),
  }
  list.push(item)
  writeSupportOptions(list)
  res.status(201).json({ msg: 'Pergunta adicionada!', item: publicSupportOption(item) })
})

// PUT /api/support-options/:id (só admin) { pergunta?, resposta?, ordem?, ativo? }
app.put('/api/support-options/:id', autenticarToken, isAdmin, (req, res) => {
  const body = req.body || {}
  const list = readSupportOptions()
  const idx = list.findIndex((o) => String(o.id) === String(req.params.id))
  if (idx === -1) return res.status(404).json({ erro: 'Pergunta não encontrada.' })
  if (body.pergunta !== undefined) {
    const p = String(body.pergunta).trim()
    if (!p) return res.status(400).json({ erro: 'Pergunta não pode ser vazia.' })
    list[idx].pergunta = p
  }
  if (body.resposta !== undefined) {
    const r = String(body.resposta).trim()
    if (!r) return res.status(400).json({ erro: 'Resposta não pode ser vazia.' })
    list[idx].resposta = r
  }
  if (body.ordem !== undefined && body.ordem !== '') list[idx].ordem = Number(body.ordem) || 0
  if (body.ativo !== undefined) list[idx].ativo = body.ativo === true || body.ativo === 'true'
  writeSupportOptions(list)
  res.json({ msg: 'Pergunta atualizada!', item: publicSupportOption(list[idx]) })
})

// DELETE /api/support-options/:id (só admin)
app.delete('/api/support-options/:id', autenticarToken, isAdmin, (req, res) => {
  const list = readSupportOptions()
  const idx = list.findIndex((o) => String(o.id) === String(req.params.id))
  if (idx === -1) return res.status(404).json({ erro: 'Pergunta não encontrada.' })
  const [removida] = list.splice(idx, 1)
  writeSupportOptions(list)
  res.json({ msg: 'Pergunta excluída.', item: publicSupportOption(removida) })
})

// --- PLANOS (CRUD usado pelo ConfigPixPayment + checkout do site) ---
// GET /api/planos (pública) -> só ativos, ordenados. O site monta os cards daqui.
app.get('/api/planos', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const list = readPlanos().map(publicPlano).filter((p) => p.ativo && p.preco > 0)
  list.sort((a, b) => a.ordem - b.ordem)
  res.json(list)
})

// GET /api/admin/planos (só admin) -> TODOS (ativos e inativos) para gestão
function listarPlanosAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const list = readPlanos().map(publicPlano)
  list.sort((a, b) => a.ordem - b.ordem)
  console.log(`[admin] GET ${req.path} -> ${list.length} plano(s) (${(req.user && req.user.email) || '?'})`)
  res.json(list)
}
app.get('/api/admin/planos', autenticarToken, isAdmin, listarPlanosAdmin)
// Alias em inglês: GET /api/admin/plans (mesma base de /api/admin/planos)
app.get('/api/admin/plans', autenticarToken, isAdmin, listarPlanosAdmin)

// POST /api/planos (só admin) { nome, preco, descricao?, recursos?, destaque?, ativo?, ordem? }
// BOTÃO 2 — ADICIONAR PLANO (seção 4 do ConfigPixPayment). preco via Number.parseFloat
// no front; aqui aceita string "6565"/"65,65" ou number. Depois de salvar, o card do
// site e o QR Pix usam plano.preco automaticamente (valor_do_pix = plano.preco).
function createPlanoHandler(req, res) {
  const body = req.body || {}
  const nome = String(body.nome || '').trim()
  const preco = Number(String(body.preco ?? '').replace(',', '.'))
  if (!nome) return res.status(400).json({ erro: 'Informe o nome do plano.' })
  if (!Number.isFinite(preco) || preco <= 0) return res.status(400).json({ erro: 'Informe um preço maior que zero.' })
  const list = readPlanos()
  const maxOrdem = list.reduce((m, p) => Math.max(m, Number(p.ordem) || 0), 0)
  const item = {
    id: 'plano-' + Date.now(),
    nome,
    preco,
    descricao: String(body.descricao || body.descrição || '').trim(),
    recursos: normRecursos(body.recursos),
    destaque: body.destaque === true || body.destaque === 'true',
    ativo: body.ativo === undefined ? true : (body.ativo === true || body.ativo === 'true'),
    ordem: body.ordem !== undefined && body.ordem !== '' ? Number(body.ordem) || 0 : maxOrdem + 1,
    criadoEm: new Date().toISOString(),
  }
  list.push(item)
  writePlanosFile(list)
  res.status(201).json({ msg: 'Plano criado!', success: true, item: publicPlano(item), list: publicPlanos(list) })
}
// Rota oficial + alias do prompt (/api/admin/planos) — ambos criam plano (só admin)
app.post('/api/planos', autenticarToken, isAdmin, createPlanoHandler)
app.post('/api/admin/planos', autenticarToken, isAdmin, createPlanoHandler)

// PUT /api/planos/:id (só admin) — parcial
function updatePlanoHandler(req, res) {
  const body = req.body || {}
  const list = readPlanos()
  const idx = list.findIndex((p) => String(p.id) === String(req.params.id))
  if (idx === -1) return res.status(404).json({ erro: 'Plano não encontrado.' })
  if (body.nome !== undefined) {
    const n = String(body.nome).trim()
    if (!n) return res.status(400).json({ erro: 'Nome não pode ser vazio.' })
    list[idx].nome = n
  }
  if (body.preco !== undefined) {
    const v = Number(String(body.preco).replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ erro: 'Preço deve ser maior que zero.' })
    list[idx].preco = v
  }
  if (body.descricao !== undefined) list[idx].descricao = String(body.descricao).trim()
  if (body.recursos !== undefined) list[idx].recursos = normRecursos(body.recursos)
  if (body.destaque !== undefined) list[idx].destaque = body.destaque === true || body.destaque === 'true'
  if (body.ativo !== undefined) list[idx].ativo = body.ativo === true || body.ativo === 'true'
  if (body.ordem !== undefined && body.ordem !== '') list[idx].ordem = Number(body.ordem) || 0
  writePlanos(list)
  res.json({ msg: 'Plano atualizado!', item: publicPlano(list[idx]) })
}
app.put('/api/planos/:id', autenticarToken, isAdmin, updatePlanoHandler)
app.put('/api/admin/planos/:id', autenticarToken, isAdmin, updatePlanoHandler)

// DELETE /api/planos/:id (só admin)
function deletePlanoHandler(req, res) {
  const list = readPlanos()
  const idx = list.findIndex((p) => String(p.id) === String(req.params.id))
  if (idx === -1) return res.status(404).json({ erro: 'Plano não encontrado.', error: 'Plano não encontrado.' })
  const [removido] = list.splice(idx, 1)
  writePlanosFile(list)
  res.json({ msg: 'Plano excluído.', success: true, item: publicPlano(removido), list: publicPlanos(list) })
}
app.delete('/api/planos/:id', autenticarToken, isAdmin, deletePlanoHandler)
app.delete('/api/admin/planos/:id', autenticarToken, isAdmin, deletePlanoHandler)

// Webhook WhatsApp: dono responde via WhatsApp "/responder ID mensagem" -> injeta no chat do cliente
app.post('/api/webhook/whatsapp', async (req, res) => {
  const { from, text, message } = req.body
  const raw = text || message || ''
  const m = String(raw).match(/^\/responder\s+(\S+)\s+([\s\S]+)/)
  if (!m) return res.status(400).json({ erro: 'Use /responder ID_DA_CONVERSA mensagem' })
  const [, id, mensagem] = m

  // Auto-criar contato se não existir (para quando mensagem vem de número novo) — salva em disco na hora
  const phoneFrom = soDigitos(from)
  const jidFrom = phoneFrom ? normalizarJid(phoneFrom) : ''
  if (phoneFrom) {
    const contacts = readContacts()
    const contatoExistente = contacts.find(c => c.jid === jidFrom || c.numero === phoneFrom)
    if (!contatoExistente) {
      upsertContato({ numero: phoneFrom, jid: jidFrom })
    }
  }

  // Salvar mensagem do cliente via mesmo mapa em disco (POST /api/messages usa o mesmo)
  const phone = soDigitos(from)
  const targetJid = normalizarJid(phone || jidFrom)
  salvarMensagem({ jid: targetJid, role: 'user', text: mensagem, at: new Date().toISOString() })

  res.json({ ok: true, id, mensagem, from: from || null })
})

// --- PIX (BR Code padrão Banco Central, sem API externa) ---
function pixCampo(id, valor) {
  const v = String(valor)
  return id + String(v.length).padStart(2, '0') + v
}
function pixCrc16(str) {
  let crc = 0xffff
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}
function montarPayloadPix(chave, nome, cidade, valor, txid, tipoChave) {
  // Telefone: normaliza para E.164 com + (ex: 11916572015 -> +5511916572015, 14 chars -> 0114... e campo 26 com 36)
  let chaveFinal = String(chave).trim()
  if (String(tipoChave || '').toLowerCase() === 'telefone') {
    const tel = chaveFinal.replace(/\D/g, '')
    if (tel.length === 11) chaveFinal = '+55' + tel
    else if (tel.length === 13 && tel.startsWith('55')) chaveFinal = '+' + tel
  }
  const gui = pixCampo('00', 'br.gov.bcb.pix') + pixCampo('01', chaveFinal)
  let p = pixCampo('00', '01') + pixCampo('26', gui) + pixCampo('52', '0000') + pixCampo('53', '986')
  // Valor SEMPRE com ponto e 2 casas (ex: 15 -> "15.00" -> campo 54 length 05 = "540515.00")
  const vNum = Number(String(valor).replace(',', '.'))
  if (Number.isFinite(vNum) && vNum > 0) p += pixCampo('54', vNum.toFixed(2))
  const nomeLimpo = String(nome || 'EMPRESAS NICK').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 25) || 'EMPRESAS NICK'
  const cidadeLimpa = String(cidade || 'SAO PAULO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 15) || 'SAO PAULO'
  const tx = String(txid || 'EMPRESASNICK').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'EMPRESASNICK'
  p += pixCampo('58', 'BR') + pixCampo('59', nomeLimpo) + pixCampo('60', cidadeLimpa) + pixCampo('62', pixCampo('05', tx)) + '6304'
  return p + pixCrc16(p)
}

// Lê identidade Pix de backend/data/pix-config.json (não mais do .env)
function gerarPayloadPix(valor, txid, tipoChave) {
  const cfg = loadPixConfig()
  return montarPayloadPix(cfg.chavePix, cfg.nomeRecebedor, cfg.cidadeRecebedor, valor, txid, tipoChave || cfg.tipoChave)
}

// txid sempre com tamanho exato: 8 chars aleatórios (length calculado dinamicamente no EMV)
function gerarTxid() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

// ÚNICA função que gera Pix (modo real e modo teste usam a mesma).
// QR Code gerado aqui no backend. Retorna { copiaECola, qrBase64, valor }.
async function gerarPix(chave, nome, cidade, valor, txid, tipoChave) {
  const payload = montarPayloadPix(chave, nome, cidade, valor, txid, tipoChave)
  const qrBase64 = await QRCode.toDataURL(payload)
  return { copiaECola: payload, qrBase64, valor: Number(valor) }
}

// GET /api/pix-config -> PÚBLICO (site/checkout lê sem token, tempo real).
// Retorna SEMPRE do Turso primeiro (fonte oficial); fallback: JSON local.
app.get('/api/pix-config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const { config: cfg, fonte } = await lerPixConfigTempoReal()
  res.json(cfg)
})

// POST /api/pix-config -> salva config (só admin). Retorna qrPreview: QR do
// /api/pix já refletindo a config salva (gerado aqui no backend).
// BOTÃO 1 — SALVAR CONFIGURAÇÃO (seções 1,2,3 do ConfigPixPayment).
async function savePixConfigHandler(req, res) {
  const body = req.body || {}
  const modoTeste = body.modoTeste === true
  // Fallback 100% dinâmico: usa os valores já salvos em data/pix-config.json,
  // NUNCA número fixo no código.
  const atual = loadPixConfig()
  const num = (v, fb) => {
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : fb
  }
  const cfg = {
    chavePix: String(body.chavePix || '').trim(),
    tipoChave: ['CPF', 'CNPJ', 'Email', 'Telefone', 'Aleatória'].includes(body.tipoChave) ? body.tipoChave : 'Email',
    nomeRecebedor: String(body.nomeRecebedor || 'EMPRESAS NICK').trim() || 'EMPRESAS NICK',
    cidadeRecebedor: String(body.cidadeRecebedor || 'SAO PAULO').trim() || 'SAO PAULO',
    valorStart: num(body.valorStart, atual.valorStart),
    valorPro: num(body.valorPro, atual.valorPro),
    valorPremium: num(body.valorPremium, atual.valorPremium),
    modoTeste,
  }
  if (modoTeste) {
    cfg.valorStart = 1
    cfg.valorPro = 1
    cfg.valorPremium = 1
  }
  if (!cfg.chavePix) return res.status(400).json({ erro: 'Informe a Chave Pix.', error: 'Informe a Chave Pix.' })
  const salva = savePixConfigFile({ ...loadPixConfig(), ...cfg, updatedAt: new Date().toISOString() })
  let qrPreview = null
  try {
    qrPreview = await gerarPix(salva.chavePix, salva.nomeRecebedor, salva.cidadeRecebedor, salva.valorStart, gerarTxid(), salva.tipoChave)
  } catch {
    qrPreview = null
  }
  res.json({ msg: 'Configuração Pix salva!', success: true, config: salva, qrPreview })
}
// Rota oficial + aliases do prompt (/api/pix/config, /api/admin/pix-config) — todos salvam (só admin).
// Toast verde no front confirma; em seguida o front recarrega GET /api/pix-config.
app.post('/api/pix-config', autenticarToken, isAdmin, savePixConfigHandler)
app.post('/api/pix/config', autenticarToken, isAdmin, savePixConfigHandler)
app.post('/api/admin/pix-config', autenticarToken, isAdmin, savePixConfigHandler)
// GET /api/admin/pix-config -> leitura admin em tempo real (mesmo middleware de /api/admin/users).
// Mesma fonte Turso do GET /api/pix-config (que continua PÚBLICO, sem token).
app.get('/api/admin/pix-config', autenticarToken, isAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const { config: cfg } = await lerPixConfigTempoReal()
  res.json(cfg)
})
// Alias público de leitura (mesma fonte Turso do GET /api/pix-config).
app.get('/api/pix/config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const { config: cfg } = await lerPixConfigTempoReal()
  res.json(cfg)
})

// POST /api/pix-config/teste -> gera QR de teste com os dados da tela (só admin).
// Usa a MESMA gerarPix() do modo real; só muda o valor: modoTeste ? 1.00 : valor da tela.
// BOTÃO 3 — GERAR QR CODE DE TESTE: aceita { planoId | valorManual | valor | valorTeste }.
// Se planoId, pega valor do plano em readPlanos(). Se não, usa valorManual/valor.
// Usa loadPixConfig() para montar payload EMV. Salva pendente em
// backend/data/pagamentos-pendentes.json e retorna {copiaECola, qrCodeBase64, valor, planoId, expiraEm}.
async function testePixHandler(req, res) {
  const body = req.body || {}
  const salva = loadPixConfig()
  const chave = String(body.chavePix || body.pix_key || salva.chavePix || '').trim()
  if (!chave) return res.status(400).json({ erro: 'Informe a Chave Pix para o teste.' })
  // Resolve planoId (qualquer alias) -> valor do plano em readPlanos()
  let planoId = body.planoId ?? body.plano_id ?? body.planoID ?? body.id_plano ?? null
  planoId = planoId !== null && planoId !== undefined && String(planoId).trim() !== '' ? String(planoId).trim() : null
  let valorTela
  if (planoId) {
    const plano = readPlanos().find((p) => String(p.id) === String(planoId))
    if (!plano) return res.status(404).json({ erro: 'Plano não encontrado.' })
    valorTela = Number(String(plano.preco ?? '').replace(',', '.'))
    if (!Number.isFinite(valorTela) || valorTela <= 0) return res.status(400).json({ erro: 'Plano sem preço válido.' })
  } else {
    const bruto = body.valorManual ?? body.valor_manual ?? body.valor ?? body.valorTeste ?? body.preco ?? '0'
    valorTela = Number(String(bruto).replace(',', '.'))
    if (!Number.isFinite(valorTela) || valorTela <= 0) return res.status(400).json({ erro: 'Informe um valor maior que zero.' })
  }
  const valorFinal = body.modoTeste ? 1.00 : valorTela
  try {
    const resultado = await gerarPix(chave, body.nomeRecebedor || salva.nomeRecebedor || 'EMPRESAS NICK', body.cidadeRecebedor || salva.cidadeRecebedor || 'SAO PAULO', valorFinal, gerarTxid(), body.tipoChave || salva.tipoChave)
    const pendente = salvarPagamentoPendente({ valor: resultado.valor, copiaECola: resultado.copiaECola, planoId })
    res.json({
      ...resultado,
      qrcode: resultado.qrBase64,
      qrCodeBase64: resultado.qrBase64,
      copiaECola: resultado.copiaECola,
      valor: resultado.valor,
      planoId,
      expiraEm: pendente.expiraEm,
      status: 'pendente',
      id: pendente.id,
    })
  } catch {
    res.status(500).json({ erro: 'Falha ao gerar QR Code de teste' })
  }
}
// Rota oficial + aliases do prompt (/api/pix/test-qr, /api/pix/generate, /api/pix/gerar)
app.post('/api/pix-config/teste', autenticarToken, isAdmin, testePixHandler)
app.post('/api/pix/test-qr', autenticarToken, isAdmin, testePixHandler)
app.post('/api/pix/generate', autenticarToken, isAdmin, testePixHandler)
app.post('/api/pix/gerar', autenticarToken, isAdmin, testePixHandler)
// GET /api/admin/pagamentos-pendentes (só admin) -> últimos QRs gerados (status pendente)
app.get('/api/admin/pagamentos-pendentes', autenticarToken, isAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const list = readPagamentosPendentes().slice().reverse()
  res.json(list)
})

// GET /api/pix/:projetoId -> { copiaECola, qrBase64, valor } (dono ou admin)
app.get('/api/pix/:projetoId', autenticarToken, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const project = readProjects().find((p) => p.id === req.params.projetoId)
  if (!project) return res.status(404).json({ erro: 'Projeto não encontrado' })
  if (project.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' })
  }
  if (!project.valor) return res.status(400).json({ erro: 'Projeto sem valor definido. Escolha um plano no checkout.' })
  const cfg = loadPixConfig()
  if (!cfg.chavePix) return res.status(500).json({ erro: 'PIX não configurado. Ajuste em /admin/config-pix-payment.' })
  try {
    res.json(await gerarPix(cfg.chavePix, cfg.nomeRecebedor, cfg.cidadeRecebedor, project.valor, project.id, cfg.tipoChave))
  } catch {
    res.status(500).json({ erro: 'Falha ao gerar QR Code' })
  }
})

// PUT /api/admin/projeto/:id/confirmar-pagamento -> em_andamento + pagamentoConfirmado=true
app.put('/api/admin/projeto/:id/confirmar-pagamento', autenticarToken, isAdmin, (req, res) => {
  const projects = readProjects()
  const idx = projects.findIndex((p) => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ erro: 'Projeto não encontrado' })
  projects[idx].status = 'em_andamento'
  projects[idx].pagamentoConfirmado = true
  if (!projects[idx].dataInicioDev) projects[idx].dataInicioDev = new Date().toISOString()
  writeProjects(projects)
  res.json({ msg: 'Pagamento confirmado! Projeto entrou na fila de desenvolvimento.', projeto: publicProjeto(projects[idx]) })
})

// PUT /api/admin/projetos/:id/concluir -> status='concluido' (só admin).
// Ao concluir, o projeto SAI da aba "Projetos Ativos" e vai para "Projetos Concluídos".
// Aceita { link_final } opcional no body para registrar o link do site entregue.
app.put('/api/admin/projetos/:id/concluir', autenticarToken, isAdmin, (req, res) => {
  const projects = readProjects()
  const idx = projects.findIndex((p) => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ erro: 'Projeto não encontrado' })
  const agora = new Date().toISOString()
  const linkFinal = req.body && (req.body.link_final !== undefined ? req.body.link_final : req.body.linkFinal)
  if (linkFinal !== undefined) {
    const link = normalizarLinkFinal(linkFinal)
    projects[idx].linkFinal = link
    projects[idx].link_final = link
  }
  projects[idx].status = 'concluido'
  if (!projects[idx].concluidoEm) projects[idx].concluidoEm = agora
  if (!projects[idx].dataEntrega) projects[idx].dataEntrega = agora
  writeProjects(projects)
  res.json({ msg: 'Projeto concluído! Saiu dos ativos e foi para concluídos.', projeto: publicProjeto(projects[idx]) })
})

// --- CONFIG PIX OFICIAL DO ADMIN (tabela configs: pix_key, pix_nome, pix_cidade, valor_minimo) ---
// GET /api/admin/config/pix -> { pix_key, pix_nome, pix_cidade, valor_minimo } (só admin)
app.get('/api/admin/config/pix', autenticarToken, isAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const cfg = loadPixConfig()
  const planos = [cfg.valorStart, cfg.valorPro, cfg.valorPremium]
    .map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
  res.json({
    pix_key: cfg.chavePix || '',
    pix_nome: cfg.nomeRecebedor || '',
    pix_cidade: cfg.cidadeRecebedor || '',
    valor_minimo: cfg.valor_minimo !== undefined ? cfg.valor_minimo : (planos.length ? Math.min(...planos) : 0),
  })
})

// PUT /api/admin/config/pix -> salva pix_key, pix_nome, pix_cidade, valor_minimo (só admin)
app.put('/api/admin/config/pix', autenticarToken, isAdmin, (req, res) => {
  const body = req.body || {}
  const cfg = loadPixConfig()
  if (body.pix_key !== undefined) cfg.chavePix = String(body.pix_key).trim()
  if (body.pix_nome !== undefined) cfg.nomeRecebedor = String(body.pix_nome).trim() || 'EMPRESAS NICK'
  if (body.pix_cidade !== undefined) cfg.cidadeRecebedor = String(body.pix_cidade).trim() || 'SAO PAULO'
  if (body.valor_minimo !== undefined) {
    const vm = Number(String(body.valor_minimo).replace(',', '.'))
    if (!Number.isFinite(vm) || vm < 0) return res.status(400).json({ erro: 'valor_minimo inválido.' })
    cfg.valor_minimo = vm
    if (vm > 0) {
      for (const k of ['valorStart', 'valorPro', 'valorPremium']) {
        const atual = Number(cfg[k])
        if (Number.isFinite(atual) && atual > 0 && atual < vm) cfg[k] = vm
      }
    }
  }
  if (!cfg.chavePix) return res.status(400).json({ erro: 'Informe pix_key (Chave Pix).' })
  const salva = savePixConfig(cfg)
  res.json({
    msg: 'Configuração Pix salva!',
    config: {
      pix_key: salva.chavePix,
      pix_nome: salva.nomeRecebedor,
      pix_cidade: salva.cidadeRecebedor,
      valor_minimo: salva.valor_minimo !== undefined ? salva.valor_minimo : 0,
    },
  })
})

// GET /api/suporte/numero -> número oficial do suporte (público, usado pelo painel admin e pelo site)
app.get('/api/suporte/numero', (req, res) => {
  const numero = String(process.env.OWNER_PHONE || '5511916572015').replace(/\D/g, '')
  const texto = 'Olá, preciso de suporte na Empresa Nick'
  res.json({ numero, texto, url: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` })
})

// --- ADMIN ---

// Lógica única do dashboard (unificada): lê backend/data/users.json via path.join.
// Cria o arquivo com [] se não existir e SEMPRE retorna JSON válido.
function calcularStats(reqUser) {
  ensureDataFile()
  const usersPath = path.join(__dirname, 'data', 'users.json');
  let users = [];
  if (fs.existsSync(usersPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      users = Array.isArray(raw) ? raw : [];
    } catch { users = []; }
  }
  const diaDe = (u) => String(u.createdAt || u.criadoEm || '').split('T')[0];
  const hoje = new Date().toISOString().split('T')[0];
  const cadastrosHoje = users.filter(u => diaDe(u) === hoje).length;

  // últimos 7 dias
  let cadastrosPorDia = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dataStr = d.toISOString().split('T')[0];
    const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const total = users.filter(u => diaDe(u) === dataStr).length;
    cadastrosPorDia.push({ data: label, total });
  }

  const ultimos7dias = users.filter(u => {
    const dt = new Date(u.createdAt || u.criadoEm || 0);
    const limite = new Date(); limite.setDate(limite.getDate() - 7);
    return dt >= limite;
  }).length;

  const dono = users.find((u) => u.id === (reqUser && reqUser.id));
  const seuEmail = (reqUser && reqUser.email) || (dono && dono.email) || '';
  const ordenados = [...users]
    .sort((a, b) => new Date(b.createdAt || b.criadoEm) - new Date(a.createdAt || a.criadoEm));
  const limpo = (u) => ({ id: u.id, nome: u.nome, email: u.email, role: u.role, createdAt: u.createdAt || u.criadoEm });
  const ultimos = ordenados.slice(0, 5).map(limpo);
  const cadastros = ordenados.slice(0, 20).map(limpo);
  return {
    totalUsers: users.length, totalHoje: cadastrosHoje, ultimos,
    porDia: cadastrosPorDia, total7Dias: ultimos7dias,
    totalUsuarios: users.length, cadastrosHoje, ultimos7dias,
    seuEmail, cadastrosPorDia,
    total: users.length, hoje: cadastrosHoje, semana: ultimos7dias,
    totalEmails: users.length, emails: users.length, cadastros,
  };
}
app.get('/admin/stats', autenticarToken, isAdmin, (req, res) => {
  try {
    const out = calcularStats(req.user)
    res.json(out)
  } catch (e) {
    console.error('ERRO /admin/stats', e);
    res.status(500).json({ error: e.message, totalUsuarios: 0, cadastrosHoje: 0, ultimos7dias: 0, seuEmail: '', cadastrosPorDia: [] });
  }
})

// GET /api/admin/stats -> alias unificado (mesma lógica de /admin/stats).
// NOTA: projeto usa users.json (sem SQL). Os blocos abaixo simulam o padrão
// rows[0]?.total || 0 (NUNCA rows.total) sobre as contagens em disco.
app.get('/api/admin/stats', autenticarToken, isAdmin, (req, res) => {
  const out = calcularStats(req.user)
  const rowsTotal = [{ total: out.totalUsuarios }]
  const rowsHoje = [{ total: out.cadastrosHoje }]
  const rowsSemana = [{ total: out.ultimos7dias }]
  const total = rowsTotal[0]?.total || 0
  const hoje = rowsHoje[0]?.total || 0
  const semana = rowsSemana[0]?.total || 0
  console.log(`[admin] GET /api/admin/stats -> total=${total} hoje=${hoje} 7d=${semana} (${(req.user && req.user.email) || '?'})`)
  res.json({ ...out, totalUsuarios: total, cadastrosHoje: hoje, ultimos7Dias: semana, ultimos7dias: semana, totalEmails: total })
})

app.get('/admin/users', autenticarToken, isAdmin, (req, res) => {
  const usersPath = path.join(__dirname, 'data', 'users.json');
  let users = [];
  if (fs.existsSync(usersPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      users = Array.isArray(raw) ? raw : [];
    } catch { users = []; }
  }
  res.json(users.map((u) => {
    const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...pub } = u
    return pub
  }))
})

// Alias oficial do dashboard: GET /api/admin/users (mesma base de /admin/users)
app.get('/api/admin/users', autenticarToken, isAdmin, (req, res) => {
  const users = readUsers().map((u) => {
    const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...pub } = u
    return pub
  })
  console.log(`[admin] GET /api/admin/users -> ${users.length} usuário(s) (${(req.user && req.user.email) || '?'})`)
  res.json(users)
})

// --- FUNCIONÁRIOS/ADMINS (role admin em users.json: { email, role, addedBy, addedAt }) ---
// GET /api/admin/funcionarios -> lista quem tem acesso admin (só admin)
app.get('/api/admin/funcionarios', autenticarToken, isAdmin, (req, res) => {
  const list = readUsers()
    .filter((u) => u.role === 'admin')
    .map((u) => {
      const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...pub } = u
      return { ...pub, adminDesde: u.addedAt || u.createdAt || u.criadoEm || null }
    })
  res.json(list)
})

// PUT /api/admin/funcionarios { email } -> dar acesso admin (só admin)
// POST /api/admin/funcionarios { email } -> alias do PUT (mesmo middleware de /api/admin/users)
// Cada funcionário depois faz login com o PRÓPRIO email/senha e ganha o PRÓPRIO token.
function promoverFuncionario(req, res) {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' })
  const users = readUsers()
  const u = users.find((x) => String(x.email || '').toLowerCase() === email)
  if (!u) return res.status(404).json({ erro: 'Usuário não cadastrado. Peça para criar a conta primeiro.' })
  u.role = 'admin'
  u.addedBy = req.user.email
  u.addedAt = new Date().toISOString()
  writeUsers(users)
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...pub } = u
  res.json({ msg: 'Acesso admin concedido!', user: { ...pub, adminDesde: u.addedAt } })
}
app.put('/api/admin/funcionarios', autenticarToken, isAdmin, promoverFuncionario)
app.post('/api/admin/funcionarios', autenticarToken, isAdmin, promoverFuncionario)

// DELETE /api/admin/funcionarios/:id -> remover acesso admin (só admin, nunca a si mesmo)
app.delete('/api/admin/funcionarios/:id', autenticarToken, isAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ erro: 'Você não pode remover seu próprio acesso.' })
  const users = readUsers()
  const u = users.find((x) => x.id === req.params.id)
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' })
  u.role = 'user'
  writeUsers(users)
  res.json({ msg: 'Acesso admin removido.' })
})

app.delete('/admin/users/:id', autenticarToken, isAdmin, (req, res) => {
  const { id } = req.params
  if (id === req.user.id) {
    return res.status(400).json({ erro: 'Não pode deletar a própria conta.' })
  }
  const users = readUsers()
  const idx = users.findIndex((u) => u.id === id)
  if (idx === -1) return res.status(404).json({ erro: 'Usuário não encontrado.' })
  users.splice(idx, 1)
  writeUsers(users)
  res.json({ msg: 'Usuário deletado.' })
})

// Alias oficial: DELETE /api/admin/users/:id (mesma base)
app.delete('/api/admin/users/:id', autenticarToken, isAdmin, (req, res) => {
  const { id } = req.params
  if (id === req.user.id) {
    return res.status(400).json({ erro: 'Não pode deletar a própria conta.' })
  }
  const users = readUsers()
  const idx = users.findIndex((u) => u.id === id)
  if (idx === -1) return res.status(404).json({ erro: 'Usuário não encontrado.' })
  users.splice(idx, 1)
  writeUsers(users)
  res.json({ msg: 'Usuário deletado.' })
})

app.put('/admin/users/:id/role', autenticarToken, isAdmin, (req, res) => {
  const { id } = req.params
  const { role } = req.body
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ erro: 'Role inválida. Use admin ou user.' })
  }
  const users = readUsers()
  const user = users.find((u) => u.id === id)
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' })
  if (id === req.user.id && role !== 'admin') {
    return res.status(400).json({ erro: 'Você não pode remover seu próprio acesso.' })
  }
  user.role = role
  if (role === 'admin') {
    user.addedBy = req.user.email
    user.addedAt = new Date().toISOString()
  }
  writeUsers(users)
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...pub } = user
  res.json({ msg: 'Role atualizada.', user: pub })
})

// Alias oficial: PUT /api/admin/users/:id/role (mesma base)
app.put('/api/admin/users/:id/role', autenticarToken, isAdmin, (req, res) => {
  const { id } = req.params
  const { role } = req.body
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ erro: 'Role inválida. Use admin ou user.' })
  }
  const users = readUsers()
  const user = users.find((u) => u.id === id)
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' })
  if (id === req.user.id && role !== 'admin') {
    return res.status(400).json({ erro: 'Você não pode remover seu próprio acesso.' })
  }
  user.role = role
  if (role === 'admin') {
    user.addedBy = req.user.email
    user.addedAt = new Date().toISOString()
  }
  writeUsers(users)
  const { senhaHash: _, senha: __, resetToken: _rt, resetTokenExpiry: _rte, ...pub } = user
  res.json({ msg: 'Role atualizada.', user: pub })
})

app.get('/admin', autenticarToken, isAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin - Empresas Nick</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{background:#0f172a;color:#e2e8f0;min-height:100vh}
header{padding:18px 24px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;background:#0f172a;position:sticky;top:0}
header h1{font-size:1.25rem;color:#06b6d4}
header a{color:#94a3b8;text-decoration:none;font-size:.9rem}
.container{max-width:1100px;margin:0 auto;padding:24px;width:92%}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px}
.card{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:18px}
.card small{color:#94a3b8;font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
.card strong{display:block;font-size:1.7rem;margin-top:6px;color:#fff}
.card span{font-size:.82rem;color:#64748b}
.chart-wrap{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:18px;margin-bottom:22px}
.chart-wrap h3{margin-bottom:12px;color:#06b6d4}
.table-wrap{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:18px;overflow:auto;margin-bottom:22px}
.table-wrap h3{margin-bottom:12px;color:#fff}
.tabs{display:flex;gap:10px;margin-bottom:16px}
.tab{padding:10px 16px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#94a3b8;cursor:pointer;font-weight:700;font-size:.85rem;white-space:nowrap;flex:0 0 auto}
.tab.active{background:#06b6d4;color:#0f172a;border-color:#06b6d4}
.tabs-container {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE */
  padding-bottom: 10px;
  cursor: grab;
}
.tabs-container::-webkit-scrollbar {
  display: none; /* Chrome, Safari */
}
.tabs-container .tab-btn {
  flex: 0 0 auto;
}
.tabs-container.grabbing{cursor:grabbing}
#busca{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;margin-bottom:12px;outline:none}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{padding:10px 8px;text-align:left;border-bottom:1px solid #334155}
th{color:#94a3b8;font-weight:600;font-size:.78rem;text-transform:uppercase}
td{color:#e2e8f0}
.badge{padding:3px 8px;border-radius:999px;font-size:.72rem;font-weight:700}
.badge-admin{background:#06b6d4;color:#0f172a}
.badge-user{background:#334155;color:#cbd5e1}
.btn{padding:6px 10px;border-radius:8px;border:none;cursor:pointer;font-size:.78rem;font-weight:600}
.btn-del{background:#ef4444;color:#fff}
.btn-prom{background:#06b6d4;color:#0f172a}
.btn-save{background:#10b981;color:#fff}
.btn:hover{opacity:.9}
.proj-card{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:14px;margin-bottom:12px}
.proj-card strong{font-size:.95rem}
.proj-card p{font-size:.84rem;color:#cbd5e1;margin:4px 0;word-break:break-word}
.proj-card select, .proj-card input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;margin-top:6px;outline:none}
.topnav{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.topnav a{padding:10px 16px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-weight:700;font-size:.85rem;text-decoration:none}
.topnav a.active{background:#06b6d4;color:#0f172a;border-color:#06b6d4}
.toolbar{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
.toolbtn{padding:9px 14px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#94a3b8;cursor:pointer;font-weight:700;font-size:.82rem}
.toolbtn.danger{background:#7f1d1d;border-color:#ef4444;color:#fecaca}
.toolbtn.warn{background:#451a03;border-color:#f59e0b;color:#fde68a}
.toolbtn:hover{opacity:.9}
.proj-check{width:18px;height:18px;accent-color:#06b6d4;cursor:pointer}
.selcount{font-size:.82rem;color:#94a3b8}
.sup-grid{display:grid;grid-template-columns:320px 1fr;gap:14px}
.sup-list{max-height:480px;overflow-y:auto}
.sup-item{padding:10px;border-bottom:1px solid #334155;cursor:pointer}
.sup-item.sel{background:#164e63}
.sup-thread{flex:1;overflow-y:auto;display:grid;gap:8px;background:#0f172a;padding:10px;border-radius:10px;min-height:280px;max-height:380px;align-content:start}
.sup-msg{max-width:80%;padding:8px 10px;border-radius:10px;font-size:.85rem;border:1px solid #334155}
.sup-msg.user{align-self:flex-end;background:#06b6d4;color:#0f172a}
.sup-msg.bot{align-self:flex-start;background:#1e293b;color:#e2e8f0}
.pixlabel{display:block;font-size:.78rem;color:#94a3b8;margin:10px 0 4px;font-weight:600}
.pixinput{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;outline:none;font-size:.9rem}
@media(max-width:900px){.sup-grid{grid-template-columns:1fr}}
@media(max-width:900px){.cards{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.cards{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Empresas Nick — Admin</h1><a href="/">← voltar</a></header>
<div class="container">
  <div class="topnav">
    <a href="/admin" class="active">Dashboard</a>
    <a href="/admin/config-pix-payment">💠 ConfigPixPayment</a>
  </div>
  <p style="color:#94a3b8;font-size:.85rem;margin-bottom:14px">Suporte oficial: <strong style="color:#06b6d4">+5511916572015</strong> • <a style="color:#06b6d4" href="https://wa.me/5511916572015" target="_blank">abrir WhatsApp</a></p>
  <div class="cards">
    <div class="card"><small>Total usuários</small><strong id="totalUsuarios" data-total>-</strong><span>todos os cadastros</span></div>
    <div class="card"><small>Cadastros hoje</small><strong id="cadastrosHoje" data-hoje>-</strong><span id="c-hoje-data"></span></div>
    <div class="card"><small>Últimos 7 dias</small><strong id="ultimos7dias" data-7dias>-</strong><span>soma da semana</span></div>
    <div class="card"><small>Seu email</small><strong id="seuEmail" data-email style="font-size:1rem;word-break:break-all">-</strong><span id="c-role"></span></div>
  </div>
  <div class="chart-wrap">
    <h3>Cadastros por dia (últimos 7 dias)</h3>
    <canvas id="grafico" height="110"></canvas>
    <div id="grafico-vazio" style="display:none;color:#94a3b8;text-align:center;padding:24px">Sem dados</div>
  </div>
  <div class="tabs tabs-container">
    <button id="tab-users" class="tab tab-btn active" onclick="showTab('users')">Usuários</button>
    <button id="tab-ativos" class="tab tab-btn" onclick="showTab('ativos')">Projetos Ativos</button>
    <button id="tab-concluidos" class="tab tab-btn" onclick="showTab('concluidos')">Projetos Concluídos</button>
    <button id="tab-suporte" class="tab tab-btn" onclick="showTab('suporte')">Suporte</button>
    <button id="tab-bot" class="tab tab-btn" onclick="showTab('bot')">Suporte Bot</button>
    <button id="tab-portfolio" class="tab tab-btn" onclick="showTab('portfolio')">Portfólio Sites Criados</button>
    <button id="tab-pagamentos" class="tab tab-btn" onclick="showTab('pagamentos')">Pagamentos</button>
    <button id="tab-func" class="tab tab-btn" onclick="location.href='/admin/funcionarios'">Funcionários</button>
  </div>
  <div id="sec-users" class="table-wrap">
    <h3>Usuários</h3>
    <input id="busca" placeholder="Pesquisar por nome ou email..."/>
    <table>
      <thead><tr><th>Nome</th><th>Email</th><th>Role</th><th>Criado em</th><th>Ações</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <div id="sec-ativos" class="table-wrap" style="display:none">
    <h3>Projetos Ativos (pendente + em_andamento)</h3>
    <div class="toolbar">
      <button class="toolbtn" onclick="selecionarTodos('ativos')">Selecionar Todos</button>
      <button class="toolbtn danger" onclick="excluirSelecionados('ativos')">Excluir Selecionados</button>
      <button class="toolbtn warn" onclick="zerarHistorico()">Zerar Histórico</button>
      <span class="selcount" id="count-ativos"></span>
    </div>
    <div id="ativos-lista"></div>
  </div>
  <div id="sec-concluidos" class="table-wrap" style="display:none">
    <h3>Projetos Concluídos</h3>
    <div class="toolbar">
      <button class="toolbtn" onclick="selecionarTodos('concluidos')">Selecionar Todos</button>
      <button class="toolbtn danger" onclick="excluirSelecionados('concluidos')">Excluir Selecionados</button>
      <button class="toolbtn warn" onclick="zerarHistorico()">Zerar Histórico</button>
      <span class="selcount" id="count-concluidos"></span>
    </div>
    <div id="concluidos-lista"></div>
  </div>
  <div id="sec-suporte" class="table-wrap" style="display:none">
    <h3>Suporte — WhatsApp <span style="color:#06b6d4">+5511916572015</span> <a style="color:#06b6d4;font-size:.8rem" href="https://wa.me/5511916572015" target="_blank">abrir</a></h3>
    <div class="sup-grid">
      <div class="proj-card sup-list" id="sup-lista"><p style="color:#94a3b8">Carregando conversas...</p></div>
      <div class="proj-card" style="display:flex;flex-direction:column;gap:10px;min-height:420px">
        <div id="sup-head" style="color:#94a3b8;font-size:.85rem">Selecione uma conversa</div>
        <div class="sup-thread" id="sup-thread"></div>
        <div style="display:flex;gap:8px">
          <input id="sup-resp" placeholder="Responder como dono..." style="flex:1;padding:10px 12px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;outline:none"/>
          <button class="btn btn-save" onclick="supResponder()">Enviar</button>
        </div>
      </div>
    </div>
  </div>
  <div id="sec-bot" class="table-wrap" style="display:none">
    <h3>Suporte Bot — Perguntas do FAQ</h3>
    <p style="color:#94a3b8;font-size:.82rem;margin-bottom:12px">O chat do site usa estas perguntas (GET /api/support-options). Adicione FAQ sem mexer no código.</p>
    <button class="btn btn-save" style="margin-bottom:12px" onclick="toggleBotForm()">+ Nova Pergunta</button>
    <div id="bot-form" class="proj-card" style="display:none;margin-bottom:14px">
      <label class="pixlabel">Pergunta *</label>
      <input class="pixinput" id="bot-pergunta" placeholder="ex: Quais são os planos?"/>
      <label class="pixlabel">Resposta *</label>
      <input class="pixinput" id="bot-resposta" placeholder="ex: Planos Start, Pro e Premium..."/>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
        <div><label class="pixlabel">Ordem</label><input class="pixinput" id="bot-ordem" type="number" placeholder="auto"/></div>
        <div><label class="pixlabel">Ativo</label><input class="pixinput" id="bot-ativo" type="checkbox" checked style="width:auto"/></div>
      </div>
      <div class="msg" id="msg-bot" style="font-size:.82rem;margin-top:8px;min-height:20px"></div>
      <button class="btn btn-save" style="width:100%;margin-top:8px" id="btn-bot-salvar" onclick="salvarBot()">SALVAR</button>
    </div>
    <div id="bot-lista"></div>
  </div>
  <div id="sec-portfolio" class="table-wrap" style="display:none">
    <h3>Portfólio Sites Criados</h3>
    <button class="btn btn-save" style="margin-bottom:12px" onclick="togglePortForm()">+ Novo Projeto no Portfólio</button>
    <div id="port-form" class="proj-card" style="display:none;margin-bottom:14px">
      <label class="pixlabel">Título *</label>
      <input class="pixinput" id="port-titulo" placeholder="ex: Loja da Maria"/>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
        <div><label class="pixlabel">Nome Cliente</label><input class="pixinput" id="port-cliente" placeholder="ex: Maria"/></div>
        <div><label class="pixlabel">Link do Site</label><input class="pixinput" id="port-link" placeholder="https://..."/></div>
      </div>
      <label class="pixlabel">Descrição curta</label>
      <input class="pixinput" id="port-desc" placeholder="ex: Loja virtual com Pix"/>
      <label class="pixlabel">Foto ou vídeo (arraste e solte ou clique, até 50MB) *</label>
      <div id="port-drop" style="border:2px dashed #334155;border-radius:12px;padding:22px;text-align:center;color:#94a3b8;cursor:pointer">
        Arraste foto/vídeo aqui ou clique para escolher
        <input type="file" id="port-arquivo" accept="image/*,video/*" style="display:none"/>
      </div>
      <div id="port-prev" style="font-size:.8rem;color:#06b6d4;margin-top:8px"></div>
      <div class="msg" id="msg-port" style="font-size:.82rem;margin-top:8px;min-height:20px"></div>
      <button class="btn btn-save" style="width:100%;margin-top:8px" onclick="publicarPort()">PUBLICAR NO PORTFÓLIO</button>
    </div>
    <div id="port-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px"></div>
  </div>
  <div id="sec-pagamentos" class="table-wrap" style="display:none">
    <h3>Pagamentos — Pix em tempo real</h3>
    <p style="color:#94a3b8;font-size:.82rem;margin-bottom:12px">Valores vêm do backend em tempo real (GET /api/pix-config + GET /api/admin/planos). Salvar em ConfigPixPayment atualiza aqui sem F5.</p>
    <div class="proj-card" id="pag-pix-atual">
      <div style="font-size:.82rem;color:#94a3b8">Config Pix atual (tempo real)</div>
      <div id="pag-pix-valores" style="margin-top:6px;font-size:.88rem;color:#e2e8f0">Carregando...</div>
    </div>
    <div class="proj-card">
      <label class="pixlabel">Plano</label>
      <select id="pag-plano" class="pixinput" onchange="pagPlanoChange()"><option value="">Carregando planos...</option></select>
      <label class="pixlabel">Valor manual (R$ — sobrescreve o plano se digitado)</label>
      <input id="pag-valor-manual" class="pixinput" inputmode="decimal" placeholder="ex: valor avulso"/>
      <button class="btn btn-save" style="width:100%;margin-top:12px" onclick="gerarQrPagamentos()">GERAR QR PIX</button>
      <div class="msg" id="msg-pag" style="font-size:.82rem;margin-top:8px;min-height:20px"></div>
      <div id="pag-qr" style="text-align:center;margin-top:12px"></div>
    </div>
    <div class="proj-card">
      <div style="font-size:.82rem;color:#94a3b8;margin-bottom:8px">Últimos QRs gerados (pendentes)</div>
      <div id="pag-pendentes" style="display:grid;gap:8px"><p style="font-size:.8rem;color:#64748b">Nenhum QR gerado ainda.</p></div>
    </div>
  </div>
</div>
<script>
// Handoff ?token= -> localStorage: o frontend abre /admin em nova aba
// (origem diferente => localStorage vazio). Salva nas 4 chaves e limpa a URL.
(function(){try{var m=new URLSearchParams(location.search).get('token');if(m){['token','adminToken','authToken','en_token'].forEach(function(k){try{localStorage.setItem(k,m)}catch(e){}});var u=new URL(location.href);u.searchParams.delete('token');history.replaceState(null,'',u);}}catch(e){}})();
let todos=[]
let projetosAtivos=[]
let projetosConcluidos=[]
let selecionadosAtivos=new Set()
let selecionadosConcluidos=new Set()
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escAttr(s){return esc(s).replace(/"/g,'&quot;')}
function showTab(t){
  ['users','ativos','concluidos','suporte','bot','portfolio','pagamentos'].forEach(x=>{
    document.getElementById('tab-'+x).classList.toggle('active', t===x)
    document.getElementById('sec-'+x).style.display = t===x ? 'block' : 'none'
  })
  if(t==='ativos') loadProjetosTab('ativos')
  if(t==='concluidos') loadProjetosTab('concluidos')
  if(t==='suporte') loadSuporte()
  if(t==='bot') loadBot()
  if(t==='portfolio') loadPortfolio()
  if(t==='pagamentos') loadPagamentos(false)
}
// --- ABA PAGAMENTOS (tempo real com ConfigPixPayment) ---
// loadAll: GET /api/pix-config + GET /api/admin/planos em paralelo.
// Atualiza via CustomEvent (mesma aba), storage event + BroadcastChannel (outra aba/página),
// e refetch no focus/visibility — tudo sem F5.
let pagPlanos=[], pagPixConfig=null;
async function loadPagamentos(silent){
  try{
    const results=await Promise.all([
      authFetch('/api/pix-config?t='+Date.now(),{cache:'no-store',credentials:'include',headers:authHeaders()}),
      authFetch('/api/admin/planos?t='+Date.now(),{cache:'no-store',credentials:'include',headers:authHeaders()})
    ]);
    const rc=results[0], rp=results[1];
    if(rc.ok){ pagPixConfig=await rc.json(); renderPagPixAtual(); }
    if(rp.ok){ pagPlanos=await rp.json(); renderPagPlanos(); }
  }catch(e){ if(!silent) console.error('Falha ao carregar pagamentos:',e); }
  carregarPendentes();
}
function renderPagPixAtual(){
  const box=document.getElementById('pag-pix-valores');
  if(!box) return;
  if(!pagPixConfig){ box.textContent='Pix não configurado.'; return; }
  box.innerHTML='Chave: <strong style="color:#fff">'+esc(pagPixConfig.chavePix||'-')+'</strong>'
    +' | Start: <strong style="color:#06b6d4">R$'+esc(pagPixConfig.valorStart)+'</strong>'
    +' | Pro: <strong style="color:#06b6d4">R$'+esc(pagPixConfig.valorPro)+'</strong>'
    +' | Premium: <strong style="color:#06b6d4">R$'+esc(pagPixConfig.valorPremium)+'</strong>';
}
function renderPagPlanos(){
  const sel=document.getElementById('pag-plano');
  if(!sel) return;
  const atual=sel.value;
  sel.innerHTML='<option value="">— Selecione um plano —</option>';
  pagPlanos.forEach(function(p){
    const o=document.createElement('option');
    o.value=p.id; o.textContent=p.nome+' — R$'+p.preco;
    sel.appendChild(o);
  });
  if(atual) sel.value=atual;
}
function pagPlanoChange(){
  const sel=document.getElementById('pag-plano');
  const man=document.getElementById('pag-valor-manual');
  if(!sel) return;
  const p=pagPlanos.find(function(x){ return String(x.id)===String(sel.value) });
  if(p && man) man.placeholder='Plano '+p.nome+': R$'+p.preco+' (ou digite outro valor)';
}
function renderPagQr(d){
  const box=document.getElementById('pag-qr');
  if(!box) return;
  box.innerHTML='';
  const img=document.createElement('img');
  img.src=d.qrCodeBase64||d.qrBase64||d.qrcode||'';
  img.alt='QR Code Pix';
  img.style.cssText='width:220px;height:220px;border-radius:12px;background:#fff;padding:8px;margin:0 auto;display:block';
  const valor=document.createElement('div');
  valor.style.cssText='font-size:1.2rem;font-weight:800;color:#06b6d4;margin-top:8px';
  valor.textContent='R$'+d.valor+' • Status: pendente';
  const copia=document.createElement('div');
  copia.style.cssText='background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;margin-top:8px;font-size:.7rem;word-break:break-all;color:#cbd5e1;max-height:90px;overflow-y:auto;text-align:left';
  copia.textContent=d.copiaECola||'';
  const btn=document.createElement('button');
  btn.className='btn btn-prom'; btn.style.marginTop='8px'; btn.textContent='Copiar código';
  btn.onclick=function(){ copiarPagCopia(d.copiaECola, btn) };
  box.appendChild(img); box.appendChild(valor); box.appendChild(copia); box.appendChild(btn);
}
function copiarPagCopia(texto, btn){
  if(!texto) return;
  function ok(){ if(btn){ btn.textContent='Copiado!'; setTimeout(function(){ btn.textContent='Copiar código' },2000) } }
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(texto).then(ok).catch(function(){}) }
  else{ const ta=document.createElement('textarea'); ta.value=texto; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy') }catch(e){} document.body.removeChild(ta); ok() }
}
async function gerarQrPagamentos(){
  const m=document.getElementById('msg-pag');
  const box=document.getElementById('pag-qr');
  const sel=document.getElementById('pag-plano');
  const man=document.getElementById('pag-valor-manual');
  m.style.color='#94a3b8'; m.textContent='Gerando...'; box.innerHTML='';
  const manual=(man && man.value || '').trim();
  const body={};
  if(manual) body.valorManual=manual;
  else if(sel && sel.value) body.planoId=sel.value;
  else{ m.style.color='#f87171'; m.textContent='Selecione um plano ou digite o valor manual.'; return }
  try{
    const r=await authFetch('/api/pix/gerar',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify(body)});
    const d=await r.json().catch(function(){ return {} });
    if(!r.ok){ m.style.color='#f87171'; m.textContent=d.erro||'Erro ao gerar QR'; return }
    m.style.color='#10b981'; m.textContent='QR gerado com R$'+d.valor+' (pendente)';
    renderPagQr(d);
    try{
      localStorage.setItem('pix-qr-gerado-at', JSON.stringify({at:Date.now(), qr:d}));
      if(window.__pagBC && window.__pagBC.postMessage) window.__pagBC.postMessage({type:'pix-qr-gerado', qr:d});
    }catch(e){}
    carregarPendentes();
  }catch(e){ m.style.color='#f87171'; m.textContent='Erro de conexão.'; }
}
async function carregarPendentes(){
  const box=document.getElementById('pag-pendentes');
  if(!box) return;
  try{
    const r=await authFetch('/api/admin/pagamentos-pendentes?t='+Date.now(),{cache:'no-store',credentials:'include',headers:authHeaders()});
    if(!r.ok) return;
    const list=await r.json();
    if(!list.length){ box.innerHTML='<p style="font-size:.8rem;color:#64748b">Nenhum QR gerado ainda.</p>'; return }
    box.innerHTML='';
    list.slice(0,5).forEach(function(p){
      const div=document.createElement('div');
      div.style.cssText='background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;font-size:.8rem';
      div.innerHTML='<strong style="color:#fff">R$'+esc(p.valor)+'</strong> <span style="color:#f59e0b;font-weight:700">'+esc(p.status||'pendente')+'</span>'
        +'<div style="font-size:.72rem;color:#94a3b8;margin-top:4px;word-break:break-all">'+esc((p.copiaECola||'').slice(0,80))+'...</div>';
      box.appendChild(div);
    });
  }catch(e){}
}
window.addEventListener('pix-config-updated', function(e){
  if(e && e.detail){ pagPixConfig=e.detail; renderPagPixAtual(); } else loadPagamentos(true);
});
window.addEventListener('planos-updated', function(){ loadPagamentos(true) });
window.addEventListener('pix-qr-gerado', function(e){ if(e && e.detail) renderPagQr(e.detail) });
window.addEventListener('storage', function(e){
  if(e.key==='pix-config-updated-at' || e.key==='planos-updated-at'){ loadPagamentos(true) }
  if(e.key==='pix-qr-gerado-at'){ try{ const d=JSON.parse(e.newValue||'{}'); if(d.qr) renderPagQr(d.qr); }catch(err){} loadPagamentos(true) }
});
try{
  window.__pagBC=('BroadcastChannel' in window) ? new BroadcastChannel('pix-admin') : null;
  if(window.__pagBC) window.__pagBC.onmessage=function(ev){
    const d=(ev && ev.data) || {};
    if(d.type==='pix-config-updated'){ if(d.config){ pagPixConfig=d.config; renderPagPixAtual() } else loadPagamentos(true) }
    else if(d.type==='planos-updated'){ loadPagamentos(true) }
    else if(d.type==='pix-qr-gerado'){ if(d.qr) renderPagQr(d.qr); loadPagamentos(true) }
  };
}catch(e){}
document.addEventListener('visibilitychange', function(){
  if(!document.hidden){ const s=document.getElementById('sec-pagamentos'); if(s && s.style.display!=='none') loadPagamentos(true) }
});
window.addEventListener('focus', function(){
  const s=document.getElementById('sec-pagamentos'); if(s && s.style.display!=='none') loadPagamentos(true);
});
// Scroll horizontal invisível das abas: arrastar com mouse (PC) + dedo (mobile nativo).
(function initTabsDrag(){
  const el=document.querySelector('.tabs-container');
  if(!el) return;
  let down=false,startX=0,startScroll=0,moved=false;
  el.addEventListener('mousedown',(e)=>{down=true;moved=false;startX=e.pageX-el.offsetLeft;startScroll=el.scrollLeft;el.classList.add('grabbing')});
  el.addEventListener('mouseleave',()=>{down=false;el.classList.remove('grabbing')});
  el.addEventListener('mouseup',(e)=>{down=false;el.classList.remove('grabbing');if(moved) e.preventDefault()});
  el.addEventListener('mousemove',(e)=>{if(!down) return;const x=e.pageX-el.offsetLeft;if(Math.abs(x-startX)>5) moved=true;el.scrollLeft=startScroll-(x-startX)});
  el.addEventListener('click',(e)=>{if(moved){e.preventDefault();e.stopPropagation();moved=false} },true);
})();
// Interceptor global do admin (padrão api.js): TODO fetch envia
// cookie httpOnly + Authorization: Bearer do localStorage.
// (lê 'token', 'adminToken', 'authToken' e 'en_token' — login salva nos 4).
function adminToken(){
  try{
    return localStorage.getItem('token') || localStorage.getItem('adminToken') || localStorage.getItem('authToken') || localStorage.getItem('en_token') || '';
  }catch(e){ return '' }
}
function authFetch(url, options){
  options = options || {};
  options.credentials = 'include';
  options.headers = options.headers || {};
  try{
    const t = adminToken();
    if(t && !options.headers['Authorization'] && !options.headers['authorization']) options.headers['Authorization'] = 'Bearer ' + t;
  }catch(e){}
  return fetch(url, options);
}
function authHeaders(){
  let headers={};
  try{ const t=adminToken(); if(t) headers={ 'Authorization':'Bearer '+t }; }catch(e){}
  return headers;
}
function setCard(id, v){
  const el=document.querySelector('#'+id);
  if(!el){ console.error('Card não encontrado no HTML:', id); return }
  el.textContent=(v===undefined||v===null||Number.isNaN(v))?0:v;
}
function renderGrafico(porDia){
  const lista=Array.isArray(porDia)?porDia:[];
  const soma=lista.reduce((a,p)=>a+((p&&p.total)||0),0);
  try{
    if(!lista.length||soma===0){
      document.getElementById('grafico').style.display='none';
      document.getElementById('grafico-vazio').style.display='block';
      return;
    }
    document.getElementById('grafico').style.display='block';
    document.getElementById('grafico-vazio').style.display='none';
    new Chart(document.getElementById('grafico'),{
      type:'bar',
      data:{labels: lista.map(p=>p.data), datasets:[{label:'Cadastros', data: lista.map(p=>p.total), backgroundColor:'#06b6d4', borderRadius:6}]},
      options:{plugins:{legend:{display:false}}, scales:{x:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}}, y:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}, beginAtZero:true}}}
    })
  }catch(e){
    console.error('Falha ao renderizar gráfico:', e);
    try{
      document.getElementById('grafico').style.display='none';
      document.getElementById('grafico-vazio').style.display='block';
    }catch(e2){}
  }
}
function loadStats(){
  authFetch('/admin/stats', {credentials: 'include', headers: authHeaders()})
  .then(r => { if(!r.ok) throw new Error('HTTP '+r.status+' em /admin/stats'); return r.json() })
  .catch(() => authFetch('/api/admin/stats', {credentials: 'include', headers: authHeaders()}).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json() }))
  .then(data => {
    const total=(data.totalUsuarios!==undefined?data.totalUsuarios:data.totalUsers);
    const hoje=(data.cadastrosHoje!==undefined?data.cadastrosHoje:data.totalHoje);
    const dias7=(data.ultimos7dias!==undefined?data.ultimos7dias:data.total7Dias);
    document.querySelector('[data-total]').innerText=(total===undefined||total===null)?0:total;
    document.querySelector('[data-hoje]').innerText=(hoje===undefined||hoje===null)?0:hoje;
    document.querySelector('[data-7dias]').innerText=(dias7===undefined||dias7===null)?0:dias7;
    document.querySelector('[data-email]').innerText=data.seuEmail || data.email || '';
    // IDs oficiais dos cards (getElementById direto, como pedido):
    document.getElementById('totalUsuarios').innerText=(total===undefined||total===null)?0:total;
    document.getElementById('cadastrosHoje').innerText=(hoje===undefined||hoje===null)?0:hoje;
    document.getElementById('ultimos7dias').innerText=(dias7===undefined||dias7===null)?0:dias7;
    document.getElementById('seuEmail').innerText=data.seuEmail || data.email || '';
    setCard('totalUsuarios',total); setCard('cadastrosHoje',hoje); setCard('ultimos7dias',dias7);
    document.getElementById('c-hoje-data').textContent=new Date().toLocaleDateString('pt-BR');
    authFetch('/me',{credentials:'include', headers: authHeaders()})
      .then(me => { if(me.ok) return me.json(); throw new Error('HTTP '+me.status) })
      .then(d => { document.querySelector('[data-email]').innerText=d.user.email; document.getElementById('seuEmail').innerText=d.user.email; document.getElementById('c-role').textContent=d.user.role })
      .catch(e => console.error('Falha ao carregar /me:', e));
    renderGrafico(data.cadastrosPorDia||data.porDia||[]);
  })
  .catch(e => {
    console.error('Falha ao carregar stats:', e);
    document.querySelector('[data-total]').innerText=0;
    document.querySelector('[data-hoje]').innerText=0;
    document.querySelector('[data-7dias]').innerText=0;
    document.querySelector('[data-email]').innerText='';
    document.getElementById('totalUsuarios').innerText=0;
    document.getElementById('cadastrosHoje').innerText=0;
    document.getElementById('ultimos7dias').innerText=0;
    document.getElementById('seuEmail').innerText='';
    setCard('totalUsuarios',0); setCard('cadastrosHoje',0); setCard('ultimos7dias',0);
    renderGrafico([]);
    // Erro visível (antes ficava "0" silencioso parecendo banco vazio):
    try{
      var gv=document.getElementById('grafico-vazio');
      gv.style.display='block';
      gv.innerHTML='Erro ao carregar ('+esc(String((e&&e.message)||e))+'). Faça login de novo como admin e recarregue.';
    }catch(e2){}
  });
}
async function loadUsers(){
  try{
    let u=await authFetch('/admin/users', {credentials: 'include', headers: authHeaders()});
    if(!u.ok) u=await authFetch('/api/admin/users', {credentials: 'include', headers: authHeaders()});
    if(!u.ok) throw new Error('HTTP '+u.status);
    todos=await u.json(); render(todos);
  }catch(e){
    console.error('Falha ao carregar /api/admin/users:', e);
    todos=[];
    try{
      var tb=document.getElementById('tbody');
      var msg401=String((e&&e.message)||e).indexOf('401')!==-1
        ? 'Sessão expirada ou sem login — entre de novo como admin e recarregue.'
        : 'Erro ao carregar usuários ('+esc(String((e&&e.message)||e))+').';
      tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#f87171">'+msg401+'</td></tr>';
    }catch(e2){ render([]); }
  }
}
async function load(){
  await loadStats();
  await loadUsers();
}
function render(list){
  const tb=document.getElementById('tbody'); tb.innerHTML='';
  if(!list.length){ tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#94a3b8">Nenhum usuário encontrado.</td></tr>'; return }
  list.forEach(user=>{
    const tr=document.createElement('tr');
    const data=user.createdAt||user.criadoEm||'';
    const dataFmt=data? new Date(data).toLocaleString('pt-BR') : '-';
    tr.innerHTML='<td>'+user.nome+'</td><td>'+user.email+'</td><td><span class="badge-'+user.role+' badge">'+user.role+'</span></td><td>'+dataFmt+'</td><td><button class="btn btn-prom" onclick="promover(\\''+user.id+'\\',\\''+user.role+'\\')">'+(user.role==='admin'?'Rebaixar':'Promover')+'</button> <button class="btn btn-del" onclick="deletar(\\''+user.id+'\\')">Deletar</button></td>';
    tb.appendChild(tr);
  })
}
document.getElementById('busca').addEventListener('input', e=>{
  const q=e.target.value.toLowerCase();
  render(todos.filter(u=> u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
})
async function deletar(id){
  if(!confirm('Deletar usuário?')) return;
  const r=await authFetch('/api/admin/users/'+id,{method:'DELETE', credentials:'include', headers: authHeaders()});
  const d=await r.json(); if(!r.ok) return alert(d.erro||'Erro');
  load()
}
async function promover(id,role){
  const novo= role==='admin' ? 'user' : 'admin';
  const r=await authFetch('/api/admin/users/'+id+'/role',{method:'PUT', credentials:'include', headers:{'Content-Type':'application/json', ...authHeaders()}, body: JSON.stringify({role:novo})});
  const d=await r.json(); if(!r.ok) return alert(d.erro||'Erro');
  load()
}
function listaDaAba(aba){ return aba==='ativos' ? projetosAtivos : projetosConcluidos }
function selDaAba(aba){ return aba==='ativos' ? selecionadosAtivos : selecionadosConcluidos }
function optsStatus(atual){
  const lista=['pendente','em_andamento','concluido','cancelado'];
  let o='';
  lista.forEach(s=>{ o+='<option value="'+s+'" '+(atual===s?'selected':'')+'>'+s+'</option>' });
  return o;
}
async function loadProjetosTab(aba){
  const cont=document.getElementById(aba+'-lista');
  cont.innerHTML='<p style="color:#94a3b8">Carregando...</p>';
  try{
    const r=await authFetch('/api/admin/projetos?filtro='+aba,{credentials:'include', headers: authHeaders()});
    if(!r.ok){
      if(r.status===401) cont.innerHTML='<p style="color:#f87171">Sessão expirada — entre de novo como admin e recarregue.</p>';
      else cont.innerHTML='<p style="color:#f87171">Erro ao carregar (HTTP '+r.status+').</p>';
      return;
    }
    const list=await r.json();
    if(aba==='ativos'){ projetosAtivos=list; selecionadosAtivos=new Set() }
    else{ projetosConcluidos=list; selecionadosConcluidos=new Set() }
  }catch(e){
    console.error('Falha ao carregar projetos:', e);
    cont.innerHTML='<p style="color:#f87171">Erro de conexão. Verifique se o backend está no ar e recarregue.</p>';
    return;
  }
  renderProjetosTab(aba)
}
function renderProjetosTab(aba){
  const list=listaDaAba(aba), sel=selDaAba(aba);
  const cont=document.getElementById(aba+'-lista'); cont.innerHTML='';
  document.getElementById('count-'+aba).textContent=list.length+' projeto(s) • '+sel.size+' selecionado(s)';
  if(!list.length){ cont.innerHTML='<p style="color:#94a3b8">Nenhum projeto aqui.</p>'; return; }
  list.forEach(p=>{
    const div=document.createElement('div'); div.className='proj-card';
    const link=p.linkFinal||p.link_final||'';
    let corpo='<div style="display:flex;gap:10px;align-items:flex-start">'
      +'<input type="checkbox" class="proj-check" '+(sel.has(p.id)?'checked':'')+' onchange="alternarSel(\\''+aba+'\\',\\''+p.id+'\\',this.checked)"/>'
      +'<div style="flex:1">'
      +'<strong>'+esc(p.nomeCliente)+'</strong> <span style="color:#94a3b8">('+esc(p.emailCliente)+')</span>'
      +'<p><strong>Descrição:</strong> '+esc(p.descricaoSite)+'</p>'
      +'<p><strong>Valor:</strong> '+(p.valor ? 'R$'+p.valor : 'a definir')+' | <strong>Status:</strong> '+esc(p.status)+(p.pagamentoConfirmado ? ' ✅ pago' : '')
      +((p.dataEntrega||p.concluidoEm) ? ' | <strong>Entregue:</strong> '+new Date(p.dataEntrega||p.concluidoEm).toLocaleString('pt-BR') : '')
      +' | <strong>Data:</strong> '+(p.criadoEm?new Date(p.criadoEm).toLocaleString('pt-BR'):'-')+'</p>';
    if(aba==='ativos'){
      corpo+='<label style="font-size:.75rem;color:#94a3b8">Status</label><select id="st-'+p.id+'">'+optsStatus(p.status)+'</select>'
        +'<label style="font-size:.75rem;color:#94a3b8">Link final</label><input id="link-'+p.id+'" value="'+escAttr(link)+'" placeholder="https://..."/>'
        +'<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">'
        +'<button class="btn btn-save" onclick="salvarProj(\\''+p.id+'\\')">Salvar</button>'
        +'<button class="btn btn-prom" onclick="confirmarPag(\\''+p.id+'\\')">Confirmar Pagamento</button>'
        +'<button class="btn btn-save" style="background:#06b6d4;color:#0f172a" onclick="concluirProj(\\''+p.id+'\\')">Marcar como Concluído</button>'
        +'<button class="btn btn-del" onclick="excluirUm(\\''+p.id+'\\')">Excluir</button></div>'
        +' <span id="msg-'+p.id+'" style="font-size:.78rem;color:#10b981;margin-left:8px"></span>';
    }else{
      if(link) corpo+='<p><strong>Link:</strong> <a style="color:#06b6d4;word-break:break-all" href="'+escAttr(link)+'" target="_blank">'+esc(link)+'</a></p>';
      corpo+='<div style="margin-top:8px"><button class="btn btn-del" onclick="excluirUm(\\''+p.id+'\\')">Excluir</button></div>';
    }
    corpo+='</div></div>';
    div.innerHTML=corpo;
    cont.appendChild(div);
  })
}
function alternarSel(aba,id,marcado){
  const s=selDaAba(aba);
  if(marcado) s.add(id); else s.delete(id);
  renderProjetosTab(aba)
}
function selecionarTodos(aba){
  const s=selDaAba(aba), l=listaDaAba(aba);
  if(s.size===l.length) s.clear(); else l.forEach(p=>s.add(p.id));
  renderProjetosTab(aba)
}
async function excluirUm(id){
  if(!confirm('Tem certeza que quer excluir 1 projeto do histórico?')) return;
  const r=await authFetch('/api/admin/projetos/'+id,{method:'DELETE', credentials:'include', headers: authHeaders()});
  const d=await r.json().catch(()=>({})); if(!r.ok) return alert(d.erro||'Erro');
  loadProjetosTab('ativos'); loadProjetosTab('concluidos');
}
async function excluirSelecionados(aba){
  const ids=[...selDaAba(aba)];
  if(!ids.length) return alert('Selecione ao menos 1 projeto.');
  if(!confirm('Tem certeza que quer excluir '+ids.length+' projetos do histórico?')) return;
  const r=await authFetch('/api/admin/projetos/delete-many',{method:'POST', credentials:'include', headers:{'Content-Type':'application/json', ...authHeaders()}, body: JSON.stringify({ids})});
  const d=await r.json().catch(()=>({})); if(!r.ok) return alert(d.erro||'Erro');
  alert(d.msg||'Excluídos!');
  loadProjetosTab('ativos'); loadProjetosTab('concluidos');
}
async function zerarHistorico(){
  const total=projetosAtivos.length+projetosConcluidos.length;
  if(!confirm('Tem certeza que quer excluir '+total+' projetos do histórico? Isso apaga TUDO.')) return;
  const r=await authFetch('/api/admin/projetos',{method:'DELETE', credentials:'include', headers: authHeaders()});
  const d=await r.json().catch(()=>({})); if(!r.ok) return alert(d.erro||'Erro');
  alert(d.msg||'Histórico zerado!');
  loadProjetosTab('ativos'); loadProjetosTab('concluidos');
}
async function salvarProj(id){
  const status=document.getElementById('st-'+id).value;
  const linkFinal=document.getElementById('link-'+id).value;
  const r=await authFetch('/api/projetos/'+id,{method:'PUT', credentials:'include', headers:{'Content-Type':'application/json', ...authHeaders()}, body: JSON.stringify({status, link_final: linkFinal})});
  const d=await r.json(); if(!r.ok) return alert(d.erro||'Erro');
  document.getElementById('msg-'+id).textContent='Salvo! Cliente vê instantaneamente.';
  setTimeout(()=>{ loadProjetosTab('ativos'); loadProjetosTab('concluidos') },500)
}
async function confirmarPag(id){
  if(!confirm('Confirmar pagamento? Projeto vai para em_andamento.')) return;
  const r=await authFetch('/api/admin/projeto/'+id+'/confirmar-pagamento',{method:'PUT', credentials:'include', headers: authHeaders()});
  const d=await r.json(); if(!r.ok) return alert(d.erro||'Erro');
  alert('Pagamento confirmado! Projeto entrou na fila.');
  loadProjetosTab('ativos'); loadProjetosTab('concluidos')
}
async function concluirProj(id){
  const linkEl=document.getElementById('link-'+id);
  if(!confirm('Marcar projeto como concluído? Ele sai de Ativos e vai para Concluídos.')) return;
  const r=await authFetch('/api/admin/projetos/'+id+'/concluir',{method:'PUT', credentials:'include', headers:{'Content-Type':'application/json', ...authHeaders()}, body: JSON.stringify({link_final: linkEl?linkEl.value:undefined})});
  const d=await r.json().catch(()=>({})); if(!r.ok) return alert(d.erro||'Erro');
  alert('Projeto concluído! Foi para Concluídos.');
  loadProjetosTab('ativos'); loadProjetosTab('concluidos')
}
function soDig(v){ return String(v||'').replace(/\D/g,'') }
let supConversas=[], supSel=null, supTimer=null;
async function loadSuporte(){
  await carregarSuporte(false);
  if(supTimer) clearInterval(supTimer);
  supTimer=setInterval(()=>{ if(document.getElementById('sec-suporte').style.display!=='none') carregarSuporte(true) },3000);
}
async function carregarSuporte(silent){
  try{
    const rc=await authFetch('/api/contacts',{credentials:'include', headers: authHeaders()});
    const contacts=rc.ok?await rc.json():[];
    const rm=await authFetch('/api/messages',{credentials:'include', headers: authHeaders()});
    const map=(rm.ok?await rm.json():{});
    const mapa=(map&&!Array.isArray(map)&&typeof map==='object')?map:{};
    const lista=[];
    const vistos=new Set();
    (Array.isArray(contacts)?contacts:[]).forEach(ct=>{
      const jid=ct.jid||(soDig(ct.numero||ct.jid)+'@s.whatsapp.net');
      if(!jid||vistos.has(jid)) return;
      vistos.add(jid);
      let msgs=Array.isArray(mapa[jid])?mapa[jid]:[];
      if(!msgs.length){
        const dig=soDig(jid);
        const key=Object.keys(mapa).find(k=>k===jid||soDig(k)===dig);
        if(key&&Array.isArray(mapa[key])) msgs=mapa[key];
      }
      lista.push({id:jid,nome:ct.nome||ct.name||soDig(ct.numero||jid),fone:soDig(ct.numero||jid),messages:msgs});
    });
    Object.keys(mapa).forEach(key=>{
      if(vistos.has(key)||!Array.isArray(mapa[key])||!mapa[key].length) return;
      lista.push({id:key,nome:'Cliente '+soDig(key).slice(-4),fone:soDig(key),messages:mapa[key]});
    });
    supConversas=lista;
    renderSupLista();
    if(supSel){
      const fresh=lista.find(c=>c.id===supSel.id);
      if(fresh){ supSel=fresh; renderSupThread() }
    }
  }catch(e){
    if(!silent) document.getElementById('sup-lista').innerHTML='<p style="color:#f87171">Erro ao carregar.</p>';
  }
}
function renderSupLista(){
  const box=document.getElementById('sup-lista'); box.innerHTML='';
  if(!supConversas.length){ box.innerHTML='<p style="color:#94a3b8">Nenhuma conversa.</p>'; return }
  supConversas.forEach(c=>{
    const last=c.messages[c.messages.length-1];
    const div=document.createElement('div');
    div.className='sup-item'+(supSel&&supSel.id===c.id?' sel':'');
    div.innerHTML='<strong style="font-size:.9rem">'+esc(c.nome)+'</strong><div style="font-size:.75rem;color:#94a3b8">'+esc(c.fone)+'</div><div style="font-size:.8rem;color:#cbd5e1;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(last?last.text:'')+'</div>';
    div.onclick=()=>{ supSel=c; renderSupLista(); renderSupThread() };
    box.appendChild(div);
  })
}
function renderSupThread(){
  const head=document.getElementById('sup-head'), th=document.getElementById('sup-thread');
  if(!supSel){ head.textContent='Selecione uma conversa'; th.innerHTML=''; return }
  head.innerHTML='<strong style="color:#fff">'+esc(supSel.nome)+'</strong> <span style="color:#94a3b8">'+esc(supSel.fone)+'</span> <a style="color:#06b6d4;font-size:.78rem" target="_blank" href="https://wa.me/'+escAttr(supSel.fone)+'">WhatsApp 5511916572015</a>';
  th.innerHTML='';
  supSel.messages.forEach(m=>{
    const d=document.createElement('div');
    d.className='sup-msg '+(m.role==='user'?'user':'bot');
    d.textContent=m.text;
    th.appendChild(d);
  });
  th.scrollTop=th.scrollHeight;
}
async function supResponder(){
  const inp=document.getElementById('sup-resp');
  const texto=inp.value.trim();
  if(!texto||!supSel) return;
  inp.value='';
  const jid=supSel.id;
  await authFetch('/api/messages',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json', ...authHeaders()},body:JSON.stringify({jid,text:texto,fromMe:true})});
  carregarSuporte(true);
}
document.getElementById('sup-resp').addEventListener('keydown',e=>{ if(e.key==='Enter') supResponder() });
let botOpcoes=[], botEditId=null;
function toggleBotForm(edit){
  const f=document.getElementById('bot-form');
  const abrir = edit === true ? true : (f.style.display==='none');
  f.style.display = abrir ? 'block' : 'none';
  if(!abrir){ botEditId=null; document.getElementById('bot-pergunta').value=''; document.getElementById('bot-resposta').value=''; document.getElementById('bot-ordem').value=''; document.getElementById('bot-ativo').checked=true; document.getElementById('btn-bot-salvar').textContent='SALVAR'; document.getElementById('msg-bot').textContent=''; }
}
async function loadBot(){
  const box=document.getElementById('bot-lista');
  box.innerHTML='<p style="color:#94a3b8">Carregando...</p>';
  try{
    const r=await authFetch('/api/support-options',{credentials:'include', headers: authHeaders()});
    if(!r.ok) throw new Error('HTTP '+r.status);
    botOpcoes=await r.json();
    renderBot();
  }catch(e){
    console.error('Falha ao carregar FAQ:', e);
    box.innerHTML='<p style="color:#f87171">Erro ao carregar.</p>';
  }
}
function renderBot(){
  const box=document.getElementById('bot-lista'); box.innerHTML='';
  document.getElementById('msg-bot').textContent='';
  if(!botOpcoes.length){ box.innerHTML='<p style="color:#94a3b8">Nenhuma pergunta. Adicione a primeira!</p>'; return }
  botOpcoes.forEach(o=>{
    const div=document.createElement('div'); div.className='proj-card';
    div.innerHTML='<div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between">'
      +'<div style="flex:1"><strong>#'+esc(String(o.ordem))+ ' — ' +esc(o.pergunta)+'</strong>'
      +'<p style="font-size:.84rem;color:#cbd5e1;margin-top:4px">'+esc(o.resposta)+'</p>'
      +'<div style="font-size:.72rem;margin-top:4px;color:'+(o.ativo?'#10b981':'#f87171')+';font-weight:700">'+(o.ativo?'ATIVO':'INATIVO')+'</div></div>'
      +'<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-prom" onclick="editarBot(\\''+o.id+'\\')">Editar</button>'
      +'<button class="btn btn-del" onclick="excluirBot(\\''+o.id+'\\')">Excluir</button></div></div>';
    box.appendChild(div);
  });
}
async function salvarBot(){
  const m=document.getElementById('msg-bot');
  const pergunta=document.getElementById('bot-pergunta').value.trim();
  const resposta=document.getElementById('bot-resposta').value.trim();
  const ordem=document.getElementById('bot-ordem').value;
  const ativo=document.getElementById('bot-ativo').checked;
  if(!pergunta||!resposta){ m.style.color='#f87171'; m.textContent='Preencha pergunta e resposta.'; return }
  m.style.color='#94a3b8'; m.textContent='Salvando...';
  const body={pergunta,resposta,ativo};
  if(ordem!==''&&ordem!==null) body.ordem=Number(ordem);
  const url= botEditId ? '/api/support-options/'+botEditId : '/api/support-options';
  const method= botEditId ? 'PUT' : 'POST';
  const r=await authFetch(url,{method, credentials:'include', headers:{'Content-Type':'application/json', ...authHeaders()}, body: JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){ m.style.color='#f87171'; m.textContent=d.erro||'Erro ao salvar'; return }
  m.style.color='#10b981'; m.textContent='Salvo!';
  toggleBotForm(false); loadBot();
}
function editarBot(id){
  const o=botOpcoes.find(x=>String(x.id)===String(id));
  if(!o) return;
  botEditId=o.id;
  document.getElementById('bot-pergunta').value=o.pergunta||'';
  document.getElementById('bot-resposta').value=o.resposta||'';
  document.getElementById('bot-ordem').value=(o.ordem!==undefined&&o.ordem!==null)?o.ordem:'';
  document.getElementById('bot-ativo').checked=o.ativo!==false;
  document.getElementById('btn-bot-salvar').textContent='ATUALIZAR';
  document.getElementById('bot-form').style.display='block';
}
async function excluirBot(id){
  if(!confirm('Excluir esta pergunta do FAQ?')) return;
  const r=await authFetch('/api/support-options/'+id,{method:'DELETE', credentials:'include', headers: authHeaders()});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) return alert(d.erro||'Erro');
  loadBot();
}

let portItens=[];
function togglePortForm(){
  const f=document.getElementById('port-form');
  f.style.display = f.style.display==='none' ? 'block' : 'none';
}
function loadPortfolio(){
  const grid=document.getElementById('port-grid');
  if(!grid){ console.error('Grid do portfólio não encontrada no HTML (port-grid)'); return }
  grid.innerHTML='<p style="color:#94a3b8">Carregando...</p>';
  authFetch('/admin/sites', {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders()
  })
  .then(r => { if(!r.ok) throw new Error('HTTP '+r.status+' em /admin/sites'); return r.json() })
  .catch(() => authFetch('/api/admin/sites',{credentials:'include', headers: authHeaders()}).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json() }))
  .catch(() => authFetch('/api/portfolio',{credentials:'include'}).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json() }))
  .then(data => {
    portItens=Array.isArray(data)?data:[];
    renderPortfolioGrid();
  })
  .catch(e => {
    console.error('Falha ao carregar sites do portfólio:', e);
    grid.innerHTML='<p style="color:#f87171">Erro ao carregar. Abra o console (F12) e verifique.</p>';
  });
}
function renderPortfolioGrid(){
  const grid=document.getElementById('port-grid');
  grid.innerHTML='';
  if(!portItens.length){ grid.innerHTML='<p style="color:#94a3b8">Nenhum site criado ainda</p>'; return }
  portItens.forEach(p=>{
    const div=document.createElement('div'); div.className='proj-card';
    const titulo=p.titulo||p.nome||'Sem título';
    const cliente=p.cliente_nome||p.cliente||'';
    const link=p.link_site||p.link||'';
    const prev = p.tipo==='video'
      ? '<video src="'+escAttr(p.url_arquivo)+'" style="width:100%;border-radius:8px;max-height:160px" preload="metadata" controls></video>'
      : '<img src="'+escAttr(p.url_arquivo)+'" alt="'+escAttr(titulo)+'" style="width:100%;border-radius:8px;max-height:160px;object-fit:cover"/>';
    div.innerHTML=prev
      +'<strong style="display:block;margin-top:8px">'+esc(titulo)+'</strong>'
      +'<div style="font-size:.78rem;color:#94a3b8">Cliente: '+esc(cliente||'-')+'</div>'
      +(link?'<div style="font-size:.78rem;margin-top:4px;word-break:break-all"><a style="color:#06b6d4" href="'+escAttr(link)+'" target="_blank">'+esc(link)+'</a></div>':'')
      +'<div style="font-size:.72rem;color:#10b981;font-weight:700;margin-top:4px">Status: '+esc(p.status||'publicado')+'</div>'
      +'<div style="margin-top:8px"><button class="btn btn-del" onclick="excluirPort(\\''+p.id+'\\')">Excluir</button></div>';
    grid.appendChild(div);
  });
}
async function publicarPort(){
  const m=document.getElementById('msg-port');
  const titulo=document.getElementById('port-titulo').value.trim();
  const arq=document.getElementById('port-arquivo').files[0];
  if(!titulo){ m.style.color='#f87171'; m.textContent='Informe o título.'; return }
  if(!arq){ m.style.color='#f87171'; m.textContent='Escolha foto ou vídeo (até 50MB).'; return }
  m.style.color='#94a3b8'; m.textContent='Publicando...';
  const fd=new FormData();
  fd.append('arquivo', arq);
  fd.append('titulo', titulo);
  fd.append('cliente_nome', document.getElementById('port-cliente').value.trim());
  fd.append('descricao', document.getElementById('port-desc').value.trim());
  fd.append('link_site', document.getElementById('port-link').value.trim());
  const r=await authFetch('/api/admin/portfolio',{method:'POST', credentials:'include', headers: authHeaders(), body: fd});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){ m.style.color='#f87171'; m.textContent=d.erro||'Erro ao publicar'; return }
  m.style.color='#10b981'; m.textContent='Publicado! Já aparece no GET /api/portfolio.';
  document.getElementById('port-titulo').value='';
  document.getElementById('port-cliente').value='';
  document.getElementById('port-desc').value='';
  document.getElementById('port-link').value='';
  document.getElementById('port-arquivo').value='';
  document.getElementById('port-prev').textContent='';
  loadPortfolio();
}
async function excluirPort(id){
  if(!confirm('Excluir este item do portfólio?')) return;
  const r=await authFetch('/api/admin/portfolio/'+id,{method:'DELETE', credentials:'include', headers: authHeaders()});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) return alert(d.erro||'Erro');
  loadPortfolio();
}
(function initPortDrop(){
  const drop=document.getElementById('port-drop');
  const inp=document.getElementById('port-arquivo');
  const prev=document.getElementById('port-prev');
  if(!drop||!inp) return;
  drop.addEventListener('click',()=>inp.click());
  inp.addEventListener('change',()=>{ if(inp.files[0]) prev.textContent='Selecionado: '+inp.files[0].name });
  ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,(e)=>{ e.preventDefault(); drop.style.borderColor='#06b6d4' }));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,(e)=>{ e.preventDefault(); drop.style.borderColor='#334155' }));
  drop.addEventListener('drop',(e)=>{
    if(e.dataTransfer.files && e.dataTransfer.files[0]){
      inp.files=e.dataTransfer.files;
      prev.textContent='Selecionado: '+inp.files[0].name;
    }
  });
})();
load();
</script>
</body>
</html>`)
})

// GET /admin/funcionarios -> gestão de funcionários/admins (só admin).
// Cada funcionário faz login com o PRÓPRIO email/senha e recebe o PRÓPRIO token (cookie httpOnly).
// Token nunca é compartilhado entre funcionários.
app.get('/admin/funcionarios', autenticarToken, isAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Funcionários - Admin Empresas Nick</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{background:#0f172a;color:#e2e8f0;min-height:100vh}
header{padding:18px 24px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;background:#0f172a;position:sticky;top:0}
header h1{font-size:1.25rem;color:#06b6d4}
header a{color:#94a3b8;text-decoration:none;font-size:.9rem}
.container{max-width:900px;margin:0 auto;padding:24px;width:92%}
.topnav{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.topnav a{padding:10px 16px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-weight:700;font-size:.85rem;text-decoration:none}
.card{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:18px;margin-bottom:16px}
.card h3{margin-bottom:12px;color:#fff}
label{display:block;font-size:.78rem;color:#94a3b8;margin:10px 0 4px;font-weight:600}
input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;outline:none;font-size:.9rem}
table{width:100%;border-collapse:collapse;font-size:.9rem;margin-top:8px}
th,td{padding:10px 8px;text-align:left;border-bottom:1px solid #334155}
th{color:#94a3b8;font-weight:600;font-size:.78rem;text-transform:uppercase}
.badge{padding:3px 8px;border-radius:999px;font-size:.72rem;font-weight:700;background:#06b6d4;color:#0f172a}
.btn{padding:8px 14px;border-radius:10px;border:none;cursor:pointer;font-size:.85rem;font-weight:700}
.btn-save{background:#10b981;color:#fff}
.btn-del{background:#ef4444;color:#fff}
.btn:hover{opacity:.9}
.msg{font-size:.82rem;margin-top:8px;min-height:20px}
.msg.ok{color:#10b981}
.msg.erro{color:#f87171}
.hint{font-size:.78rem;color:#64748b;margin-top:10px}
</style>
</head>
<body>
<header><h1>Empresas Nick — Admin</h1><a href="/admin">← voltar ao painel</a></header>
<div class="container">
  <div class="topnav">
    <a href="/admin">Dashboard</a>
    <a href="/admin/config-pix-payment">💠 ConfigPixPayment</a>
  </div>
  <h2 style="font-size:1.3rem;margin-bottom:4px;color:#fff">Funcionários com acesso admin</h2>
  <p class="hint" style="margin-bottom:16px">Cada funcionário entra com o próprio email/senha e recebe o próprio token. Nada é compartilhado.</p>
  <div class="card">
    <h3>Dar acesso admin</h3>
    <label>E-mail do funcionário (precisa ter conta criada)</label>
    <div style="display:flex;gap:8px">
      <input id="novo-email" type="email" placeholder="funcionario@email.com"/>
      <button class="btn btn-save" style="white-space:nowrap" onclick="darAcesso()">Dar acesso admin</button>
    </div>
    <div class="msg" id="msg-add"></div>
  </div>
  <div class="card">
    <h3>Quem tem acesso (<span id="total-func">0</span>)</h3>
    <div style="overflow:auto">
    <table>
      <thead><tr><th>Nome</th><th>Email</th><th>Virou admin em</th><th>Adicionado por</th><th>Ações</th></tr></thead>
      <tbody id="tbody-func"><tr><td colspan="5" style="text-align:center;color:#94a3b8">Carregando...</td></tr></tbody>
    </table>
    </div>
  </div>
</div>
<script>
// Handoff ?token= -> localStorage (mesma regra do /admin).
(function(){try{var m=new URLSearchParams(location.search).get('token');if(m){['token','adminToken','authToken','en_token'].forEach(function(k){try{localStorage.setItem(k,m)}catch(e){}});var u=new URL(location.href);u.searchParams.delete('token');history.replaceState(null,'',u);}}catch(e){}})();
// Interceptor global do admin (padrão api.js): TODO fetch envia
// cookie httpOnly + Authorization: Bearer do localStorage.
function adminTokenFunc(){
  try{
    return localStorage.getItem('token') || localStorage.getItem('adminToken') || localStorage.getItem('authToken') || localStorage.getItem('en_token') || '';
  }catch(e){ return '' }
}
function authFetch(url, options){
  options = options || {};
  options.credentials = 'include';
  options.headers = options.headers || {};
  try{
    const t = adminTokenFunc();
    if(t && !options.headers['Authorization'] && !options.headers['authorization']) options.headers['Authorization'] = 'Bearer ' + t;
  }catch(e){}
  return fetch(url, options);
}
function authHeaders(){
  let h={};
  try{ const t=adminTokenFunc(); if(t) h={ 'Authorization':'Bearer '+t }; }catch(e){}
  return h;
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function carregarFunc(){
  const tb=document.getElementById('tbody-func');
  try{
    const r=await authFetch('/api/admin/funcionarios',{credentials:'include', headers: authHeaders()});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const list=await r.json();
    document.getElementById('total-func').textContent=list.length;
    if(!list.length){ tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#94a3b8">Nenhum funcionário com acesso.</td></tr>'; return }
    tb.innerHTML='';
    list.forEach(u=>{
      const tr=document.createElement('tr');
      const desde=u.adminDesde?new Date(u.adminDesde).toLocaleString('pt-BR'):'-';
      tr.innerHTML='<td>'+esc(u.nome)+'</td><td>'+esc(u.email)+'</td><td>'+desde+'</td><td>'+esc(u.addedBy||'-')+'</td><td><button class="btn btn-del" onclick="removerAcesso(\\''+u.id+'\\',\\''+esc(u.email)+'\\')">Remover acesso</button></td>';
      tb.appendChild(tr);
    });
  }catch(e){
    console.error('Falha ao carregar funcionários:', e);
    tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#f87171">Erro ao carregar. Verifique o console.</td></tr>';
  }
}
async function darAcesso(){
  const m=document.getElementById('msg-add');
  const email=document.getElementById('novo-email').value.trim();
  if(!email){ m.className='msg erro'; m.textContent='Informe o e-mail.'; return }
  m.className='msg'; m.textContent='Salvando...';
  try{
    const r=await authFetch('/api/admin/funcionarios',{method:'PUT', credentials:'include', headers:{'Content-Type':'application/json', ...authHeaders()}, body: JSON.stringify({email})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ m.className='msg erro'; m.textContent=d.erro||'Erro'; return }
    m.className='msg ok'; m.textContent='Acesso admin concedido para '+email+'!';
    document.getElementById('novo-email').value='';
    carregarFunc();
  }catch(e){
    console.error('Falha ao dar acesso:', e);
    m.className='msg erro'; m.textContent='Erro de conexão.';
  }
}
async function removerAcesso(id,email){
  if(!confirm('Remover acesso admin de '+email+'?')) return;
  try{
    const r=await authFetch('/api/admin/funcionarios/'+id,{method:'DELETE', credentials:'include', headers: authHeaders()});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) return alert(d.erro||'Erro');
    carregarFunc();
  }catch(e){ console.error('Falha ao remover acesso:', e); alert('Erro de conexão.') }
}
carregarFunc()
</script>
</body>
</html>`)
})

app.get('/admin/config-pix-payment', autenticarToken, isAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ConfigPixPayment - Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{background:#0f172a;color:#e2e8f0;min-height:100vh}
header{padding:18px 24px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;background:#0f172a;position:sticky;top:0}
header h1{font-size:1.25rem;color:#06b6d4}
header a{color:#94a3b8;text-decoration:none;font-size:.9rem}
.container{max-width:760px;margin:0 auto;padding:24px;width:92%}
.topnav{display:flex;gap:10px;margin-bottom:18px}
.topnav a{padding:10px 16px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-weight:700;font-size:.85rem;text-decoration:none}
.topnav a.active{background:#06b6d4;color:#0f172a;border-color:#06b6d4}
h2{font-size:1.3rem;margin-bottom:16px;color:#fff}
.secao{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:18px;margin-bottom:16px}
.secao h3{margin-bottom:12px;color:#06b6d4;font-size:1rem}
label{display:block;font-size:.78rem;color:#94a3b8;margin:10px 0 4px;font-weight:600}
input,select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;outline:none;font-size:.9rem}
input:focus,select:focus{border-color:#06b6d4}
.check{display:flex;align-items:center;gap:10px;margin-top:14px;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px 12px;cursor:pointer}
.check input{width:auto}
.check span{font-size:.85rem;color:#e2e8f0}
.btn{padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:.85rem;font-weight:700}
.btn-teste{background:#0ea5e9;color:#fff;width:100%;margin-top:10px}
.btn-save{background:#10b981;color:#fff;width:100%;padding:14px;font-size:1rem;margin-top:6px}
.btn:hover{opacity:.9}
.msg{font-size:.82rem;margin-top:8px;min-height:20px}
.msg.ok{color:#10b981}
.msg.erro{color:#f87171}
#qr-teste{text-align:center;margin-top:12px}
#qr-teste img{width:220px;height:220px;border-radius:12px;background:#fff;padding:8px}
#copia-teste{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;margin-top:8px;font-size:.7rem;word-break:break-all;color:#cbd5e1;max-height:90px;overflow-y:auto;text-align:left}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
@media(max-width:600px){.grid2{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Empresas Nick — Admin</h1><a href="/">← voltar</a></header>
<div class="container">
  <div class="topnav">
    <a href="/admin">Dashboard</a>
    <a href="/admin/config-pix-payment" class="active">💠 ConfigPixPayment</a>
  </div>
  <h2>Configuração Pix - Pagamento</h2>

  <div class="secao">
    <h3>1 — Chave Pix</h3>
    <label>Chave Pix (CPF, CNPJ, email, telefone ou aleatória)</label>
    <input id="chavePix" placeholder="ex: contato@empresasnick.com"/>
    <div class="grid2">
      <div>
        <label>Tipo da chave</label>
        <select id="tipoChave">
          <option>CPF</option>
          <option>CNPJ</option>
          <option>Email</option>
          <option>Telefone</option>
          <option>Aleatória</option>
        </select>
      </div>
      <div>
        <label>Cidade do Recebedor</label>
        <input id="cidadeRecebedor" placeholder="ex: SAO PAULO"/>
      </div>
    </div>
    <label>Nome do Recebedor</label>
    <input id="nomeRecebedor" placeholder="ex: João Silva"/>
  </div>

  <div class="secao">
    <h3>2 — Valores dos Planos</h3>
    <div class="grid2">
      <div>
        <label>Valor Plano Start (R$)</label>
        <input id="valorStart" inputmode="decimal" placeholder="ex: valor do plano"/>
      </div>
      <div>
        <label>Valor Plano Pro (R$)</label>
        <input id="valorPro" inputmode="decimal" placeholder="ex: valor do plano"/>
      </div>
    </div>
    <label>Valor Plano Premium (R$)</label>
    <input id="valorPremium" inputmode="decimal" placeholder="ex: valor do plano"/>
    <label class="check"><input type="checkbox" id="modoTeste"/><span>Modo Teste (R$ 1,00 para todos)</span></label>
  </div>

  <div class="secao">
    <h3>3 — Teste</h3>
    <label>Valor do teste (R$)</label>
    <input id="valorTeste" inputmode="decimal" placeholder="ex: 15"/>
    <button class="btn btn-teste" onclick="gerarTeste()">Gerar QR Code de Teste</button>
    <div class="msg" id="msg-teste"></div>
    <div id="qr-teste"></div>
  </div>

  <button class="btn btn-save" onclick="salvar()">SALVAR CONFIGURAÇÃO</button>
  <div class="msg" id="msg-save"></div>

  <div class="secao" style="margin-top:16px">
    <h3>4 — Planos (checkout usa estes preços em tempo real)</h3>
    <p style="font-size:.8rem;color:#94a3b8;margin-bottom:10px">Ao salvar, o <strong>preco</strong> entra no card do site e no QR Code Pix automaticamente (valor_do_pix = plano.preco).</p>
    <label>Nome do plano *</label>
    <input id="plano-nome" placeholder="ex: Básico"/>
    <div class="grid2">
      <div>
        <label>Preço (R$) *</label>
        <input id="plano-preco" inputmode="decimal" placeholder="ex: 800"/>
      </div>
      <div>
        <label>Ordem</label>
        <input id="plano-ordem" type="number" placeholder="auto"/>
      </div>
    </div>
    <label>Descrição</label>
    <input id="plano-desc" placeholder="ex: site institucional completo"/>
    <label>Recursos (separados por vírgula)</label>
    <input id="plano-recursos" placeholder="ex: 5 páginas, WhatsApp, SEO"/>
    <div style="display:flex;gap:16px;margin-top:10px">
      <label class="check" style="flex:1;margin-top:0"><input type="checkbox" id="plano-destaque"/><span>Destaque</span></label>
      <label class="check" style="flex:1;margin-top:0"><input type="checkbox" id="plano-ativo" checked/><span>Ativo</span></label>
    </div>
    <div class="msg" id="msg-plano"></div>
    <button class="btn btn-save" id="btn-plano-salvar" style="margin-top:10px" onclick="salvarPlano()">ADICIONAR PLANO</button>
    <div id="planos-lista" style="margin-top:14px;display:grid;gap:10px"></div>
  </div>
</div>
<script>
// Handoff ?token= -> localStorage (mesma regra do /admin).
(function(){try{var m=new URLSearchParams(location.search).get('token');if(m){['token','adminToken','authToken','en_token'].forEach(function(k){try{localStorage.setItem(k,m)}catch(e){}});var u=new URL(location.href);u.searchParams.delete('token');history.replaceState(null,'',u);}}catch(e){}})();
// Broadcast tempo real ConfigPixPayment -> aba Pagamentos (sem F5).
// Mesma aba/página: CustomEvent. Outra aba/página: localStorage (storage event) + BroadcastChannel.
function broadcastPixAdmin(type, payload){
  try{
    if(type==='pix-config-updated'){
      window.dispatchEvent(new CustomEvent('pix-config-updated',{detail:payload||null}));
      localStorage.setItem('pix-config-updated-at', JSON.stringify({at:Date.now(), config:payload||null}));
    }else if(type==='planos-updated'){
      window.dispatchEvent(new CustomEvent('planos-updated'));
      localStorage.setItem('planos-updated-at', String(Date.now()));
    }else if(type==='pix-qr-gerado'){
      window.dispatchEvent(new CustomEvent('pix-qr-gerado',{detail:payload||null}));
      localStorage.setItem('pix-qr-gerado-at', JSON.stringify({at:Date.now(), qr:payload||null}));
    }
    if('BroadcastChannel' in window){
      const msg={type:type};
      if(type==='pix-config-updated') msg.config=payload||null;
      if(type==='pix-qr-gerado') msg.qr=payload||null;
      const bc=new BroadcastChannel('pix-admin');
      bc.postMessage(msg);
      bc.close();
    }
  }catch(e){}
}
async function carregar() {
  try {
    const r = await authFetch('/api/pix-config', { credentials: 'include' })
    if (!r.ok) return
    const c = await r.json()
    document.getElementById('chavePix').value = c.chavePix || ''
    document.getElementById('tipoChave').value = c.tipoChave || 'Email'
    document.getElementById('nomeRecebedor').value = c.nomeRecebedor || ''
    document.getElementById('cidadeRecebedor').value = c.cidadeRecebedor || ''
    document.getElementById('valorStart').value = c.valorStart ?? ''
    document.getElementById('valorPro').value = c.valorPro ?? ''
    document.getElementById('valorPremium').value = c.valorPremium ?? ''
    document.getElementById('modoTeste').checked = !!c.modoTeste
  } catch (e) {}
}
function lerTela() {
  return {
    chavePix: document.getElementById('chavePix').value.trim(),
    tipoChave: document.getElementById('tipoChave').value,
    nomeRecebedor: document.getElementById('nomeRecebedor').value.trim(),
    cidadeRecebedor: document.getElementById('cidadeRecebedor').value.trim(),
    valorStart: document.getElementById('valorStart').value,
    valorPro: document.getElementById('valorPro').value,
    valorPremium: document.getElementById('valorPremium').value,
    modoTeste: document.getElementById('modoTeste').checked
  }
}
document.getElementById('modoTeste').addEventListener('change', (e) => {
  if (e.target.checked) {
    document.getElementById('valorStart').value = '1'
    document.getElementById('valorPro').value = '1'
    document.getElementById('valorPremium').value = '1'
  }
})
async function salvar() {
  const m = document.getElementById('msg-save')
  m.className = 'msg'; m.textContent = 'Salvando...'
  const r = await authFetch('/api/pix-config', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lerTela()) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { m.className = 'msg erro'; m.textContent = d.erro || 'Erro ao salvar'; return }
  m.className = 'msg ok'; m.textContent = 'Configuração salva! Checkout e QR passam a usar esses valores.'
  if (d.config) broadcastPixAdmin('pix-config-updated', d.config)
  carregar()
}
async function gerarTeste() {
  const m = document.getElementById('msg-teste')
  const box = document.getElementById('qr-teste')
  m.className = 'msg'; m.textContent = 'Gerando...'
  box.innerHTML = ''
  const t = lerTela()
  const r = await authFetch('/api/pix-config/teste', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chavePix: t.chavePix, tipoChave: t.tipoChave, nomeRecebedor: t.nomeRecebedor, cidadeRecebedor: t.cidadeRecebedor, modoTeste: t.modoTeste, valor: document.getElementById('valorTeste').value }) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { m.className = 'msg erro'; m.textContent = d.erro || 'Erro ao gerar teste'; return }
  m.className = 'msg ok'; m.textContent = 'QR de teste gerado com R$' + d.valor
  broadcastPixAdmin('pix-qr-gerado', { copiaECola: d.copiaECola, qrCodeBase64: d.qrCodeBase64 || d.qrBase64 || d.qrcode, qrBase64: d.qrBase64 || d.qrCodeBase64 || d.qrcode, qrcode: d.qrcode || d.qrBase64 || d.qrCodeBase64, valor: d.valor, planoId: d.planoId || null, expiraEm: d.expiraEm || null })
  const img = document.createElement('img')
  img.src = d.qrBase64
  img.alt = 'QR Code Pix teste'
  const copia = document.createElement('div')
  copia.id = 'copia-teste'
  copia.textContent = d.copiaECola
  box.appendChild(img)
  box.appendChild(copia)
}
// --- CRUD PLANOS (conectado ao Pix em tempo real: preco -> card -> QR) ---
let planoEditId = null
// Interceptor global do admin (padrão api.js): TODO fetch envia
// cookie httpOnly + Authorization: Bearer do localStorage.
// (lê 'token', 'adminToken', 'authToken' e 'en_token' — login salva nas 4).
function adminTokenPlano(){
  try{
    return localStorage.getItem('token') || localStorage.getItem('adminToken') || localStorage.getItem('authToken') || localStorage.getItem('en_token') || '';
  }catch(e){ return '' }
}
function authFetch(url, options){
  options = options || {};
  options.credentials = 'include';
  options.headers = options.headers || {};
  try{
    const t = adminTokenPlano();
    if(t && !options.headers['Authorization'] && !options.headers['authorization']) options.headers['Authorization'] = 'Bearer ' + t;
  }catch(e){}
  return fetch(url, options);
}
function authPlano(){
  const t = adminTokenPlano();
  return t ? { 'Authorization': 'Bearer ' + t } : {};
}
function escPlano(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
async function carregarPlanos() {
  const box = document.getElementById('planos-lista')
  box.innerHTML = '<p style="font-size:.82rem;color:#94a3b8">Carregando planos...</p>'
  try {
    const r = await authFetch('/api/admin/planos?t=' + Date.now(), { cache: 'no-store', credentials: 'include', headers: authPlano() })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    renderPlanos(await r.json())
  } catch (e) {
    box.innerHTML = '<p style="font-size:.82rem;color:#f87171">Erro ao carregar planos.</p>'
  }
}
function renderPlanos(list) {
  const box = document.getElementById('planos-lista')
  box.innerHTML = ''
  if (!list.length) { box.innerHTML = '<p style="font-size:.82rem;color:#94a3b8">Nenhum plano. Adicione o primeiro!</p>'; return }
  list.forEach((p) => {
    const div = document.createElement('div')
    div.style.cssText = 'background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px'
    div.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
      + '<div><strong style="color:#fff">' + escPlano(p.nome) + '</strong> '
      + '<span style="color:#06b6d4;font-weight:800">R$' + escPlano(p.preco) + '</span> '
      + '<span style="font-size:.72rem;color:' + (p.ativo ? '#10b981' : '#f87171') + ';font-weight:700">' + (p.ativo ? 'ATIVO' : 'INATIVO') + '</span>'
      + (p.destaque ? ' <span style="font-size:.7rem;background:#06b6d4;color:#0f172a;font-weight:800;padding:2px 8px;border-radius:999px">DESTAQUE</span>' : '')
      + '<div style="font-size:.78rem;color:#94a3b8;margin-top:2px">' + escPlano(p.descricao || '-') + ' • ordem ' + escPlano(p.ordem) + '</div></div>'
      + '<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-save" style="width:auto;margin-top:0;padding:8px 12px" onclick="editarPlano(\\'' + p.id + '\\')">Editar</button>'
      + '<button class="btn btn-del btn" style="padding:8px 12px" onclick="excluirPlano(\\'' + p.id + '\\')">Excluir</button></div></div>'
    box.appendChild(div)
    div._plano = p
  })
}
function planoDoId(id) {
  const box = document.getElementById('planos-lista')
  for (const div of box.children) {
    if (div._plano && String(div._plano.id) === String(id)) return div._plano
  }
  return null
}
async function salvarPlano() {
  const m = document.getElementById('msg-plano')
  const nome = document.getElementById('plano-nome').value.trim()
  const preco = document.getElementById('plano-preco').value
  if (!nome) { m.className = 'msg erro'; m.textContent = 'Informe o nome do plano.'; return }
  m.className = 'msg'; m.textContent = 'Salvando...'
  const body = {
    nome,
    preco,
    descricao: document.getElementById('plano-desc').value.trim(),
    recursos: document.getElementById('plano-recursos').value,
    destaque: document.getElementById('plano-destaque').checked,
    ativo: document.getElementById('plano-ativo').checked,
  }
  const ordem = document.getElementById('plano-ordem').value
  if (ordem !== '') body.ordem = Number(ordem)
  const url = planoEditId ? '/api/planos/' + planoEditId : '/api/planos'
  const method = planoEditId ? 'PUT' : 'POST'
  const r = await authFetch(url, { method, cache: 'no-store', credentials: 'include', headers: { 'Content-Type': 'application/json', ...authPlano() }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { m.className = 'msg erro'; m.textContent = d.erro || 'Erro ao salvar plano'; return }
  m.className = 'msg ok'; m.textContent = 'Plano salvo! O checkout já mostra R$' + d.item.preco + ' e o Pix usa esse valor.'
  broadcastPixAdmin('planos-updated')
  limparFormPlano()
  carregarPlanos()
}
function editarPlano(id) {
  const p = planoDoId(id)
  if (!p) return
  planoEditId = p.id
  document.getElementById('plano-nome').value = p.nome || ''
  document.getElementById('plano-preco').value = p.preco ?? ''
  document.getElementById('plano-desc').value = p.descricao || ''
  document.getElementById('plano-recursos').value = (p.recursos || []).join(', ')
  document.getElementById('plano-destaque').checked = !!p.destaque
  document.getElementById('plano-ativo').checked = p.ativo !== false
  document.getElementById('plano-ordem').value = (p.ordem !== undefined && p.ordem !== null) ? p.ordem : ''
  document.getElementById('btn-plano-salvar').textContent = 'ATUALIZAR PLANO'
}
function limparFormPlano() {
  planoEditId = null
  document.getElementById('plano-nome').value = ''
  document.getElementById('plano-preco').value = ''
  document.getElementById('plano-desc').value = ''
  document.getElementById('plano-recursos').value = ''
  document.getElementById('plano-destaque').checked = false
  document.getElementById('plano-ativo').checked = true
  document.getElementById('plano-ordem').value = ''
  document.getElementById('btn-plano-salvar').textContent = 'ADICIONAR PLANO'
}
async function excluirPlano(id) {
  if (!confirm('Excluir este plano?')) return
  const r = await authFetch('/api/planos/' + id, { method: 'DELETE', cache: 'no-store', credentials: 'include', headers: authPlano() })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) return alert(d.erro || 'Erro')
  broadcastPixAdmin('planos-updated')
  carregarPlanos()
}
carregar()
carregarPlanos()
</script>
</body>
</html>`)
})

startWhatsApp().catch(e => console.log('Baileys QR:', e.message))
// O listen É a última coisa do arquivo: enquanto o socket estiver aberto o loop
// do Node fica vivo e o processo NÃO volta para o prompt.
// NÃO colocar process.exit / server.close / return top-level depois daqui.
// (PORT já declarado no topo; handlers uncaughtException/unhandledRejection idem.)
const server = app.listen(PORT, '0.0.0.0', () => {
  // Adia o "Servidor rodando" 1 tick: se a porta estiver ocupada (EADDRINUSE),
  // o 'error' chega logo depois do 'listening' e este bloco nem roda —
  // sem log prematuro enganoso, só o [FATAL] abaixo.
  setImmediate(() => {
    if (!server.listening) return
    ensureDataFile()
    ensureContactsFile()
    ensureMessagesFile()
    ensurePixConfigFile()
    ensurePortfolioFile()
    ensureUploadsPortfolioDir()
    ensureSupportOptionsFile()
    ensurePlanosFile()
    migrarProjetosParaStatusCanonico()
    console.log(`Servidor rodando na porta ${PORT}`)
  })
})
// Bind falhou (ex: EADDRINUSE = outro 'node server.js' ainda vivo segurando a
// porta)? NÃO pode ser silencioso: sem este handler o Node fecha o socket, o loop
// esvazia e o processo volta para o prompt sem mostrar erro nenhum.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Porta ${PORT} ja esta em uso — outro servidor ainda esta rodando.`)
    console.error(`[FATAL] Libere a porta (ex: fuser -k ${PORT}/tcp ou mate o processo antigo) e rode 'node server.js' de novo.`)
  } else {
    console.error('[FATAL] Falha ao abrir o servidor:', err && err.message)
  }
  process.exit(1)
})
