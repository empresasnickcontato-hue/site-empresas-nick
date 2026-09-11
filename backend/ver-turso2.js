import "dotenv/config";
let url = process.env.TURSO_DATABASE_URL.trim().replace(/['"]/g,"");
url = url.replace("libsql://", "https://");
console.log("URL usando:", url);

const token = process.env.TURSO_AUTH_TOKEN.trim().replace(/['"]/g,"");

async function query(sql){
  const res = await fetch(`${url}/v2/pipeline`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql } }, { type: "close" }] })
  });
  const txt = await res.text();
  console.log("Resposta bruta:", txt.slice(0,500));
  const j = JSON.parse(txt);
  return j.results?.[0]?.response?.result;
}

const users = await query("SELECT id, data FROM users");
console.log(`\n=== ${users.rows.length} USUARIOS ===`);
users.rows.forEach(r => console.log(JSON.parse(r[1].value)));
