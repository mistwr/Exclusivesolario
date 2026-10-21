import test from "node:test";
import assert from "node:assert/strict";
import {
  InputError,
  readJsonLimited,
  validateLeadSubmission,
  validateOperations
} from "../netlify/lib/records.mjs";

test("website lead requires a name, valid phone, and explicit consent", () => {
  assert.deepEqual(validateLeadSubmission({ name: "  Ana Silva ", phone: "+351 912 345 678", consent: true }), {
    name: "Ana Silva",
    phone: "+351 912 345 678"
  });
  assert.throws(() => validateLeadSubmission({ name: "Ana", phone: "12345", consent: true }), InputError);
  assert.throws(() => validateLeadSubmission({ name: "Ana", phone: "912345678", consent: false }), InputError);
  assert.throws(() => validateLeadSubmission(null), InputError);
});

test("CRM writes are whitelisted and reject malformed operations", () => {
  const [operation] = validateOperations([{
    action: "upsert",
    type: "clients",
    record: {
      id: "client-1",
      name: "Ana Silva",
      phone: "912345678",
      status: "interested",
      source: "Site",
      extra: "não guardar"
    }
  }]);
  assert.equal(operation.record.status, "interested");
  assert.equal(Object.hasOwn(operation.record, "extra"), false);
  assert.throws(() => validateOperations([{ action: "delete", type: "clients", id: "bad id" }]), InputError);
  assert.throws(() => validateOperations([{ action: "upsert", type: "clients", record: { id: "client-2" } }]), InputError);
  assert.throws(() => validateOperations(null), InputError);
});

test("request JSON parser enforces its byte limit and rejects invalid JSON", async () => {
  const valid = new Request("https://example.test/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ana" })
  });
  assert.deepEqual(await readJsonLimited(valid, 100), { name: "Ana" });

  const oversized = new Request("https://example.test/api/leads", { method: "POST", body: "123456" });
  await assert.rejects(readJsonLimited(oversized, 5), (error) => error instanceof InputError && error.status === 413);

  const malformed = new Request("https://example.test/api/leads", { method: "POST", body: "{" });
  await assert.rejects(readJsonLimited(malformed, 100), (error) => error instanceof InputError && error.status === 400);
});
