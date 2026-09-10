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
  console.log("[DB] Turso não disponível no Android, usando JSON local");
}

export { turso };

export async function initTurso() {
  if (!turso) return;
  try {
    await turso.batch([
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT)`,
      `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT)`,
    ], "write");
    console.log("[DB] Turso conectado!");
  } catch {}
}
