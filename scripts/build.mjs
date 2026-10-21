import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/gestao", { recursive: true });
await copyFile("src/supabase-config.js", "dist/supabase-config.js");
await copyFile("src/supabase-auth.js", "dist/gestao/supabase-auth.js");
