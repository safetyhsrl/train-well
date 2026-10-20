// =====================================================================
// Train Well — main application (single page, hash routing)
// =====================================================================
(function () {
  "use strict";

  const CFG = window.TRAINWELL_CONFIG || {};
  const WARN_DAYS = CFG.EXPIRY_WARNING_DAYS || 30;

  // ---------------------------------------------------------------- state
  const state = { me: null, facilities: [], courses: [] };
  const isAdmin = () => state.me && state.me.role === "admin";

  // -------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const todayISO = () => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const addDaysISO = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const fmtDate = (v) => v ? new Date(v.length === 10 ? v + "T00:00:00" : v)
    .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
  const fmtDateTime = (v) => v ? new Date(v).toLocaleString(undefined,
    { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const toLocalInput = (v) => {
    if (!v) return "";
    const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const fullName = (e) => e ? `${e.first_name} ${e.last_name}` : "—";
  const facilityName = (id) => (state.facilities.find((f) => f.id === id) || {}).name || "—";
  const courseTitle = (id) => (state.courses.find((c) => c.id === id) || {}).title || "—";
  const badge = (s, text) => `<span class="badge ${esc(s)}">${esc(text || s)}</span>`;

  function expiryStatus(expires_on) {
    if (!expires_on) return "valid";
    if (expires_on < todayISO()) return "expired";
    if (expires_on <= addDaysISO(WARN_DAYS)) return "expiring";
    return "valid";
  }

  function toast(msg, isError = false) {
    const t = $("#toast");
    t.textContent = msg; t.className = isError ? "error" : "";
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 3500);
  }

  function check({ data, error }) {
    if (error) { console.error(error); throw new Error(error.message); }
    return data;
  }

  // Fetch all rows of a query in pages of 1000 (Supabase's default cap)
  async function fetchAll(build) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const rows = check(await build().range(from, from + size - 1));
      out.push(...rows);
      if (rows.length < size) break;
    }
    return out;
  }

  function facilityOptions(selected, { includeAll = false } = {}) {
    let opts = includeAll ? `<option value="">All facilities</option>` : "";
    for (const f of state.facilities)
      opts += `<option value="${f.id}" ${String(f.id) === String(selected) ? "selected" : ""}>${esc(f.name)}</option>`;
    return opts;
  }
  function courseOptions(selected, { includeAll = false, activeOnly = true } = {}) {
    let opts = includeAll ? `<option value="">All courses</option>` : `<option value="">Select a course…</option>`;
    for (const c of state.courses.filter((c) => !activeOnly || c.active || c.id === Number(selected)))
      opts += `<option value="${c.id}" ${String(c.id) === String(selected) ? "selected" : ""}>${esc(c.title)}</option>`;
    return opts;
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------------------------------------------------------- Excel export
  // SheetJS is loaded only when someone downloads, so normal pages stay fast.
  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) xlsxLoading = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      sc.onload = () => resolve(window.XLSX);
      sc.onerror = () => { xlsxLoading = null; reject(new Error("Could not load the Excel library. Check your internet connection and try again.")); };
      document.head.appendChild(sc);
    });
    return xlsxLoading;
  }
  // Dates go in as real Excel dates (serial numbers) so they never shift a day with time zones
  const toDate = (v) => {
    if (!v) return null;
    const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
    return { t: "n", v: (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000, z: "yyyy-mm-dd" };
  };
  function sheetFrom(XLSX, rows, widths) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = (widths || rows[0].map((h) => Math.max(12, String(h).length + 2))).map((w) => ({ wch: w }));
    if (rows.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    return ws;
  }
  async function downloadXLSX(filename, sheetName, rows) {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, rows), sheetName);
    XLSX.writeFile(wb, filename);
  }

  const STATUS_LABEL = { valid: "Up to date", expiring: "Due soon", expired: "Overdue", missing: "Missing" };

  // Training records workbook: a matrix (people x courses, like the paper report) + the full list
  async function downloadTrainingExcel(facilityFilter, records) {
    toast("Preparing Excel file…");
    const XLSX = await loadXLSX();
    const facId = facilityFilter ? Number(facilityFilter) : null;
    const employees = (await loadEmployees({ activeOnly: true })).filter((e) => !facId || e.facility_id === facId);
    const status = await fetchAll(() => sb.from("training_status").select("*"));
    const map = new Map(status.map((s) => [`${s.employee_id}:${s.course_id}`, s]));
    const courses = state.courses.filter((c) => c.active);

    // Sheet 1: matrix
    const head = ["Employee", "Facility", "Job title", ...courses.map((c) => c.title + (c.mandatory ? "" : " (optional)"))];
    const matrix = [head];
    for (const e of employees) {
      const row = [`${e.last_name}, ${e.first_name}`, facilityName(e.facility_id), e.job_title || ""];
      for (const c of courses) {
        const s = map.get(`${e.id}:${c.id}`);
        if (!s) { row.push(c.mandatory ? "Missing" : ""); continue; }
        const label = STATUS_LABEL[expiryStatus(s.expires_on)];
        row.push(s.expires_on ? `${label} (${s.expires_on})` : label);
      }
      matrix.push(row);
    }
    // Totals per course
    matrix.push([]);
    for (const key of ["valid", "expiring", "expired", "missing"]) {
      const row = [STATUS_LABEL[key], "", ""];
      for (const c of courses) {
        row.push(employees.filter((e) => {
          const s = map.get(`${e.id}:${c.id}`);
          return key === "missing" ? (!s && c.mandatory) : (s && expiryStatus(s.expires_on) === key);
        }).length);
      }
      matrix.push(row);
    }
    const mWs = sheetFrom(XLSX, matrix, [26, 24, 18, ...courses.map(() => 24)]);
    mWs["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: employees.length, c: head.length - 1 } }) };

    // Sheet 2: every record currently shown on the page
    const list = [["Employee", "Facility", "Course", "Completed", "Expires", "Status", "Score", "Certificate #", "Notes"]];
    for (const r of records) list.push([
      `${r.employees.last_name}, ${r.employees.first_name}`, facilityName(r.employees.facility_id), courseTitle(r.course_id),
      toDate(r.completed_on), toDate(r.expires_on), STATUS_LABEL[expiryStatus(r.expires_on)],
      r.score ?? "", r.certificate_no || "", r.notes || ""]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, mWs, "Training matrix");
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, list, [26, 24, 34, 12, 12, 12, 8, 14, 50]), "All records");
    const facPart = facId ? "-" + facilityName(facId).replace(/[^A-Za-z0-9]+/g, "-") : "";
    XLSX.writeFile(wb, `TrainWell-training${facPart}-${todayISO()}.xlsx`);
  }

  function parseCSV(text) {
    const rows = []; let row = []; let cur = ""; let q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur); if (row.some((c) => c.trim() !== "")) rows.push(row);
    return rows;
  }

  // ---------------------------------------------------------------- modal
  function openModal({ title, body, wide = false, submitText = "Save", onSubmit, footer }) {
    const root = $("#modalRoot");
    root.innerHTML = `
      <div class="modal-bg">
        <form class="modal ${wide ? "wide" : ""}" novalidate>
          <div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-close aria-label="Close">×</button></div>
          <div class="alert error hidden" data-err></div>
          <div data-body>${body}</div>
          ${footer !== undefined ? footer : `
          <div class="modal-foot">
            <button type="button" class="secondary" data-close>Cancel</button>
            ${onSubmit ? `<button type="submit">${esc(submitText)}</button>` : ""}
          </div>`}
        </form>
      </div>`;
    const form = $("form", root);
    const close = () => { root.innerHTML = ""; };
    $$("[data-close]", root).forEach((b) => b.addEventListener("click", close));
    $(".modal-bg", root).addEventListener("mousedown", (e) => { if (e.target.classList.contains("modal-bg")) close(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const btn = $("button[type=submit]", form); const err = $("[data-err]", form);
      btn.disabled = true; err.classList.add("hidden");
      try {
        const fd = Object.fromEntries(new FormData(form).entries());
        const res = await onSubmit(fd, form);
        if (res !== false) close();
      } catch (ex) {
        err.textContent = ex.message || String(ex); err.classList.remove("hidden");
        form.scrollTop = 0;
      } finally { btn.disabled = false; }
    });
    const first = $("input:not([type=hidden]),select,textarea", form); if (first) first.focus();
    return { form, close };
  }

  async function confirmBox(message, { okText = "Delete", danger = true } = {}) {
    return new Promise((resolve) => {
      const { form } = openModal({
        title: "Please confirm", body: `<p>${esc(message)}</p>`,
        footer: `<div class="modal-foot">
          <button type="button" class="secondary" data-no>Cancel</button>
          <button type="button" class="${danger ? "danger" : ""}" data-yes>${esc(okText)}</button></div>`
      });
      $("[data-no]", form).onclick = () => { $("#modalRoot").innerHTML = ""; resolve(false); };
      $("[data-yes]", form).onclick = () => { $("#modalRoot").innerHTML = ""; resolve(true); };
      $$("[data-close]", form).forEach((b) => b.addEventListener("click", () => resolve(false)));
    });
  }

  // Blank-to-null for form values
  const nn = (v) => (v === undefined || v === null || String(v).trim() === "") ? null : String(v).trim();

  // Red "Delete" link used on each row
  const delBtn = (id) => `<button class="link small" data-del="${esc(id)}" style="color:var(--bad)">Delete</button>`;

  // Call a Supabase Edge Function and turn its errors into readable messages
  async function invokeFn(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j.error) msg = j.error; } catch (_) { /* keep default */ }
      throw new Error(/Failed to send|not found|404/i.test(msg)
        ? `Could not reach the "${name}" function. Has it been deployed in Supabase? (see README)` : msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // -------------------------------------------------------------- loaders
  async function loadLookups() {
    state.facilities = check(await sb.from("facilities").select("*").order("name"));
    state.courses = check(await sb.from("courses").select("*").order("title"));
  }

  async function loadEmployees({ activeOnly = false } = {}) {
    return fetchAll(() => {
      let q = sb.from("employees").select("*").order("last_name").order("first_name");
      if (activeOnly) q = q.eq("status", "active");
      return q;
    });
  }

  // Requirement status for active employees against mandatory courses
  async function complianceMatrix(employees) {
    const status = await fetchAll(() => sb.from("training_status").select("*"));
    const map = new Map(status.map((s) => [`${s.employee_id}:${s.course_id}`, s]));
    const mandatory = state.courses.filter((c) => c.mandatory && c.active);
    const items = [];
    for (const e of employees.filter((e) => e.status === "active")) {
      for (const c of mandatory) {
        const s = map.get(`${e.id}:${c.id}`);
        items.push({
          employee: e, course: c,
          status: s ? expiryStatus(s.expires_on) : "missing",
          expires_on: s ? s.expires_on : null, completed_on: s ? s.completed_on : null
        });
      }
    }
    return { items, map };
  }

  // =============================================================== VIEWS
  const views = {};

  // -------------------------------------------------------- dashboard
  views.dashboard = {
    title: "Dashboard",
    async render(view) {
      const employees = await loadEmployees({ activeOnly: true });
      const { items } = await complianceMatrix(employees);
      const upcoming = check(await sb.from("sessions").select("*, attendance(count)")
        .gte("starts_at", new Date().toISOString()).order("starts_at").limit(8));
      // Fire drills: last drill per home (the card hides itself if drills aren't set up yet)
      const { data: drillRows, error: drillErr } = await sb.from("fire_drills")
        .select("id, facility_id, drill_date, event_type, q_meeting_area, q_fire_doors, q_windows_doors, q_staff_response, q_corridors_clear, q_pull_stations")
        .order("drill_date", { ascending: false });
      const thisYear = todayISO().slice(0, 4);
      const drillByFac = drillErr ? [] : state.facilities
        .filter((f) => isAdmin() || f.id === state.me.facility_id)
        .map((f) => {
          const ds = drillRows.filter((x) => x.facility_id === f.id);
          const last = ds[0];
          return { f, last, year: ds.filter((x) => x.drill_date.startsWith(thisYear)).length,
            days: last ? Math.round((new Date(todayISO()) - new Date(last.drill_date)) / 86400000) : null };
        });

      const count = (s) => items.filter((i) => i.status === s).length;
      const okCount = count("valid") + count("expiring");
      const pct = items.length ? Math.round((okCount / items.length) * 100) : 100;

      const byFac = state.facilities.map((f) => {
        const fi = items.filter((i) => i.employee.facility_id === f.id);
        const ok = fi.filter((i) => i.status === "valid" || i.status === "expiring").length;
        return { f, n: employees.filter((e) => e.facility_id === f.id).length,
          pct: fi.length ? Math.round(ok / fi.length * 100) : 100,
          expired: fi.filter((i) => i.status === "expired").length,
          missing: fi.filter((i) => i.status === "missing").length };
      }).filter((r) => isAdmin() || r.f.id === state.me.facility_id);

      const attention = items.filter((i) => i.status !== "valid")
        .sort((a, b) => ({ expired: 0, expiring: 1, missing: 2 }[a.status] - { expired: 0, expiring: 1, missing: 2 }[b.status])
          || String(a.expires_on).localeCompare(String(b.expires_on)))
        .slice(0, 15);

      view.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="label">Active employees</div><div class="value">${employees.length}</div></div>
          <div class="stat ${pct >= 90 ? "ok" : pct >= 75 ? "warn" : "bad"}"><div class="label">Mandatory training compliance</div><div class="value">${pct}%</div></div>
          <div class="stat warn"><div class="label">Expiring in ${WARN_DAYS} days</div><div class="value">${count("expiring")}</div></div>
          <div class="stat bad"><div class="label">Expired</div><div class="value">${count("expired")}</div></div>
          <div class="stat bad"><div class="label">Never completed</div><div class="value">${count("missing")}</div></div>
        </div>

        <div class="card">
          <h2>Compliance by facility</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Facility</th><th>Employees</th><th style="width:40%">Compliance</th><th>Expired</th><th>Missing</th></tr></thead>
            <tbody>${byFac.map((r) => `
              <tr><td>${esc(r.f.name)}</td><td>${r.n}</td>
                <td><div style="display:flex;gap:.6rem;align-items:center"><div class="bar" style="flex:1"><span style="width:${r.pct}%;background:${r.pct >= 90 ? "var(--ok)" : r.pct >= 75 ? "var(--accent)" : "var(--bad)"}"></span></div><strong>${r.pct}%</strong></div></td>
                <td>${r.expired}</td><td>${r.missing}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No facilities yet.</td></tr>`}
            </tbody></table></div>
        </div>

        ${drillErr ? "" : `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
            <h2 style="margin:0">Fire drills</h2><a href="#drills">Open Fire Drilling →</a></div>
          <div class="table-wrap" style="margin-top:.6rem"><table>
            <thead><tr><th>Home</th><th>Last drill</th><th>Days since</th><th>Last outcome</th><th>Drills in ${thisYear}</th></tr></thead>
            <tbody>${drillByFac.map((r) => `
              <tr><td>${esc(r.f.name)}</td>
                <td>${r.last ? fmtDate(r.last.drill_date) + (r.last.event_type === "alarm" ? " (alarm)" : "") : badge("missing", "None recorded")}</td>
                <td>${r.days == null ? "—" : r.days}</td>
                <td>${r.last ? (drillIssues(r.last) ? badge("expired", drillIssues(r.last) + (drillIssues(r.last) > 1 ? " issues" : " issue")) : badge("valid", "No issues")) : "—"}</td>
                <td>${r.year}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No facilities yet.</td></tr>`}
            </tbody></table></div>
        </div>`}

        <div class="cols">
          <div class="card">
            <h2>Needs attention</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>Employee</th><th>Course</th><th>Status</th><th>Expires</th></tr></thead>
              <tbody>${attention.map((i) => `
                <tr><td><button class="link" data-emp="${i.employee.id}">${esc(fullName(i.employee))}</button></td>
                  <td>${esc(i.course.title)}</td><td>${badge(i.status)}</td><td>${fmtDate(i.expires_on)}</td></tr>`).join("")
                || `<tr><td colspan="4" class="empty">Everyone is up to date. 🎉</td></tr>`}
              </tbody></table></div>
            ${attention.length ? `<p style="margin:.8rem 0 0"><a href="#records">See all training records →</a></p>` : ""}
          </div>
          <div class="card">
            <h2>Upcoming sessions</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>Date</th><th>Course</th><th>Facility</th><th>Booked</th></tr></thead>
              <tbody>${upcoming.map((s) => `
                <tr><td>${fmtDateTime(s.starts_at)}</td><td>${esc(courseTitle(s.course_id))}</td>
                  <td>${esc(facilityName(s.facility_id))}</td>
                  <td>${s.attendance[0]?.count ?? 0}${s.capacity ? " / " + s.capacity : ""}</td></tr>`).join("")
                || `<tr><td colspan="4" class="empty">No sessions scheduled. <a href="#sessions">Schedule one</a></td></tr>`}
              </tbody></table></div>
          </div>
        </div>`;
      $$("[data-emp]", view).forEach((b) => b.onclick = () => showEmployee(Number(b.dataset.emp)));
    }
  };

  // -------------------------------------------------------- employees
  views.employees = {
    title: "Employees",
    filters: { q: "", facility: "", status: "active" },
    actions() {
      return `<button class="secondary" data-act="import">Import CSV</button>
              <button class="secondary" data-act="export">Download Excel</button>
              <button data-act="add">+ Add employee</button>`;
    },
    async render(view) {
      const all = await loadEmployees();
      const { map } = await complianceMatrix(all);
      const logins = await loadEmployeeLogins();
      const photo = await photoUrls(all.map((e) => e.photo_path));
      const mandatory = state.courses.filter((c) => c.mandatory && c.active);
      const f = this.filters;

      const gaps = (e) => mandatory.filter((c) => {
        const s = map.get(`${e.id}:${c.id}`);
        return !s || expiryStatus(s.expires_on) === "expired";
      }).length;

      view.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <input type="search" placeholder="Search name, title, department…" value="${esc(f.q)}" data-f="q">
            ${isAdmin() ? `<select data-f="facility">${facilityOptions(f.facility, { includeAll: true })}</select>` : ""}
            <select data-f="status">
              <option value="active" ${f.status === "active" ? "selected" : ""}>Active</option>
              <option value="inactive" ${f.status === "inactive" ? "selected" : ""}>Inactive</option>
              <option value="" ${f.status === "" ? "selected" : ""}>All statuses</option>
            </select>
            <span class="spacer"></span><span class="muted" data-count></span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Job title</th><th>Department</th><th>Facility</th><th>Status</th><th>Mandatory training</th>${isAdmin() ? "<th>App login</th>" : ""}<th></th></tr></thead>
            <tbody data-rows></tbody></table></div>
        </div>`;

      const draw = () => {
        const q = f.q.toLowerCase();
        const rows = all.filter((e) =>
          (!f.facility || String(e.facility_id) === f.facility) &&
          (!f.status || e.status === f.status) &&
          (!q || [e.employee_no, e.first_name, e.last_name, e.job_title, e.department, e.email]
            .some((v) => String(v || "").toLowerCase().includes(q))));
        $("[data-count]", view).textContent = `${rows.length} of ${all.length}`;
        $("[data-rows]", view).innerHTML = rows.map((e) => {
          const g = e.status === "active" ? gaps(e) : null;
          return `<tr>
            <td><button class="link person" data-view="${e.id}">${avatar(e, photo(e.photo_path))}<span>${esc(fullName(e))}</span></button></td>
            <td>${esc(e.job_title || "—")}</td><td>${esc(e.department || "—")}</td>
            <td>${esc(facilityName(e.facility_id))}</td><td>${badge(e.status)}</td>
            <td>${g === null ? "—" : g === 0 ? badge("valid", "Up to date") : badge("expired", g + " outstanding")}</td>
            ${isAdmin() ? `<td>${logins.has(e.id) ? badge("active", "Has login") : `<button class="link small" data-login="${e.id}">Give login</button>`}</td>` : ""}
            <td class="actions"><button class="link small" data-edit="${e.id}">Edit</button> ${delBtn(e.id)}</td></tr>`;
        }).join("") || `<tr><td colspan="${isAdmin() ? 8 : 7}" class="empty">No employees match. Add one or import a CSV.</td></tr>`;
        $$("[data-login]", view).forEach((b) => b.onclick = () => giveLogin(all.find((e) => e.id === Number(b.dataset.login))));
        $$("[data-view]", view).forEach((b) => b.onclick = () => showEmployee(Number(b.dataset.view)));
        $$("[data-edit]", view).forEach((b) => b.onclick = () => editEmployee(all.find((e) => e.id === Number(b.dataset.edit))));
        $$("[data-del]", view).forEach((b) => b.onclick = async () => {
          const e = all.find((x) => x.id === Number(b.dataset.del));
          if (!(await confirmBox(`Delete ${fullName(e)}? Their training records and attendance will also be deleted. ` +
            `(To keep their history, Edit them and set Status to Inactive instead.)`))) return;
          try {
            if (e.photo_path) await sb.storage.from(PHOTO_BUCKET).remove([e.photo_path]);
            check(await sb.from("employees").delete().eq("id", e.id)); toast("Employee deleted"); route();
          }
          catch (ex) { toast(ex.message, true); }
        });
      };
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; draw(); }));
      draw();

      this.onAction = (act) => {
        if (act === "add") editEmployee(null);
        if (act === "import") importEmployees();
        if (act === "export") downloadXLSX(`TrainWell-employees-${todayISO()}.xlsx`, "Employees", [
          ["First name", "Last name", "Email", "Phone", "Job title", "Department", "Facility", "Hire date", "Status"],
          ...all.map((e) => [e.first_name, e.last_name, e.email || "", e.phone || "", e.job_title || "", e.department || "",
            facilityName(e.facility_id), toDate(e.hire_date), e.status])
        ]).catch((ex) => toast(ex.message, true));
      };
    }
  };

  function editEmployee(e) {
    const isNew = !e; e = e || { status: "active", facility_id: state.me.facility_id };
    openModal({
      title: isNew ? "Add employee" : "Edit employee",
      body: `
        <div class="grid2">
          <div class="field"><label>First name *</label><input name="first_name" required value="${esc(e.first_name)}"></div>
          <div class="field"><label>Last name *</label><input name="last_name" required value="${esc(e.last_name)}"></div>
          <div class="field"><label>Facility *</label>
            <select name="facility_id" required ${isAdmin() ? "" : "disabled"}>${facilityOptions(e.facility_id)}</select></div>
          <div class="field"><label>Job title</label><input name="job_title" value="${esc(e.job_title)}"></div>
          <div class="field"><label>Department</label><input name="department" value="${esc(e.department)}"></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${esc(e.email)}"></div>
          <div class="field"><label>Phone</label><input name="phone" value="${esc(e.phone)}"></div>
          <div class="field"><label>Hire date</label><input name="hire_date" type="date" value="${esc(e.hire_date)}"></div>
          <div class="field"><label>Status</label><select name="status">
            <option value="active" ${e.status === "active" ? "selected" : ""}>Active</option>
            <option value="inactive" ${e.status === "inactive" ? "selected" : ""}>Inactive</option></select></div>
        </div>
        <div class="field"><label>${e.photo_path ? "Replace photo" : "Photo"} <span class="muted">optional · JPG, PNG or HEIC</span></label>
          <input type="file" name="photo" accept="image/*"></div>`,
      async onSubmit(d) {
        const row = {
          first_name: d.first_name.trim(), last_name: d.last_name.trim(),
          facility_id: Number(isAdmin() ? d.facility_id : (e.facility_id || state.me.facility_id)),
          job_title: nn(d.job_title), department: nn(d.department), email: nn(d.email), phone: nn(d.phone),
          hire_date: nn(d.hire_date), status: d.status
        };
        const frm = $("#modalRoot form");
        let saved = e;
        if (isNew) saved = check(await sb.from("employees").insert(row).select().single());
        else check(await sb.from("employees").update(row).eq("id", e.id));
        const pic = $("input[name=photo]", frm).files[0];
        if (pic) {
          try { await setEmployeePhoto(saved, pic); }
          catch (ex) { toast(`${isNew ? "Employee added" : "Details saved"}, but the photo wasn't: ${ex.message}`, true); route(); return; }
        }
        toast(isNew ? "Employee added" : "Employee saved"); route();
      }
    });
  }

  function importEmployees() {
    const { form } = openModal({
      title: "Import employees from CSV", submitText: "Import",
      body: `
        <p class="muted" style="margin-top:0">Columns (first row = headers): <code>first_name, last_name, email, phone,
        job_title, department, facility, hire_date</code>. Only first and last name are required. <code>facility</code> must match a
        facility name${isAdmin() ? "" : " (or leave blank for yours)"}. Dates as YYYY-MM-DD.</p>
        <p><button type="button" class="link" data-template>Download a blank template</button></p>
        <div class="field"><label>CSV file</label><input type="file" name="file" accept=".csv,text/csv" required></div>
        <div data-preview class="muted"></div>`,
      async onSubmit(_d, frm) {
        const file = $("input[type=file]", frm).files[0];
        const rows = parseCSV(await file.text());
        if (rows.length < 2) throw new Error("The file has no data rows.");
        const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
        const idx = (k) => head.indexOf(k);
        if (idx("first_name") < 0 || idx("last_name") < 0) throw new Error("Missing first_name / last_name columns.");
        const facByName = new Map(state.facilities.map((f) => [f.name.toLowerCase(), f.id]));
        const problems = []; const withNo = []; const withoutNo = [];
        rows.slice(1).forEach((r, i) => {
          const get = (k) => idx(k) >= 0 ? nn(r[idx(k)]) : null;
          const facName = get("facility");
          let facility_id = facName ? facByName.get(facName.toLowerCase()) : (isAdmin() ? null : state.me.facility_id);
          if (!isAdmin() && facility_id && facility_id !== state.me.facility_id) facility_id = undefined;
          if (!get("first_name") || !get("last_name")) { problems.push(`Row ${i + 2}: missing name`); return; }
          if (!facility_id) { problems.push(`Row ${i + 2}: unknown facility "${facName || ""}"`); return; }
          const hd = get("hire_date");
          if (hd && !/^\d{4}-\d{2}-\d{2}$/.test(hd)) { problems.push(`Row ${i + 2}: hire_date must be YYYY-MM-DD`); return; }
          const row = { first_name: get("first_name"), last_name: get("last_name"), employee_no: get("employee_no"),
            email: get("email"), phone: get("phone"), job_title: get("job_title"), department: get("department"),
            facility_id, hire_date: hd, status: get("status") === "inactive" ? "inactive" : "active" };
          (row.employee_no ? withNo : withoutNo).push(row);
        });
        if (problems.length) throw new Error("Nothing imported. Fix these rows and try again:\n" + problems.slice(0, 10).join("\n") +
          (problems.length > 10 ? `\n…and ${problems.length - 10} more` : ""));
        if (withNo.length) check(await sb.from("employees").upsert(withNo, { onConflict: "employee_no" }));
        if (withoutNo.length) check(await sb.from("employees").insert(withoutNo));
        toast(`Imported ${withNo.length + withoutNo.length} employees`); route();
      }
    });
    $("[data-err]", form).style.whiteSpace = "pre-line";
    $("[data-template]", form).onclick = () => downloadCSV("trainwell-employee-template.csv", [
      ["first_name", "last_name", "email", "phone", "job_title", "department", "facility", "hire_date"],
      ["Jane", "Doe", "jane@example.com", "709-555-0100", "Operator", "Production", state.facilities[0]?.name || "Facility 1", "2024-03-15"]
    ]);
  }

  async function showEmployee(id) {
    const e = check(await sb.from("employees").select("*").eq("id", id).single());
    const comps = check(await sb.from("completions").select("*").eq("employee_id", id)
      .order("completed_on", { ascending: false, nullsFirst: false }).order("expires_on", { ascending: false, nullsFirst: false }));
    const latest = new Map();
    for (const c of comps) if (!latest.has(c.course_id)) latest.set(c.course_id, c);
    const mandatory = state.courses.filter((c) => c.mandatory && c.active);
    const login = (await loadEmployeeLogins()).get(e.id);
    const photoUrl = (await photoUrls([e.photo_path]))(e.photo_path);
    // Sessions and fire drills are extras: show the rest of the profile even if these can't load
    const att = (await sb.from("attendance").select("status, sessions(starts_at, course_id, location, trainer)").eq("employee_id", id)).data || [];
    att.sort((x, y) => String(y.sessions?.starts_at).localeCompare(String(x.sessions?.starts_at)));
    const drills = ((await sb.from("fire_drill_participants").select("drill_id, fire_drills(drill_date, event_type, start_time, facility_id, coordinator)").eq("employee_id", id)).data || [])
      .filter((d) => d.fire_drills).sort((x, y) => y.fire_drills.drill_date.localeCompare(x.fire_drills.drill_date));

    const mStatus = mandatory.map((c) => { const l = latest.get(c.id); return l ? expiryStatus(l.expires_on) : "missing"; });
    const count = (s) => mStatus.filter((x) => x === s).length;
    const detail = (label, value) => `<div><dt>${label}</dt><dd>${value || '<span class="muted">—</span>'}</dd></div>`;

    const { form } = openModal({
      title: "Employee profile", wide: true,
      body: `
        <section class="profile">
          <div class="profile-photo">
            ${photoUrl
              ? `<button type="button" class="photo-frame" data-fullphoto title="Open full size"><img src="${esc(photoUrl)}" alt="Photo of ${esc(fullName(e))}"></button>`
              : `<div class="photo-frame photo-frame--empty"><span>${esc(initials(e))}</span><small>No photo yet</small></div>`}
            <div class="photo-actions">
              <button type="button" class="secondary small" data-photo>${photoUrl ? "Change photo" : "Add photo"}</button>
              ${photoUrl ? `<button type="button" class="link small" data-rmphoto style="color:var(--bad)">Remove</button>` : ""}
            </div>
          </div>
          <div class="profile-main">
            <h2 class="profile-name">${esc(fullName(e))}</h2>
            <p class="profile-role">${esc([e.job_title, e.department].filter(Boolean).join(", ") || "No job title set")}</p>
            <p class="profile-tags">${badge(e.status, e.status === "active" ? "Active" : "Inactive")} ${badge("neutral", facilityName(e.facility_id))}</p>
            <dl class="profile-details">
              ${detail("Email", e.email ? `<a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : "")}
              ${detail("Phone", e.phone ? `<a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>` : "")}
              ${detail("Hire date", e.hire_date ? fmtDate(e.hire_date) : "")}
              ${isAdmin() ? detail("App login", login ? esc(login.email) : "None") : ""}
            </dl>
            <div class="profile-summary">
              <div class="ok"><strong>${count("valid")}</strong><span>Up to date</span></div>
              <div class="warn"><strong>${count("expiring")}</strong><span>Due in ${WARN_DAYS} days</span></div>
              <div class="bad"><strong>${count("expired")}</strong><span>Expired</span></div>
              <div class="bad"><strong>${count("missing")}</strong><span>Never done</span></div>
            </div>
          </div>
        </section>
        ${isAdmin() ? `<div class="alert info" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
          <span>${login ? `App login: <strong>${esc(login.email)}</strong>` : "No app login yet. Give them one so they can see their training and upload certificates."}</span>
          ${login ? `<button type="button" class="secondary small" data-rmlogin>Remove login</button>` : `<button type="button" class="small" data-givelogin>Give login</button>`}</div>` : ""}
        <h3>Mandatory training</h3>
        <div class="table-wrap"><table><thead><tr><th>Course</th><th>Status</th><th>Completed</th><th>Expires</th></tr></thead><tbody>
          ${mandatory.map((c, i) => { const l = latest.get(c.id);
            return `<tr><td>${esc(c.title)}</td><td>${badge(mStatus[i])}</td><td>${fmtDate(l?.completed_on)}</td><td>${fmtDate(l?.expires_on)}</td></tr>`; }).join("")
            || `<tr><td colspan="4" class="empty">No mandatory courses set up.</td></tr>`}
        </tbody></table></div>
        <h3 style="margin-top:1.2rem">Full training history</h3>
        <div class="table-wrap"><table><thead><tr><th>Course</th><th>Completed</th><th>Expires</th><th>Score</th><th>Certificate #</th><th>File</th></tr></thead><tbody>
          ${comps.map((c) => `<tr><td>${esc(courseTitle(c.course_id))}${c.uploaded_by_employee ? ' <span class="muted" style="font-size:.8rem">(uploaded by employee)</span>' : ""}</td><td>${fmtDate(c.completed_on)}</td>
            <td>${fmtDate(c.expires_on)} ${c.expires_on ? badge(expiryStatus(c.expires_on)) : ""}</td>
            <td>${c.score ?? "—"}</td><td>${esc(c.certificate_no || "—")}</td><td>${certLink(c)}</td></tr>`).join("")
            || `<tr><td colspan="6" class="empty">No training recorded yet.</td></tr>`}
        </tbody></table></div>
        <h3 style="margin-top:1.2rem">Sessions</h3>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Course</th><th>Location</th><th>Trainer</th><th>Attendance</th></tr></thead><tbody>
          ${att.filter((a) => a.sessions).map((a) => `<tr><td>${fmtDateTime(a.sessions.starts_at)}</td><td>${esc(courseTitle(a.sessions.course_id))}</td>
            <td>${esc(a.sessions.location || "—")}</td><td>${esc(a.sessions.trainer || "—")}</td>
            <td>${badge(a.status, a.status[0].toUpperCase() + a.status.slice(1))}</td></tr>`).join("")
            || `<tr><td colspan="5" class="empty">Not booked into any sessions.</td></tr>`}
        </tbody></table></div>
        <h3 style="margin-top:1.2rem">Fire drills</h3>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Home</th><th>Coordinator</th><th></th></tr></thead><tbody>
          ${drills.map((d) => `<tr><td>${fmtDate(d.fire_drills.drill_date)}</td>
            <td>${d.fire_drills.event_type === "alarm" ? badge("expiring", "Fire alarm") : badge("neutral", "Fire drill")}</td>
            <td>${esc(facilityName(d.fire_drills.facility_id))}</td><td>${esc(d.fire_drills.coordinator || "—")}</td>
            <td class="actions"><button type="button" class="link small" data-drill="${d.drill_id}">View report</button></td></tr>`).join("")
            || `<tr><td colspan="5" class="empty">Not listed on any fire drill yet.</td></tr>`}
        </tbody></table></div>`,
      footer: `<div class="modal-foot">
        <button type="button" class="secondary" data-edit>Edit details</button>
        <button type="button" class="secondary" data-upload>Upload certificate</button>
        <button type="button" data-addrec>+ Add training record</button></div>`
    });
    $("[data-edit]", form).onclick = () => editEmployee(e);
    $("[data-addrec]", form).onclick = () => editRecord(null, { employeeIds: [e.id] });
    $("[data-upload]", form).onclick = () => uploadCertificate({ employeeId: e.id, title: `Upload certificate for ${fullName(e)}` });
    $("[data-givelogin]", form)?.addEventListener("click", () => giveLogin(e));
    $("[data-rmlogin]", form)?.addEventListener("click", () => removeLogin(e));
    $("[data-photo]", form).onclick = () => uploadPhoto(e);
    $("[data-fullphoto]", form)?.addEventListener("click", () => openPhoto(e.photo_path));
    $("[data-rmphoto]", form)?.addEventListener("click", async () => {
      if (!(await confirmBox(`Remove ${fullName(e)}'s photo?`, { okText: "Remove photo" }))) { showEmployee(e.id); return; }
      try { await removeEmployeePhoto(e); toast("Photo removed"); }
      catch (ex) { toast(ex.message, true); }
      showEmployee(e.id); if (currentView === views.employees) route();
    });
    $$("[data-drill]", form).forEach((b) => b.onclick = () => showDrill(Number(b.dataset.drill)));
    wireCerts(form);
  }

  // =============================================================== EMPLOYEE PHOTOS
  // Private "employee-photos" bucket, files stored as  <employee id>/<time>.jpg
  const PHOTO_BUCKET = "employee-photos";
  const photoCache = new Map(); // path -> { url, at }
  async function photoUrls(paths) {
    const fresh = (p) => photoCache.has(p) && Date.now() - photoCache.get(p).at < 50 * 60 * 1000;
    const need = [...new Set(paths.filter((p) => p && !fresh(p)))];
    for (let i = 0; i < need.length; i += 100) {
      const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
      (data || []).forEach((d) => { if (d.signedUrl) photoCache.set(d.path, { url: d.signedUrl, at: Date.now() }); });
    }
    return (p) => (p && photoCache.get(p)?.url) || "";
  }
  const initials = (e) => `${(e.first_name || "")[0] || ""}${(e.last_name || "")[0] || ""}`.toUpperCase();
  const avatar = (e, url) => url
    ? `<img class="avatar" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="avatar avatar--empty" aria-hidden="true">${esc(initials(e))}</span>`;

  // Phone photos are often 5–15 MB; shrink to at most 1200 px on the long side before upload
  async function shrinkPhoto(file) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error("Choose a photo (JPG, PNG or HEIC).");
    let img;
    try { img = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (_) { throw new Error("This photo can't be opened in this browser. Save it as a JPG or PNG and try again."); }
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("Could not read that photo.")), "image/jpeg", 0.86));
  }
  async function setEmployeePhoto(e, file) {
    const blob = await shrinkPhoto(file);
    const path = `${e.id}/${Date.now()}.jpg`;
    const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(/bucket/i.test(error.message)
      ? "Photo uploads aren't set up yet. An administrator needs to run the employee-photos update in Supabase (see README)." : error.message);
    const { error: e2 } = await sb.from("employees").update({ photo_path: path }).eq("id", e.id);
    if (e2) { await sb.storage.from(PHOTO_BUCKET).remove([path]); throw new Error(e2.message); }
    if (e.photo_path) await sb.storage.from(PHOTO_BUCKET).remove([e.photo_path]);
    e.photo_path = path;
  }
  async function removeEmployeePhoto(e) {
    check(await sb.from("employees").update({ photo_path: null }).eq("id", e.id));
    if (e.photo_path) await sb.storage.from(PHOTO_BUCKET).remove([e.photo_path]);
    e.photo_path = null;
  }
  async function openPhoto(path) {
    const url = (await photoUrls([path]))(path);
    if (url) window.open(url, "_blank", "noopener");
  }
  function uploadPhoto(e) {
    const { form } = openModal({
      title: `${e.photo_path ? "Change" : "Add"} photo · ${fullName(e)}`, submitText: "Save photo",
      body: `
        <div class="photo-pick">
          <div class="photo-frame photo-frame--empty" data-prev><span>${esc(initials(e))}</span><small>Preview</small></div>
          <div>
            <div class="field"><label>Photo *</label><input type="file" name="file" accept="image/*" required></div>
            <p class="muted" style="font-size:.85rem;margin:0">JPG, PNG or HEIC. On a phone you can take one now. The whole photo is kept; large photos are made smaller automatically.</p>
          </div>
        </div>`,
      async onSubmit(_d, frm) {
        const file = $("input[type=file]", frm).files[0];
        if (!file) throw new Error("Choose a photo.");
        await setEmployeePhoto(e, file);
        toast("Photo saved");
        if (currentView === views.employees) route();
        setTimeout(() => showEmployee(e.id), 0);
      }
    });
    const inp = $("input[type=file]", form);
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const prev = $("[data-prev]", form);
      prev.className = "photo-frame";
      prev.innerHTML = `<img alt="Preview" src="${URL.createObjectURL(f)}">`;
      $("img", prev).onerror = () => { prev.className = "photo-frame photo-frame--empty"; prev.innerHTML = "<span>?</span><small>No preview, but it may still upload</small>"; };
    };
  }

  // -------------------------------------------------------- records
  views.records = {
    title: "Training records",
    filters: { q: "", course: "", status: "", facility: "" },
    actions() {
      return `<button class="secondary" data-act="excel">Download Excel</button>
              <button data-act="add">+ Record training</button>`;
    },
    async render(view) {
      const recs = await fetchAll(() => sb.from("completions")
        .select("*, employees!inner(id, first_name, last_name, employee_no, facility_id, status)")
        .order("completed_on", { ascending: false, nullsFirst: false }));
      const f = this.filters;
      view.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <input type="search" placeholder="Search employee…" value="${esc(f.q)}" data-f="q">
            <select data-f="course">${courseOptions(f.course, { includeAll: true, activeOnly: false })}</select>
            <select data-f="status">
              <option value="">Any status</option>
              ${["valid", "expiring", "expired"].map((s) => `<option value="${s}" ${f.status === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}
            </select>
            ${isAdmin() ? `<select data-f="facility">${facilityOptions(f.facility, { includeAll: true })}</select>` : ""}
            <span class="spacer"></span><span class="muted" data-count></span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Employee</th><th>Facility</th><th>Course</th><th>Completed</th><th>Expires</th><th>Status</th><th>File</th><th></th></tr></thead>
            <tbody data-rows></tbody></table></div>
        </div>`;
      let shown = [];
      const draw = () => {
        const q = f.q.toLowerCase();
        shown = recs.filter((r) =>
          (!f.course || String(r.course_id) === f.course) &&
          (!f.facility || String(r.employees.facility_id) === f.facility) &&
          (!f.status || expiryStatus(r.expires_on) === f.status) &&
          (!q || `${r.employees.first_name} ${r.employees.last_name} ${r.employees.employee_no || ""}`.toLowerCase().includes(q)));
        $("[data-count]", view).textContent = `${shown.length} records`;
        $("[data-rows]", view).innerHTML = shown.slice(0, 500).map((r) => `<tr>
          <td><button class="link" data-emp="${r.employee_id}">${esc(fullName(r.employees))}</button></td>
          <td>${esc(facilityName(r.employees.facility_id))}</td><td>${esc(courseTitle(r.course_id))}</td>
          <td>${fmtDate(r.completed_on)}</td><td>${fmtDate(r.expires_on)}</td>
          <td>${badge(expiryStatus(r.expires_on))}</td><td>${certLink(r)}</td>
          <td class="actions"><button class="link small" data-edit="${r.id}">Edit</button>
            <button class="link small" data-del="${r.id}" style="color:var(--bad)">Delete</button></td></tr>`).join("")
          + (shown.length > 500 ? `<tr><td colspan="8" class="empty">Showing first 500. Narrow the filters or export to see all.</td></tr>` : "")
          || `<tr><td colspan="8" class="empty">No training records yet.</td></tr>`;
        $$("[data-emp]", view).forEach((b) => b.onclick = () => showEmployee(Number(b.dataset.emp)));
        $$("[data-edit]", view).forEach((b) => b.onclick = () => editRecord(recs.find((r) => r.id === Number(b.dataset.edit))));
        wireCerts(view);
        $$("[data-del]", view).forEach((b) => b.onclick = async () => {
          const rec = recs.find((r) => r.id === Number(b.dataset.del));
          if (!(await confirmBox("Delete this training record" + (rec.certificate_path ? " and its certificate file" : "") + "? This cannot be undone."))) return;
          try { check(await sb.from("completions").delete().eq("id", rec.id)); await removeCertificate(rec.certificate_path); toast("Record deleted"); route(); }
          catch (ex) { toast(ex.message, true); }
        });
      };
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; draw(); }));
      draw();
      this.onAction = (act) => {
        if (act === "add") editRecord(null);
        if (act === "excel") downloadTrainingExcel(f.facility, shown).catch((ex) => toast(ex.message, true));
      };
    }
  };

  // Employee checklist picker (used for records and attendance)
  function employeePicker(employees, selectedIds = [], { facilityFilter = true, label = "Employees *" } = {}) {
    const sel = new Set(selectedIds);
    return `
      <div class="field"><label>${esc(label)} <span data-selcount class="muted"></span></label>
        <div class="toolbar" style="margin-bottom:.4rem">
          <input type="search" placeholder="Filter…" data-pick-filter style="flex:1">
          ${isAdmin() && facilityFilter ? `<select data-pick-fac>${facilityOptions("", { includeAll: true })}</select>` : ""}
          <button type="button" class="secondary small" data-pick-all>Select shown</button>
          <button type="button" class="secondary small" data-pick-none>Clear</button>
        </div>
        <div data-pick-list style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:.3rem .6rem">
          ${employees.map((e) => `<label style="display:flex;gap:.5rem;align-items:center;font-weight:400;color:var(--text);margin:.3rem 0"
              data-name="${esc((fullName(e) + " " + (e.employee_no || "")).toLowerCase())}" data-fac="${e.facility_id}">
            <input type="checkbox" name="emp" value="${e.id}" ${sel.has(e.id) ? "checked" : ""}>
            ${esc(fullName(e))} <span class="muted">· ${esc(facilityName(e.facility_id))}</span></label>`).join("")
            || `<p class="muted">No employees available.</p>`}
        </div></div>`;
  }
  function wirePicker(form) {
    const list = $("[data-pick-list]", form); if (!list) return;
    const count = () => { $("[data-selcount]", form).textContent = `(${$$("input[name=emp]:checked", list).length} selected)`; };
    const apply = () => {
      const q = ($("[data-pick-filter]", form).value || "").toLowerCase();
      const fac = $("[data-pick-fac]", form)?.value || "";
      $$("label", list).forEach((l) => l.classList.toggle("hidden",
        !(l.dataset.name.includes(q) && (!fac || l.dataset.fac === fac))));
    };
    $("[data-pick-filter]", form).addEventListener("input", apply);
    $("[data-pick-fac]", form)?.addEventListener("input", apply);
    $("[data-pick-all]", form).onclick = () => { $$("label:not(.hidden) input", list).forEach((c) => c.checked = true); count(); };
    $("[data-pick-none]", form).onclick = () => { $$("input", list).forEach((c) => c.checked = false); count(); };
    list.addEventListener("change", count); count();
  }
  const pickedIds = (form) => $$("input[name=emp]:checked", form).map((c) => Number(c.value));

  async function editRecord(r, { employeeIds = [] } = {}) {
    const isNew = !r;
    const employees = isNew ? await loadEmployees({ activeOnly: true }) : [];
    const { form } = openModal({
      title: isNew ? "Record training" : `Edit record — ${fullName(r.employees)}`, wide: isNew,
      body: `
        ${isNew ? employeePicker(employees, employeeIds) : ""}
        <div class="grid2">
          <div class="field"><label>Course *</label><select name="course_id" required>${courseOptions(r?.course_id)}</select></div>
          <div class="field"><label>Date completed ${isNew ? "*" : ""}</label><input type="date" name="completed_on" ${isNew ? "required" : ""} value="${esc(isNew ? todayISO() : (r.completed_on || ""))}"></div>
          <div class="field"><label>Expiry date <span class="muted">(blank = from course)</span></label><input type="date" name="expires_on" value="${esc(r?.expires_on)}"></div>
          <div class="field"><label>Score</label><input type="number" step="0.01" name="score" value="${esc(r?.score)}"></div>
          <div class="field"><label>Certificate #</label><input name="certificate_no" value="${esc(r?.certificate_no)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea name="notes" rows="2">${esc(r?.notes)}</textarea></div>
        <div class="field"><label>${r?.certificate_path ? "Replace certificate file" : "Certificate file"} <span class="muted">(optional, PDF or photo${isNew ? ", one employee at a time" : ""})</span></label>
          <input type="file" name="file" accept="application/pdf,image/*,.heic,.heif"></div>`,
      async onSubmit(d, frm) {
        const base = { course_id: Number(d.course_id), completed_on: nn(d.completed_on), expires_on: nn(d.expires_on),
          score: nn(d.score), certificate_no: nn(d.certificate_no), notes: nn(d.notes) };
        const file = $("input[type=file]", frm).files[0];
        if (isNew) {
          const ids = pickedIds(frm);
          if (!ids.length) throw new Error("Select at least one employee.");
          if (file && ids.length !== 1) throw new Error("A certificate file can only be attached when recording for one employee. Untick the others, or leave the file empty.");
          if (file) base.certificate_path = await putCertificate(ids[0], file);
          check(await sb.from("completions").insert(ids.map((id) => ({ ...base, employee_id: id, recorded_by: state.me.id }))));
          toast(`Recorded for ${ids.length} employee${ids.length > 1 ? "s" : ""}`);
        } else {
          // Clearing the expiry box lets the database recalculate it from the course
          if (file) base.certificate_path = await putCertificate(r.employee_id, file);
          check(await sb.from("completions").update(base).eq("id", r.id));
          if (file && r.certificate_path) await removeCertificate(r.certificate_path);
          toast("Record saved");
        }
        route();
      }
    });
    wirePicker(form);
  }

  // -------------------------------------------------------- sessions
  views.sessions = {
    title: "Sessions & attendance",
    filters: { when: "upcoming", facility: "" },
    actions() { return `<button data-act="add">+ Schedule session</button>`; },
    async render(view) {
      const f = this.filters; const now = new Date().toISOString();
      let q = sb.from("sessions").select("*, attendance(status)");
      q = f.when === "upcoming" ? q.gte("starts_at", now).order("starts_at") : q.lt("starts_at", now).order("starts_at", { ascending: false });
      if (f.facility) q = q.eq("facility_id", Number(f.facility));
      const sessions = check(await q.limit(300));
      view.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <select data-f="when">
              <option value="upcoming" ${f.when === "upcoming" ? "selected" : ""}>Upcoming</option>
              <option value="past" ${f.when === "past" ? "selected" : ""}>Past</option></select>
            ${isAdmin() ? `<select data-f="facility">${facilityOptions(f.facility, { includeAll: true })}</select>` : ""}
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Course</th><th>Facility</th><th>Location</th><th>Trainer</th><th>Booked</th><th>Attended</th><th></th></tr></thead>
            <tbody>${sessions.map((s) => `<tr>
              <td>${fmtDateTime(s.starts_at)}</td><td>${esc(courseTitle(s.course_id))}</td><td>${esc(facilityName(s.facility_id))}</td>
              <td>${esc(s.location || "—")}</td><td>${esc(s.trainer || "—")}</td>
              <td>${s.attendance.length}${s.capacity ? " / " + s.capacity : ""}</td>
              <td>${s.attendance.filter((a) => a.status === "attended").length}</td>
              <td class="actions"><button class="link small" data-att="${s.id}">Attendance</button>
                <button class="link small" data-edit="${s.id}">Edit</button>
                <button class="link small" data-del="${s.id}" style="color:var(--bad)">Delete</button></td></tr>`).join("")
              || `<tr><td colspan="8" class="empty">No ${f.when} sessions.</td></tr>`}
            </tbody></table></div>
        </div>`;
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; route(); }));
      $$("[data-att]", view).forEach((b) => b.onclick = () => manageAttendance(sessions.find((s) => s.id === Number(b.dataset.att))));
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editSession(sessions.find((s) => s.id === Number(b.dataset.edit))));
      $$("[data-del]", view).forEach((b) => b.onclick = async () => {
        if (!(await confirmBox("Delete this session and its attendance list? Training records already created are kept."))) return;
        try { check(await sb.from("sessions").delete().eq("id", Number(b.dataset.del))); toast("Session deleted"); route(); }
        catch (ex) { toast(ex.message, true); }
      });
      this.onAction = (act) => { if (act === "add") editSession(null); };
    }
  };

  function editSession(s) {
    const isNew = !s; s = s || { facility_id: state.me.facility_id };
    openModal({
      title: isNew ? "Schedule session" : "Edit session",
      body: `
        <div class="grid2">
          <div class="field"><label>Course *</label><select name="course_id" required>${courseOptions(s.course_id)}</select></div>
          <div class="field"><label>Facility *</label><select name="facility_id" required ${isAdmin() ? "" : "disabled"}>${facilityOptions(s.facility_id)}</select></div>
          <div class="field"><label>Starts *</label><input type="datetime-local" name="starts_at" required value="${toLocalInput(s.starts_at)}"></div>
          <div class="field"><label>Ends</label><input type="datetime-local" name="ends_at" value="${toLocalInput(s.ends_at)}"></div>
          <div class="field"><label>Location / room</label><input name="location" value="${esc(s.location)}"></div>
          <div class="field"><label>Trainer</label><input name="trainer" value="${esc(s.trainer)}"></div>
          <div class="field"><label>Capacity</label><input type="number" min="1" name="capacity" value="${esc(s.capacity)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea name="notes" rows="2">${esc(s.notes)}</textarea></div>`,
      async onSubmit(d) {
        const row = { course_id: Number(d.course_id),
          facility_id: Number(isAdmin() ? d.facility_id : (s.facility_id || state.me.facility_id)),
          starts_at: new Date(d.starts_at).toISOString(), ends_at: d.ends_at ? new Date(d.ends_at).toISOString() : null,
          location: nn(d.location), trainer: nn(d.trainer), capacity: nn(d.capacity), notes: nn(d.notes) };
        if (row.ends_at && row.ends_at < row.starts_at) throw new Error("End time is before the start time.");
        if (isNew) check(await sb.from("sessions").insert({ ...row, created_by: state.me.id }));
        else check(await sb.from("sessions").update(row).eq("id", s.id));
        toast(isNew ? "Session scheduled" : "Session saved"); route();
      }
    });
  }

  async function manageAttendance(s) {
    const att = check(await sb.from("attendance").select("*, employees(id, first_name, last_name, employee_no)").eq("session_id", s.id));
    const employees = (await loadEmployees({ activeOnly: true })).filter((e) => e.facility_id === s.facility_id);
    const booked = new Set(att.map((a) => a.employee_id));
    const available = employees.filter((e) => !booked.has(e.id));
    att.sort((a, b) => fullName(a.employees).localeCompare(fullName(b.employees)));

    const { form } = openModal({
      title: `${courseTitle(s.course_id)} — ${fmtDateTime(s.starts_at)}`, wide: true, submitText: "Save attendance",
      body: `
        <p class="muted" style="margin-top:0">${esc(facilityName(s.facility_id))}${s.location ? " · " + esc(s.location) : ""}
          · ${att.length}${s.capacity ? " / " + s.capacity : ""} booked. Marking someone <strong>Attended</strong> adds a training record automatically.</p>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Status</th><th></th></tr></thead><tbody>
          ${att.map((a) => `<tr><td>${esc(fullName(a.employees))}</td>
            <td><select name="att_${a.id}" style="width:auto">
              ${["registered", "attended", "absent", "excused"].map((st) => `<option value="${st}" ${a.status === st ? "selected" : ""}>${st[0].toUpperCase() + st.slice(1)}</option>`).join("")}
            </select></td>
            <td class="actions"><button type="button" class="link small" data-rm="${a.id}" style="color:var(--bad)">Remove</button></td></tr>`).join("")
            || `<tr><td colspan="3" class="empty">Nobody booked yet — add employees below.</td></tr>`}
        </tbody></table></div>
        ${att.length ? `<p style="display:flex;gap:.5rem"><button type="button" class="secondary small" data-allattended>Mark everyone attended</button>
          <button type="button" class="secondary small" data-rmall style="color:var(--bad)">Remove everyone</button></p>` : ""}
        <h3 style="margin-top:1.2rem">Add employees</h3>
        ${employeePicker(available, [], { facilityFilter: false })}`,
      async onSubmit(d, frm) {
        const changes = att.filter((a) => d["att_" + a.id] && d["att_" + a.id] !== a.status);
        for (const a of changes) check(await sb.from("attendance").update({ status: d["att_" + a.id] }).eq("id", a.id));
        const ids = pickedIds(frm);
        if (s.capacity && att.length + ids.length > s.capacity &&
            !window.confirm(`This will put the session over its capacity of ${s.capacity}. Continue?`))
          return false;
        if (ids.length) check(await sb.from("attendance").insert(ids.map((id) => ({ session_id: s.id, employee_id: id }))));
        toast("Attendance saved"); route();
      }
    });
    wirePicker(form);
    $("[data-allattended]", form)?.addEventListener("click", () => $$("select[name^=att_]", form).forEach((sel) => sel.value = "attended"));
    $("[data-rmall]", form)?.addEventListener("click", async () => {
      if (!window.confirm(`Remove all ${att.length} people from this session's attendance list? Training records already created are kept.`)) return;
      try { check(await sb.from("attendance").delete().eq("session_id", s.id)); toast("Attendance list cleared"); route(); manageAttendance(s); }
      catch (ex) { toast(ex.message, true); }
    });
    $$("[data-rm]", form).forEach((b) => b.onclick = async () => {
      try { check(await sb.from("attendance").delete().eq("id", Number(b.dataset.rm))); toast("Removed"); manageAttendance(s); }
      catch (ex) { toast(ex.message, true); }
    });
  }

  // -------------------------------------------------------- fire drills
  // Based on the paper "Fire Drill Report" form (resident checklist page left out on purpose).
  const DRILL_QUESTIONS = [
    ["q_meeting_area", "Did all residents/people proceed to predetermined meeting area?"],
    ["q_fire_doors", "Did fire doors close as expected?"],
    ["q_windows_doors", "Were all windows and doors closed?"],
    ["q_staff_response", "Did all staff respond effectively and timely?"],
    ["q_corridors_clear", "Were all corridors free from obstruction?"],
    ["q_pull_stations", "Were all pull stations and extinguishers easily accessible?"],
    ["q_fire_dept_called", "Was the Fire Department called?"],
    ["q_extinguishing", "Was fire extinguishing necessary?"]
  ];
  // A "No" on these six is a problem to follow up; the last two are just information.
  const DRILL_PROBLEM_QS = DRILL_QUESTIONS.slice(0, 6).map((q) => q[0]);
  const DRILL_TYPE = { drill: "Fire drill (planned)", alarm: "Fire alarm (unplanned)" };
  const DRILL_ACTIVITY = {
    staff_only: "Staff only participated",
    full: "Residents and staff (full drill – residents moved to central meeting area)",
    info_session: "Residents and staff information/discussion session"
  };
  const ANSWER = { yes: "Yes", no: "No", na: "N/A" };
  const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
  function drillMinutes(d) {
    if (!d.start_time || !d.end_time) return null;
    const [a, b] = hhmm(d.start_time).split(":").map(Number);
    const [c, e] = hhmm(d.end_time).split(":").map(Number);
    let m = (c * 60 + e) - (a * 60 + b);
    if (m < 0) m += 1440; // ran past midnight
    return m;
  }
  const fmtMinutes = (m) => (m == null ? "—" : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const drillIssues = (d) => DRILL_PROBLEM_QS.filter((k) => d[k] === "no").length;
  const drillNotSetUp = (error) =>
    `<div class="card"><h2>Fire Drilling isn't set up yet</h2>
      <p>An administrator needs to run <code>supabase/update-2026-10-fire-drills.sql</code> once in the Supabase SQL Editor (see README).</p>
      <p class="muted" style="font-size:.85rem">${esc(error.message)}</p></div>`;

  async function loadDrill(id) {
    return check(await sb.from("fire_drills").select("*, fire_drill_participants(*)").eq("id", id).single());
  }

  views.drills = {
    title: "Fire Drilling",
    filters: { facility: "", year: "" },
    actions() {
      return `<button class="secondary" data-act="excel">Download Excel</button>
              <button data-act="add">+ Record fire drill</button>`;
    },
    async render(view) {
      const f = this.filters;
      let q = sb.from("fire_drills").select("*, fire_drill_participants(count)")
        .order("drill_date", { ascending: false }).order("start_time", { ascending: false, nullsFirst: false });
      if (f.facility) q = q.eq("facility_id", Number(f.facility));
      const { data, error } = await q;
      if (error) {
        view.innerHTML = drillNotSetUp(error);
        this.onAction = () => toast("Fire Drilling isn't set up yet. See the message on the page.", true);
        return;
      }
      const years = [...new Set(data.map((d) => d.drill_date.slice(0, 4)))].sort().reverse();
      const drills = data.filter((d) => !f.year || d.drill_date.startsWith(f.year));
      view.innerHTML = `
        <div class="card">
          <div class="toolbar">
            ${isAdmin() ? `<select data-f="facility">${facilityOptions(f.facility, { includeAll: true })}</select>` : ""}
            <select data-f="year"><option value="">All years</option>
              ${years.map((y) => `<option value="${y}" ${f.year === y ? "selected" : ""}>${y}</option>`).join("")}</select>
            <span class="spacer"></span><span class="muted">${drills.length} report${drills.length === 1 ? "" : "s"}</span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Home</th><th>Type</th><th>Time</th><th>Total</th><th>Participants</th><th>Outcome</th><th>Coordinator</th><th></th></tr></thead>
            <tbody>${drills.map((d) => {
              const n = drillIssues(d);
              return `<tr>
                <td><button class="link" data-view="${d.id}">${fmtDate(d.drill_date)}</button></td>
                <td>${esc(facilityName(d.facility_id))}</td>
                <td>${d.event_type === "alarm" ? badge("expiring", "Fire alarm") : badge("neutral", "Fire drill")}</td>
                <td>${hhmm(d.start_time) || "—"}${d.end_time ? "–" + hhmm(d.end_time) : ""}</td>
                <td>${fmtMinutes(drillMinutes(d))}</td>
                <td>${d.fire_drill_participants[0]?.count ?? 0}</td>
                <td>${n ? badge("expired", n + (n > 1 ? " issues" : " issue")) : badge("valid", "No issues")}</td>
                <td>${esc(d.coordinator || "—")}</td>
                <td class="actions"><button class="link small" data-print="${d.id}">Print</button>
                  <button class="link small" data-edit="${d.id}">Edit</button> ${delBtn(d.id)}</td></tr>`;
            }).join("") || `<tr><td colspan="9" class="empty">No fire drills recorded yet. Click <strong>+ Record fire drill</strong> to add one.</td></tr>`}
            </tbody></table></div>
        </div>`;
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; route(); }));
      $$("[data-view]", view).forEach((b) => b.onclick = () => showDrill(Number(b.dataset.view)));
      $$("[data-print]", view).forEach((b) => b.onclick = () => printDrill(Number(b.dataset.print)));
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editDrill(Number(b.dataset.edit)));
      $$("[data-del]", view).forEach((b) => b.onclick = async () => {
        const d = drills.find((x) => x.id === Number(b.dataset.del));
        if (!(await confirmBox(`Delete the fire drill report for ${facilityName(d.facility_id)} on ${fmtDate(d.drill_date)}? This cannot be undone.`))) return;
        try { check(await sb.from("fire_drills").delete().eq("id", d.id)); toast("Fire drill report deleted"); route(); }
        catch (ex) { toast(ex.message, true); }
      });
      this.onAction = (act) => {
        if (act === "add") editDrill(null);
        if (act === "excel") downloadDrillsExcel(drills).catch((ex) => toast(ex.message, true));
      };
    }
  };

  async function editDrill(id) {
    let d = { facility_id: state.me.facility_id || state.facilities[0]?.id, drill_date: todayISO(), event_type: "drill", fire_drill_participants: [] };
    let allEmps;
    try {
      if (id) d = await loadDrill(id);
      allEmps = await loadEmployees({ activeOnly: true });
    } catch (ex) { toast(ex.message, true); return; }
    const isNew = !id;
    const known = new Set(allEmps.map((e) => e.id));
    let picked = new Set(d.fire_drill_participants.filter((p) => p.employee_id && known.has(p.employee_id)).map((p) => p.employee_id));
    // Names typed in by hand, plus anyone no longer on the active employee list, stay as plain names
    const others = d.fire_drill_participants.filter((p) => !p.employee_id || !known.has(p.employee_id)).map((p) => p.name).join("\n");
    const radio = (name, value, label, cur) =>
      `<label class="choice"><input type="radio" name="${name}" value="${value}" ${cur === value ? "checked" : ""}> ${esc(label)}</label>`;

    const { form } = openModal({
      title: isNew ? "Record fire drill" : "Edit fire drill report", wide: true, submitText: "Save report",
      body: `
        <div class="grid2">
          <div class="field"><label>Name of home *</label>
            <select name="facility_id" required data-fac ${isAdmin() ? "" : "disabled"}>${facilityOptions(d.facility_id)}</select></div>
          <div class="field"><label>Date of drill *</label><input type="date" name="drill_date" required value="${esc(d.drill_date)}"></div>
          <div class="field"><label>Start time</label><input type="time" name="start_time" value="${hhmm(d.start_time)}" data-t></div>
          <div class="field"><label>Completion time</label><input type="time" name="end_time" value="${hhmm(d.end_time)}" data-t></div>
        </div>
        <p class="muted" style="margin:-.3rem 0 .9rem">Total time: <strong data-total>${fmtMinutes(drillMinutes(d))}</strong></p>
        <div class="field"><label>Type of event *</label>
          <div class="choices">${radio("event_type", "drill", DRILL_TYPE.drill, d.event_type)}${radio("event_type", "alarm", DRILL_TYPE.alarm, d.event_type)}</div></div>
        <div class="field" data-actfield><label>If fire drill, activities of the drill</label>
          <div class="choices stacked">${Object.entries(DRILL_ACTIVITY).map(([k, v]) => radio("activity", k, v, d.activity)).join("")}</div></div>
        <h3 style="margin-top:1rem">Outcome of fire event</h3>
        <div class="table-wrap"><table class="qtable">
          <thead><tr><th></th><th>Yes</th><th>No</th><th>N/A</th></tr></thead>
          <tbody>${DRILL_QUESTIONS.map(([k, label]) => `<tr><td>${esc(label)}</td>${["yes", "no", "na"].map((v) =>
            `<td><input type="radio" name="${k}" value="${v}" ${d[k] === v ? "checked" : ""} aria-label="${esc(label)} ${ANSWER[v]}"></td>`).join("")}</tr>`).join("")}
          </tbody></table></div>
        <div class="field" style="margin-top:1rem"><label>Problems, concerns or actions for improvement</label>
          <textarea name="problems" rows="3">${esc(d.problems)}</textarea></div>
        <div class="grid2">
          <div class="field"><label>Fire drill coordinator</label><input name="coordinator" value="${esc(d.coordinator)}"></div>
          <div class="field"><label>Name of observer</label><input name="observer_name" value="${esc(d.observer_name)}"></div>
          <div class="field"><label>Observer date</label><input type="date" name="observer_date" value="${esc(d.observer_date)}"></div>
        </div>
        <h3 style="margin-top:.6rem">Participants</h3>
        <p class="muted" style="margin-top:0">Staff who took part in the drill and the debrief.</p>
        <div data-picker></div>
        <div class="field"><label>Other participants not in the employee list (one name per line)</label>
          <textarea name="other_participants" rows="2" placeholder="e.g. agency or casual staff">${esc(others)}</textarea></div>
        <p class="muted" style="font-size:.85rem">For signatures, save the report and click <strong>Print</strong>. The printout has a sign-in sheet for participants.</p>`,
      async onSubmit(v, frm) {
        if (!v.event_type) throw new Error("Choose the type of event (fire drill or fire alarm).");
        const facility_id = Number(isAdmin() ? v.facility_id : (d.facility_id || state.me.facility_id));
        const row = {
          facility_id, drill_date: v.drill_date, start_time: nn(v.start_time), end_time: nn(v.end_time),
          event_type: v.event_type, activity: v.event_type === "drill" ? nn(v.activity) : null,
          problems: nn(v.problems), coordinator: nn(v.coordinator), observer_name: nn(v.observer_name), observer_date: nn(v.observer_date)
        };
        for (const [k] of DRILL_QUESTIONS) row[k] = v[k] || null;
        let drillId = id;
        if (isNew) drillId = check(await sb.from("fire_drills").insert({ ...row, created_by: state.me.id }).select("id").single()).id;
        else check(await sb.from("fire_drills").update(row).eq("id", id));

        const parts = pickedIds(frm).map((eid) => ({ drill_id: drillId, employee_id: eid, name: fullName(allEmps.find((e) => e.id === eid)) }));
        for (const nm of String(v.other_participants || "").split("\n").map((s) => s.trim()).filter(Boolean))
          parts.push({ drill_id: drillId, employee_id: null, name: nm });
        if (!isNew) check(await sb.from("fire_drill_participants").delete().eq("drill_id", drillId));
        if (parts.length) check(await sb.from("fire_drill_participants").insert(parts));
        toast(isNew ? "Fire drill recorded" : "Fire drill report saved"); route();
      }
    });

    // Participant list follows the chosen home
    const facSel = $("[data-fac]", form);
    const drawPicker = () => {
      $$("input[name=emp]", form).forEach((c) => { const n = Number(c.value); if (c.checked) picked.add(n); else picked.delete(n); });
      const fac = Number(facSel.value);
      $("[data-picker]", form).innerHTML = employeePicker(allEmps.filter((e) => e.facility_id === fac), [...picked],
        { facilityFilter: false, label: "Employees" });
      wirePicker(form);
    };
    facSel.addEventListener("input", drawPicker);
    drawPicker();
    // Total time and drill-only activity question
    const total = () => { $("[data-total]", form).textContent = fmtMinutes(drillMinutes({ start_time: form.start_time.value, end_time: form.end_time.value })); };
    $$("[data-t]", form).forEach((i) => i.addEventListener("input", total));
    const syncType = () => $("[data-actfield]", form).classList.toggle("hidden", (form.querySelector("input[name=event_type]:checked") || {}).value === "alarm");
    $$("input[name=event_type]", form).forEach((r) => r.addEventListener("change", syncType));
    syncType();
  }

  async function showDrill(id) {
    let d;
    try { d = await loadDrill(id); } catch (ex) { toast(ex.message, true); return; }
    const parts = [...d.fire_drill_participants].sort((a, b) => a.name.localeCompare(b.name));
    const { form } = openModal({
      title: `Fire drill — ${facilityName(d.facility_id)}`, wide: true,
      body: `
        <div class="grid2">
          <p><span class="muted">Date</span><br><strong>${fmtDate(d.drill_date)}</strong></p>
          <p><span class="muted">Time</span><br><strong>${hhmm(d.start_time) || "—"}${d.end_time ? " – " + hhmm(d.end_time) : ""}</strong> (${fmtMinutes(drillMinutes(d))})</p>
          <p><span class="muted">Type of event</span><br><strong>${esc(DRILL_TYPE[d.event_type] || "—")}</strong></p>
          <p><span class="muted">Activities</span><br><strong>${esc(DRILL_ACTIVITY[d.activity] || "—")}</strong></p>
        </div>
        <h3>Outcome of fire event</h3>
        <div class="table-wrap"><table class="qtable"><tbody>
          ${DRILL_QUESTIONS.map(([k, label]) => `<tr><td>${esc(label)}</td><td style="text-align:right">${
            d[k] ? badge(d[k] === "no" && DRILL_PROBLEM_QS.includes(k) ? "expired" : d[k] === "yes" ? "valid" : "neutral", ANSWER[d[k]]) : "—"}</td></tr>`).join("")}
        </tbody></table></div>
        <h3 style="margin-top:1rem">Problems, concerns or actions for improvement</h3>
        <p style="white-space:pre-wrap">${esc(d.problems || "None recorded.")}</p>
        <div class="grid2">
          <p><span class="muted">Fire drill coordinator</span><br><strong>${esc(d.coordinator || "—")}</strong></p>
          <p><span class="muted">Observer</span><br><strong>${esc(d.observer_name || "—")}</strong>${d.observer_date ? " · " + fmtDate(d.observer_date) : ""}</p>
        </div>
        <h3>Participants (${parts.length})</h3>
        <p>${parts.map((p) => esc(p.name)).join(", ") || '<span class="muted">None recorded.</span>'}</p>`,
      footer: `<div class="modal-foot">
        <button type="button" class="secondary" data-print>Print</button>
        <button type="button" data-edit>Edit</button></div>`
    });
    $("[data-print]", form).onclick = () => printDrill(id);
    $("[data-edit]", form).onclick = () => editDrill(id);
  }

  // Printable copy of the report, laid out like the paper form, with a sign-in sheet
  async function printDrill(id) {
    const w = window.open("", "_blank"); // open first so pop-up blockers allow it
    if (!w) { toast("Your browser blocked the print window. Allow pop-ups for this site and try again.", true); return; }
    w.document.write("<p style='font-family:sans-serif'>Preparing report…</p>");
    let d;
    try { d = await loadDrill(id); } catch (ex) { w.close(); toast(ex.message, true); return; }
    const box = (on) => (on ? "&#9746;" : "&#9744;");
    const ymd = (v) => (v ? String(v).replace(/-/g, "/") : "");
    const parts = [...d.fire_drill_participants].sort((a, b) => a.name.localeCompare(b.name));
    const rows = parts.map((p) => p.name);
    while (rows.length < Math.max(20, parts.length + 4)) rows.push("");
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fire Drill Report ${esc(d.drill_date)}</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #000; margin: 1.6cm; }
        h1 { text-align: center; font-size: 16pt; margin: 0 0 1em; }
        .line { margin: .45em 0; } .val { display: inline-block; min-width: 14em; border-bottom: 1px solid #000; padding: 0 .3em; }
        .sm { min-width: 5em; } table { width: 100%; border-collapse: collapse; margin: .6em 0; }
        td, th { border: 1px solid #000; padding: .35em .5em; vertical-align: top; } th { background: #eee; }
        .q td:not(:first-child) { width: 4.5em; text-align: center; white-space: nowrap; }
        .opts span { margin-right: 1.6em; } .notes { min-height: 5em; white-space: pre-wrap; }
        .sign td { height: 1.9em; } .page2 { page-break-before: always; }
        .noprint { margin-bottom: 1em; } @media print { .noprint { display: none; } body { margin: 0; } }
      </style></head><body>
      <div class="noprint"><button onclick="window.print()">Print</button></div>
      <h1>FIRE DRILL REPORT</h1>
      <div class="line">Name of Home: <span class="val">${esc(facilityName(d.facility_id))}</span></div>
      <div class="line">Date of Drill (YYYY/MM/DD): <span class="val">${ymd(d.drill_date)}</span></div>
      <div class="line">Start time (hh:mm): <span class="val sm">${hhmm(d.start_time)}</span>
        Completion Time (hh:mm): <span class="val sm">${hhmm(d.end_time)}</span>
        Total Time: <span class="val sm">${drillMinutes(d) == null ? "" : fmtMinutes(drillMinutes(d))}</span></div>
      <div class="line opts">Type of Event: <span>${box(d.event_type === "drill")} Fire Drill (planned)</span><span>${box(d.event_type === "alarm")} Fire Alarm (unplanned)</span></div>
      <p><strong>If fire drill, please describe activities of the fire drill:</strong></p>
      ${Object.entries(DRILL_ACTIVITY).map(([k, v]) => `<div class="line">${box(d.activity === k)} ${esc(v)}</div>`).join("")}
      <p><strong>Outcome of Fire Event:</strong></p>
      <table class="q"><tr><th style="text-align:left">Question</th><th>Yes</th><th>No</th><th>N/A</th></tr>
        ${DRILL_QUESTIONS.map(([k, label]) => `<tr><td>${esc(label)}</td>${["yes", "no", "na"].map((v) => `<td>${box(d[k] === v)}</td>`).join("")}</tr>`).join("")}
      </table>
      <p><strong>Problems, concerns or actions for improvements</strong></p>
      <table><tr><td class="notes">${esc(d.problems || "")}</td></tr></table>
      <p><em>Following debrief session, staff participating must sign in the Page 2.</em></p>
      <div class="line">Fire Drill Coordinator: <span class="val">${esc(d.coordinator || "")}</span></div>
      <div class="line">Name of observer: <span class="val">${esc(d.observer_name || "")}</span></div>
      <div class="line">Signature of observer: <span class="val"></span> Date (yyyy/mm/dd): <span class="val sm">${ymd(d.observer_date)}</span></div>
      <div class="page2">
        <h1>PARTICIPANTS</h1>
        <table class="sign"><tr><th style="width:50%">PARTICIPANTS NAME</th><th>SIGNATURE</th></tr>
          ${rows.map((n) => `<tr><td>${esc(n)}</td><td></td></tr>`).join("")}
        </table>
      </div>
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script>
      </body></html>`);
    w.document.close();
  }

  async function downloadDrillsExcel(drills) {
    toast("Preparing Excel file…");
    const XLSX = await loadXLSX();
    const ids = drills.map((d) => d.id);
    const parts = [];
    for (let i = 0; i < ids.length; i += 200)
      parts.push(...check(await sb.from("fire_drill_participants").select("drill_id, name").in("drill_id", ids.slice(i, i + 200))));
    const head = ["Date", "Home", "Type of event", "Activities", "Start", "Completion", "Total (min)",
      ...DRILL_QUESTIONS.map((q) => q[1]), "Issues", "Problems / actions for improvement",
      "Coordinator", "Observer", "Observer date", "Participants (count)", "Participants"];
    const rows = [head];
    for (const d of drills) {
      const names = parts.filter((p) => p.drill_id === d.id).map((p) => p.name).sort();
      rows.push([toDate(d.drill_date), facilityName(d.facility_id), DRILL_TYPE[d.event_type] || "", DRILL_ACTIVITY[d.activity] || "",
        hhmm(d.start_time), hhmm(d.end_time), drillMinutes(d) ?? "",
        ...DRILL_QUESTIONS.map(([k]) => ANSWER[d[k]] || ""), drillIssues(d), d.problems || "",
        d.coordinator || "", d.observer_name || "", toDate(d.observer_date), names.length, names.join(", ")]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, rows, [12, 28, 20, 30, 8, 11, 10, ...DRILL_QUESTIONS.map(() => 16), 8, 40, 20, 20, 12, 12, 60]), "Fire drills");
    XLSX.writeFile(wb, `TrainWell-fire-drills-${todayISO()}.xlsx`);
  }

  // -------------------------------------------------------- courses
  views.courses = {
    title: "Courses",
    actions() { return isAdmin() ? `<button data-act="add">+ Add course</button>` : ""; },
    async render(view) {
      await loadLookups();
      view.innerHTML = `
        <div class="card">
          ${isAdmin() ? "" : `<p class="muted" style="margin-top:0">Courses are managed by your administrator.</p>`}
          <div class="table-wrap"><table>
            <thead><tr><th>Code</th><th>Title</th><th>Category</th><th>Hours</th><th>Valid for</th><th>Mandatory</th><th>Status</th><th></th></tr></thead>
            <tbody>${state.courses.map((c) => `<tr>
              <td>${esc(c.code || "—")}</td><td>${esc(c.title)}</td><td>${esc(c.category || "—")}</td>
              <td>${c.duration_hours ?? "—"}</td><td>${c.validity_months ? c.validity_months + " months" : "No expiry"}</td>
              <td>${c.mandatory ? badge("admin", "Mandatory") : badge("neutral", "Optional")}</td>
              <td>${badge(c.active ? "active" : "inactive")}</td>
              <td class="actions">${isAdmin() ? `<button class="link small" data-edit="${c.id}">Edit</button> ${delBtn(c.id)}` : ""}</td></tr>`).join("")
              || `<tr><td colspan="8" class="empty">No courses yet.</td></tr>`}
            </tbody></table></div>
        </div>`;
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editCourse(state.courses.find((c) => c.id === Number(b.dataset.edit))));
      $$("[data-del]", view).forEach((b) => b.onclick = async () => {
        const c = state.courses.find((x) => x.id === Number(b.dataset.del));
        try {
          const n = async (t) => (await sb.from(t).select("id", { count: "exact", head: true }).eq("course_id", c.id)).count || 0;
          const [nRec, nSess] = await Promise.all([n("completions"), n("sessions")]);
          const warn = nRec + nSess
            ? `This also deletes ${nRec} training record(s) and ${nSess} session(s) for this course. To keep that history, Edit the course and untick Active instead.`
            : "No training records or sessions use it.";
          if (!(await confirmBox(`Delete the course "${c.title}"? ${warn}`))) return;
          check(await sb.from("courses").delete().eq("id", c.id)); toast("Course deleted"); route();
        } catch (ex) { toast(ex.message, true); }
      });
      this.onAction = (act) => { if (act === "add") editCourse(null); };
    }
  };

  function editCourse(c) {
    const isNew = !c; c = c || { active: true, mandatory: false };
    openModal({
      title: isNew ? "Add course" : "Edit course",
      body: `
        <div class="grid2">
          <div class="field"><label>Title *</label><input name="title" required value="${esc(c.title)}"></div>
          <div class="field"><label>Code</label><input name="code" value="${esc(c.code)}"></div>
          <div class="field"><label>Category</label><input name="category" value="${esc(c.category)}" placeholder="Safety, Onboarding…"></div>
          <div class="field"><label>Duration (hours)</label><input type="number" step="0.25" min="0" name="duration_hours" value="${esc(c.duration_hours)}"></div>
          <div class="field"><label>Valid for (months) <span class="muted">blank = never expires</span></label><input type="number" min="1" name="validity_months" value="${esc(c.validity_months)}"></div>
        </div>
        <div class="field"><label>Description</label><textarea name="description" rows="2">${esc(c.description)}</textarea></div>
        <div class="field"><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="mandatory" ${c.mandatory ? "checked" : ""}> Mandatory for all active employees</label></div>
        <div class="field"><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> Active</label></div>`,
      async onSubmit(d) {
        const row = { title: d.title.trim(), code: nn(d.code), category: nn(d.category), duration_hours: nn(d.duration_hours),
          validity_months: nn(d.validity_months), description: nn(d.description), mandatory: !!d.mandatory, active: !!d.active };
        if (isNew) check(await sb.from("courses").insert(row));
        else check(await sb.from("courses").update(row).eq("id", c.id));
        toast(isNew ? "Course added" : "Course saved"); route();
      }
    });
  }

  // -------------------------------------------------------- users (admin)
  views.users = {
    title: "Users", adminOnly: true,
    filters: { role: "" },
    actions() { return `<button data-act="add">+ Add user</button>`; },
    async render(view) {
      const f = this.filters;
      const all = check(await sb.from("profiles").select("*").order("full_name"));
      const users = all.filter((u) => !f.role || u.role === f.role);
      const count = (r) => all.filter((u) => u.role === r).length;
      view.innerHTML = `
        <div class="card">
          <p class="muted" style="margin-top:0"><strong>Admins</strong> see and manage everything.
            <strong>Managers</strong> see only their own facility's employees, sessions and records.
            <strong>Employees</strong> see only their own training, certificates, sessions and fire drills.</p>
          <div class="toolbar">
            <select data-f="role">
              <option value="">All roles (${all.length})</option>
              <option value="admin" ${f.role === "admin" ? "selected" : ""}>Admins (${count("admin")})</option>
              <option value="manager" ${f.role === "manager" ? "selected" : ""}>Managers (${count("manager")})</option>
              <option value="employee" ${f.role === "employee" ? "selected" : ""}>Employees (${count("employee")})</option>
            </select>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Facility</th><th>Status</th><th></th></tr></thead>
            <tbody>${users.map((u) => `<tr>
              <td>${esc(u.full_name)}${u.id === state.me.id ? ' <span class="muted">(you)</span>' : ""}</td><td>${esc(u.email)}</td>
              <td>${badge(u.role)}</td><td>${u.role === "admin" ? "All" : esc(facilityName(u.facility_id))}</td>
              <td>${badge(u.active ? "active" : "inactive")}</td>
              <td class="actions"><button class="link small" data-reset="${u.id}">Send password reset</button>
                <button class="link small" data-edit="${u.id}">Edit</button>
                ${u.id === state.me.id ? "" : delBtn(u.id)}</td></tr>`).join("")
              || `<tr><td colspan="6" class="empty">No users with this role yet.</td></tr>`}
            </tbody></table></div>
        </div>`;
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; route(); }));
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editUser(users.find((u) => u.id === b.dataset.edit)));
      $$("[data-del]", view).forEach((b) => b.onclick = async () => {
        const u = users.find((x) => x.id === b.dataset.del);
        if (!(await confirmBox(`Delete the login for ${u.full_name} (${u.email})? They will no longer be able to sign in. ` +
          (u.role === "employee" ? "Their employee record, training and certificates are kept." : "Employees and training records are not affected.")))) return;
        try { await invokeFn("delete-user", { ids: [u.id] }); toast("User deleted"); route(); }
        catch (ex) { toast(ex.message, true); }
      });
      $$("[data-reset]", view).forEach((b) => b.onclick = async () => {
        const u = users.find((x) => x.id === b.dataset.reset);
        const redirectTo = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "") + "index.html?setpw=1";
        const { error } = await sb.auth.resetPasswordForEmail(u.email, { redirectTo });
        toast(error ? error.message : `Reset email sent to ${u.email}`, !!error);
      });
      this.onAction = (act) => { if (act === "add") addUser(); };
    }
  };

  function roleFields(u) {
    return `
      <div class="field"><label>Role *</label><select name="role" data-role>
        <option value="manager" ${u.role !== "admin" ? "selected" : ""}>Manager — one facility</option>
        <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin — everything</option>
        ${u.allowEmployee ? `<option value="employee">Employee — their own training only</option>` : ""}</select></div>
      <div class="field" data-facfield><label>Facility *</label><select name="facility_id">${facilityOptions(u.facility_id)}</select></div>`;
  }
  function wireRole(form) {
    const sync = () => $("[data-facfield]", form).classList.toggle("hidden", $("[data-role]", form).value !== "manager");
    $("[data-role]", form).addEventListener("input", sync); sync();
  }
  function genPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    const a = new Uint32Array(14); crypto.getRandomValues(a);
    return Array.from(a, (n) => chars[n % chars.length]).join("");
  }

  async function addUser() {
    const pw = genPassword();
    let emps = [], logins = new Map();
    try { [emps, logins] = await Promise.all([loadEmployees({ activeOnly: true }), loadEmployeeLogins()]); }
    catch (ex) { toast(ex.message, true); return; }
    const free = emps.filter((e) => !logins.has(e.id));
    const { form } = openModal({
      title: "Add user", submitText: "Create user",
      body: `
        <div class="grid2">
          ${roleFields({ role: "manager", facility_id: state.facilities[0]?.id, allowEmployee: true })}
        </div>
        <div data-emp-only class="hidden">
          <div class="field"><label>Which employee? *</label>
            <select name="employee_id" data-emp>
              <option value="">Choose an employee…</option>
              ${free.map((e) => `<option value="${e.id}" data-email="${esc(e.email || "")}">${esc(e.last_name)}, ${esc(e.first_name)} · ${esc(facilityName(e.facility_id))}</option>`).join("")}
            </select>
            <p class="muted" style="font-size:.85rem;margin:.3rem 0 0">${free.length} employees don't have a login yet. The login is linked to their employee record and home.</p></div>
        </div>
        <div class="grid2">
          <div class="field" data-staff-only><label>Full name *</label><input name="full_name"></div>
          <div class="field"><label>Email *</label><input name="email" type="email" required></div>
        </div>
        <div data-emp-only class="hidden">
          <div class="field"><label>How will they get in?</label>
            <div class="choices stacked">
              <label class="choice"><input type="radio" name="mode" value="invite" checked> Email them an invite. They click the link and choose their own password.</label>
              <label class="choice"><input type="radio" name="mode" value="password"> Set a temporary password now (no email is sent)</label>
            </div></div>
        </div>
        <div class="field" data-pw><label>Temporary password *</label>
          <div style="display:flex;gap:.5rem"><input name="password" minlength="8" value="${esc(pw)}">
          <button type="button" class="secondary" data-copy>Copy</button></div>
          <p class="muted" style="font-size:.85rem;margin:.3rem 0 0">Give this to the user privately. They can change it with “Forgot password?” on the sign-in page.</p></div>`,
      async onSubmit(d) {
        const email = d.email.trim().toLowerCase();
        if (d.role === "employee") {
          if (!d.employee_id) throw new Error("Choose which employee this login is for.");
          const redirect_to = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "") + "index.html?setpw=1";
          await invokeFn("employee-access", { action: d.mode, employee_id: Number(d.employee_id), email, password: d.password, redirect_to });
          toast(d.mode === "invite" ? `Invite sent to ${email}` : `Login created for ${email}`);
        } else {
          if (!d.full_name.trim()) throw new Error("Full name is required.");
          if ((d.password || "").length < 8) throw new Error("Password must be at least 8 characters.");
          await invokeFn("create-user", { full_name: d.full_name.trim(), email, password: d.password,
            role: d.role, facility_id: d.role === "admin" ? null : Number(d.facility_id) });
          toast(`User ${email} created`);
        }
        route();
      }
    });
    wireRole(form);
    const sync = () => {
      const isEmp = form.role.value === "employee";
      $$("[data-emp-only]", form).forEach((el) => el.classList.toggle("hidden", !isEmp));
      $$("[data-staff-only]", form).forEach((el) => el.classList.toggle("hidden", isEmp));
      const mode = (form.querySelector("input[name=mode]:checked") || {}).value;
      $("[data-pw]", form).classList.toggle("hidden", isEmp && mode !== "password");
    };
    form.role.addEventListener("input", sync);
    $$("input[name=mode]", form).forEach((r) => r.addEventListener("change", sync));
    $("[data-emp]", form).addEventListener("input", (ev) => {
      const opt = ev.target.selectedOptions[0];
      if (opt && opt.dataset.email && !form.email.value) form.email.value = opt.dataset.email;
    });
    sync();
    $("[data-copy]", form).onclick = () => { navigator.clipboard?.writeText($("input[name=password]", form).value); toast("Password copied"); };
  }

  function editUser(u) {
    const self = u.id === state.me.id;
    if (u.role === "employee") {
      openModal({
        title: "Edit employee login",
        body: `
          <p style="margin-top:0"><strong>${esc(u.full_name)}</strong><br><span class="muted">${esc(u.email)} · ${esc(facilityName(u.facility_id))}</span></p>
          <p class="muted">This login belongs to an employee. To change their name, job or home, edit them on the
            <a href="#employees">Employees</a> page.</p>
          <div class="field"><label style="display:flex;gap:.5rem;align-items:center">
            <input type="checkbox" name="active" ${u.active ? "checked" : ""}> Account active (can sign in)</label></div>`,
        async onSubmit(d) {
          check(await sb.from("profiles").update({ active: !!d.active }).eq("id", u.id));
          toast("Login saved"); route();
        }
      });
      return;
    }
    const { form } = openModal({
      title: "Edit user",
      body: `
        <div class="field"><label>Full name *</label><input name="full_name" required value="${esc(u.full_name)}"></div>
        <p class="muted" style="margin-top:0">${esc(u.email)}</p>
        ${roleFields(u)}
        <div class="field"><label style="display:flex;gap:.5rem;align-items:center">
          <input type="checkbox" name="active" ${u.active ? "checked" : ""} ${self ? "disabled" : ""}> Account active (can sign in)</label>
          ${self ? `<p class="muted" style="font-size:.85rem">You can't deactivate or demote your own account.</p>` : ""}</div>`,
      async onSubmit(d) {
        const row = { full_name: d.full_name.trim() };
        if (!self) Object.assign(row, { role: d.role, facility_id: d.role === "admin" ? null : Number(d.facility_id), active: !!d.active });
        check(await sb.from("profiles").update(row).eq("id", u.id));
        toast("User saved"); route();
      }
    });
    wireRole(form);
    if (self) $("[data-role]", form).disabled = true;
  }

  // -------------------------------------------------------- facilities (admin)
  views.facilities = {
    title: "Facilities", adminOnly: true,
    actions() { return `<button data-act="add">+ Add facility</button>`; },
    async render(view) {
      await loadLookups();
      const emps = await loadEmployees({ activeOnly: true });
      const users = check(await sb.from("profiles").select("facility_id, role, active"));
      view.innerHTML = `
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Facility</th><th>Address</th><th>Active employees</th><th>Managers</th><th></th></tr></thead>
          <tbody>${state.facilities.map((f) => `<tr>
            <td><strong>${esc(f.name)}</strong></td><td>${esc(f.address || "—")}</td>
            <td>${emps.filter((e) => e.facility_id === f.id).length}</td>
            <td>${users.filter((u) => u.facility_id === f.id && u.role === "manager" && u.active).length}</td>
            <td class="actions"><button class="link small" data-edit="${f.id}">Edit</button>
              <button class="link small" data-del="${f.id}" style="color:var(--bad)">Delete</button></td></tr>`).join("")
            || `<tr><td colspan="5" class="empty">No facilities yet.</td></tr>`}
          </tbody></table></div></div>`;
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editFacility(state.facilities.find((f) => f.id === Number(b.dataset.edit))));
      $$("[data-del]", view).forEach((b) => b.onclick = () => deleteFacility(state.facilities.find((f) => f.id === Number(b.dataset.del))));
      this.onAction = (act) => { if (act === "add") editFacility(null); };
    }
  };

  function editFacility(f) {
    const isNew = !f; f = f || {};
    openModal({
      title: isNew ? "Add facility" : "Edit facility",
      body: `
        <div class="field"><label>Name *</label><input name="name" required value="${esc(f.name)}"></div>
        <div class="field"><label>Address</label><input name="address" value="${esc(f.address)}"></div>`,
      async onSubmit(d) {
        const row = { name: d.name.trim(), address: nn(d.address) };
        if (isNew) check(await sb.from("facilities").insert(row));
        else check(await sb.from("facilities").update(row).eq("id", f.id));
        await loadLookups(); toast("Facility saved"); route();
      }
    });
  }

  // Delete a facility. If it still has employees, sessions or managers,
  // they must be moved to another facility first so nothing is lost.
  async function deleteFacility(f) {
    const count = async (table, optional = false) => {
      const { count: n, error } = await sb.from(table).select("id", { count: "exact", head: true }).eq("facility_id", f.id);
      if (error) { if (optional) return 0; throw new Error(error.message); }
      return n || 0;
    };
    let nEmp, nSess, nMgr, nDrill;
    try { [nEmp, nSess, nMgr, nDrill] = await Promise.all([count("employees"), count("sessions"), count("profiles"), count("fire_drills", true)]); }
    catch (ex) { toast(ex.message, true); return; }
    const others = state.facilities.filter((x) => x.id !== f.id);
    const inUse = nEmp + nSess + nMgr + nDrill > 0;

    if (inUse && !others.length) {
      openModal({ title: `Delete ${f.name}`, body: `<p>This facility still has ${nEmp} employee(s), ${nSess} session(s), ${nDrill} fire drill report(s) and ${nMgr} manager(s).
        Add another facility first so they can be moved there, then delete this one.</p>` });
      return;
    }

    openModal({
      title: `Delete ${f.name}`, submitText: "Delete facility",
      body: inUse ? `
        <p>This facility still has <strong>${nEmp}</strong> employee(s) (active and inactive), <strong>${nSess}</strong> session(s),
          <strong>${nDrill}</strong> fire drill report(s) and <strong>${nMgr}</strong> manager login(s). They'll be moved to the facility you choose, with all their training records kept.</p>
        <div class="field"><label>Move everything to *</label>
          <select name="target" required>${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Type <strong>DELETE</strong> to confirm</label><input name="confirm" required autocomplete="off"></div>`
        : `<p>This facility has no employees, sessions, fire drill reports or managers.</p>
        <div class="field"><label>Type <strong>DELETE</strong> to confirm</label><input name="confirm" required autocomplete="off"></div>`,
      async onSubmit(d) {
        if (d.confirm.trim().toUpperCase() !== "DELETE") throw new Error("Type DELETE to confirm.");
        if (inUse) {
          const target = Number(d.target);
          check(await sb.from("employees").update({ facility_id: target }).eq("facility_id", f.id));
          check(await sb.from("sessions").update({ facility_id: target }).eq("facility_id", f.id));
          check(await sb.from("profiles").update({ facility_id: target }).eq("facility_id", f.id));
          if (nDrill) check(await sb.from("fire_drills").update({ facility_id: target }).eq("facility_id", f.id));
        }
        check(await sb.from("facilities").delete().eq("id", f.id));
        await loadLookups(); toast(`${f.name} deleted`); route();
      }
    });
  }

  // =============================================================== CERTIFICATES
  // Files live in the private "certificates" storage bucket as  <employee id>/<file>
  const CERT_MAX = 10 * 1024 * 1024;
  async function putCertificate(employeeId, file) {
    if (file.size > CERT_MAX) throw new Error("That file is over 10 MB. Try a smaller photo or a PDF.");
    let type = file.type;
    if (!type && /\.hei[cf]$/i.test(file.name)) type = "image/heic";
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    const path = `${employeeId}/${Date.now()}-${safe}`;
    const { error } = await sb.storage.from("certificates").upload(path, file, { contentType: type || undefined, upsert: false });
    if (error) {
      if (/mime|type/i.test(error.message)) throw new Error("Only PDF files or photos (JPG, PNG, HEIC) can be uploaded.");
      if (/bucket/i.test(error.message)) throw new Error("Certificate uploads aren't set up yet. An administrator needs to run the employee-logins update (see README).");
      throw new Error(error.message);
    }
    return path;
  }
  async function removeCertificate(path) {
    if (path) await sb.storage.from("certificates").remove([path]);
  }
  async function openCertificate(path) {
    const w = window.open("", "_blank"); // open first so pop-up blockers allow it
    const { data, error } = await sb.storage.from("certificates").createSignedUrl(path, 300);
    if (error || !data) { if (w) w.close(); toast(error ? error.message : "Could not open the file.", true); return; }
    if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
  }
  const certLink = (r) => r.certificate_path
    ? `<button class="link small" data-cert="${esc(r.certificate_path)}">View file</button>` : `<span class="muted">—</span>`;
  const wireCerts = (root) => $$("[data-cert]", root).forEach((b) => b.onclick = () => openCertificate(b.dataset.cert));

  // Upload form, used by employees (their own) and by managers (for one employee)
  function uploadCertificate({ employeeId, courseId = "", byEmployee = false, title = "Upload certificate" }) {
    openModal({
      title, submitText: "Upload",
      body: `
        <div class="field"><label>Course *</label><select name="course_id" required>${courseOptions(courseId)}</select></div>
        <div class="grid2">
          <div class="field"><label>Date completed *</label><input type="date" name="completed_on" required max="${todayISO()}"></div>
          <div class="field"><label>Expiry date <span class="muted">(blank = worked out from the course)</span></label><input type="date" name="expires_on"></div>
          <div class="field"><label>Certificate #</label><input name="certificate_no"></div>
        </div>
        <div class="field"><label>Certificate file * <span class="muted">PDF or photo, up to 10 MB</span></label>
          <input type="file" name="file" required accept="application/pdf,image/*,.heic,.heif"></div>
        <p class="muted" style="font-size:.85rem;margin:0">On a phone you can take a photo of the certificate here.</p>`,
      async onSubmit(d, frm) {
        const file = $("input[type=file]", frm).files[0];
        if (!file) throw new Error("Choose the certificate file.");
        const path = await putCertificate(employeeId, file);
        const row = {
          employee_id: employeeId, course_id: Number(d.course_id), completed_on: d.completed_on, expires_on: nn(d.expires_on),
          certificate_no: nn(d.certificate_no), certificate_path: path, uploaded_by_employee: !!byEmployee,
          recorded_by: state.me.id, notes: byEmployee ? "Uploaded by employee" : null
        };
        const { error } = await sb.from("completions").insert(row);
        if (error) { await removeCertificate(path); throw new Error(error.message); }
        toast("Certificate uploaded"); route();
      }
    });
  }

  // =============================================================== EMPLOYEE PORTAL
  const isEmployee = () => state.me && state.me.role === "employee";
  const MY_LABEL = { valid: "Up to date", expiring: "Due soon", expired: "Overdue", missing: "To complete" };
  const myBadge = (s) => badge(s, MY_LABEL[s]);

  async function loadMyTraining() {
    const recs = check(await sb.from("completions").select("*").eq("employee_id", state.me.employee_id)
      .order("completed_on", { ascending: false, nullsFirst: false }).order("expires_on", { ascending: false, nullsFirst: false }));
    const latest = new Map();
    for (const r of recs) if (!latest.has(r.course_id)) latest.set(r.course_id, r);
    const rows = state.courses
      .filter((c) => c.active && (c.mandatory || latest.has(c.id)))
      .map((c) => { const r = latest.get(c.id); return { course: c, rec: r, status: r ? expiryStatus(r.expires_on) : "missing" }; })
      .sort((a, b) => ({ expired: 0, missing: 1, expiring: 2, valid: 3 }[a.status] - { expired: 0, missing: 1, expiring: 2, valid: 3 }[b.status])
        || a.course.title.localeCompare(b.course.title));
    return { recs, rows };
  }

  views.my = {
    title: "My training", employee: true,
    actions() { return `<button data-act="upload">+ Upload certificate</button>`; },
    async render(view) {
      const { rows } = await loadMyTraining();
      const n = (s) => rows.filter((r) => r.status === s).length;
      const todo = rows.filter((r) => r.status !== "valid");
      view.innerHTML = `
        <p class="muted" style="margin-top:0">Hi ${esc(state.me.full_name.split(" ")[0])}. Here is your training at ${esc(facilityName(state.myEmp?.facility_id))}.</p>
        <div class="stats">
          <div class="stat ok"><div class="label">Up to date</div><div class="value">${n("valid")}</div></div>
          <div class="stat warn"><div class="label">Due soon (${WARN_DAYS} days)</div><div class="value">${n("expiring")}</div></div>
          <div class="stat bad"><div class="label">Overdue</div><div class="value">${n("expired")}</div></div>
          <div class="stat bad"><div class="label">Still to complete</div><div class="value">${n("missing")}</div></div>
        </div>
        <div class="card">
          <h2>Courses you need to complete</h2>
          ${todo.length ? `<p class="muted" style="margin-top:0">Done one of these? Upload the certificate and your record updates straight away.</p>` : ""}
          <div class="table-wrap"><table>
            <tbody>${todo.map((r) => `<tr><td style="white-space:normal"><strong>${esc(r.course.title)}</strong><br>
                <span style="display:inline-flex;gap:.5rem;align-items:center;margin-top:.25rem">${myBadge(r.status)}
                <span class="muted" style="font-size:.85rem">${r.rec?.expires_on ? "Expires " + fmtDate(r.rec.expires_on) : "Not done yet"}</span></span></td>
              <td class="actions" style="vertical-align:middle"><button class="small" data-up="${r.course.id}">Upload</button></td></tr>`).join("")
              || `<tr><td colspan="2" class="empty">You're all up to date. 🎉</td></tr>`}
            </tbody></table></div>
        </div>
        <div class="card">
          <h2>All my training</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Course</th><th>Required</th><th>Status</th><th>Completed</th><th>Expiry date</th><th>Certificate</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td>${esc(r.course.title)}</td>
              <td>${r.course.mandatory ? badge("admin", "Required") : badge("neutral", "Optional")}</td>
              <td>${myBadge(r.status)}</td><td>${fmtDate(r.rec?.completed_on)}</td><td>${fmtDate(r.rec?.expires_on)}</td>
              <td>${r.rec ? certLink(r.rec) : '<span class="muted">—</span>'}</td></tr>`).join("")
              || `<tr><td colspan="6" class="empty">No courses set up yet.</td></tr>`}
            </tbody></table></div>
        </div>`;
      $$("[data-up]", view).forEach((b) => b.onclick = () => uploadCertificate({ employeeId: state.me.employee_id, courseId: b.dataset.up, byEmployee: true }));
      wireCerts(view);
      this.onAction = (act) => { if (act === "upload") uploadCertificate({ employeeId: state.me.employee_id, byEmployee: true }); };
    }
  };

  views.certs = {
    title: "My certificates", employee: true,
    actions() { return `<button data-act="upload">+ Upload certificate</button>`; },
    async render(view) {
      const { recs } = await loadMyTraining();
      view.innerHTML = `
        <div class="card">
          <p class="muted" style="margin-top:0">Everything on your training record. Files you uploaded can be viewed or deleted here.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Course</th><th>Completed</th><th>Expiry date</th><th>Status</th><th>Certificate #</th><th>File</th><th>Added by</th><th></th></tr></thead>
            <tbody>${recs.map((r) => `<tr><td>${esc(courseTitle(r.course_id))}</td><td>${fmtDate(r.completed_on)}</td><td>${fmtDate(r.expires_on)}</td>
              <td>${myBadge(expiryStatus(r.expires_on))}</td><td>${esc(r.certificate_no || "—")}</td><td>${certLink(r)}</td>
              <td>${r.uploaded_by_employee ? "You" : "Your manager"}</td>
              <td class="actions">${r.uploaded_by_employee ? delBtn(r.id) : ""}</td></tr>`).join("")
              || `<tr><td colspan="8" class="empty">Nothing yet. Click <strong>+ Upload certificate</strong> to add one.</td></tr>`}
            </tbody></table></div>
        </div>`;
      wireCerts(view);
      $$("[data-del]", view).forEach((b) => b.onclick = async () => {
        const r = recs.find((x) => x.id === Number(b.dataset.del));
        if (!(await confirmBox(`Delete your ${courseTitle(r.course_id)} certificate? This cannot be undone.`))) return;
        try { check(await sb.from("completions").delete().eq("id", r.id)); await removeCertificate(r.certificate_path); toast("Certificate deleted"); route(); }
        catch (ex) { toast(ex.message, true); }
      });
      this.onAction = (act) => { if (act === "upload") uploadCertificate({ employeeId: state.me.employee_id, byEmployee: true }); };
    }
  };

  views.mysessions = {
    title: "My sessions", employee: true,
    async render(view) {
      const all = check(await sb.from("sessions").select("*, attendance(status, employee_id)").order("starts_at"));
      const now = new Date().toISOString();
      const up = all.filter((s) => s.starts_at >= now);
      const past = all.filter((s) => s.starts_at < now).reverse().slice(0, 20);
      const status = (s) => (s.attendance.find((a) => a.employee_id === state.me.employee_id) || {}).status || "registered";
      const table = (list, empty) => `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Course</th><th>Location</th><th>Trainer</th><th>Status</th></tr></thead>
        <tbody>${list.map((s) => `<tr><td>${fmtDateTime(s.starts_at)}</td><td>${esc(courseTitle(s.course_id))}</td>
          <td>${esc(s.location || "—")}</td><td>${esc(s.trainer || "—")}</td><td>${badge(status(s), status(s)[0].toUpperCase() + status(s).slice(1))}</td></tr>`).join("")
          || `<tr><td colspan="5" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
      view.innerHTML = `
        <div class="card"><h2>Coming up</h2>${table(up, "You're not booked into any upcoming sessions.")}</div>
        <div class="card"><h2>Past sessions</h2>${table(past, "No past sessions yet.")}</div>`;
    }
  };

  views.mydrills = {
    title: "My fire drills", employee: true,
    async render(view) {
      const { data, error } = await sb.from("fire_drills").select("*").order("drill_date", { ascending: false });
      if (error) { view.innerHTML = `<div class="card empty">Fire drills aren't available yet.</div>`; return; }
      view.innerHTML = `
        <div class="card">
          <p class="muted" style="margin-top:0">Fire drills and fire alarms you took part in.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Time</th><th>Total</th><th>Coordinator</th></tr></thead>
            <tbody>${data.map((d) => `<tr><td>${fmtDate(d.drill_date)}</td>
              <td>${d.event_type === "alarm" ? badge("expiring", "Fire alarm") : badge("neutral", "Fire drill")}</td>
              <td>${hhmm(d.start_time) || "—"}${d.end_time ? "–" + hhmm(d.end_time) : ""}</td>
              <td>${fmtMinutes(drillMinutes(d))}</td><td>${esc(d.coordinator || "—")}</td></tr>`).join("")
              || `<tr><td colspan="5" class="empty">No fire drills recorded for you yet.</td></tr>`}
            </tbody></table></div>
        </div>`;
    }
  };

  // =============================================================== EMPLOYEE LOGINS (admin)
  async function loadEmployeeLogins() {
    if (!isAdmin()) return new Map();
    const { data } = await sb.from("profiles").select("id, email, employee_id, active").eq("role", "employee");
    return new Map((data || []).map((p) => [p.employee_id, p]));
  }

  function giveLogin(e) {
    const { form } = openModal({
      title: `Give ${fullName(e)} a login`, submitText: "Create login",
      body: `
        <div class="field"><label>Their email *</label><input type="email" name="email" required value="${esc(e.email)}"></div>
        <div class="field"><label>How will they get in?</label>
          <div class="choices stacked">
            <label class="choice"><input type="radio" name="mode" value="invite" checked> Email them an invite. They click the link and choose their own password.</label>
            <label class="choice"><input type="radio" name="mode" value="password"> Set a temporary password now (no email is sent)</label>
          </div></div>
        <div class="field hidden" data-pw><label>Temporary password</label>
          <div style="display:flex;gap:.5rem"><input name="password" minlength="8" value="${esc(genPassword())}">
          <button type="button" class="secondary" data-copy>Copy</button></div>
          <p class="muted" style="font-size:.85rem;margin:.3rem 0 0">Give it to them privately. They can change it any time with “Forgot password?” on the sign-in page.</p></div>
        <p class="muted" style="font-size:.85rem;margin:0">They'll sign in at the same address as you, and will only see their own training, certificates, sessions and fire drills.</p>`,
      async onSubmit(d) {
        const redirect_to = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "") + "index.html?setpw=1";
        await invokeFn("employee-access", { action: d.mode, employee_id: e.id, email: d.email.trim(), password: d.password, redirect_to });
        toast(d.mode === "invite" ? `Invite sent to ${d.email.trim()}` : `Login created for ${fullName(e)}`);
        route();
      }
    });
    const sync = () => $("[data-pw]", form).classList.toggle("hidden", form.querySelector("input[name=mode]:checked").value !== "password");
    $$("input[name=mode]", form).forEach((r) => r.addEventListener("change", sync));
    $("[data-copy]", form).onclick = () => { navigator.clipboard?.writeText(form.password.value); toast("Password copied"); };
  }

  async function removeLogin(e) {
    if (!(await confirmBox(`Remove ${fullName(e)}'s login? They won't be able to sign in. Their training records and certificates are kept.`, { okText: "Remove login" }))) return;
    try { await invokeFn("employee-access", { action: "remove", employee_id: e.id }); toast("Login removed"); route(); }
    catch (ex) { toast(ex.message, true); }
  }

  // ============================================================== ROUTER
  let currentView = null;
  async function route() {
    const home = isEmployee() ? "my" : "dashboard";
    let name = (location.hash || "#" + home).slice(1);
    let v = views[name];
    if (!v || (v.adminOnly && !isAdmin()) || !!v.employee !== isEmployee()) {
      name = home; v = views[home];
      history.replaceState(null, "", "#" + name);
    }
    currentView = v;
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + name));
    $("#pageTitle").textContent = v.title;
    document.title = `${v.title} · Train Well`;
    $("#pageActions").innerHTML = v.actions ? v.actions() : "";
    $("#sidebar").classList.remove("open");
    const view = $("#view");
    view.innerHTML = `<div class="card empty">Loading…</div>`;
    try { await v.render(view); }
    catch (ex) { view.innerHTML = `<div class="alert error">Couldn't load this page: ${esc(ex.message)}</div>`; }
  }

  $("#pageActions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && currentView && currentView.onAction) currentView.onAction(b.dataset.act);
  });
  $("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); location.replace("index.html"); });
  window.addEventListener("hashchange", () => { $("#modalRoot").innerHTML = ""; route(); });

  // ============================================================== BOOT
  (async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.replace("index.html"); return; }
    const { data: me } = await sb.from("profiles").select("*").eq("id", data.session.user.id).maybeSingle();
    if (!me || !me.active) { await sb.auth.signOut(); location.replace("index.html"); return; }
    state.me = me;
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.replace("index.html"); });
    await loadLookups();
    if (isEmployee()) {
      if (!me.employee_id) throw new Error("This login isn't linked to an employee record. Ask your administrator.");
      state.myEmp = check(await sb.from("employees").select("*").eq("id", me.employee_id).maybeSingle());
      $$(".staff-only, .admin-only").forEach((el) => el.classList.add("hidden"));
      $$(".employee-only").forEach((el) => el.classList.remove("hidden"));
    }
    $("#meName").textContent = me.full_name;
    $("#meRole").textContent = me.role === "admin" ? "Administrator · all facilities"
      : me.role === "employee" ? `Staff · ${facilityName(state.myEmp?.facility_id)}` : `Manager · ${facilityName(me.facility_id)}`;
    if (!isAdmin()) $$(".admin-only").forEach((el) => el.classList.add("hidden"));
    if (!isAdmin()) views.employees.filters.facility = "";
    $("#shell").classList.remove("hidden");
    route();
  })().catch((ex) => {
    document.body.innerHTML = `<div class="alert error" style="margin:2rem">Train Well couldn't start: ${esc(ex.message)}</div>`;
  });
})();
