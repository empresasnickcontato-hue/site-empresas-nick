// Envio de e-mail via Gmail SMTP (nodemailer). Sem Resend, sem domínio
// customizado, sem API do Google — só usuário + senha de app (16 caracteres).
// Config: EMAIL_USER e EMAIL_PASS no backend/.env
import nodemailer from 'nodemailer'

// Transport criado sob demanda (lê process.env em tempo de chamada,
// depois que o dotenv já carregou o backend/.env).
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  })
}

export function isEmailConfigured() {
  const user = String(process.env.EMAIL_USER || '')
  const pass = String(process.env.EMAIL_PASS || '')
  if (!user || !pass) return false
  // Placeholders de exemplo NÃO contam como configurado (modo dev)
  const low = `${user} ${pass}`.toLowerCase()
  if (/seu\.?email|xxxx|sua_chave|example|teste|test@|changeme/.test(low)) return false
  return true
}

export async function sendEmail({ to, subject, html }) {
  const from = `Empresas Nick <${process.env.EMAIL_USER}>`
  const transporter = getTransporter()
  return transporter.sendMail({ from, to, subject, html })
}
