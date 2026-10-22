(function () {
  "use strict";

  var config = window.exclusiveSolarioConfig || {};
  var storageKey = "exclusive-solario-auth-v1";
  var adminEmail = String(config.adminEmail || "").toLowerCase();
  var session = readSession();

  function readSession() {
    try {
      return JSON.parse(window.localStorage.getItem(storageKey) || "null");
    } catch (error) {
      return null;
    }
  }

  function writeSession(value) {
    session = value;
    if (value) window.localStorage.setItem(storageKey, JSON.stringify(value));
    else window.localStorage.removeItem(storageKey);
  }

  function clearCallbackHash() {
    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
  }

  function explainError(result, status) {
    var raw = result && (result.msg || result.message || result.error_description || result.error);
    var message = String(raw || "");
    var normalized = message.toLowerCase();
    if (normalized.includes("invalid login credentials")) return "Email ou palavra-passe incorretos.";
    if (normalized.includes("email not confirmed")) return "Esta conta ainda não está confirmada no Supabase Auth.";
    if (normalized.includes("too many requests")) return "Foram feitas demasiadas tentativas. Aguarda um pouco e tenta novamente.";
    if (status === 401 || status === 403) return "A sessão expirou ou esta conta não tem acesso à gestão.";
    return message || "Não foi possível concluir o pedido de autenticação.";
  }

  async function request(path, options) {
    if (!config.url || !config.publishableKey) {
      throw new Error("A ligação ao Supabase ainda não está configurada.");
    }
    var settings = options || {};
    var headers = Object.assign({
      apikey: config.publishableKey,
      Accept: "application/json"
    }, settings.headers || {});
    if (settings.token) headers.Authorization = "Bearer " + settings.token;
    if (settings.body !== undefined) headers["Content-Type"] = "application/json";
    var response;
    try {
      response = await window.fetch(config.url.replace(/\/$/, "") + path, {
        method: settings.method || "GET",
        headers: headers,
        body: settings.body === undefined ? undefined : JSON.stringify(settings.body)
      });
    } catch (error) {
      throw new Error("Não foi possível ligar ao serviço de autenticação.");
    }
    var data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) throw new Error(explainError(data, response.status));
    return data;
  }

  function storeAuthResponse(data) {
    var expiresIn = Number(data.expires_in || 3600);
    writeSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      expires_at: Date.now() + expiresIn * 1000,
      user: data.user || null
    });
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) {
      writeSession(null);
      return null;
    }
    var data = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token }
    });
    storeAuthResponse(data);
    return session;
  }

  async function getAccessToken() {
    if (!session || !session.access_token) throw new Error("Inicia sessão para abrir o CRM.");
    if (session.expires_at && session.expires_at < Date.now() + 60000) {
      await refreshSession();
    }
    if (!session || !session.access_token) throw new Error("Inicia sessão para abrir o CRM.");
    return session.access_token;
  }

  async function getUser() {
    if (!session || !session.access_token) return null;
    try {
      var data = await request("/auth/v1/user", { token: await getAccessToken() });
      var user = data && data.email ? data : null;
      if (!user || String(user.email).toLowerCase() !== adminEmail) {
        writeSession(null);
        return null;
      }
      session.user = user;
      window.localStorage.setItem(storageKey, JSON.stringify(session));
      return user;
    } catch (error) {
      if (/sessão expirou|inicia sessão/i.test(error.message)) writeSession(null);
      throw error;
    }
  }

  async function login(email, password) {
    var data = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: String(email || "").trim().toLowerCase(), password: password }
    });
    storeAuthResponse(data);
    if (!data.user || String(data.user.email || "").toLowerCase() !== adminEmail) {
      try {
        await request("/auth/v1/logout", { method: "POST", token: data.access_token });
      } catch (error) {
        // Clear the local session even if the remote sign-out request fails.
      }
      writeSession(null);
      throw new Error("Esta conta do Supabase Auth não está autorizada a abrir a gestão Solario.");
    }
    return data.user;
  }

  async function logout() {
    var token = session && session.access_token;
    try {
      if (token) await request("/auth/v1/logout", { method: "POST", token: token });
    } catch (error) {
      // Local access must always be cleared, even if the Auth API is unavailable.
    } finally {
      writeSession(null);
      window.dispatchEvent(new CustomEvent("solario-auth-change", { detail: "logout" }));
    }
  }

  function onAuthChange(callback) {
    window.addEventListener("solario-auth-change", function (event) {
      callback(event.detail);
    });
    window.addEventListener("storage", function (event) {
      if (event.key === storageKey && !event.newValue) callback("logout");
    });
  }

  async function requestPasswordRecovery(email) {
    var target = String(email || "").trim().toLowerCase();
    if (target !== adminEmail) throw new Error("A recuperação está limitada à conta administradora.");
    var redirect = window.location.origin + "/gestao/";
    await request("/auth/v1/recover?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      body: { email: target }
    });
  }

  async function requestAccessLink(email) {
    var target = String(email || "").trim().toLowerCase();
    if (target !== adminEmail) throw new Error("O link de acesso está limitado à conta administradora.");
    var redirect = window.location.origin + "/gestao/";
    await request("/auth/v1/otp?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      body: { email: target, create_user: true }
    });
  }

  async function updateUser(changes) {
    var token = await getAccessToken();
    var data = await request("/auth/v1/user", {
      method: "PUT",
      token: token,
      body: changes
    });
    if (session) {
      session.user = data;
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    }
    return data;
  }

  async function handleAuthCallback() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    var error = params.get("error_description");
    if (error) {
      clearCallbackHash();
      throw new Error(error);
    }
    var accessToken = params.get("access_token");
    if (!accessToken) return null;
    var callbackType = params.get("type") || "";
    writeSession({
      access_token: accessToken,
      refresh_token: params.get("refresh_token") || "",
      expires_at: Date.now() + Number(params.get("expires_in") || 3600) * 1000,
      user: null
    });
    clearCallbackHash();
    var user = await getUser();
    if (!user) throw new Error("A conta recebida no link não tem acesso à gestão Solario.");
    return { type: callbackType, user: user };
  }

  window.solarioIdentity = {
    getAccessToken: getAccessToken,
    getUser: getUser,
    handleAuthCallback: handleAuthCallback,
    login: login,
    logout: logout,
    onAuthChange: onAuthChange,
    requestAccessLink: requestAccessLink,
    requestPasswordRecovery: requestPasswordRecovery,
    updateUser: updateUser
  };
})();
