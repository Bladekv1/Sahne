import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool;
let local;

export async function sql(text, params = []) {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await pool.query(text, params)).rows;
  }
  local ??= startLocal().catch((error) => {
    local = undefined;
    throw error;
  });
  return (await (await local).query(text, params)).rows;
}

async function startLocal() {
  const db = new PGlite();
  const dir = path.join(root, "migrations");
  const files = (await readdir(dir).catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) await db.exec(await readFile(path.join(dir, file), "utf8"));
  return db;
}
