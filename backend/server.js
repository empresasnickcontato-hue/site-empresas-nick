import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { turso } from "./src/lib/turso.js";
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.get("/", (req,res)=> res.send("Backend OK - "+new Date().toISOString()));
app.get("/debug", async (req,res)=>{
  try {
    const users = await turso.execute("SELECT * FROM users");
    res.json({ total_users: users.rows.length, users: users.rows });
  } catch(e){
    res.status(500).json({ erro: e.message });
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log("Rodando na porta "+PORT));
