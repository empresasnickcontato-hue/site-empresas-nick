import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '../../data/users.json');
const PROJECTS_FILE = path.join(__dirname, '../../data/projects.json');

let turso = null;

function isAuthError(e) {
  const msg = String((e && e.message) || e || '').toLowerCase();
  return msg.includes('401') || msg.includes('unauthor') || msg.includes('forbidden')
    || msg.includes('token') || msg.includes('expired') || msg.includes('expir');
}

function explainDbError(e) {
  if (isAuthError(e)) {
    return 'TURSO_AUTH_TOKEN inválido ou EXPIRADO — gere um novo token no dashboard do Turso e atualize a env TURSO_AUTH_TOKEN no Render (backend). Erro original: ' + (e && e.message);
  }
  return (e && e.message) || String(e);
}

// Reconexão sob demanda: tenta (re)criar o client se ainda não houver um.
// Retorna o client ou null (nunca lança — o servidor segue no JSON local).
export async function reconnectTurso() {
  if (turso) return turso;
  const url = (process.env.TURSO_DATABASE_URL || '').trim();
  const token = (process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!url || !token) return null;
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url, authToken: token });
    await client.execute('SELECT 1');
    turso = client;
    console.log('[DB] Reconexão Turso OK.');
    return turso;
  } catch (e) {
    console.error('[DB] Falha na reconexão Turso:', explainDbError(e));
    return null;
  }
}

export async function initTurso() {
  return reconnectTurso();
}

try {
  console.log('[DB] Conectando Turso...');

  const url = (process.env.TURSO_DATABASE_URL || '').trim();
  const token = (process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!url || !token) {
    throw new Error('Sem env vars (defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no ambiente)');
  }
  if (!/^libsql:\/\//i.test(url) && !/^https:\/\//i.test(url)) {
    throw new Error('TURSO_DATABASE_URL inválida (esperado libsql://... ou https://...). Valor atual parece truncado/placeholder.');
  }

  const { createClient } = await import('@libsql/client');
  turso = createClient({ url, authToken: token });

  await turso.batch([
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT)',
    'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT)',
  ]);

  const dirUsers = path.dirname(DATA_FILE);
  if (!fs.existsSync(dirUsers)) fs.mkdirSync(dirUsers, { recursive: true });

  // No Render o disco é efêmero: se o JSON local está vazio e o Turso tem
  // dados, restaura o JSON a partir do Turso (é isso que alimenta o /admin).
  try {
    const u = await turso.execute('SELECT data FROM users');
    console.log(`[DB] Achou ${u.rows.length} usuario(s) no Turso`);
    const locais = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8') || '[]') : [];
    if (u.rows.length > 0 && (!Array.isArray(locais) || locais.length === 0)) {
      const users = u.rows.map((r) => JSON.parse(r.data));
      fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
      console.log('[DB] Recuperou users.json do Turso!');
    }
  } catch (e) { console.error('[DB] Erro ao recuperar users:', explainDbError(e)); }

  try {
    const p = await turso.execute('SELECT data FROM projects');
    console.log(`[DB] Achou ${p.rows.length} projeto(s) no Turso`);
    const locaisP = fs.existsSync(PROJECTS_FILE) ? JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8') || '[]') : [];
    if (p.rows.length > 0 && (!Array.isArray(locaisP) || locaisP.length === 0)) {
      const projs = p.rows.map((r) => JSON.parse(r.data));
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projs, null, 2));
      console.log('[DB] Recuperou projects do Turso!');
    }
  } catch (e) { console.error('[DB] Erro ao recuperar projects:', explainDbError(e)); }

  console.log('[DB] Turso conectado!');
} catch (e) {
  console.error('[DB] Turso NAO disponivel:', explainDbError(e));
}

export { turso };
