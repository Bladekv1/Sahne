import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, "index.html"), path.join(out, "index.html"));
await cp(path.join(root, "manifest.webmanifest"), path.join(out, "manifest.webmanifest"));
await cp(path.join(root, "css"), path.join(out, "css"), { recursive: true });
await cp(path.join(root, "js"), path.join(out, "js"), { recursive: true });
await cp(path.join(root, "media"), path.join(out, "media"), { recursive: true });
console.log("build: public ready");
