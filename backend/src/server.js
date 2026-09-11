import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { db } from "./lib/turso.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/", (req,res)=> res.send("Backend Empresas Nick OK - "+new Date().toISOString()));

app.get("/debug", async (req,res)=>{
  try {
    const users = await db.execute("SELECT * FROM users");
    const projects = await db.execute("SELECT * FROM projects").catch(()=>({rows:[]}));
    res.json({
      total_users: users.rows.length,
      users: users.rows,
      projects: projects.rows
    });
  } catch(e){
    res.status(500).json({ erro: e.message, stack: e.stack });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log("Rodando na porta "+PORT));
