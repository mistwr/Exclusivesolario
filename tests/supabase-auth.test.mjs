import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/supabase-auth.js", import.meta.url), "utf8");

function createAuth(fetcher) {
  const values = new Map();
  const window = {
    exclusiveSolarioConfig: {
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
      adminEmail: "alex@exclusivesolario.pt"
    },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    location: {
      origin: "https://exclusive-solario-maia.netlify.app",
      pathname: "/gestao/",
      search: "",
      hash: ""
    },
    history: { replaceState() {} },
    fetch: fetcher,
    dispatchEvent() {},
    addEventListener() {}
  };
  vm.runInNewContext(source, { window, URLSearchParams, CustomEvent });
  return { auth: window.solarioIdentity, values };
}

test("login uses Indigo Auth and returns the authorized administrator", async () => {
  const calls = [];
  const user = { id: "auth-user", email: "alex@exclusivesolario.pt" };
  const { auth, values } = createAuth(async (url, options) => {
    calls.push({ url, options });
    return Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      user
    });
  });

  assert.deepEqual(await auth.login("Alex@ExclusiveSolario.pt", "password"), user);
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(calls[0].options.headers.apikey, "sb_publishable_test");
  assert.ok([...values.keys()].some((key) => key.includes("exclusive-solario-auth")));
});

test("another Indigo user is rejected and its local session is cleared", async () => {
  const calls = [];
  const { auth, values } = createAuth(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("grant_type=password")) {
      return Response.json({
        access_token: "other-access",
        refresh_token: "other-refresh",
        expires_in: 3600,
        user: { id: "other-user", email: "someone@sd-dialer.example" }
      });
    }
    return new Response(null, { status: 204 });
  });

  await assert.rejects(auth.login("someone@sd-dialer.example", "password"), /não está autorizada/i);
  assert.equal(values.size, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/auth\/v1\/logout$/);
});

test("password recovery is limited to the configured admin email", async () => {
  let calls = 0;
  const { auth } = createAuth(async () => {
    calls += 1;
    return Response.json({});
  });

  await assert.rejects(auth.requestPasswordRecovery("other@example.com"), /limitada/i);
  assert.equal(calls, 0);
});

test("first access link creates only the authorized admin and redirects to CRM", async () => {
  const calls = [];
  const { auth } = createAuth(async (url, options) => {
    calls.push({ url, options });
    return Response.json({});
  });

  await auth.requestAccessLink("Alex@ExclusiveSolario.pt");
  assert.match(calls[0].url, /\/auth\/v1\/otp\?redirect_to=/);
  assert.equal(decodeURIComponent(calls[0].url.split("redirect_to=")[1]), "https://exclusive-solario-maia.netlify.app/gestao/");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    email: "alex@exclusivesolario.pt",
    create_user: true
  });
  assert.equal(calls[0].options.headers.apikey, "sb_publishable_test");
});

test("first access link cannot be requested for another Indigo user", async () => {
  let calls = 0;
  const { auth } = createAuth(async () => {
    calls += 1;
    return Response.json({});
  });

  await assert.rejects(auth.requestAccessLink("other@example.com"), /limitado à conta administradora/i);
  assert.equal(calls, 0);
});
