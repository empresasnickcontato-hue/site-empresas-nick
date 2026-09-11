import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

console.log("Conectando...");
const u = await db.execute("SELECT id, data FROM users");
console.log(`\n=== ${u.rows.length} USUARIOS NO TURSO ===`);
u.rows.forEach(r => {
  const j = JSON.parse(r.data);
  console.log(`- ID: ${r.id} | Nome: ${j.name || j.username || j.email}`);
  console.log(j);
});

const p = await db.execute("SELECT id, data FROM projects");
console.log(`\n=== ${p.rows.length} PROJECTS NO TURSO ===`);
