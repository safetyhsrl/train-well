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
              <button class="secondary" data-act="export">Export CSV</button>
              <button data-act="add">+ Add employee</button>`;
    },
    async render(view) {
      const all = await loadEmployees();
      const { map } = await complianceMatrix(all);
      const mandatory = state.courses.filter((c) => c.mandatory && c.active);
      const f = this.filters;

      const gaps = (e) => mandatory.filter((c) => {
        const s = map.get(`${e.id}:${c.id}`);
        return !s || expiryStatus(s.expires_on) === "expired";
      }).length;

      view.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <input type="search" placeholder="Search name, number, title…" value="${esc(f.q)}" data-f="q">
            ${isAdmin() ? `<select data-f="facility">${facilityOptions(f.facility, { includeAll: true })}</select>` : ""}
            <select data-f="status">
              <option value="active" ${f.status === "active" ? "selected" : ""}>Active</option>
              <option value="inactive" ${f.status === "inactive" ? "selected" : ""}>Inactive</option>
              <option value="" ${f.status === "" ? "selected" : ""}>All statuses</option>
            </select>
            <span class="spacer"></span><span class="muted" data-count></span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Emp #</th><th>Name</th><th>Job title</th><th>Department</th><th>Facility</th><th>Status</th><th>Mandatory training</th><th></th></tr></thead>
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
            <td>${esc(e.employee_no || "—")}</td>
            <td><button class="link" data-view="${e.id}">${esc(fullName(e))}</button></td>
            <td>${esc(e.job_title || "—")}</td><td>${esc(e.department || "—")}</td>
            <td>${esc(facilityName(e.facility_id))}</td><td>${badge(e.status)}</td>
            <td>${g === null ? "—" : g === 0 ? badge("valid", "Up to date") : badge("expired", g + " outstanding")}</td>
            <td class="actions"><button class="link small" data-edit="${e.id}">Edit</button></td></tr>`;
        }).join("") || `<tr><td colspan="8" class="empty">No employees match. Add one or import a CSV.</td></tr>`;
        $$("[data-view]", view).forEach((b) => b.onclick = () => showEmployee(Number(b.dataset.view)));
        $$("[data-edit]", view).forEach((b) => b.onclick = () => editEmployee(all.find((e) => e.id === Number(b.dataset.edit))));
      };
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; draw(); }));
      draw();

      this.onAction = (act) => {
        if (act === "add") editEmployee(null);
        if (act === "import") importEmployees();
        if (act === "export") downloadCSV(`trainwell-employees-${todayISO()}.csv`, [
          ["employee_no", "first_name", "last_name", "email", "phone", "job_title", "department", "facility", "hire_date", "status"],
          ...all.map((e) => [e.employee_no, e.first_name, e.last_name, e.email, e.phone, e.job_title, e.department,
            facilityName(e.facility_id), e.hire_date, e.status])
        ]);
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
          <div class="field"><label>Employee number</label><input name="employee_no" value="${esc(e.employee_no)}"></div>
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
        </div>`,
      async onSubmit(d) {
        const row = {
          first_name: d.first_name.trim(), last_name: d.last_name.trim(), employee_no: nn(d.employee_no),
          facility_id: Number(isAdmin() ? d.facility_id : (e.facility_id || state.me.facility_id)),
          job_title: nn(d.job_title), department: nn(d.department), email: nn(d.email), phone: nn(d.phone),
          hire_date: nn(d.hire_date), status: d.status
        };
        if (isNew) check(await sb.from("employees").insert(row));
        else check(await sb.from("employees").update(row).eq("id", e.id));
        toast(isNew ? "Employee added" : "Employee saved"); route();
      }
    });
  }

  function importEmployees() {
    const { form } = openModal({
      title: "Import employees from CSV", submitText: "Import",
      body: `
        <p class="muted" style="margin-top:0">Columns (first row = headers): <code>employee_no, first_name, last_name, email, phone,
        job_title, department, facility, hire_date</code>. Only first and last name are required. <code>facility</code> must match a
        facility name${isAdmin() ? "" : " (or leave blank for yours)"}. Dates as YYYY-MM-DD. Rows with an existing employee number are updated.</p>
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
      ["employee_no", "first_name", "last_name", "email", "phone", "job_title", "department", "facility", "hire_date"],
      ["1001", "Jane", "Doe", "jane@example.com", "709-555-0100", "Operator", "Production", state.facilities[0]?.name || "Facility 1", "2024-03-15"]
    ]);
  }

  async function showEmployee(id) {
    const e = check(await sb.from("employees").select("*").eq("id", id).single());
    const comps = check(await sb.from("completions").select("*").eq("employee_id", id).order("completed_on", { ascending: false }));
    const latest = new Map();
    for (const c of comps) if (!latest.has(c.course_id)) latest.set(c.course_id, c);
    const mandatory = state.courses.filter((c) => c.mandatory && c.active);

    const { form } = openModal({
      title: fullName(e), wide: true,
      body: `
        <p class="muted" style="margin-top:0">${esc([e.employee_no && "#" + e.employee_no, e.job_title, e.department, facilityName(e.facility_id)].filter(Boolean).join(" · "))}
          ${e.hire_date ? " · Hired " + fmtDate(e.hire_date) : ""} · ${badge(e.status)}</p>
        <h3>Mandatory training</h3>
        <div class="table-wrap"><table><thead><tr><th>Course</th><th>Status</th><th>Completed</th><th>Expires</th></tr></thead><tbody>
          ${mandatory.map((c) => { const l = latest.get(c.id); const s = l ? expiryStatus(l.expires_on) : "missing";
            return `<tr><td>${esc(c.title)}</td><td>${badge(s)}</td><td>${fmtDate(l?.completed_on)}</td><td>${fmtDate(l?.expires_on)}</td></tr>`; }).join("")
            || `<tr><td colspan="4" class="empty">No mandatory courses set up.</td></tr>`}
        </tbody></table></div>
        <h3 style="margin-top:1.2rem">Full training history</h3>
        <div class="table-wrap"><table><thead><tr><th>Course</th><th>Completed</th><th>Expires</th><th>Score</th><th>Certificate</th></tr></thead><tbody>
          ${comps.map((c) => `<tr><td>${esc(courseTitle(c.course_id))}</td><td>${fmtDate(c.completed_on)}</td>
            <td>${fmtDate(c.expires_on)} ${c.expires_on ? badge(expiryStatus(c.expires_on)) : ""}</td>
            <td>${c.score ?? "—"}</td><td>${esc(c.certificate_no || "—")}</td></tr>`).join("")
            || `<tr><td colspan="5" class="empty">No training recorded yet.</td></tr>`}
        </tbody></table></div>`,
      footer: `<div class="modal-foot">
        <button type="button" class="secondary" data-edit>Edit details</button>
        <button type="button" data-addrec>+ Add training record</button></div>`
    });
    $("[data-edit]", form).onclick = () => editEmployee(e);
    $("[data-addrec]", form).onclick = () => editRecord(null, { employeeIds: [e.id] });
  }

  // -------------------------------------------------------- records
  views.records = {
    title: "Training records",
    filters: { q: "", course: "", status: "", facility: "" },
    actions() {
      return `<button class="secondary" data-act="export">Export CSV</button>
              <button data-act="add">+ Record training</button>`;
    },
    async render(view) {
      const recs = await fetchAll(() => sb.from("completions")
        .select("*, employees!inner(id, first_name, last_name, employee_no, facility_id, status)")
        .order("completed_on", { ascending: false }));
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
            <thead><tr><th>Employee</th><th>Facility</th><th>Course</th><th>Completed</th><th>Expires</th><th>Status</th><th>Score</th><th></th></tr></thead>
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
          <td>${badge(expiryStatus(r.expires_on))}</td><td>${r.score ?? "—"}</td>
          <td class="actions"><button class="link small" data-edit="${r.id}">Edit</button>
            <button class="link small" data-del="${r.id}" style="color:var(--bad)">Delete</button></td></tr>`).join("")
          + (shown.length > 500 ? `<tr><td colspan="8" class="empty">Showing first 500. Narrow the filters or export to see all.</td></tr>` : "")
          || `<tr><td colspan="8" class="empty">No training records yet.</td></tr>`;
        $$("[data-emp]", view).forEach((b) => b.onclick = () => showEmployee(Number(b.dataset.emp)));
        $$("[data-edit]", view).forEach((b) => b.onclick = () => editRecord(recs.find((r) => r.id === Number(b.dataset.edit))));
        $$("[data-del]", view).forEach((b) => b.onclick = async () => {
          if (!(await confirmBox("Delete this training record? This cannot be undone."))) return;
          try { check(await sb.from("completions").delete().eq("id", Number(b.dataset.del))); toast("Record deleted"); route(); }
          catch (ex) { toast(ex.message, true); }
        });
      };
      $$("[data-f]", view).forEach((inp) => inp.addEventListener("input", () => { f[inp.dataset.f] = inp.value; draw(); }));
      draw();
      this.onAction = (act) => {
        if (act === "add") editRecord(null);
        if (act === "export") downloadCSV(`trainwell-training-records-${todayISO()}.csv`, [
          ["employee_no", "employee", "facility", "course", "completed_on", "expires_on", "status", "score", "certificate_no", "notes"],
          ...shown.map((r) => [r.employees.employee_no, fullName(r.employees), facilityName(r.employees.facility_id),
            courseTitle(r.course_id), r.completed_on, r.expires_on, expiryStatus(r.expires_on), r.score, r.certificate_no, r.notes])
        ]);
      };
    }
  };

  // Employee checklist picker (used for records and attendance)
  function employeePicker(employees, selectedIds = [], { facilityFilter = true } = {}) {
    const sel = new Set(selectedIds);
    return `
      <div class="field"><label>Employees * <span data-selcount class="muted"></span></label>
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
            ${esc(fullName(e))} <span class="muted">${esc(e.employee_no ? "#" + e.employee_no : "")} · ${esc(facilityName(e.facility_id))}</span></label>`).join("")
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
          <div class="field"><label>Date completed *</label><input type="date" name="completed_on" required value="${esc(r?.completed_on || todayISO())}"></div>
          <div class="field"><label>Expiry date <span class="muted">(blank = from course)</span></label><input type="date" name="expires_on" value="${esc(r?.expires_on)}"></div>
          <div class="field"><label>Score</label><input type="number" step="0.01" name="score" value="${esc(r?.score)}"></div>
          <div class="field"><label>Certificate #</label><input name="certificate_no" value="${esc(r?.certificate_no)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea name="notes" rows="2">${esc(r?.notes)}</textarea></div>`,
      async onSubmit(d, frm) {
        const base = { course_id: Number(d.course_id), completed_on: d.completed_on, expires_on: nn(d.expires_on),
          score: nn(d.score), certificate_no: nn(d.certificate_no), notes: nn(d.notes) };
        if (isNew) {
          const ids = pickedIds(frm);
          if (!ids.length) throw new Error("Select at least one employee.");
          check(await sb.from("completions").insert(ids.map((id) => ({ ...base, employee_id: id, recorded_by: state.me.id }))));
          toast(`Recorded for ${ids.length} employee${ids.length > 1 ? "s" : ""}`);
        } else {
          // Clearing the expiry box lets the database recalculate it from the course
          check(await sb.from("completions").update(base).eq("id", r.id));
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
        ${att.length ? `<p><button type="button" class="secondary small" data-allattended>Mark everyone attended</button></p>` : ""}
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
    $$("[data-rm]", form).forEach((b) => b.onclick = async () => {
      try { check(await sb.from("attendance").delete().eq("id", Number(b.dataset.rm))); toast("Removed"); manageAttendance(s); }
      catch (ex) { toast(ex.message, true); }
    });
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
              <td class="actions">${isAdmin() ? `<button class="link small" data-edit="${c.id}">Edit</button>` : ""}</td></tr>`).join("")
              || `<tr><td colspan="8" class="empty">No courses yet.</td></tr>`}
            </tbody></table></div>
        </div>`;
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editCourse(state.courses.find((c) => c.id === Number(b.dataset.edit))));
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
    actions() { return `<button data-act="add">+ Add user</button>`; },
    async render(view) {
      const users = check(await sb.from("profiles").select("*").order("full_name"));
      view.innerHTML = `
        <div class="card">
          <p class="muted" style="margin-top:0"><strong>Admins</strong> see and manage all facilities, courses and users.
            <strong>Managers</strong> see only their own facility's employees, sessions and records.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Facility</th><th>Status</th><th></th></tr></thead>
            <tbody>${users.map((u) => `<tr>
              <td>${esc(u.full_name)}${u.id === state.me.id ? ' <span class="muted">(you)</span>' : ""}</td><td>${esc(u.email)}</td>
              <td>${badge(u.role)}</td><td>${u.role === "admin" ? "All" : esc(facilityName(u.facility_id))}</td>
              <td>${badge(u.active ? "active" : "inactive")}</td>
              <td class="actions"><button class="link small" data-reset="${u.id}">Send password reset</button>
                <button class="link small" data-edit="${u.id}">Edit</button></td></tr>`).join("")}
            </tbody></table></div>
        </div>`;
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editUser(users.find((u) => u.id === b.dataset.edit)));
      $$("[data-reset]", view).forEach((b) => b.onclick = async () => {
        const u = users.find((x) => x.id === b.dataset.reset);
        const redirectTo = location.href.split("#")[0].replace(/[^/]*$/, "") + "index.html";
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
        <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin — everything</option></select></div>
      <div class="field" data-facfield><label>Facility *</label><select name="facility_id">${facilityOptions(u.facility_id)}</select></div>`;
  }
  function wireRole(form) {
    const sync = () => $("[data-facfield]", form).classList.toggle("hidden", $("[data-role]", form).value === "admin");
    $("[data-role]", form).addEventListener("input", sync); sync();
  }
  function genPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    const a = new Uint32Array(14); crypto.getRandomValues(a);
    return Array.from(a, (n) => chars[n % chars.length]).join("");
  }

  function addUser() {
    const pw = genPassword();
    const { form } = openModal({
      title: "Add user", submitText: "Create user",
      body: `
        <div class="grid2">
          <div class="field"><label>Full name *</label><input name="full_name" required></div>
          <div class="field"><label>Email *</label><input name="email" type="email" required></div>
          ${roleFields({ role: "manager", facility_id: state.facilities[0]?.id })}
        </div>
        <div class="field"><label>Temporary password *</label>
          <div style="display:flex;gap:.5rem"><input name="password" required minlength="8" value="${esc(pw)}">
          <button type="button" class="secondary" data-copy>Copy</button></div>
          <p class="muted" style="font-size:.85rem;margin:.3rem 0 0">Give this to the user privately. They can change it with “Forgot password?” on the sign-in page.</p></div>`,
      async onSubmit(d) {
        const body = { full_name: d.full_name.trim(), email: d.email.trim().toLowerCase(), password: d.password,
          role: d.role, facility_id: d.role === "admin" ? null : Number(d.facility_id) };
        const { data, error } = await sb.functions.invoke("create-user", { body });
        if (error) {
          let msg = error.message;
          try { const j = await error.context.json(); if (j.error) msg = j.error; } catch (_) { /* keep default */ }
          throw new Error(msg.includes("Failed to send") ? "Could not reach the create-user function. Has it been deployed? (see README step 4)" : msg);
        }
        if (data && data.error) throw new Error(data.error);
        toast(`User ${body.email} created`); route();
      }
    });
    wireRole(form);
    $("[data-copy]", form).onclick = () => { navigator.clipboard?.writeText($("input[name=password]", form).value); toast("Password copied"); };
  }

  function editUser(u) {
    const self = u.id === state.me.id;
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
            <td class="actions"><button class="link small" data-edit="${f.id}">Edit</button></td></tr>`).join("")}
          </tbody></table></div></div>`;
      $$("[data-edit]", view).forEach((b) => b.onclick = () => editFacility(state.facilities.find((f) => f.id === Number(b.dataset.edit))));
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

  // ============================================================== ROUTER
  let currentView = null;
  async function route() {
    let name = (location.hash || "#dashboard").slice(1);
    let v = views[name];
    if (!v || (v.adminOnly && !isAdmin())) { name = "dashboard"; v = views.dashboard; }
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
  window.addEventListener("hashchange", route);

  // ============================================================== BOOT
  (async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.replace("index.html"); return; }
    const { data: me } = await sb.from("profiles").select("*").eq("id", data.session.user.id).maybeSingle();
    if (!me || !me.active) { await sb.auth.signOut(); location.replace("index.html"); return; }
    state.me = me;
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.replace("index.html"); });
    await loadLookups();
    $("#meName").textContent = me.full_name;
    $("#meRole").textContent = me.role === "admin" ? "Administrator · all facilities" : `Manager · ${facilityName(me.facility_id)}`;
    if (!isAdmin()) $$(".admin-only").forEach((el) => el.classList.add("hidden"));
    if (!isAdmin()) views.employees.filters.facility = "";
    $("#shell").classList.remove("hidden");
    route();
  })().catch((ex) => {
    document.body.innerHTML = `<div class="alert error" style="margin:2rem">Train Well couldn't start: ${esc(ex.message)}</div>`;
  });
})();
