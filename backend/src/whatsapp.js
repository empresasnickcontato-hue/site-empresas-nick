// @ts-nocheck
import makeWASocket, { makeCacheableSignalKeyStore, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import fs from 'fs'
import path from 'path'

let sock = null
let sockConectado = null
let starting = false
let lastQr = ''

// Hook registrado pelo server.js para persistir msg recebida em disco (contacts + messages).
// Mantém este módulo sem depender do server (evita import circular).
let incomingHandler = null
export function onIncomingMessage(cb) {
  incomingHandler = cb
}

function extrairTexto(msg) {
  if (!msg || !msg.message) return ''
  const m = msg.message
  if (m.conversation) return m.conversation
  if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text
  if (m.imageMessage && m.imageMessage.caption) return m.imageMessage.caption
  if (m.videoMessage && m.videoMessage.caption) return m.videoMessage.caption
  return ''
}

export async function startWhatsApp() {
  if (sockConectado) return sockConectado
  if (starting) return sock
  starting = true
  try {
    await conectar()
    sockConectado = sock
  } finally {
    starting = false
  }
  return sockConectado
}

async function conectar() {  const authDir = path.join(process.cwd(), 'auth_info_baileys')
  // Ensure auth directory exists
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })

  const signalKeyStore = makeCacheableSignalKeyStore(authDir, async (keyId) => {
    // Load signed prekey data from files or return null if not found
    try {
      const spk = fs.readFileSync(path.join(authDir, 'signed-prekey.json'), 'utf-8')
      return spk
    } catch {
      return null
    }
  })

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
  sock = makeWASocket({
    auth: state,
    signalKeyStore: signalKeyStore,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Empresas Nick', 'Chrome', '1.0'],
  })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    // Imprime o QR só quando muda (evita flood no terminal)
    if (qr && qr !== lastQr) {
      lastQr = qr
      console.log('Escaneie o QR do WhatsApp abaixo:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      sockConectado = null
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      if (shouldReconnect) {
        // Delay + trava: sem isso, falha repetida vira loop apertado de reconexão
        setTimeout(() => { startWhatsApp().catch(() => {}) }, 5000)
      }
    } else if (connection === 'open') {
      lastQr = ''
      sockConectado = sock
      console.log('WhatsApp conectado! ✅')
    }
  })
  // Cliente mandou msg no Zap -> entrega ao server.js, que salva em messages.json e garante contacts.json
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !incomingHandler) return
    for (const wmsg of (messages || [])) {
      try {
        if (!wmsg || wmsg.key.fromMe) continue
        const jid = wmsg.key.remoteJid || ''
        if (!jid || jid === 'status@broadcast' || jid.includes('@g.us')) continue
        const text = extrairTexto(wmsg).trim()
        if (!text) continue
        const pushName = wmsg.pushName || ''
        await incomingHandler({ jid, text, pushName })
      } catch (e) {
        console.log('[Zap] erro ao processar mensagem recebida:', e.message || e)
      }
    }
  })
  return sock
}

export function getSock() { return sock }

export async function sendMessage(phone, message) {
  if (!sock) throw new Error('WhatsApp não conectado - escaneie QR')
  const jid = phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`
  await sock.sendMessage(jid, { text: message })
}
