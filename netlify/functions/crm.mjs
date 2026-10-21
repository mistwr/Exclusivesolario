import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { InputError, TYPES, readJsonLimited, validateOperations } from "../lib/records.mjs";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}


async function requireAdmin() {
  const user = await getUser();
  if (!user) return json({ error: "Inicia sessão para abrir o CRM." }, 401);

  const allowedEmail = String(process.env.CRM_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!allowedEmail) return json({ error: "O acesso do administrador ainda não foi configurado." }, 503);
  if (String(user.email || "").trim().toLowerCase() !== allowedEmail) {
    return json({ error: "Esta conta não tem acesso à gestão de clientes." }, 403);
  }
  return null;
}

async function readRecords(db) {
  const result = await db.pool.query("SELECT id, type, payload FROM crm_records ORDER BY created_at ASC");
  const records = { clients: [], visits: [], followUps: [], sales: [] };
  for (const row of result.rows) {
    if (TYPES.has(row.type)) records[row.type].push(row.payload);
  }
  return records;
}

export default async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }

  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const db = getDatabase();

    if (request.method === "GET") {
      return json({ records: await readRecords(db) });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ error: "Formato de pedido inválido." }, 415);
    }
    const body = await readJsonLimited(request, 1_500_000);
    const operations = validateOperations(body && body.operations);

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      for (const operation of operations) {
        if (operation.action === "delete") {
          await client.query(
            "DELETE FROM crm_records WHERE id = $1 AND type = $2",
            [operation.id, operation.type]
          );
        } else {
          await client.query(
            "INSERT INTO crm_records (id, type, payload, created_at, updated_at) VALUES ($1, $2, $3::jsonb, NOW(), NOW()) " +
              "ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, payload = EXCLUDED.payload, updated_at = NOW()",
            [operation.record.id, operation.type, JSON.stringify(operation.record)]
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return json({ records: await readRecords(db) });
  } catch (error) {
    if (error instanceof InputError) {
      return json({ error: error.message }, error.status);
    }
    console.error("CRM database request failed.");
    return json({ error: "Não foi possível carregar ou guardar os registos." }, 503);
  }
};

export const config = {
  path: "/api/crm",
  method: ["GET", "POST"],
  region: "dub"
};
