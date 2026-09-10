// Script de limpeza imediata — zera o histórico de projetos.
// Equivalente a db.projetos.deleteMany({}) usando o JSON em disco.
// Uso: node scripts/clear-projects.js
// Backup automático em data/projects.backup-<timestamp>.json

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECTS_FILE = path.join(__dirname, '..', 'data', 'projects.json')

function main() {
  let projetos = []
  try {
    projetos = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
  } catch {
    projetos = []
  }
  const total = Array.isArray(projetos) ? projetos.length : 0

  // Backup antes de apagar
  const backup = path.join(
    path.dirname(PROJECTS_FILE),
    `projects.backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  )
  fs.writeFileSync(backup, JSON.stringify(projetos, null, 2), 'utf-8')

  // db.projetos.deleteMany({})
  fs.writeFileSync(PROJECTS_FILE, '[]', 'utf-8')

  console.log(`Backup salvo em: ${backup}`)
  console.log(`Histórico zerado! ${total} projeto(s) excluído(s).`)
}

main()
