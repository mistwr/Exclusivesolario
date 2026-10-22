(function () {
  "use strict";

  var TYPES = ["clients", "visits", "followUps", "sales"];
  var records = { clients: [], visits: [], followUps: [], sales: [] };
  var serverBaseline = { clients: [], visits: [], followUps: [], sales: [] };
  var toastTimer = null;
  var cachedXlsx = null;
  var refreshTimer = null;
  var refreshInProgress = false;

  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

  function makeId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
    });
  }

  function normalize(value) {
    return String(value == null ? "" : value).toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function localDateKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function cloneRecords(source) {
    var copy = {};
    TYPES.forEach(function (type) {
      copy[type] = JSON.parse(JSON.stringify(Array.isArray(source[type]) ? source[type] : []));
    });
    return copy;
  }

  function normalizeRecords(source) {
    var normalized = { clients: [], visits: [], followUps: [], sales: [] };
    if (!source || typeof source !== "object") return normalized;
    TYPES.forEach(function (type) {
      if (Array.isArray(source[type])) normalized[type] = source[type].filter(function (item) {
        return item && typeof item === "object" && typeof item.id === "string";
      });
    });
    return normalized;
  }

  async function apiRequest(path, options) {
    var config = window.exclusiveSolarioConfig || {};
    if (!config.url || !config.publishableKey) throw new Error("A ligação ao Supabase ainda não está configurada.");
    var settings = options || {};
    var token = await window.solarioIdentity.getAccessToken();
    var headers = Object.assign({
      apikey: config.publishableKey,
      Authorization: "Bearer " + token,
      Accept: "application/json"
    }, settings.headers || {});
    if (settings.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    var response = await fetch(config.url.replace(/\/$/, "") + "/rest/v1/solario_crm_records" + (path || ""), {
      method: settings.method || "GET",
      headers: headers,
      body: settings.body
    });
    var result = {};
    try { result = await response.json(); } catch (error) { result = {}; }
    if (!response.ok) {
      var message = result.message || result.details || result.hint || "Não foi possível comunicar com o CRM.";
      throw new Error(message);
    }
    return result;
  }

  async function loadRecords() {
    var params = new URLSearchParams({ select: "id,type,payload", order: "created_at.asc" });
    var rows = await apiRequest("?" + params.toString(), { method: "GET" });
    var loaded = { clients: [], visits: [], followUps: [], sales: [] };
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (TYPES.indexOf(row.type) >= 0 && row.payload && typeof row.payload === "object") {
        loaded[row.type].push(row.payload);
      }
    });
    return normalizeRecords(loaded);
  }

  function collectOperations(before, after) {
    var operations = [];
    TYPES.forEach(function (type) {
      var oldItems = Array.isArray(before[type]) ? before[type] : [];
      var newItems = Array.isArray(after[type]) ? after[type] : [];
      var oldById = new Map(oldItems.map(function (item) { return [item.id, item]; }));
      var newById = new Map(newItems.map(function (item) { return [item.id, item]; }));

      newItems.forEach(function (item) {
        var oldItem = oldById.get(item.id);
        if (!oldItem || JSON.stringify(oldItem) !== JSON.stringify(item)) {
          operations.push({ action: "upsert", type: type, record: item });
        }
      });
      oldItems.forEach(function (item) {
        if (!newById.has(item.id)) operations.push({ action: "delete", type: type, id: item.id });
      });
    });
    return operations;
  }

  function applyOperations(target, operations) {
    var result = cloneRecords(target);
    operations.forEach(function (operation) {
      var list = result[operation.type];
      var index = list.findIndex(function (item) { return item.id === operation.id || item.id === (operation.record && operation.record.id); });
      if (operation.action === "delete") {
        if (index >= 0) list.splice(index, 1);
      } else if (index >= 0) {
        list[index] = operation.record;
      } else {
        list.push(operation.record);
      }
    });
    return result;
  }

  async function saveRecords() {
    var operations = collectOperations(serverBaseline, records);
    if (!operations.length) return;
    var upserts = operations.filter(function (operation) { return operation.action === "upsert"; });
    for (var start = 0; start < upserts.length; start += 100) {
      var rows = upserts.slice(start, start + 100).map(function (operation) {
        var now = new Date().toISOString();
        return {
          id: operation.record.id,
          type: operation.type,
          payload: operation.record,
          created_at: operation.record.createdAt || now,
          updated_at: operation.record.updatedAt || now
        };
      });
      await apiRequest("?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows)
      });
    }
    var deletions = operations.filter(function (operation) { return operation.action === "delete"; });
    for (var typeIndex = 0; typeIndex < TYPES.length; typeIndex += 1) {
      var type = TYPES[typeIndex];
      var ids = deletions.filter(function (operation) { return operation.type === type; }).map(function (operation) { return operation.id; });
      for (var start = 0; start < ids.length; start += 100) {
        var chunk = ids.slice(start, start + 100);
        if (!chunk.length) continue;
        var query = new URLSearchParams();
        query.set("type", "eq." + type);
        query.set("id", "in.(" + chunk.map(function (id) { return '"' + id + '"'; }).join(",") + ")");
        await apiRequest("?" + query.toString(), {
          method: "DELETE",
          headers: { Prefer: "return=minimal" }
        });
      }
    }
    records = await loadRecords();
    serverBaseline = cloneRecords(records);
  }

  function showPanel(panelName) {
    $$(".auth-panel").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.id !== panelName + "Panel");
    });
  }

  function showAuthMessage(message) {
    $("#authError").textContent = message || "";
  }

  function showToast(message) {
    var toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove("is-visible"); }, 3300);
  }

  function showNotice(message) {
    var notice = $("#notice");
    notice.textContent = message;
    notice.classList.remove("hidden");
  }

  async function openApp(user) {
    records = await loadRecords();
    serverBaseline = cloneRecords(records);
    $("#authScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    var displayName = user && (user.name || user.email) ? (user.name || user.email) : "Administração";
    $("#adminName").textContent = displayName;
    $("#adminEmail").textContent = user && user.email ? user.email : "Sessão privada";
    $("#adminAvatar").textContent = (displayName.trim().charAt(0) || "A").toUpperCase();
    renderAll();
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(refreshFromServer, 30000);
  }

  async function refreshFromServer() {
    if (refreshInProgress || $("#app").classList.contains("hidden") || !navigator.onLine) return;
    refreshInProgress = true;
    try {
      var localChanges = collectOperations(serverBaseline, records);
      serverBaseline = await loadRecords();
      records = applyOperations(serverBaseline, localChanges);
      renderAll();
    } catch (error) {
      showToast("A sincronização falhou. Verifica a ligação à internet.");
    } finally {
      refreshInProgress = false;
    }
  }

  function lockApp() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
    records = { clients: [], visits: [], followUps: [], sales: [] };
    serverBaseline = cloneRecords(records);
    closeAllModals();
    $("#app").classList.add("hidden");
    $("#authScreen").classList.remove("hidden");
    $("#loginPassword").value = "";
    showPanel("login");
  }

  function formatDate(value, includeYear) {
    if (!value) return "—";
    var date = new Date(value.length === 10 ? value + "T12:00:00" : value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-PT", includeYear
      ? { day: "2-digit", month: "short", year: "numeric" }
      : { day: "2-digit", month: "short" }).format(date).replace(/\./g, "");
  }

  function monthName(value) {
    var date = new Date(value.length === 10 ? value + "T12:00:00" : value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-PT", { month: "short" }).format(date).replace(/\./g, "");
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join("").toUpperCase();
  }

  function clientVisits(clientId) {
    return records.visits.filter(function (visit) { return visit.clientId === clientId; });
  }

  function latestVisit(clientId) {
    return clientVisits(clientId).sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    })[0] || null;
  }

  function clientStatusValue(client) {
    return client && client.status ? client.status : "active";
  }

  function clientStatusHTML(client) {
    var status = clientStatusValue(client);
    var labels = { interested: "Interessado", active: "Cliente ativo", inactive: "Inativo" };
    return '<span class="client-status is-' + escapeHTML(status) + '">' + escapeHTML(labels[status] || labels.active) + '</span>';
  }

  function followUpTypeLabel(type) {
    var labels = { contact: "Contacto", first_visit: "Primeira visita", renewal: "Renovação", other: "Outro" };
    return labels[type] || labels.other;
  }

  function followUpStatus(followUp) {
    if (followUp.done) return { label: "Concluído", className: "is-done" };
    var today = localDateKey(new Date());
    var date = String(followUp.date || "").slice(0, 10);
    if (date && date < today) return { label: "Atrasado", className: "is-due" };
    if (date === today) return { label: "Hoje", className: "is-open" };
    return { label: "Agendado", className: "is-open" };
  }

  function saleStatusLabel(status) {
    var labels = { pending: "Pendente", paid: "Paga", cancelled: "Cancelada" };
    return labels[status] || labels.pending;
  }

  function formatEuro(value) {
    if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value));
  }

  function renewalStatus(sale) {
    var today = localDateKey(new Date());
    var renewal = String(sale.renewalDate || "").slice(0, 10);
    if (!renewal) return "none";
    if (renewal < today) return "expired";
    var remaining = Math.ceil((new Date(renewal + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000);
    return remaining <= 30 ? "due" : "active";
  }

  function escapeTextNode(value) {
    return escapeHTML(value).replace(/\n/g, "<br>");
  }

  function clientById(clientId) {
    return records.clients.find(function (client) { return client.id === clientId; }) || null;
  }

  function clientOptions(selectedId) {
    var options = ['<option value="">Seleciona um cliente</option>'];
    records.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "pt"); }).forEach(function (client) {
      options.push('<option value="' + escapeHTML(client.id) + '"' + (client.id === selectedId ? ' selected' : '') + '>' + escapeHTML(client.number ? client.number + " · " : "") + escapeHTML(client.name) + '</option>');
    });
    return options.join("");
  }

  function openFollowUpModal(followUp, clientId) {
    if (!records.clients.length) {
      showToast("Regista primeiro um cliente.");
      openClientModal(null);
      return;
    }
    $("#followUpForm").reset();
    $("#followUpId").value = followUp ? followUp.id : "";
    $("#followUpModal").querySelector("h2").textContent = followUp ? "Editar acompanhamento" : "Novo acompanhamento";
    $("#followUpClient").innerHTML = clientOptions(followUp ? followUp.clientId : clientId);
    $("#followUpDate").value = followUp ? followUp.date : localDateKey(new Date());
    $("#followUpType").value = followUp ? followUp.type || "contact" : "contact";
    $("#followUpNotes").value = followUp ? followUp.notes || "" : "";
    openModal("followUpModal");
  }

  function openSaleModal(sale, clientId) {
    if (!records.clients.length) {
      showToast("Regista primeiro um cliente.");
      openClientModal(null);
      return;
    }
    $("#saleForm").reset();
    $("#saleId").value = sale ? sale.id : "";
    $("#saleModal").querySelector("h2").textContent = sale ? "Editar venda" : "Registar venda";
    $("#saleClient").innerHTML = clientOptions(sale ? sale.clientId : clientId);
    $("#saleDescription").value = sale ? sale.description || "" : "";
    $("#saleDate").value = sale ? sale.date : localDateKey(new Date());
    $("#saleAmount").value = sale && sale.amount != null ? sale.amount : "";
    $("#saleStatus").value = sale ? sale.status || "pending" : "pending";
    $("#saleRenewalDate").value = sale ? sale.renewalDate || "" : "";
    $("#saleNotes").value = sale ? sale.notes || "" : "";
    openModal("saleModal");
  }

  function renderDashboard() {
    var monthKey = localDateKey(new Date()).slice(0, 7);
    var visitsThisMonth = records.visits.filter(function (visit) { return String(visit.date || "").slice(0, 7) === monthKey; }).length;
    var followUpsOpen = records.followUps.filter(function (followUp) { return !followUp.done; }).length;
    var salesThisMonth = records.sales.filter(function (sale) { return String(sale.date || "").slice(0, 7) === monthKey && sale.status !== "cancelled"; }).length;
    $("#statClients").textContent = String(records.clients.length);
    $("#statVisits").textContent = String(visitsThisMonth);
    $("#statFollowups").textContent = String(followUpsOpen);
    $("#statSales").textContent = String(salesThisMonth);
    $("#navClientCount").textContent = String(records.clients.length);
    $("#navFollowUpCount").textContent = String(followUpsOpen);
    $("#navSalesCount").textContent = String(records.sales.filter(function (sale) { return sale.status !== "cancelled"; }).length);
    $("#navLoyaltyCount").textContent = String(records.sales.filter(function (sale) { return sale.status !== "cancelled" && sale.renewalDate; }).length);
    var recent = records.clients.slice().sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    }).slice(0, 5);
    if (!recent.length) {
      $("#recentClients").innerHTML = '<div class="empty-mini"><span>♙</span><strong>Ainda sem clientes</strong><small>Adiciona uma ficha ou importa a folha Excel.</small></div>';
      return;
    }
    $("#recentClients").innerHTML = recent.map(function (client) {
      var last = latestVisit(client.id);
      return '<button class="recent-row recent-open" type="button" data-open="' + escapeHTML(client.id) + '">' +
        '<span class="client-avatar">' + escapeHTML(initials(client.name)) + '</span>' +
        '<span class="recent-details"><strong>' + escapeHTML(client.name) + '</strong><small>' +
        (client.phone ? escapeHTML(client.phone) : "Sem telemóvel") + '</small></span>' +
        '<span class="recent-date">' + (last ? escapeHTML(formatDate(last.date, false)) : "Novo") + '</span></button>';
    }).join("");
  }

  function renderClients() {
    var term = normalize($("#clientSearch").value);
    var statusFilter = $("#clientStatusFilter").value;
    var visible = records.clients.filter(function (client) {
      var content = normalize([client.number, client.name, client.phone, client.notes, client.source, clientStatusValue(client)].join(" "));
      return (statusFilter === "all" || clientStatusValue(client) === statusFilter) && (!term || content.indexOf(term) !== -1);
    }).sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "pt");
    });
    $("#clientListCount").textContent = visible.length + (visible.length === 1 ? " cliente" : " clientes");
    $("#clientEmpty").classList.toggle("hidden", records.clients.length !== 0);
    $(".table-scroll").classList.toggle("hidden", records.clients.length === 0);
    if (!records.clients.length) {
      $("#clientRows").innerHTML = "";
      return;
    }
    if (!visible.length) {
      $("#clientRows").innerHTML = '<tr><td colspan="7" class="no-results">Não encontrei clientes com essa pesquisa.</td></tr>';
      return;
    }
    $("#clientRows").innerHTML = visible.map(function (client) {
      var visits = clientVisits(client.id);
      var last = latestVisit(client.id);
      return '<tr>' +
        '<td class="number-cell">' + escapeHTML(client.number || "—") + '</td>' +
        '<td><div class="client-name-cell"><span class="client-avatar">' + escapeHTML(initials(client.name)) + '</span><span class="table-person"><strong>' + escapeHTML(client.name) + '</strong><small>Adicionado ' + escapeHTML(formatDate(client.createdAt || "", false)) + '</small></span></div></td>' +
        '<td>' + clientStatusHTML(client) + '</td>' +
        '<td>' + (client.phone ? escapeHTML(client.phone) : '<span class="quiet-dash">—</span>') + '</td>' +
        '<td><span class="visit-pill">' + visits.length + '</span></td>' +
        '<td>' + (last ? escapeHTML(formatDate(last.date, true)) : '<span class="quiet-dash">Sem visitas</span>') + '</td>' +
        '<td><button class="row-open" type="button" data-open="' + escapeHTML(client.id) + '" aria-label="Abrir ficha de ' + escapeHTML(client.name) + '">↗</button></td>' +
        '</tr>';
    }).join("");
  }

  function renderVisits() {
    var visits = records.visits.slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    $("#visitListCount").textContent = visits.length + (visits.length === 1 ? " visita" : " visitas");
    if (!visits.length) {
      $("#visitRows").innerHTML = '<div class="empty-mini visit-empty"><span>◷</span><strong>Ainda sem visitas registadas</strong><small>Quando um cliente visitar o espaço, regista aqui a data e uma nota opcional.</small></div>';
      return;
    }
    $("#visitRows").innerHTML = visits.map(function (visit) {
      var client = records.clients.find(function (item) { return item.id === visit.clientId; });
      return '<div class="visit-row"><div class="visit-date-box"><strong>' + escapeHTML(String(visit.date || "").slice(8, 10) || "—") + '</strong><small>' + escapeHTML(monthName(visit.date || "")) + '</small></div>' +
        '<div class="visit-main"><strong>' + escapeHTML(client ? client.name : "Cliente removido") + '</strong><small>' + (visit.notes ? escapeHTML(visit.notes) : "Visita registada") + '</small></div>' +
        '<span class="visit-client-phone">' + escapeHTML(client && client.phone ? client.phone : "") + '</span>' +
        '<button class="row-open" type="button" data-open="' + escapeHTML(visit.clientId) + '" aria-label="Abrir ficha do cliente">↗</button></div>';
    }).join("");
  }

  function renderFollowUps() {
    var term = normalize($("#followUpSearch").value);
    var filter = $("#followUpFilter").value;
    var followUps = records.followUps.filter(function (followUp) {
      var client = clientById(followUp.clientId);
      var content = normalize([client ? client.name : "", followUp.notes, followUpTypeLabel(followUp.type)].join(" "));
      return (filter === "all" || (filter === "done" ? !!followUp.done : !followUp.done)) && (!term || content.indexOf(term) !== -1);
    }).sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
    $("#followUpListCount").textContent = followUps.length + (followUps.length === 1 ? " acompanhamento" : " acompanhamentos");
    $("#followUpEmpty").classList.toggle("hidden", records.followUps.length !== 0);
    $("#followUpRows").classList.toggle("hidden", records.followUps.length === 0);
    if (!followUps.length && records.followUps.length) {
      $("#followUpRows").innerHTML = '<div class="empty-mini visit-empty"><span>⌕</span><strong>Sem resultados</strong><small>Altera a pesquisa ou o filtro para veres outros acompanhamentos.</small></div>';
      return;
    }
    $("#followUpRows").innerHTML = followUps.map(function (followUp) {
      var client = clientById(followUp.clientId);
      var status = followUpStatus(followUp);
      return '<article class="followup-row' + (followUp.done ? ' is-complete' : '') + '">' +
        '<button class="followup-check ' + (followUp.done ? 'is-checked' : '') + '" type="button" data-toggle-followup="' + escapeHTML(followUp.id) + '" aria-label="' + (followUp.done ? 'Reabrir' : 'Concluir') + ' acompanhamento">' + (followUp.done ? '✓' : '') + '</button>' +
        '<div class="followup-main"><div class="followup-title"><strong>' + escapeHTML(client ? client.name : "Cliente removido") + '</strong><span class="status-badge ' + status.className + '">' + status.label + '</span></div>' +
        '<small>' + escapeHTML(followUpTypeLabel(followUp.type)) + (followUp.notes ? ' · ' + escapeHTML(followUp.notes) : '') + '</small></div>' +
        '<time class="followup-date" datetime="' + escapeHTML(followUp.date || "") + '">' + escapeHTML(formatDate(followUp.date || "", true)) + '</time>' +
        '<div class="row-actions"><button class="row-open" type="button" data-edit-followup="' + escapeHTML(followUp.id) + '" aria-label="Editar acompanhamento">✎</button><button class="row-open row-delete" type="button" data-delete-followup="' + escapeHTML(followUp.id) + '" aria-label="Eliminar acompanhamento">×</button></div></article>';
    }).join("");
  }

  function renderSales() {
    var term = normalize($("#saleSearch").value);
    var filter = $("#saleStatusFilter").value;
    var sales = records.sales.filter(function (sale) {
      var client = clientById(sale.clientId);
      var content = normalize([client ? client.name : "", sale.description, sale.notes].join(" "));
      return (filter === "all" || (sale.status || "pending") === filter) && (!term || content.indexOf(term) !== -1);
    }).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    var paidTotal = records.sales.filter(function (sale) { return sale.status === "paid"; }).reduce(function (total, sale) { return total + (Number(sale.amount) || 0); }, 0);
    var pendingCount = records.sales.filter(function (sale) { return sale.status === "pending"; }).length;
    $("#saleListCount").textContent = sales.length + (sales.length === 1 ? " venda" : " vendas");
    $("#salesSummary").textContent = formatEuro(paidTotal) + " declarados em vendas pagas · " + pendingCount + (pendingCount === 1 ? " pendente" : " pendentes");
    $("#saleEmpty").classList.toggle("hidden", records.sales.length !== 0);
    $(".sales-table").parentElement.classList.toggle("hidden", records.sales.length === 0);
    if (!records.sales.length) { $("#saleRows").innerHTML = ""; return; }
    if (!sales.length) {
      $("#saleRows").innerHTML = '<tr><td colspan="7" class="no-results">Não encontrei vendas com essa pesquisa.</td></tr>';
      return;
    }
    $("#saleRows").innerHTML = sales.map(function (sale) {
      var client = clientById(sale.clientId);
      var status = sale.status || "pending";
      return '<tr><td>' + escapeHTML(formatDate(sale.date || "", true)) + '</td>' +
        '<td><strong>' + escapeHTML(client ? client.name : "Cliente removido") + '</strong></td>' +
        '<td>' + escapeHTML(sale.description || "Venda") + (sale.notes ? '<small class="table-subnote">' + escapeHTML(sale.notes) + '</small>' : '') + '</td>' +
        '<td>' + escapeHTML(formatEuro(sale.amount)) + '</td>' +
        '<td><span class="status-badge sale-' + escapeHTML(status) + '">' + escapeHTML(saleStatusLabel(status)) + '</span></td>' +
        '<td>' + escapeHTML(formatDate(sale.renewalDate || "", true)) + '</td>' +
        '<td><div class="row-actions"><button class="row-open" type="button" data-edit-sale="' + escapeHTML(sale.id) + '" aria-label="Editar venda">✎</button><button class="row-open row-delete" type="button" data-delete-sale="' + escapeHTML(sale.id) + '" aria-label="Eliminar venda">×</button></div></td></tr>';
    }).join("");
  }

  function renderLoyalties() {
    var filter = $("#loyaltyFilter").value;
    var eligible = records.sales.filter(function (sale) { return sale.status !== "cancelled" && !!sale.renewalDate; });
    var renewals = eligible.filter(function (sale) { return filter === "all" || renewalStatus(sale) === filter; }).sort(function (a, b) {
      return String(a.renewalDate || "").localeCompare(String(b.renewalDate || ""));
    });
    $("#loyaltyListCount").textContent = renewals.length + (renewals.length === 1 ? " data de renovação" : " datas de renovação");
    $("#loyaltyEmpty").classList.toggle("hidden", eligible.length !== 0);
    $(".loyalty-table").parentElement.classList.toggle("hidden", eligible.length === 0);
    if (!eligible.length) { $("#loyaltyRows").innerHTML = ""; return; }
    if (!renewals.length) {
      $("#loyaltyRows").innerHTML = '<tr><td colspan="5" class="no-results">Não há renovações neste filtro.</td></tr>';
      return;
    }
    var statusLabels = { active: "Em dia", due: "A terminar", expired: "Expirada" };
    $("#loyaltyRows").innerHTML = renewals.map(function (sale) {
      var client = clientById(sale.clientId);
      var state = renewalStatus(sale);
      return '<tr><td><strong>' + escapeHTML(client ? client.name : "Cliente removido") + '</strong></td><td>' + escapeHTML(sale.description || "Venda") + '</td>' +
        '<td>' + escapeHTML(formatDate(sale.renewalDate || "", true)) + '</td><td><span class="status-badge renewal-' + state + '">' + statusLabels[state] + '</span></td>' +
        '<td><button class="row-open" type="button" data-edit-sale="' + escapeHTML(sale.id) + '" aria-label="Editar venda e renovação">✎</button></td></tr>';
    }).join("");
  }

  function renderAll() {
    renderDashboard();
    renderClients();
    renderVisits();
    renderFollowUps();
    renderSales();
    renderLoyalties();
  }

  function setView(view) {
    var labels = { dashboard: "Visão geral", clients: "Clientes", visits: "Visitas", followups: "Acompanhamentos", sales: "Vendas", loyalty: "Fidelizações" };
    $$(".view-panel").forEach(function (panel) { panel.classList.add("hidden"); });
    $("#" + view + "View").classList.remove("hidden");
    $$(".nav-item").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.view === view);
    });
    $("#breadcrumbName").textContent = labels[view] || "Visão geral";
    $("#sidebar").classList.remove("is-open");
    closeSidebarScrim();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "clients") $("#clientSearch").focus({ preventScroll: true });
    if (view === "followups") $("#followUpSearch").focus({ preventScroll: true });
    if (view === "sales") $("#saleSearch").focus({ preventScroll: true });
  }

  function openModal(id) {
    $("#" + id).classList.remove("hidden");
    document.body.classList.add("modal-open");
    var first = $("#" + id + " input:not([type=hidden]), #" + id + " select, #" + id + " textarea");
    if (first) window.setTimeout(function () { first.focus(); }, 50);
  }

  function closeModal(id) {
    var modal = $("#" + id);
    if (modal) modal.classList.add("hidden");
    if ($$(".modal-backdrop:not(.hidden)").length === 0) document.body.classList.remove("modal-open");
  }

  function closeAllModals() {
    $$(".modal-backdrop").forEach(function (modal) { modal.classList.add("hidden"); });
    document.body.classList.remove("modal-open");
  }

  function openClientModal(client) {
    $("#clientForm").reset();
    $("#clientId").value = client ? client.id : "";
    $("#clientModalKicker").textContent = client ? "FICHA DO CLIENTE" : "NOVA FICHA";
    $("#clientModalTitle").textContent = client ? "Editar cliente" : "Registar cliente";
    $("#clientName").value = client ? client.name || "" : "";
    $("#clientPhone").value = client ? client.phone || "" : "";
    $("#clientNumber").value = client ? client.number || "" : nextClientNumber();
    $("#clientStatus").value = clientStatusValue(client);
    $("#clientSource").value = client ? client.source || "" : "";
    $("#clientNotes").value = client ? client.notes || "" : "";
    openModal("clientModal");
  }

  function nextClientNumber() {
    var max = 0;
    records.clients.forEach(function (client) {
      var n = parseInt(String(client.number || "").replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return String(max + 1);
  }

  function openVisitModal(clientId) {
    if (!records.clients.length) {
      showToast("Regista primeiro um cliente.");
      openClientModal(null);
      return;
    }
    $("#visitForm").reset();
    $("#visitId").value = "";
    var options = ['<option value="">Seleciona um cliente</option>'];
    records.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "pt"); }).forEach(function (client) {
      options.push('<option value="' + escapeHTML(client.id) + '">' + escapeHTML(client.number ? client.number + " · " : "") + escapeHTML(client.name) + '</option>');
    });
    $("#visitClient").innerHTML = options.join("");
    if (clientId) $("#visitClient").value = clientId;
    $("#visitDate").value = localDateKey(new Date());
    openModal("visitModal");
  }

  function openClientDetail(clientId) {
    var client = records.clients.find(function (item) { return item.id === clientId; });
    if (!client) return;
    var visits = clientVisits(clientId).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    var clientFollowUps = records.followUps.filter(function (item) { return item.clientId === clientId; });
    var clientSales = records.sales.filter(function (item) { return item.clientId === clientId; });
    var phoneLine = client.phone
      ? '<a class="detail-phone" href="tel:' + escapeHTML(client.phone.replace(/[^\d+]/g, "")) + '">' + escapeHTML(client.phone) + '</a>'
      : '<span class="detail-phone">Sem telemóvel</span>';
    var visitList = visits.length ? visits.slice(0, 8).map(function (visit) {
      return '<div class="detail-visit"><span>' + escapeHTML(formatDate(visit.date, true)) + '</span><small>' + (visit.notes ? escapeHTML(visit.notes) : "Visita registada") + '</small></div>';
    }).join("") : '<div class="detail-visit"><span>Sem visitas registadas</span><small>O histórico aparece aqui.</small></div>';
    $("#detailBody").innerHTML =
      '<div class="detail-cover"><button class="modal-close" type="button" data-close="detailModal" aria-label="Fechar">×</button></div>' +
      '<div class="detail-content"><div class="detail-profile"><span class="detail-avatar">' + escapeHTML(initials(client.name)) + '</span><div><h2 id="detailName">' + escapeHTML(client.name) + '</h2><p>Cliente desde ' + escapeHTML(formatDate(client.createdAt || "", true)) + '</p></div></div>' +
      '<div class="detail-actions"><button class="crm-button crm-button-outline" type="button" data-edit="' + escapeHTML(client.id) + '">Editar ficha</button><button class="crm-button crm-button-gold" type="button" data-add-visit="' + escapeHTML(client.id) + '">＋ Registar visita</button><button class="crm-button crm-button-outline" type="button" data-add-followup="' + escapeHTML(client.id) + '">Agendar contacto</button><button class="crm-button crm-button-outline" type="button" data-add-sale="' + escapeHTML(client.id) + '">Registar venda</button></div>' +
      '<div class="detail-meta"><div><small>N.º CLIENTE</small><strong>' + escapeHTML(client.number || "—") + '</strong></div><div><small>TELEMÓVEL</small><strong>' + phoneLine + '</strong></div></div>' +
      '<div class="detail-meta detail-meta-secondary"><div><small>ESTADO</small><strong>' + clientStatusHTML(client) + '</strong></div><div><small>ORIGEM DO CONTACTO</small><strong>' + escapeHTML(client.source || "—") + '</strong></div></div>' +
      (client.notes ? '<div class="detail-notes">' + escapeTextNode(client.notes) + '</div>' : '') +
      '<div class="detail-visits-title"><strong>Acompanhamentos e vendas</strong><span class="visit-pill">' + (clientFollowUps.length + clientSales.length) + '</span></div><div class="detail-activity-note">' + clientFollowUps.length + (clientFollowUps.length === 1 ? ' acompanhamento' : ' acompanhamentos') + ' · ' + clientSales.length + (clientSales.length === 1 ? ' venda' : ' vendas') + '</div>' +
      '<div class="detail-visits-title"><strong>Histórico de visitas</strong><span class="visit-pill">' + visits.length + '</span></div><div class="detail-visits">' + visitList + '</div>' +
      '<button class="danger-link" type="button" data-delete="' + escapeHTML(client.id) + '">Eliminar esta ficha</button></div>';
    openModal("detailModal");
  }

  function closeSidebarScrim() {
    var scrim = $(".sidebar-scrim");
    if (scrim) scrim.remove();
  }

  function toggleSidebar() {
    var sidebar = $("#sidebar");
    var open = !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", open);
    $("#mobileMenu").setAttribute("aria-expanded", String(open));
    closeSidebarScrim();
    if (open) {
      var scrim = document.createElement("div");
      scrim.className = "sidebar-scrim";
      scrim.addEventListener("click", function () {
        sidebar.classList.remove("is-open");
        $("#mobileMenu").setAttribute("aria-expanded", "false");
        closeSidebarScrim();
      });
      document.body.appendChild(scrim);
    }
  }

  function openById(clientId) {
    if (clientId) openClientDetail(clientId);
  }

  async function exportBackup() {
    try {
      var backup = {
        format: "exclusive-solario-crm-backup-v1",
        version: 1,
        exportedAt: new Date().toISOString(),
        records: cloneRecords(records)
      };
      var blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "exclusive-solario-crm-copia-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Cópia exportada. O ficheiro contém dados pessoais; guarda-o num local seguro.");
    } catch (error) {
      showToast(error.message || "Não foi possível exportar a cópia.");
    }
  }

  async function loadXlsx() {
    if (window.XLSX) return window.XLSX;
    if (cachedXlsx) return cachedXlsx;
    cachedXlsx = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      script.onload = function () { resolve(window.XLSX); };
      script.onerror = function () { cachedXlsx = null; reject(new Error("A leitura de Excel precisa de uma ligação à internet. Tenta novamente ou exporta a folha como CSV UTF-8.")); };
      document.head.appendChild(script);
    });
    return cachedXlsx;
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var value = "";
    var quoted = false;
    var delimiter = ",";
    var firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
    var delimiterCounts = { ",": 0, ";": 0, "\t": 0 };
    var inHeaderQuote = false;
    for (var h = 0; h < firstLine.length; h++) {
      if (firstLine[h] === '"' && firstLine[h + 1] === '"') h++;
      else if (firstLine[h] === '"') inHeaderQuote = !inHeaderQuote;
      else if (!inHeaderQuote && Object.prototype.hasOwnProperty.call(delimiterCounts, firstLine[h])) delimiterCounts[firstLine[h]]++;
    }
    delimiter = Object.keys(delimiterCounts).sort(function (a, b) { return delimiterCounts[b] - delimiterCounts[a]; })[0];
    for (var i = 0; i < text.length; i++) {
      var character = text[i];
      if (quoted) {
        if (character === '"' && text[i + 1] === '"') {
          value += '"';
          i++;
        } else if (character === '"') {
          quoted = false;
        } else {
          value += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === delimiter) {
        row.push(value);
        value = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[i + 1] === "\n") i++;
        row.push(value);
        if (row.some(function (item) { return item.trim() !== ""; })) rows.push(row);
        row = [];
        value = "";
      } else {
        value += character;
      }
    }
    row.push(value);
    if (row.some(function (item) { return item.trim() !== ""; })) rows.push(row);
    return rows;
  }

  function rowsFromGrid(grid) {
    if (!grid.length) return [];
    var headerIndex = 0;
    for (var i = 0; i < Math.min(grid.length, 5); i++) {
      var joined = normalize(grid[i].join(" "));
      if (joined.indexOf("nome") !== -1 || joined.indexOf("cliente") !== -1 || joined.indexOf("name") !== -1) {
        headerIndex = i;
        break;
      }
    }
    var headers = grid[headerIndex].map(normalize);
    var columns = {
      number: headers.findIndex(function (value) { return value.indexOf("cliente") !== -1 && (value.indexOf("numero") !== -1 || value === "n cliente" || value === "cliente"); }),
      name: headers.findIndex(function (value) { return value === "nome" || value === "name" || value.indexOf("nome ") === 0; }),
      phone: headers.findIndex(function (value) { return value.indexOf("telemovel") !== -1 || value.indexOf("telefone") !== -1 || value === "contacto" || value === "phone" || value === "mobile"; }),
      source: headers.findIndex(function (value) { return value.indexOf("origem") !== -1 || value.indexOf("source") !== -1; }),
      notes: headers.findIndex(function (value) { return value.indexOf("nota") !== -1 || value.indexOf("observacao") !== -1; })
    };
    if (columns.name < 0) throw new Error("Não encontrei a coluna Nome na folha.");
    return grid.slice(headerIndex + 1).map(function (line) {
      return {
        number: columns.number >= 0 ? line[columns.number] : "",
        name: line[columns.name],
        phone: columns.phone >= 0 ? line[columns.phone] : "",
        source: columns.source >= 0 ? line[columns.source] : "",
        notes: columns.notes >= 0 ? line[columns.notes] : ""
      };
    }).filter(function (item) { return String(item.name || "").trim() !== ""; });
  }

  function normalizeImportedValue(value) {
    if (value == null) return "";
    if (typeof value === "number" && Number.isInteger(value)) return String(value);
    return String(value).trim();
  }

  async function importFile(file) {
    if (!file) return;
    showToast("A ler a folha neste dispositivo…");
    try {
      var rows;
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        rows = rowsFromGrid(parseCsv(await file.text()));
      } else {
        var xlsx = await loadXlsx();
        var workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false });
        var sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = rowsFromGrid(xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" }));
      }
      var existingPhones = new Set(records.clients.map(function (client) { return String(client.phone || "").replace(/\D/g, ""); }).filter(Boolean));
      var existingPairs = new Set(records.clients.map(function (client) { return normalize(client.name) + "|" + normalize(client.number); }));
      var existingNumbers = new Set(records.clients.map(function (client) { return normalize(client.number); }).filter(Boolean));
      var imported = 0;
      var skipped = 0;
      rows.forEach(function (row) {
        var name = normalizeImportedValue(row.name);
        var phone = normalizeImportedValue(row.phone);
        var number = normalizeImportedValue(row.number);
        var source = normalizeImportedValue(row.source);
        var notes = normalizeImportedValue(row.notes);
        if (!name) return;
        var phoneKey = phone.replace(/\D/g, "");
        var pairKey = normalize(name) + "|" + normalize(number);
        var numberKey = normalize(number);
        if ((phoneKey && existingPhones.has(phoneKey)) || existingPairs.has(pairKey) || (numberKey && existingNumbers.has(numberKey))) {
          skipped++;
          return;
        }
        var client = {
          id: makeId(),
          number: number || nextClientNumber(),
          name: name,
          phone: phone,
          notes: notes,
          status: /site|formulario|formulário/i.test(source) ? "interested" : "active",
          source: source,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        records.clients.push(client);
        existingPairs.add(pairKey);
        if (numberKey) existingNumbers.add(numberKey);
        if (phoneKey) existingPhones.add(phoneKey);
        imported++;
      });
      if (imported) {
        await saveRecords();
        renderAll();
      }
      showToast(imported + (imported === 1 ? " cliente importado" : " clientes importados") + (skipped ? " · " + skipped + " duplicados ignorados" : ""));
    } catch (error) {
      showToast(error.message || "Não consegui importar este ficheiro.");
    } finally {
      $("#importFile").value = "";
    }
  }

  function chooseImport() {
    $("#importFile").click();
  }

  async function handleSaleRowClick(event) {
    var edit = event.target.closest("[data-edit-sale]");
    var remove = event.target.closest("[data-delete-sale]");
    if (edit) {
      var toEdit = records.sales.find(function (sale) { return sale.id === edit.dataset.editSale; });
      if (toEdit) openSaleModal(toEdit);
    } else if (remove) {
      var id = remove.dataset.deleteSale;
      if (!window.confirm("Eliminar este registo de venda?")) return;
      var previousSales = records.sales.slice();
      records.sales = records.sales.filter(function (sale) { return sale.id !== id; });
      try { await saveRecords(); renderAll(); showToast("Venda eliminada."); }
      catch (error) { records.sales = previousSales; renderAll(); showToast("Não consegui guardar esta alteração."); }
    }
  }

  function bindEvents() {
    $("#loginForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      showAuthMessage("");
      var email = $("#loginEmail").value.trim();
      var password = $("#loginPassword").value;
      try {
        var user = await window.solarioIdentity.login(email, password);
        await openApp(user);
      } catch (error) {
        showAuthMessage(error.message || "Não foi possível iniciar sessão.");
      }
      $("#loginPassword").value = "";
    });

    $("#forgotPasswordButton").addEventListener("click", async function () {
      showAuthMessage("");
      var email = $("#loginEmail").value.trim();
      if (!email) {
        showAuthMessage("Escreve primeiro o email da conta de gestão.");
        $("#loginEmail").focus();
        return;
      }
      try {
        await window.solarioIdentity.requestPasswordRecovery(email);
        showAuthMessage("Se existir uma conta para este email, receberás uma mensagem para redefinir a palavra-passe.");
      } catch (error) {
        showAuthMessage(error.message || "Não foi possível pedir a recuperação agora.");
      }
    });

    $("#accessLinkButton").addEventListener("click", async function () {
      showAuthMessage("");
      var email = $("#loginEmail").value.trim();
      if (!email) {
        showAuthMessage("Escreve primeiro o email autorizado da gestão.");
        $("#loginEmail").focus();
        return;
      }
      var button = $("#accessLinkButton");
      button.disabled = true;
      try {
        await window.solarioIdentity.requestAccessLink(email);
        showAuthMessage("Se o email corresponder à conta autorizada, enviámos um link de acesso. Verifica a caixa de entrada e o spam.");
      } catch (error) {
        showAuthMessage(error.message || "Não foi possível enviar o link de acesso agora.");
      } finally {
        button.disabled = false;
      }
    });

    $("#recoveryForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      showAuthMessage("");
      var password = $("#recoveryPassword").value;
      if (password.length < 12) {
        showAuthMessage("Escolhe uma palavra-passe com pelo menos 12 caracteres.");
        return;
      }
      if (password !== $("#recoveryRepeat").value) {
        showAuthMessage("As palavras-passe não coincidem.");
        return;
      }
      try {
        var user = await window.solarioIdentity.updateUser({ password: password });
        await openApp(user);
      } catch (error) {
        showAuthMessage(error.message || "Não foi possível atualizar a palavra-passe.");
      }
      $("#recoveryPassword").value = "";
      $("#recoveryRepeat").value = "";
    });

    $("#importFile").addEventListener("change", function (event) { importFile(event.target.files[0]); });
    $("#quickImport").addEventListener("click", chooseImport);
    $("#emptyImport").addEventListener("click", chooseImport);

    $("#addClientTop").addEventListener("click", function () { openClientModal(null); });
    $("#addClientList").addEventListener("click", function () { openClientModal(null); });
    $("#emptyAddClient").addEventListener("click", function () { openClientModal(null); });
    $("#quickAdd").addEventListener("click", function () { openClientModal(null); });
    $("#quickVisit").addEventListener("click", function () { openVisitModal(); });
    $("#addVisitTop").addEventListener("click", function () { openVisitModal(); });
    $("#quickFollowUp").addEventListener("click", function () { openFollowUpModal(); });
    $("#addFollowUpTop").addEventListener("click", function () { openFollowUpModal(); });
    $("#emptyAddFollowUp").addEventListener("click", function () { openFollowUpModal(); });
    $("#quickSale").addEventListener("click", function () { openSaleModal(); });
    $("#addSaleTop").addEventListener("click", function () { openSaleModal(); });
    $("#emptyAddSale").addEventListener("click", function () { openSaleModal(); });
    $("#loyaltyAddSale").addEventListener("click", function () { openSaleModal(); });
    $("#emptyLoyaltySale").addEventListener("click", function () { setView("sales"); });
    $("#clientSearch").addEventListener("input", renderClients);
    $("#clientStatusFilter").addEventListener("change", renderClients);
    $("#followUpSearch").addEventListener("input", renderFollowUps);
    $("#followUpFilter").addEventListener("change", renderFollowUps);
    $("#saleSearch").addEventListener("input", renderSales);
    $("#saleStatusFilter").addEventListener("change", renderSales);
    $("#loyaltyFilter").addEventListener("change", renderLoyalties);
    $("#backupButton").addEventListener("click", exportBackup);
    $("#logoutButton").addEventListener("click", async function () {
      showAuthMessage("");
      try {
        await window.solarioIdentity.logout();
        lockApp();
      } catch (error) {
        showToast(error.message || "Não foi possível terminar a sessão.");
      }
    });
    $("#refreshButton").addEventListener("click", refreshFromServer);
    $("#mobileMenu").addEventListener("click", toggleSidebar);

    $$(".nav-item").forEach(function (button) {
      button.addEventListener("click", function () { setView(button.dataset.view); });
    });
    $$("[data-goto]").forEach(function (button) {
      button.addEventListener("click", function () { setView(button.dataset.goto); });
    });
    $$("[data-close]").forEach(function (button) {
      button.addEventListener("click", function () { closeModal(button.dataset.close); });
    });
    $$(".modal-backdrop").forEach(function (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal(modal.id);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        $$(".modal-backdrop:not(.hidden)").forEach(function (modal) { closeModal(modal.id); });
        $("#sidebar").classList.remove("is-open");
        closeSidebarScrim();
      }
      if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$("#clientsView").classList.contains("hidden")) {
        event.preventDefault();
        $("#clientSearch").focus();
      }
    });
    $("#clientRows").addEventListener("click", function (event) {
      var button = event.target.closest("[data-open]");
      if (button) openById(button.dataset.open);
    });
    $("#recentClients").addEventListener("click", function (event) {
      var button = event.target.closest("[data-open]");
      if (button) openById(button.dataset.open);
    });
    $("#visitRows").addEventListener("click", function (event) {
      var button = event.target.closest("[data-open]");
      if (button) openById(button.dataset.open);
    });
    $("#followUpRows").addEventListener("click", async function (event) {
      var toggle = event.target.closest("[data-toggle-followup]");
      var edit = event.target.closest("[data-edit-followup]");
      var remove = event.target.closest("[data-delete-followup]");
      if (toggle) {
        var item = records.followUps.find(function (followUp) { return followUp.id === toggle.dataset.toggleFollowup; });
        if (!item) return;
        var previousDone = !!item.done;
        var previousCompletedAt = item.completedAt || "";
        item.done = !item.done;
        item.completedAt = item.done ? new Date().toISOString() : "";
        try { await saveRecords(); renderAll(); showToast(item.done ? "Acompanhamento concluído." : "Acompanhamento reaberto."); }
        catch (error) { item.done = previousDone; item.completedAt = previousCompletedAt; renderAll(); showToast("Não consegui guardar esta alteração."); }
      } else if (edit) {
        var toEdit = records.followUps.find(function (followUp) { return followUp.id === edit.dataset.editFollowup; });
        if (toEdit) openFollowUpModal(toEdit);
      } else if (remove) {
        var id = remove.dataset.deleteFollowup;
        if (!window.confirm("Eliminar este acompanhamento?")) return;
        var previousFollowUps = records.followUps.slice();
        records.followUps = records.followUps.filter(function (followUp) { return followUp.id !== id; });
        try { await saveRecords(); renderAll(); showToast("Acompanhamento eliminado."); }
        catch (error) { records.followUps = previousFollowUps; renderAll(); showToast("Não consegui guardar esta alteração."); }
      }
    });
    $("#saleRows").addEventListener("click", handleSaleRowClick);
    $("#loyaltyRows").addEventListener("click", handleSaleRowClick);

    $("#clientForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var id = $("#clientId").value;
      var number = $("#clientNumber").value.trim() || nextClientNumber();
      var duplicateNumber = records.clients.find(function (client) {
        return client.number === number && client.id !== id;
      });
      if (duplicateNumber) {
        showToast("Este número de cliente já está atribuído.");
        return;
      }
      var existing = records.clients.find(function (client) { return client.id === id; });
      var now = new Date().toISOString();
      var updated = {
        id: id || makeId(),
        number: number,
        name: $("#clientName").value.trim(),
        phone: $("#clientPhone").value.trim(),
        status: $("#clientStatus").value,
        source: $("#clientSource").value.trim(),
        notes: $("#clientNotes").value.trim(),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      };
      if (!updated.name) return;
      if (existing) {
        records.clients[records.clients.indexOf(existing)] = updated;
      } else {
        records.clients.push(updated);
      }
      try {
        await saveRecords();
        renderAll();
        closeModal("clientModal");
        showToast(existing ? "Ficha do cliente atualizada." : "Cliente guardado na tua agenda.");
      } catch (error) {
        showToast("Não consegui guardar a ficha neste dispositivo.");
      }
    });

    $("#followUpForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var id = $("#followUpId").value;
      var existing = records.followUps.find(function (followUp) { return followUp.id === id; });
      var now = new Date().toISOString();
      var followUp = {
        id: id || makeId(),
        clientId: $("#followUpClient").value,
        date: $("#followUpDate").value,
        type: $("#followUpType").value,
        notes: $("#followUpNotes").value.trim(),
        done: existing ? !!existing.done : false,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        completedAt: existing ? existing.completedAt || "" : ""
      };
      if (!followUp.clientId || !followUp.date) return;
      var previousFollowUps = records.followUps.slice();
      if (existing) records.followUps[records.followUps.indexOf(existing)] = followUp;
      else records.followUps.push(followUp);
      try {
        await saveRecords(); renderAll(); closeModal("followUpModal");
        showToast(existing ? "Acompanhamento atualizado." : "Acompanhamento agendado.");
      } catch (error) { records.followUps = previousFollowUps; renderAll(); showToast("Não consegui guardar o acompanhamento."); }
    });

    $("#saleForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var id = $("#saleId").value;
      var existing = records.sales.find(function (sale) { return sale.id === id; });
      var amountText = $("#saleAmount").value.trim();
      var sale = {
        id: id || makeId(),
        clientId: $("#saleClient").value,
        description: $("#saleDescription").value.trim(),
        date: $("#saleDate").value,
        amount: amountText === "" ? null : Number(amountText),
        status: $("#saleStatus").value,
        renewalDate: $("#saleRenewalDate").value,
        notes: $("#saleNotes").value.trim(),
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (!sale.clientId || !sale.description || !sale.date || (sale.amount !== null && (!Number.isFinite(sale.amount) || sale.amount < 0))) return;
      var previousSales = records.sales.slice();
      if (existing) records.sales[records.sales.indexOf(existing)] = sale;
      else records.sales.push(sale);
      try {
        await saveRecords(); renderAll(); closeModal("saleModal");
        showToast(existing ? "Venda atualizada." : "Venda registada.");
      } catch (error) { records.sales = previousSales; renderAll(); showToast("Não consegui guardar a venda."); }
    });

    $("#visitForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var id = $("#visitId").value;
      var existing = records.visits.find(function (visit) { return visit.id === id; });
      var visit = {
        id: id || makeId(),
        clientId: $("#visitClient").value,
        date: $("#visitDate").value,
        notes: $("#visitNotes").value.trim(),
        createdAt: existing ? existing.createdAt : new Date().toISOString()
      };
      if (!visit.clientId || !visit.date) return;
      if (existing) records.visits[records.visits.indexOf(existing)] = visit;
      else records.visits.push(visit);
      try {
        await saveRecords();
        renderAll();
        closeModal("visitModal");
        closeModal("detailModal");
        showToast(existing ? "Visita atualizada." : "Visita registada.");
      } catch (error) {
        showToast("Não consegui guardar a visita neste dispositivo.");
      }
    });

    $("#detailBody").addEventListener("click", function (event) {
      var close = event.target.closest("[data-close]");
      var edit = event.target.closest("[data-edit]");
      var addVisit = event.target.closest("[data-add-visit]");
      var addFollowUp = event.target.closest("[data-add-followup]");
      var addSale = event.target.closest("[data-add-sale]");
      var remove = event.target.closest("[data-delete]");
      if (close) {
        closeModal(close.dataset.close);
        return;
      }
      if (edit) {
        var client = records.clients.find(function (item) { return item.id === edit.dataset.edit; });
        closeModal("detailModal");
        openClientModal(client);
      }
      if (addVisit) {
        var clientId = addVisit.dataset.addVisit;
        closeModal("detailModal");
        openVisitModal(clientId);
      }
      if (addFollowUp) {
        var followUpClientId = addFollowUp.dataset.addFollowup;
        closeModal("detailModal");
        openFollowUpModal(null, followUpClientId);
      }
      if (addSale) {
        var saleClientId = addSale.dataset.addSale;
        closeModal("detailModal");
        openSaleModal(null, saleClientId);
      }
      if (remove) {
        var id = remove.dataset.delete;
        var clientToDelete = records.clients.find(function (item) { return item.id === id; });
        if (!clientToDelete || !window.confirm("Eliminar a ficha de " + clientToDelete.name + " e o respetivo histórico de visitas, acompanhamentos e vendas?")) return;
        records.clients = records.clients.filter(function (item) { return item.id !== id; });
        records.visits = records.visits.filter(function (item) { return item.clientId !== id; });
        records.followUps = records.followUps.filter(function (item) { return item.clientId !== id; });
        records.sales = records.sales.filter(function (item) { return item.clientId !== id; });
        saveRecords().then(function () {
          renderAll();
          closeModal("detailModal");
          showToast("Ficha e histórico eliminados.");
        }).catch(function () { showToast("Não consegui guardar esta alteração."); });
      }
    });
  }

  async function initialize() {
    if (!window.solarioIdentity) {
      showPanel("login");
      showAuthMessage("Não foi possível carregar a autenticação. Atualiza a página e tenta novamente.");
      return;
    }
    window.solarioIdentity.onAuthChange(function (event) {
      if (event === "logout") lockApp();
    });
    try {
      var callback = await window.solarioIdentity.handleAuthCallback();
      if (callback && callback.type === "recovery") {
        showPanel("recovery");
        $("#recoveryPassword").focus();
        return;
      }
      var user = callback && callback.user ? callback.user : await window.solarioIdentity.getUser();
      if (user) await openApp(user);
      else {
        showPanel("login");
        $("#loginEmail").focus();
      }
    } catch (error) {
      showPanel("login");
      showAuthMessage(error.message || "Não foi possível validar a sessão.");
    }
  }

  bindEvents();
  initialize();
})();
