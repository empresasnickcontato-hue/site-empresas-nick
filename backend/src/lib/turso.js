let turso = null;
try {
  const mod = await import("@libsql/client");
  if (process.env.TURSO_DATABASE_URL) {
    turso = mod.createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
} catch (e) {
  console.log("[DB] Turso não disponível, usando JSON local");
}
export { turso };

export async function initTurso() {
  if (!turso) return;
  try {
    await turso.batch([
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT)`,
      `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT)`,
    ], "write");
    
    const fs = await import('fs');
    const DATA_FILE = './data/users.json';
    const PROJECTS_FILE = './data/projects.json';

    try {
      const local = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (local.length === 0) {
        const r = await turso.execute("SELECT data FROM users");
        if (r.rows.length > 0) {
          const fromTurso = r.rows.map(row => JSON.parse(row.data));
          fs.writeFileSync(DATA_FILE, JSON.stringify(fromTurso, null, 2));
          console.log("[DB] Recuperou", fromTurso.length, "usuarios do Turso");
        }
      }
    } catch {}
    
    try {
      const localP = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
      if (localP.length === 0) {
        const r = await turso.execute("SELECT data FROM projects");
        if (r.rows.length > 0) {
          const fromTurso = r.rows.map(row => JSON.parse(row.data));
          fs.writeFileSync(PROJECTS_FILE, JSON.stringify(fromTurso, null, 2));
          console.log("[DB] Recuperou", fromTurso.length, "projetos do Turso");
        }
      }
    } catch {}

    console.log("[DB] Turso conectado!");
  } catch (e) {
    console.log("[DB] Erro Turso:", e.message);
  }
}
