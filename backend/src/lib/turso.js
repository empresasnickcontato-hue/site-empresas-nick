import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '../../data/users.json');
const PROJECTS_FILE = path.join(__dirname, '../../data/projects.json');

let turso = null;

try {
  console.log("[DB] Conectando Turso...");
  
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("Sem env vars");
  }

  const { createClient } = await import("@libsql/client");
  turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  await turso.batch([
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT)",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT)"
  ]);

  const dirUsers = path.dirname(DATA_FILE);
  if (!fs.existsSync(dirUsers)) fs.mkdirSync(dirUsers, { recursive: true });

  try {
    const u = await turso.execute("SELECT data FROM users");
    console.log(`[DB] Achou ${u.rows.length} usuarios no Turso`);
    if (u.rows.length > 0) {
      const users = u.rows.map(r => JSON.parse(r.data));
      fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
      console.log("[DB] Recuperou users.json do Turso!");
    }
  } catch(e){ console.log("[DB] Erro recupera users", e.message) }

  try {
    const p = await turso.execute("SELECT data FROM projects");
    if (p.rows.length > 0) {
      const projs = p.rows.map(r => JSON.parse(r.data));
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projs, null, 2));
      console.log("[DB] Recuperou projects do Turso!");
    }
  } catch(e){}

  console.log("[DB] Turso conectado!");

} catch (e) {
  console.log("[DB] Turso NAO disponivel:", e.message);
}

export { turso };
export async function initTurso() { return turso; }
