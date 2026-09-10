// @ts-nocheck
import makeWASocket, { makeCacheableSignalKeyStore, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import path from 'path'

let sock = null

export async function startWhatsApp() {
  const authDir = path.join(process.cwd(), 'auth_info_baileys')
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })

  const signalKeyStore = makeCacheableSignalKeyStore(authDir, async (keyId) => {
    try {
      const spk = fs.readFileSync(path.join(authDir, 'signed-prekey.json'), 'utf-8')
      return spk
    } catch {
      return null
    }
  })

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
  sock = makeWASocket({ auth: state, signalKeyStore: signalKeyStore, printQRInTerminal: true })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if(qr) qrcode.generate(qr, {small: true})
    if(connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
      if(shouldReconnect) startWhatsApp()
    } else if(connection === 'open') {
      console.log('WhatsApp conectado!')
    }
  })
  return sock
}

export function getSock() { return sock }

export async function sendMessage(phone, message) {
  if(!sock) throw new Error('WhatsApp não conectado')
  const jid = phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`
  await sock.sendMessage(jid, { text: message })
}