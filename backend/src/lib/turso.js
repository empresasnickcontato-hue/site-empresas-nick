import fs from 'fs';

let turso = null;
let localUsers = [];
let localProjects = [];

const DATA_FILE = "./data/users.json";
const PROJECTS_FILE = "./data/projects.json";

try {
  console.log("[DB] Tentando conectar Turso...");
  console.log("[DB] URL existe?", !!process.env.TURSO_DATABASE_URL);
  console.log("[DB] TOKEN existe?", !!process.env.TURSO_AUTH_TOKEN);
  
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("Variaveis TURSO_DATABASE_URL ou TURSO_AUTH_TOKEN nao definidas no Render");
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

  // Recupera dados do Turso
  try {
    const u = await turso.execute("SELECT data FROM users");
    if (u.rows.length > 0) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(u.rows.map(r => JSON.parse(r.data)), null, 2));
      console.log(`[DB] Recuperou ${u.rows.length} usuarios do Turso`);
    }
  } catch(e){}

  try {
    const p = await turso.execute("SELECT data FROM projects");
    if (p.rows.length > 0) {
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(p.rows.map(r => JSON.parse(r.data)), null, 2));
      console.log(`[DB] Recuperou ${p.rows.length} projetos do Turso`);
    }
  } catch(e){}

  console.log("[DB] Turso conectado!");

} catch (e) {
  console.log("[DB] Turso NAO disponivel, usando JSON local. Motivo:", e.message);
}

export { turso };

export async function initTurso() { return turso; }
export async function saveUserToTurso(user) {
  if (!turso) return;
  try {
    await turso.execute({ sql: "INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)", args: [user.id, JSON.stringify(user)] });
  } catch (e) { console.log("[DB] Erro saveUser", e.message) }
}
export async function saveProjectToTurso(project) {
  if (!turso) return;
  try {
    await turso.execute({ sql: "INSERT OR REPLACE INTO projects (id, data) VALUES (?, ?)", args: [project.id, JSON.stringify(project)] });
  } catch (e) { console.log("[DB] Erro saveProject", e.message) }
}
