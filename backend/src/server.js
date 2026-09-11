import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as TursoMod from "./src/lib/turso.js";
import * as TursoMod2 from "./lib/turso.js";
import * as TursoMod3 from "../src/lib/turso.js";

const db = TursoMod.db || TursoMod.turso || TursoMod.default || TursoMod2.db || TursoMod2.turso || TursoMod3.db || TursoMod3.turso;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/", (req,res)=> res.send("Backend OK - "+new Date().toISOString()));
app.get("/debug", async (req,res)=>{
  try {
    const client = db;
    const users = await client.execute("SELECT * FROM users");
    res.json({ total_users: users.rows.length, users: users.rows });
  } catch(e){
    res.status(500).json({ erro: e.message, stack: e.stack, keys: Object.keys(TursoMod) });
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log("Rodando na porta "+PORT));
