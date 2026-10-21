export const TYPES = new Set(["clients", "visits", "followUps", "sales"]);
export const MAX_OPERATIONS = 2500;

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "InputError";
    this.status = status;
  }
}

export function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

export async function readJsonLimited(request, maxBytes) {
  if (!request.body) throw new InputError("O pedido não contém dados JSON.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let body = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new InputError("O pedido é demasiado grande.", 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("O JSON do pedido é inválido.");
  }
}

export function validateLeadSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InputError("O pedido de contacto é inválido.");
  }
  const name = text(input.name, 100);
  const phone = text(input.phone, 30);
  const digits = phone.replace(/\D/g, "");
  if (!name || digits.length < 8 || digits.length > 15 || input.consent !== true) {
    throw new InputError("Confirma o nome, o telemóvel e a autorização de contacto.");
  }
  if (!/^[+0-9 ().-]+$/.test(phone)) throw new InputError("Confirma o número de telemóvel.");
  return { name, phone };
}

export function cleanRecord(type, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !validId(input.id)) {
    throw new InputError("Registo inválido.");
  }

  const createdAt = text(input.createdAt, 40) || new Date().toISOString();
  const updatedAt = text(input.updatedAt, 40) || createdAt;

  if (type === "clients") {
    const status = ["active", "interested", "inactive"].includes(input.status) ? input.status : "active";
    const name = text(input.name, 100);
    if (!name) throw new InputError("O nome do cliente é obrigatório.");
    return {
      id: input.id,
      number: text(input.number, 30),
      name,
      phone: text(input.phone, 30),
      status,
      source: text(input.source, 80),
      notes: text(input.notes, 1500),
      consentAt: text(input.consentAt, 40),
      createdAt,
      updatedAt
    };
  }

  if (type === "visits") {
    return {
      id: input.id,
      clientId: validId(input.clientId) ? input.clientId : "",
      date: text(input.date, 10),
      notes: text(input.notes, 1000),
      createdAt,
      updatedAt
    };
  }

  if (type === "followUps") {
    const followUpType = ["contact", "first_visit", "renewal", "other"].includes(input.type) ? input.type : "contact";
    return {
      id: input.id,
      clientId: validId(input.clientId) ? input.clientId : "",
      date: text(input.date, 10),
      type: followUpType,
      notes: text(input.notes, 1000),
      done: Boolean(input.done),
      completedAt: text(input.completedAt, 40),
      createdAt,
      updatedAt
    };
  }

  if (type === "sales") {
    const amount = input.amount === null || input.amount === "" ? null : Number(input.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100000000)) {
      throw new InputError("O valor da venda é inválido.");
    }
    const status = ["pending", "paid", "cancelled"].includes(input.status) ? input.status : "pending";
    return {
      id: input.id,
      clientId: validId(input.clientId) ? input.clientId : "",
      description: text(input.description, 120),
      date: text(input.date, 10),
      amount,
      status,
      renewalDate: text(input.renewalDate, 10),
      notes: text(input.notes, 800),
      createdAt,
      updatedAt
    };
  }

  throw new InputError("Tipo de registo inválido.");
}

export function validateOperations(value) {
  if (!Array.isArray(value) || value.length > MAX_OPERATIONS) {
    throw new InputError("A alteração tem demasiados registos.");
  }

  return value.map((operation) => {
    if (!operation || !TYPES.has(operation.type)) throw new InputError("Tipo de registo inválido.");
    if (operation.action === "delete") {
      if (!validId(operation.id)) throw new InputError("Identificador inválido.");
      return { action: "delete", type: operation.type, id: operation.id };
    }
    if (operation.action === "upsert") {
      return { action: "upsert", type: operation.type, record: cleanRecord(operation.type, operation.record) };
    }
    throw new InputError("Ação inválida.");
  });
}
