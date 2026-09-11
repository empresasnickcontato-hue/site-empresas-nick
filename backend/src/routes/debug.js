import { db } from "../db/connection.js";
export default async function (fastify) {
  fastify.get("/debug", async () => {
    try {
      const users = await db.execute("SELECT id, data FROM users");
      return {
        total_usuarios: users.rows.length,
        usuarios: users.rows.map(r => JSON.parse(r.data))
      };
    } catch(e){
      return { erro: e.message, stack: e.stack };
    }
  });
}
