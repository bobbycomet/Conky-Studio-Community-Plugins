(() => {
  "use strict";

  // -----------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------
  // Defaults to the manifest sitting next to this page, so a store hosted
  // from the same repo as Conky Studio's plugins.json stays in sync with
  // zero extra steps. Override with ?manifest=<url> to preview a fork or a
  // different community store built from this same template.
  const params = new URLSearchParams(location.search);
  const MANIFEST_URL = params.get("manifest") || "./manifest.json";

  // Bare (non-URL) icon filenames in a manifest are resolved against this
  // folder for the *website's* purposes. This is a display-only convention
  // for this static site — separate from how the desktop app resolves a
  // bare icon filename against a local plugin pack's own directory.
  const ICON_BASE = "./icons/";

  const CATEGORY_LABELS = { logic: "Logic", visual: "Visual" };

  // -----------------------------------------------------------------
  // State
  // -----------------------------------------------------------------
  let allPlugins = [];
  let manifestMeta = { source: MANIFEST_URL, updated_at: "", api_version: "" };
  let filters = { category: "all", tag: null, query: "" };

  // -----------------------------------------------------------------
  // Elements
  // -----------------------------------------------------------------
  const el = {
    tabs: document.getElementById("filter-tabs"),
    tagRow: document.getElementById("filter-tags"),
    grid: document.getElementById("plugin-grid"),
    resultCount: document.getElementById("result-count"),
    statePanel: document.getElementById("state-panel"),
    viewGrid: document.getElementById("view-grid"),
    viewHero: document.getElementById("view-hero"),
    filterRail: document.getElementById("filter-rail"),
    viewDetail: document.getElementById("view-detail"),
    detailContent: document.getElementById("detail-content"),
    search: document.getElementById("search-input"),
    toast: document.getElementById("toast"),
    copyManifestBtn: document.getElementById("copy-manifest-url"),
  };

  // -----------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------
  async function loadManifest() {
    showState("loading");
    try {
      const res = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const plugins = Array.isArray(data.plugins) ? data.plugins : [];
      allPlugins = plugins
        .filter((p) => p && p.id)
        .map(normalizePlugin)
        .sort((a, b) =>
          (a.label || a.id).localeCompare(b.label || b.id) || a.id.localeCompare(b.id)
        );
      manifestMeta = {
        source: MANIFEST_URL,
        updated_at: data.updated_at || "",
        api_version: data.api_version || "",
      };
      if (allPlugins.length === 0) {
        showState("empty");
      } else {
        hideState();
        buildFilterUI();
        route();
      }
    } catch (err) {
      showState("error", err);
    }
  }

  function normalizePlugin(p) {
    return {
      id: String(p.id),
      category: p.category === "logic" ? "logic" : "visual",
      label: p.label || p.id,
      author: p.author || "",
      version: p.version || "",
      description: p.description || "",
      color: p.color || "#5f8fd6",
      subcategory: p.subcategory || "",
      output_kind: p.output_kind || "",
      tags: Array.isArray(p.tags) ? p.tags.filter(Boolean) : [],
      lua_expr: p.lua_expr || "",
      lua_draw_body: p.lua_draw_body || "",
      lua_helpers: p.lua_helpers || "",
      simple_mode: !!p.simple_mode,
      homepage: p.homepage || "",
      license: p.license || "",
      icon: (p.icon || "").trim(),
      properties: Array.isArray(p.properties) ? p.properties : [],
    };
  }

  function resolveIconSrc(plugin) {
    if (!plugin.icon) return null;
    if (/^https?:\/\//i.test(plugin.icon)) return plugin.icon;
    return ICON_BASE + plugin.icon;
  }

  // -----------------------------------------------------------------
  // Filter UI
  // -----------------------------------------------------------------
  function buildFilterUI() {
    const counts = { all: allPlugins.length, visual: 0, logic: 0 };
    const tagCounts = new Map();
    for (const p of allPlugins) {
      counts[p.category] = (counts[p.category] || 0) + 1;
      for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }

    el.tabs.innerHTML = "";
    const cats = ["all", ...Object.keys(CATEGORY_LABELS).filter((c) => counts[c])];
    for (const cat of cats) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-tab";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(filters.category === cat));
      btn.dataset.category = cat;
      const label = cat === "all" ? "All" : CATEGORY_LABELS[cat];
      btn.innerHTML = `${label} <span class="count">${counts[cat]}</span>`;
      btn.addEventListener("click", () => {
        filters.category = cat;
        renderGrid();
        syncFilterUI();
      });
      el.tabs.appendChild(btn);
    }

    el.tagRow.innerHTML = "";
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    for (const [tag] of topTags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip";
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        filters.tag = filters.tag === tag ? null : tag;
        renderGrid();
        syncFilterUI();
      });
      el.tagRow.appendChild(chip);
    }
    syncFilterUI();
  }

  function syncFilterUI() {
    el.tabs.querySelectorAll(".filter-tab").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.dataset.category === filters.category));
    });
    el.tagRow.querySelectorAll(".tag-chip").forEach((chip) => {
      chip.classList.toggle("active", chip.textContent === filters.tag);
    });
  }

  el.search.addEventListener("input", debounce(() => {
    filters.query = el.search.value.trim().toLowerCase();
    renderGrid();
  }, 150));

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // -----------------------------------------------------------------
  // Grid
  // -----------------------------------------------------------------
  function filteredPlugins() {
    return allPlugins.filter((p) => {
      if (filters.category !== "all" && p.category !== filters.category) return false;
      if (filters.tag && !p.tags.includes(filters.tag)) return false;
      if (filters.query) {
        const haystack = [p.label, p.id, p.description, p.author, ...p.tags]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(filters.query)) return false;
      }
      return true;
    });
  }

  function renderGrid() {
    const list = filteredPlugins();
    el.resultCount.textContent =
      list.length === allPlugins.length
        ? `${list.length} plugin${list.length === 1 ? "" : "s"}`
        : `${list.length} of ${allPlugins.length} plugins`;

    if (list.length === 0) {
      el.grid.innerHTML = "";
      showInlineEmpty();
      return;
    }
    el.statePanel.hidden = true;
    el.grid.hidden = false;

    el.grid.innerHTML = "";
    for (const p of list) el.grid.appendChild(renderCard(p));
  }

  function showInlineEmpty() {
    el.statePanel.hidden = false;
    el.statePanel.innerHTML = `
      <h2>No plugins match that</h2>
      <p>Try a different search term, or clear the category and tag filters.</p>
      <button class="btn btn-ghost" id="clear-filters" type="button">Clear filters</button>
    `;
    document.getElementById("clear-filters").addEventListener("click", () => {
      filters = { category: "all", tag: null, query: "" };
      el.search.value = "";
      syncFilterUI();
      renderGrid();
    });
  }

  function renderCard(p) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "plugin-card";
    card.style.setProperty("--card-accent", p.color);
    card.setAttribute("aria-label", `${p.label}, ${CATEGORY_LABELS[p.category]} plugin`);

    const iconSrc = resolveIconSrc(p);
    card.innerHTML = `
      <div class="card-top">
        <div class="card-icon">
          ${iconSrc ? `<img src="${escapeAttr(iconSrc)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="dot"></span>`}
        </div>
        <div class="card-heading">
          <div class="card-label">${escapeHtml(p.label)}</div>
          <div class="card-id">${escapeHtml(p.id)}</div>
        </div>
      </div>
      ${p.description ? `<p class="card-desc">${escapeHtml(p.description)}</p>` : ""}
      <div class="card-tags">${p.tags.slice(0, 3).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>
      <div class="card-meta">
        <span>${escapeHtml(p.author || "unattributed")}${p.version ? " · v" + escapeHtml(p.version) : ""}</span>
        <span class="badge">${CATEGORY_LABELS[p.category]}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      location.hash = `#/plugin/${encodeURIComponent(p.id)}`;
    });
    return card;
  }

  // -----------------------------------------------------------------
  // Detail view
  // -----------------------------------------------------------------
  function renderDetail(p) {
    const iconSrc = resolveIconSrc(p);
    const rows = p.properties
      .map(
        (prop) => `
        <tr>
          <td class="mono">${escapeHtml(prop.label || prop.key || "")}</td>
          <td class="mono">${escapeHtml(prop.kind || "")}</td>
          <td class="mono">${escapeHtml(formatDefault(prop.default))}</td>
          <td>${escapeHtml(prop.help || "")}</td>
        </tr>`
      )
      .join("");

    el.detailContent.innerHTML = `
      <div class="detail-head">
        <div class="detail-icon" style="--card-accent:${escapeAttr(p.color)}">
          ${iconSrc ? `<img src="${escapeAttr(iconSrc)}" alt="" onerror="this.remove()">` : `<span class="dot"></span>`}
        </div>
        <div>
          <h1 class="detail-title">${escapeHtml(p.label)}</h1>
          <div class="detail-id">${escapeHtml(p.id)}</div>
        </div>
      </div>

      <div class="detail-meta-row">
        <span>Author <b>${escapeHtml(p.author || "unattributed")}</b></span>
        ${p.version ? `<span>Version <b>${escapeHtml(p.version)}</b></span>` : ""}
        <span>Category <b>${CATEGORY_LABELS[p.category]}</b></span>
        ${p.output_kind ? `<span>Outputs <b>${escapeHtml(p.output_kind)}</b></span>` : ""}
        ${p.license ? `<span>License <b>${escapeHtml(p.license)}</b></span>` : ""}
      </div>

      ${p.tags.length ? `<div class="detail-tags">${p.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}

      ${p.description ? `<p class="detail-desc">${escapeHtml(p.description)}</p>` : ""}

      <div class="detail-actions">
        ${p.homepage ? `<a class="btn btn-ghost" href="${escapeAttr(p.homepage)}" target="_blank" rel="noopener">Homepage ↗</a>` : ""}
        <button class="btn btn-ghost" id="copy-id" type="button">Copy plugin ID</button>
        <button class="btn btn-ghost" id="copy-source" type="button">Copy store URL</button>
      </div>

      ${rows ? `
      <div class="detail-block">
        <h2>Properties</h2>
        <table class="prop-table">
          <thead><tr><th>Label</th><th>Kind</th><th>Default</th><th>Help</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : ""}

      <div class="detail-block">
        <h2>What actually runs</h2>
        ${luaBlock("Expression", p.lua_expr)}
        ${luaBlock("Draw body", p.lua_draw_body)}
        ${luaBlock("Shared helpers", p.lua_helpers)}
        ${!p.lua_expr && !p.lua_draw_body && !p.lua_helpers ? `<p class="card-desc">This plugin doesn't ship any Lua of its own.</p>` : ""}
      </div>
    `;

    document.getElementById("copy-id").addEventListener("click", () => copyToClipboard(p.id, "Plugin ID copied"));
    document.getElementById("copy-source").addEventListener("click", () =>
      copyToClipboard(new URL(MANIFEST_URL, location.href).toString(), "Store URL copied")
    );
  }

  function luaBlock(title, code) {
    if (!code) return "";
    return `
      <details class="lua-block">
        <summary>${escapeHtml(title)}</summary>
        <pre class="lua-code">${escapeHtml(code)}</pre>
      </details>`;
  }

  function formatDefault(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  // -----------------------------------------------------------------
  // Router
  // -----------------------------------------------------------------
  function route() {
    const hash = location.hash || "#/";
    const match = hash.match(/^#\/plugin\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const plugin = allPlugins.find((p) => p.id === id);
      if (plugin) {
        renderDetail(plugin);
        toggleViews("detail");
        window.scrollTo({ top: 0 });
        return;
      }
    }
    toggleViews("grid");
    renderGrid();
  }

  function toggleViews(which) {
    const isDetail = which === "detail";
    el.viewDetail.hidden = !isDetail;
    el.viewHero.hidden = isDetail;
    el.filterRail.hidden = isDetail;
    el.viewGrid.hidden = isDetail;
  }

  window.addEventListener("hashchange", route);

  // -----------------------------------------------------------------
  // Loading / error / empty states
  // -----------------------------------------------------------------
  function showState(kind, err) {
    el.grid.hidden = true;
    el.statePanel.hidden = false;
    el.resultCount.textContent = "";
    if (kind === "loading") {
      el.statePanel.innerHTML = `<div class="spinner"></div><h2>Loading the catalog</h2><p>Fetching the current plugin manifest.</p>`;
    } else if (kind === "empty") {
      el.statePanel.innerHTML = `<h2>Nothing published yet</h2><p>This store's manifest doesn't list any plugins right now.</p>`;
    } else if (kind === "error") {
      el.statePanel.innerHTML = `
        <h2>Couldn't load the catalog</h2>
        <p>${escapeHtml(String((err && err.message) || err || "The manifest didn't load."))}</p>
        <button class="btn btn-ghost" id="retry-load" type="button">Try again</button>
      `;
      document.getElementById("retry-load").addEventListener("click", loadManifest);
    }
  }

  function hideState() {
    el.statePanel.hidden = true;
    el.grid.hidden = false;
  }

  // -----------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  function copyToClipboard(text, message) {
    const done = () => showToast(message);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    done();
  }

  let toastTimer;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
  }

  el.copyManifestBtn.addEventListener("click", () =>
    copyToClipboard(new URL(MANIFEST_URL, location.href).toString(), "Manifest URL copied")
  );

  // -----------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------
  loadManifest();
})();
