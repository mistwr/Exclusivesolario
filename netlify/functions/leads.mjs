import { getDatabase } from "@netlify/database";
import { InputError, readJsonLimited, text, validateLeadSubmission } from "../lib/records.mjs";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ error: "Formato de pedido inválido." }, 415);
    }

    const body = await readJsonLimited(request, 12_000);
    if (body && text(body.website, 120)) return json({ ok: true }, 202);

    const { name, phone } = validateLeadSubmission(body);

    const now = new Date().toISOString();
    const id = "lead-" + crypto.randomUUID();
    const lead = {
      id,
      number: "",
      name,
      phone,
      status: "interested",
      source: "Site",
      notes: "",
      consentAt: now,
      createdAt: now,
      updatedAt: now
    };
    const db = getDatabase();
    await db.pool.query(
      "INSERT INTO crm_records (id, type, payload, created_at, updated_at) VALUES ($1, $2, $3::jsonb, NOW(), NOW())",
      [id, "clients", JSON.stringify(lead)]
    );

    return json({ ok: true }, 201);
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, error.status);
    console.error("Website contact request could not be saved.");
    return json({ error: "Não foi possível enviar o pedido agora. Tenta novamente." }, 503);
  }
};

export const config = {
  path: "/api/leads",
  method: ["POST"],
  region: "dub"
};
