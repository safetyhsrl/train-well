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
  // All dates are shown as MM/DD/YY
  const pad2 = (n) => String(n).padStart(2, "0");
  const mdy = (v) => {
    if (!v) return "";
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split("-"); return `${m}/${d}/${y.slice(-2)}`; }
    const d = new Date(s);
    return isNaN(d) ? s : `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${String(d.getFullYear()).slice(-2)}`;
  };
  const fmtDate = (v) => (v ? mdy(v) : "—");
  const fmtDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v); let h = d.getHours(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${mdy(v)} ${h}:${pad2(d.getMinutes())} ${ap}`;
  };
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
  // =============================================================== DOWNLOADS
  // Every download can be Excel or PDF and contains exactly what the filters on screen show.
  // The libraries load only when someone downloads, so normal pages stay fast.
  const libCache = {};
  function loadScript(src) {
    if (!libCache[src]) libCache[src] = new Promise((resolve, reject) => {
      const sc = document.createElement("script"); sc.src = src;
      sc.onload = resolve;
      sc.onerror = () => { delete libCache[src]; reject(new Error("Could not load the download tools. Check your internet connection and try again.")); };
      document.head.appendChild(sc);
    });
    return libCache[src];
  }
  const loadExcelLib = () => loadScript("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js").then(() => window.ExcelJS);
  const loadPdfLib = async () => {
    await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js");
    return window.jspdf.jsPDF;
  };
  const STATUS_LABEL = { valid: "Up to date", expiring: "Due soon", expired: "Overdue", missing: "Missing" };
  const ST_FILL = { valid: "E2F4EA", expiring: "FDF1DC", expired: "FBE5E3", missing: "FDE9DF" };
  const ST_INK = { valid: "1F6B3A", expiring: "8A5208", expired: "A4271D", missing: "A6461C" };
  const hexRgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const safeName = (t) => String(t).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // spec = { file, title, subtitle, columns: [{ h, w, date, pdf }], rows: [[value | { v, date, st }]], note, freezeCols, totals }
  const cellOf = (c) => (c && typeof c === "object" && !Array.isArray(c) ? c : { v: c });
  const cellText = (c, col) => { const x = cellOf(c); if (x.v == null || x.v === "") return ""; return (x.date ?? col.date) && /^\d{4}-\d{2}-\d{2}/.test(String(x.v)) ? mdy(String(x.v).slice(0, 10)) : String(x.v); };

  async function exportExcel(spec) {
    const ExcelJS = await loadExcelLib();
    const wb = new ExcelJS.Workbook(); wb.creator = "Train Well";
    const ws = wb.addWorksheet(spec.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    const n = spec.columns.length;
    ws.addRow([spec.title]).font = { bold: true, size: 14, color: { argb: "FF01452A" } };
    ws.addRow([spec.subtitle || ""]).font = { italic: true, color: { argb: "FF5F6D6A" } };
    const head = ws.addRow(spec.columns.map((c) => c.h));
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF016738" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FF01452A" } } };
    });
    head.height = 30;
    for (const r of spec.rows) {
      const row = ws.addRow(r.map((c, i) => {
        const x = cellOf(c);
        if (x.v == null || x.v === "") return null;
        if ((x.date ?? spec.columns[i].date) && /^\d{4}-\d{2}-\d{2}/.test(String(x.v))) {
          const [y, m, d] = String(x.v).slice(0, 10).split("-").map(Number);
          return new Date(Date.UTC(y, m - 1, d));
        }
        return x.v;
      }));
      r.forEach((c, i) => {
        const x = cellOf(c), cell = row.getCell(i + 1);
        if (cell.value instanceof Date) cell.numFmt = "mm/dd/yy";
        if (x.st && ST_FILL[x.st]) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + ST_FILL[x.st] } }; cell.font = { color: { argb: "FF" + ST_INK[x.st] } }; }
        if (x.bold) cell.font = { ...(cell.font || {}), bold: true };
      });
    }
    spec.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || Math.max(12, String(c.h).length + 2); });
    ws.views = [{ state: "frozen", ySplit: 3, xSplit: spec.freezeCols || 0 }];
    const dataRows = spec.rows.length - (spec.totals || 0);
    if (dataRows > 0) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + dataRows, column: n } };
    if (spec.note) { ws.addRow([]); ws.addRow([spec.note]).font = { italic: true, color: { argb: "FF5F6D6A" } }; }
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${spec.file}.xlsx`);
  }

  async function exportPDF(spec) {
    const jsPDF = await loadPdfLib();
    const cols = spec.columns.map((c, i) => ({ ...c, i })).filter((c) => c.pdf !== false);
    const doc = new jsPDF({ orientation: cols.length > 5 ? "landscape" : "portrait", unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(1, 69, 42); doc.text(spec.title, 36, 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(95, 109, 106);
    doc.text(doc.splitTextToSize(spec.subtitle || "", W - 72), 36, 56);
    const fs = cols.length > 14 ? 6.5 : cols.length > 9 ? 7.5 : 9;
    doc.autoTable({
      startY: 70, margin: { left: 36, right: 36 },
      head: [cols.map((c) => c.h)],
      body: spec.rows.map((r) => cols.map((c) => cellText(r[c.i], c))),
      styles: { fontSize: fs, cellPadding: 3, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [1, 103, 56], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 249] },
      columnStyles: Object.fromEntries(cols.map((c, k) => [k, c.pdfW ? { cellWidth: c.pdfW } : {}])),
      didParseCell: (h) => {
        if (h.section !== "body") return;
        const x = cellOf(spec.rows[h.row.index][cols[h.column.index].i]);
        if (x.st && ST_FILL[x.st]) { h.cell.styles.fillColor = hexRgb(ST_FILL[x.st]); h.cell.styles.textColor = hexRgb(ST_INK[x.st]); }
        if (x.bold) h.cell.styles.fontStyle = "bold";
      },
      didDrawPage: () => {
        doc.setFontSize(8); doc.setTextColor(140);
        doc.text(`Train Well · exported ${mdy(todayISO())}`, 36, doc.internal.pageSize.getHeight() - 18);
        doc.text(`Page ${doc.internal.getNumberOfPages()}`, W - 36, doc.internal.pageSize.getHeight() - 18, { align: "right" });
      }
    });
    if (spec.note) {
      const y = Math.min(doc.lastAutoTable.finalY + 16, doc.internal.pageSize.getHeight() - 40);
      doc.setFontSize(8); doc.setTextColor(95, 109, 106); doc.text(doc.splitTextToSize(spec.note, W - 72), 36, y);
    }
    doc.save(`${spec.file}.pdf`);
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Ask "Excel or PDF?", then build the file from what's on screen right now
  function offerDownload(build, what = "this list") {
    const { form, close } = openModal({
      title: "Download", footer: "",
      body: `<p class="muted" style="margin-top:0">Download ${esc(what)}, exactly as filtered on screen.</p>
        <div class="dl-choices">
          <button type="button" class="dl-choice" data-fmt="xlsx"><strong>Excel</strong><span>.xlsx · sort and filter</span></button>
          <button type="button" class="dl-choice" data-fmt="pdf"><strong>PDF</strong><span>ready to print or email</span></button>
        </div>`
    });
    $$("[data-fmt]", form).forEach((b) => b.onclick = async () => {
      $$("[data-fmt]", form).forEach((x) => (x.disabled = true)); b.classList.add("is-busy");
      try {
        const spec = await build();
        if (!spec.rows.length) throw new Error("There's nothing to download with the current filters.");
        await (b.dataset.fmt === "pdf" ? exportPDF(spec) : exportExcel(spec));
        close(); toast(b.dataset.fmt === "pdf" ? "PDF downloaded" : "Excel file downloaded");
      } catch (ex) { close(); toast(ex.message, true); }
    });
  }
  const filterLine = (parts) => parts.filter(Boolean).join(" · ") + ` · exported ${mdy(todayISO())}`;

  // Training matrix: one row per employee, one column per course (expiry date, coloured by status)
  async function trainingMatrixSpec(f) {
    const facId = f.facility ? Number(f.facility) : (isAdmin() ? null : state.me.facility_id);
    const q = (f.q || "").toLowerCase();
    let employees = (await loadEmployees({ activeOnly: true })).filter((e) => (!facId || e.facility_id === facId)
      && (!q || `${e.first_name} ${e.last_name} ${e.employee_no || ""}`.toLowerCase().includes(q)));
    const status = await fetchAll(() => sb.from("training_status").select("*"));
    const map = new Map(status.map((s) => [`${s.employee_id}:${s.course_id}`, s]));
    const courses = f.course ? state.courses.filter((c) => String(c.id) === String(f.course)) : state.courses.filter((c) => c.active);
    const one = courses.length === 1 ? courses[0] : null;
    const cell = (e, c) => {
      const s = map.get(`${e.id}:${c.id}`);
      if (!s) return c.mandatory || one ? { v: "Missing", st: "missing" } : { v: "" };
      const st = expiryStatus(s.expires_on);
      return s.expires_on ? { v: s.expires_on, date: true, st } : { v: "No expiry", st };
    };
    if (f.status) employees = employees.filter((e) => courses.some((c) => cell(e, c).st === f.status));
    employees.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

    const columns = [{ h: "Employee", w: 26, pdfW: 110 }, { h: "Home", w: 24 }, { h: "Job title", w: 18, pdf: !one ? false : true }];
    if (one) columns.push({ h: "Completed", w: 13, date: true }, { h: "Expires", w: 13, date: true }, { h: "Status", w: 13 });
    else courses.forEach((c) => columns.push({ h: c.title + (c.mandatory ? "" : " (optional)"), w: Math.min(22, Math.max(13, c.title.length + 2)), date: true }));

    const rows = employees.map((e) => {
      const base = [{ v: `${e.last_name}, ${e.first_name}`, bold: true }, facilityName(e.facility_id), e.job_title || ""];
      if (one) {
        const s = map.get(`${e.id}:${one.id}`), x = cell(e, one);
        return [...base, s?.completed_on ? { v: s.completed_on, date: true } : "", s?.expires_on ? { v: s.expires_on, date: true, st: x.st } : "", { v: STATUS_LABEL[x.st] || "", st: x.st }];
      }
      return [...base, ...courses.map((c) => cell(e, c))];
    });
    let totals = 0;
    if (!one && employees.length) {
      rows.push(columns.map(() => ""));
      for (const st of ["valid", "expiring", "expired", "missing"]) {
        rows.push([{ v: `Total: ${STATUS_LABEL[st]}`, bold: true }, "", "", ...courses.map((c) => ({ v: employees.filter((e) => cell(e, c).st === st).length, st }))]);
      }
      totals = 5;
    }
    const title = one ? `Training: ${one.title}` : "Training matrix";
    return {
      file: `TrainWell-${one ? safeName(one.title) : "training"}${facId ? "-" + safeName(facilityName(facId)) : ""}-${todayISO()}`,
      title, freezeCols: 1, totals, columns, rows,
      subtitle: filterLine([facId ? facilityName(facId) : "All homes", one ? one.title : `${courses.length} courses`,
        f.status ? `Status: ${STATUS_LABEL[f.status]}` : "", f.q ? `Search: "${f.q}"` : "", `${employees.length} employees`]),
      note: one ? "Colours: green up to date · amber due within " + WARN_DAYS + " days · red overdue · orange never done."
        : "Each course column shows the expiry date. Colours: green up to date · amber due within " + WARN_DAYS + " days · red overdue · orange never done. \"No expiry\" = completed, never expires."
    };
  }

  async function drillsSpec(drills, f) {
    const ids = drills.map((d) => d.id), parts = [];
    for (let i = 0; i < ids.length; i += 200)
      parts.push(...check(await sb.from("fire_drill_participants").select("drill_id, name").in("drill_id", ids.slice(i, i + 200))));
    const columns = [{ h: "Date", w: 12, date: true }, { h: "Home", w: 26 }, { h: "Type of event", w: 20 }, { h: "Activities", w: 30, pdf: false },
      { h: "Start", w: 8 }, { h: "End", w: 8 }, { h: "Total (min)", w: 10 },
      ...DRILL_QUESTIONS.map((q) => ({ h: q[1], w: 16, pdf: false })), { h: "Issues", w: 8 }, { h: "Problems / actions for improvement", w: 40, pdfW: 150 },
      { h: "Coordinator", w: 20 }, { h: "Observer", w: 20, pdf: false }, { h: "Observer date", w: 12, date: true, pdf: false }, { h: "Participants", w: 12 }, { h: "Participant names", w: 60, pdf: false }];
    const rows = drills.map((d) => {
      const names = parts.filter((p) => p.drill_id === d.id).map((p) => p.name).sort();
      const n = drillIssues(d);
      return [d.drill_date, facilityName(d.facility_id), DRILL_TYPE[d.event_type] || "", DRILL_ACTIVITY[d.activity] || "",
        hhmm(d.start_time), hhmm(d.end_time), drillMinutes(d) ?? "", ...DRILL_QUESTIONS.map(([k]) => ANSWER[d[k]] || ""),
        { v: n, st: n ? "expired" : "valid" }, d.problems || "", d.coordinator || "", d.observer_name || "", d.observer_date || "", names.length, names.join(", ")];
    });
    return { file: `TrainWell-fire-drills${f.facility ? "-" + safeName(facilityName(Number(f.facility))) : ""}${f.year ? "-" + f.year : ""}-${todayISO()}`,
      title: "Fire drill reports", columns, rows,
      subtitle: filterLine([f.facility ? facilityName(Number(f.facility)) : (isAdmin() ? "All homes" : facilityName(state.me.facility_id)), f.year ? `Year ${f.year}` : "All years", `${rows.length} reports`]) };
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
      const sched = drillErr ? [] : await loadSchedule();
      const drillByFac = drillErr ? [] : state.facilities
        .filter((f) => isAdmin() || f.id === state.me.facility_id)
        .map((f) => {
          const ds = drillRows.filter((x) => x.facility_id === f.id);
          const last = ds[0];
          return { f, last, next: sched.find((x) => x.facility_id === f.id), year: ds.filter((x) => x.drill_date.startsWith(thisYear)).length,
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
          <a class="stat stat-link" href="#employees" data-pre="employees:status:active"><div class="label">Active employees</div><div class="value">${employees.length}</div><span class="stat-go">View employees</span></a>
          <a class="stat stat-link ${pct >= 90 ? "ok" : pct >= 75 ? "warn" : "bad"}" href="#compliance" data-pre="compliance:status:"><div class="label">Mandatory training compliance</div><div class="value">${pct}%</div><span class="stat-go">See charts</span></a>
          <a class="stat stat-link warn" href="#compliance" data-pre="compliance:status:expiring"><div class="label">Expiring in ${WARN_DAYS} days</div><div class="value">${count("expiring")}</div><span class="stat-go">See who</span></a>
          <a class="stat stat-link bad" href="#compliance" data-pre="compliance:status:expired"><div class="label">Expired</div><div class="value">${count("expired")}</div><span class="stat-go">See who</span></a>
          <a class="stat stat-link bad" href="#compliance" data-pre="compliance:status:missing"><div class="label">Never completed</div><div class="value">${count("missing")}</div><span class="stat-go">See who</span></a>
        </div>

        <div class="card">
          <div class="card-head"><h2>Compliance by facility</h2><a href="#compliance" data-pre="compliance:status:">Open compliance charts →</a></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Facility</th><th>Employees</th><th style="width:40%">Compliance</th><th>Expired</th><th>Missing</th></tr></thead>
            <tbody>${byFac.map((r) => `
              <tr class="row-link" tabindex="0" data-go="#compliance" data-pre="compliance:facility:${r.f.id}" title="See compliance for ${esc(r.f.name)}"><td><strong>${esc(r.f.name)}</strong></td><td>${r.n}</td>
                <td><div style="display:flex;gap:.6rem;align-items:center"><div class="bar" style="flex:1"><span style="width:${r.pct}%;background:${r.pct >= 90 ? "var(--ok)" : r.pct >= 75 ? "var(--accent)" : "var(--bad)"}"></span></div><strong>${r.pct}%</strong></div></td>
                <td>${r.expired}</td><td>${r.missing}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No facilities yet.</td></tr>`}
            </tbody></table></div>
        </div>

        ${drillErr ? "" : `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
            <h2 style="margin:0">Fire drills</h2><a href="#drills" data-pre="drills:facility:">Open Fire Drill →</a></div>
          <div class="table-wrap" style="margin-top:.6rem"><table>
            <thead><tr><th>Home</th><th>Last drill</th><th>Days since</th><th>Last outcome</th><th>Drills in ${thisYear}</th><th>Next drill</th></tr></thead>
            <tbody>${drillByFac.map((r) => `
              <tr class="row-link" tabindex="0" data-go="#drills" data-pre="drills:facility:${isAdmin() ? r.f.id : ""}" title="Open fire drills for ${esc(r.f.name)}"><td><strong>${esc(r.f.name)}</strong></td>
                <td>${r.last ? fmtDate(r.last.drill_date) + (r.last.event_type === "alarm" ? " (alarm)" : "") : badge("missing", "None recorded")}</td>
                <td>${r.days == null ? "—" : r.days}</td>
                <td>${r.last ? (drillIssues(r.last) ? badge("expired", drillIssues(r.last) + (drillIssues(r.last) > 1 ? " issues" : " issue")) : badge("valid", "No issues")) : "—"}</td>
                <td>${r.year}</td>
                <td>${r.next ? `${fmtDate(r.next.scheduled_date)} ${whenBadge(r.next.scheduled_date)}` : badge("neutral", "Not scheduled")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No facilities yet.</td></tr>`}
            </tbody></table></div>
        </div>`}

        <div class="cols">
          <div class="card">
            <div class="card-head"><h2>Needs attention</h2><a href="#compliance" data-pre="compliance:status:">See all →</a></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Employee</th><th>Course</th><th>Status</th><th>Expires</th></tr></thead>
              <tbody>${attention.map((i) => `
                <tr class="row-link" tabindex="0" data-open-emp="${i.employee.id}"><td><button class="link" data-emp="${i.employee.id}">${esc(fullName(i.employee))}</button></td>
                  <td>${esc(i.course.title)}</td><td>${badge(i.status)}</td><td>${fmtDate(i.expires_on)}</td></tr>`).join("")
                || `<tr><td colspan="4" class="empty">Everyone is up to date. 🎉</td></tr>`}
              </tbody></table></div>
            ${attention.length ? `<p style="margin:.8rem 0 0"><a href="#compliance" data-pre="compliance:status:">See everyone who needs action →</a></p>` : ""}
          </div>
          <div class="card">
            <div class="card-head"><h2>Upcoming sessions</h2><a href="#sessions" data-pre="sessions:when:upcoming">Open Sessions & attendance →</a></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Date</th><th>Course</th><th>Facility</th><th>Booked</th></tr></thead>
              <tbody>${upcoming.map((s) => `
                <tr class="row-link" tabindex="0" data-go="#sessions/${s.id}" data-pre="sessions:when:upcoming" title="Open attendance for this session"><td>${fmtDateTime(s.starts_at)}</td><td>${esc(courseTitle(s.course_id))}</td>
                  <td>${esc(facilityName(s.facility_id))}</td>
                  <td>${s.attendance[0]?.count ?? 0}${s.capacity ? " / " + s.capacity : ""}</td></tr>`).join("")
                || `<tr><td colspan="4" class="empty">No sessions scheduled. <a href="#sessions">Schedule one</a></td></tr>`}
              </tbody></table></div>
          </div>
        </div>`;
      $$("[data-emp]", view).forEach((b) => b.onclick = (e) => { e.stopPropagation(); showEmployee(Number(b.dataset.emp)); });
      wireLinks(view);
    }
  };

  // -------------------------------------------------------- employees
  views.employees = {
    title: "Employees",
    filters: { q: "", facility: "", status: "active" },
    actions() {
      return `<button class="secondary" data-act="import">Import CSV</button>
              <button class="secondary" data-act="export">Download</button>
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

      let shownEmps = all;
      const draw = () => {
        const q = f.q.toLowerCase();
        const rows = all.filter((e) =>
          (!f.facility || String(e.facility_id) === f.facility) &&
          (!f.status || e.status === f.status) &&
          (!q || [e.employee_no, e.first_name, e.last_name, e.job_title, e.department, e.email]
            .some((v) => String(v || "").toLowerCase().includes(q))));
        $("[data-count]", view).textContent = `${rows.length} of ${all.length}`; shownEmps = rows;
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
        if (act === "export") offerDownload(async () => ({
          file: `TrainWell-employees${f.facility ? "-" + safeName(facilityName(Number(f.facility))) : ""}-${todayISO()}`, title: "Employees",
          subtitle: filterLine([f.facility ? facilityName(Number(f.facility)) : (isAdmin() ? "All homes" : facilityName(state.me.facility_id)),
            f.status ? (f.status === "active" ? "Active" : "Inactive") : "All statuses", f.q ? `Search: "${f.q}"` : "", `${shownEmps.length} employees`]),
          columns: [{ h: "Last name", w: 16 }, { h: "First name", w: 16 }, { h: "Job title", w: 20 }, { h: "Department", w: 18 }, { h: "Home", w: 24 },
            { h: "Email", w: 28 }, { h: "Phone", w: 15 }, { h: "Hire date", w: 12, date: true }, { h: "Status", w: 10 }],
          rows: shownEmps.map((e) => [e.last_name, e.first_name, e.job_title || "", e.department || "", facilityName(e.facility_id),
            e.email || "", e.phone || "", e.hire_date || "", { v: e.status === "active" ? "Active" : "Inactive", st: e.status === "active" ? "valid" : "expired" }])
        }), "the employees list");
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
      return `<button class="secondary" data-act="excel">Download</button>
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
        if (act === "excel") offerDownload(() => trainingMatrixSpec(f), f.course ? `the ${courseTitle(Number(f.course))} records` : "the training matrix (one column per course)");
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
      if (this.arg) {
        const sid = Number(this.arg); this.arg = undefined;
        history.replaceState(null, "", "#sessions");
        const one = sessions.find((s) => s.id === sid) || (await sb.from("sessions").select("*").eq("id", sid).maybeSingle()).data;
        if (one) manageAttendance(one);
      }
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
    `<div class="card"><h2>Fire Drill isn't set up yet</h2>
      <p>An administrator needs to run <code>supabase/update-2026-10-fire-drills.sql</code> once in the Supabase SQL Editor (see README).</p>
      <p class="muted" style="font-size:.85rem">${esc(error.message)}</p></div>`;

  async function loadDrill(id) {
    return check(await sb.from("fire_drills").select("*, fire_drill_participants(*)").eq("id", id).single());
  }

  views.drills = {
    title: "Fire Drill",
    filters: { facility: "", year: "" },
    actions() {
      return `<button class="secondary" data-act="excel">Download</button>
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
        this.onAction = () => toast("Fire Drill isn't set up yet. See the message on the page.", true);
        return;
      }
      const years = [...new Set(data.map((d) => d.drill_date.slice(0, 4)))].sort().reverse();
      const drills = data.filter((d) => !f.year || d.drill_date.startsWith(f.year));
      const sched = (await loadSchedule()).filter((x) => !f.facility || String(x.facility_id) === f.facility);
      view.innerHTML = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:.6rem">
            <h2 style="margin:0">Upcoming fire drills</h2>
            <button class="secondary small" data-sched-add>+ Schedule drill</button></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Home</th><th>Time</th><th>Planned activity</th><th>Coordinator</th><th>Notes</th><th></th></tr></thead>
            <tbody>${sched.map((x) => `<tr>
              <td><strong>${fmtDate(x.scheduled_date)}</strong><br><span style="display:inline-block;margin-top:.25rem">${whenBadge(x.scheduled_date)}</span></td>
              <td>${esc(facilityName(x.facility_id))}</td>
              <td>${hhmm(x.scheduled_time) || "—"}</td>
              <td style="white-space:normal;min-width:10rem">${x.activity ? esc(DRILL_ACTIVITY_SHORT[x.activity]) : "—"}</td>
              <td>${esc(x.coordinator || "—")}</td>
              <td style="white-space:normal;min-width:8rem">${esc(x.notes || "—")}</td>
              <td class="actions"><button class="small" data-sched-rec="${x.id}">Record drill</button>
                <button class="link small" data-sched-edit="${x.id}">Edit</button>
                <button class="link small" data-sched-del="${x.id}" style="color:var(--bad)">Delete</button></td></tr>`).join("")
              || `<tr><td colspan="7" class="empty">No fire drills scheduled. Click <strong>Schedule drill</strong> to plan the next one.</td></tr>`}
            </tbody></table></div>
        </div>
        <div class="card">
          <h2>Fire drill reports</h2>
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
      $("[data-sched-add]", view).onclick = () => editSchedule(null);
      $$("[data-sched-edit]", view).forEach((b) => b.onclick = () => editSchedule(sched.find((x) => x.id === Number(b.dataset.schedEdit))));
      $$("[data-sched-rec]", view).forEach((b) => b.onclick = () => editDrill(null, { schedule: sched.find((x) => x.id === Number(b.dataset.schedRec)) }));
      $$("[data-sched-del]", view).forEach((b) => b.onclick = async () => {
        const x = sched.find((y) => y.id === Number(b.dataset.schedDel));
        if (!(await confirmBox(`Remove the fire drill scheduled for ${facilityName(x.facility_id)} on ${fmtDate(x.scheduled_date)}?`, { okText: "Remove" }))) return;
        try { check(await sb.from("fire_drill_schedule").delete().eq("id", x.id)); toast("Scheduled drill removed"); route(); }
        catch (ex) { toast(ex.message, true); }
      });
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
        if (act === "excel") offerDownload(() => drillsSpec(drills, f), "the fire drill reports");
      };
    }
  };

  // ---- Scheduled fire drills (not yet recorded), soonest first
  const DRILL_ACTIVITY_SHORT = { staff_only: "Staff only", full: "Full drill (residents and staff)", info_session: "Information session" };
  async function loadSchedule() {
    const { data, error } = await sb.from("fire_drill_schedule").select("*").is("drill_id", null).order("scheduled_date").order("scheduled_time", { nullsFirst: false });
    return error ? [] : data;
  }
  function whenBadge(date) {
    const days = Math.round((new Date(date + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000);
    if (days < 0) return badge("expired", `Overdue by ${-days} day${days === -1 ? "" : "s"}`);
    if (days === 0) return badge("expiring", "Today");
    if (days <= 7) return badge("expiring", days === 1 ? "Tomorrow" : `In ${days} days`);
    return badge("neutral", `In ${days} days`);
  }
  function editSchedule(x) {
    const isNew = !x;
    x = x || { facility_id: state.me.facility_id || state.facilities[0]?.id };
    const radio = (value, label) =>
      `<label class="choice"><input type="radio" name="activity" value="${value}" ${x.activity === value ? "checked" : ""}> ${esc(label)}</label>`;
    openModal({
      title: isNew ? "Schedule a fire drill" : "Edit scheduled drill", submitText: isNew ? "Schedule drill" : "Save",
      body: `
        <div class="grid2">
          <div class="field"><label>Home *</label>
            <select name="facility_id" required ${isAdmin() ? "" : "disabled"}>${facilityOptions(x.facility_id)}</select></div>
          <div class="field"><label>Date *</label><input type="date" name="scheduled_date" required value="${esc(x.scheduled_date)}" ${isNew ? `min="${todayISO()}"` : ""}></div>
          <div class="field"><label>Time</label><input type="time" name="scheduled_time" value="${hhmm(x.scheduled_time)}"></div>
          <div class="field"><label>Coordinator</label><input name="coordinator" value="${esc(x.coordinator)}"></div>
        </div>
        <div class="field"><label>Planned activity</label>
          <div class="choices stacked">${Object.entries(DRILL_ACTIVITY).map(([k, v]) => radio(k, v)).join("")}</div></div>
        <div class="field"><label>Notes</label><textarea name="notes" rows="2" placeholder="e.g. night shift drill, test new pull station">${esc(x.notes)}</textarea></div>`,
      async onSubmit(v) {
        const row = { facility_id: Number(isAdmin() ? v.facility_id : (x.facility_id || state.me.facility_id)), scheduled_date: v.scheduled_date,
          scheduled_time: nn(v.scheduled_time), activity: nn(v.activity), coordinator: nn(v.coordinator), notes: nn(v.notes) };
        const res = isNew ? await sb.from("fire_drill_schedule").insert({ ...row, created_by: state.me.id })
          : await sb.from("fire_drill_schedule").update(row).eq("id", x.id);
        if (res.error && /fire_drill_schedule|relation|schema cache/i.test(res.error.message))
          throw new Error("Scheduling isn't set up yet. An administrator needs to run the drill-schedule update in Supabase (see README).");
        check(res);
        toast(isNew ? `Fire drill scheduled for ${fmtDate(row.scheduled_date)}` : "Scheduled drill saved"); route();
      }
    });
  }

  async function editDrill(id, { schedule = null } = {}) {
    let d = { facility_id: state.me.facility_id || state.facilities[0]?.id, drill_date: todayISO(), event_type: "drill", fire_drill_participants: [] };
    if (schedule) Object.assign(d, { facility_id: schedule.facility_id, start_time: schedule.scheduled_time, activity: schedule.activity,
      coordinator: schedule.coordinator, drill_date: schedule.scheduled_date <= todayISO() ? schedule.scheduled_date : todayISO() });
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
      title: schedule ? `Record scheduled drill · ${facilityName(schedule.facility_id)}` : isNew ? "Record fire drill" : "Edit fire drill report", wide: true, submitText: "Save report",
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
        if (schedule) await sb.from("fire_drill_schedule").update({ drill_id: drillId }).eq("id", schedule.id);
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
    const ymd = (v) => mdy(v);
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
      <div class="line">Date of Drill (MM/DD/YY): <span class="val">${ymd(d.drill_date)}</span></div>
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
      <div class="line">Signature of observer: <span class="val"></span> Date (MM/DD/YY): <span class="val sm">${ymd(d.observer_date)}</span></div>
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

  // -------------------------------------------------------- courses
  views.courses = {
    title: "Courses",
    actions() { return isAdmin() ? `<button data-act="add">+ Add course</button>` : ""; },
    async render(view) {
      await loadLookups();
      const content = await courseContentCounts();
      view.innerHTML = `
        <div class="card">
          <p class="muted" style="margin-top:0">${isAdmin() ? "Click a course to add its materials (links, PDFs, videos, PowerPoints) and its quiz." : "Courses are managed by your administrator. Click a course to see its materials and quiz results."}</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Title</th><th>Online course</th><th>Category</th><th>Hours</th><th>Valid for</th><th>Mandatory</th><th>Status</th><th></th></tr></thead>
            <tbody>${state.courses.map((c) => `<tr>
              <td><a href="#course/${c.id}"><strong>${esc(c.title)}</strong></a></td>
              <td>${contentLabel(content.get(c.id))}</td><td>${esc(c.category || "—")}</td>
              <td>${c.duration_hours ?? "—"}</td><td>${c.validity_months ? c.validity_months + " months" : "No expiry"}</td>
              <td>${c.mandatory ? badge("admin", "Mandatory") : badge("neutral", "Optional")}</td>
              <td>${badge(c.active ? "active" : "inactive")}</td>
              <td class="actions"><a class="small" href="#course/${c.id}" style="margin-right:.5rem">Open</a>${isAdmin() ? `<button class="link small" data-edit="${c.id}">Edit</button> ${delBtn(c.id)}` : ""}</td></tr>`).join("")
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
          const files = ((await sb.from("course_materials").select("file_path").eq("course_id", c.id)).data || []).map((m) => m.file_path).filter(Boolean);
          check(await sb.from("courses").delete().eq("id", c.id));
          if (files.length) await sb.storage.from(MAT_BUCKET).remove(files);
          toast("Course deleted"); route();
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
          <div class="field"><label>Category</label><input name="category" value="${esc(c.category)}" placeholder="Safety, Onboarding…"></div>
          <div class="field"><label>Duration (hours)</label><input type="number" step="0.25" min="0" name="duration_hours" value="${esc(c.duration_hours)}"></div>
          <div class="field"><label>Valid for (months) <span class="muted">blank = never expires</span></label><input type="number" min="1" name="validity_months" value="${esc(c.validity_months)}"></div>
          <div class="field"><label>Quiz pass mark (%)</label><input type="number" min="1" max="100" name="pass_mark" value="${esc(c.pass_mark ?? 80)}"></div>
        </div>
        <div class="field"><label>Description</label><textarea name="description" rows="2">${esc(c.description)}</textarea></div>
        <div class="field"><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="mandatory" ${c.mandatory ? "checked" : ""}> Mandatory for all active employees</label></div>
        <div class="field"><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> Active</label></div>`,
      async onSubmit(d) {
        const row = { title: d.title.trim(), category: nn(d.category), duration_hours: nn(d.duration_hours),
          validity_months: nn(d.validity_months), description: nn(d.description), mandatory: !!d.mandatory, active: !!d.active };
        if (d.pass_mark) row.pass_mark = Math.min(100, Math.max(1, Number(d.pass_mark)));
        if (isNew) check(await sb.from("courses").insert(row));
        else check(await sb.from("courses").update(row).eq("id", c.id));
        toast(isNew ? "Course added" : "Course saved"); route();
      }
    });
  }

  // =============================================================== ONLINE COURSES
  // Materials live in the private "course-materials" bucket as  <course id>/<time>-<file>
  const MAT_BUCKET = "course-materials";
  const MAT_MAX = 50 * 1024 * 1024;
  const MAT_KIND = { link: "Link", pdf: "PDF", video: "Video", ppt: "PowerPoint", file: "File" };
  const MAT_ACCEPT = { pdf: "application/pdf,.pdf", video: "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov",
    ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    file: ".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" };
  const MIME_BY_EXT = { pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
  const kindBadge = (k) => `<span class="kind kind-${esc(k)}">${esc(MAT_KIND[k] || k)}</span>`;

  async function courseContentCounts() {
    const [{ data: mats }, { data: qs }] = await Promise.all([
      sb.from("course_materials").select("id, course_id"), sb.rpc("quiz_counts")]);
    const out = new Map();
    const get = (id) => out.get(id) || out.set(id, { materials: 0, questions: 0 }).get(id);
    (mats || []).forEach((m) => get(m.course_id).materials++);
    (qs || []).forEach((q) => { get(q.course_id).questions = q.questions; });
    return out;
  }
  const contentLabel = (c) => !c || (!c.materials && !c.questions) ? `<span class="muted">—</span>`
    : [c.materials ? `${c.materials} item${c.materials > 1 ? "s" : ""}` : "", c.questions ? `${c.questions}-question quiz` : ""].filter(Boolean).join(" · ");

  async function loadMaterials(courseId) {
    return check(await sb.from("course_materials").select("*").eq("course_id", courseId).order("sort").order("id"));
  }
  async function materialUrl(m) {
    if (!m.file_path) return m.url;
    const { data, error } = await sb.storage.from(MAT_BUCKET).createSignedUrl(m.file_path, 3600);
    if (error || !data) throw new Error(error ? error.message : "Could not open the file.");
    return data.signedUrl;
  }
  function videoEmbed(url) {
    let m = String(url || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
    m = String(url || "").match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return null;
  }
  const safeUrl = (u) => /^https?:\/\//i.test(String(u || "").trim());

  // ---- Course page (managers and admins)
  views.course = {
    title: "Course", navAs: "courses",
    actions() {
      return `<a class="btn secondary" href="#courses">← All courses</a>
              <button class="secondary" data-act="preview">Preview as staff</button>
              ${isAdmin() ? `<button data-act="edit">Edit course</button>` : ""}`;
    },
    async render(view) {
      const id = Number(this.arg);
      await loadLookups();
      const c = state.courses.find((x) => x.id === id);
      if (!c) { view.innerHTML = `<div class="card empty">That course doesn't exist any more. <a href="#courses">Back to courses</a></div>`; this.onAction = () => goTo("#courses"); return; }
      $("#pageTitle").textContent = c.title; document.title = `${c.title} · Train Well`;
      const [mats, qsRes, attRes] = await Promise.all([
        loadMaterials(id),
        sb.from("quiz_questions").select("*").eq("course_id", id).order("sort").order("id"),
        sb.from("quiz_attempts").select("*, employees(first_name, last_name, facility_id)").eq("course_id", id).order("created_at", { ascending: false })]);
      if (qsRes.error && /quiz_questions|relation|schema cache/i.test(qsRes.error.message)) {
        view.innerHTML = `<div class="card"><h2>Online courses aren't set up yet</h2><p>An administrator needs to run <code>supabase/update-2026-10-online-courses.sql</code> once in the Supabase SQL Editor.</p></div>`;
        return;
      }
      const qs = qsRes.data || [], atts = attRes.data || [];
      const people = new Set(atts.map((a) => a.employee_id)), passedPeople = new Set(atts.filter((a) => a.passed).map((a) => a.employee_id));
      const admin = isAdmin();
      view.innerHTML = `
        <div class="card">
          <p style="margin:0 0 .6rem">${esc(c.description || "No description yet.")}</p>
          <div class="course-facts">
            ${c.mandatory ? badge("admin", "Mandatory") : badge("neutral", "Optional")}
            <span>${c.validity_months ? `Valid for ${c.validity_months} months` : "Never expires"}</span>
            <span>Pass mark ${c.pass_mark ?? 80}%</span>
            ${c.duration_hours ? `<span>${c.duration_hours} h</span>` : ""}
            ${c.active ? "" : badge("inactive", "Inactive (hidden from staff)")}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Course content</h2>${admin ? `<button class="small" data-addmat>+ Add material</button>` : ""}</div>
          <p class="muted" style="margin-top:0">Staff go through these in order. The quiz opens once they have opened every item.</p>
          <ol class="mat-list">${mats.map((m, i) => `
            <li>
              <span class="mat-num">${i + 1}</span>
              <span class="mat-main">${kindBadge(m.kind)} <strong>${esc(m.title)}</strong>
                <span class="muted mat-src">${m.file_path ? "Uploaded file" : esc(m.url)}</span></span>
              <span class="mat-actions">
                <button class="link small" data-openmat="${m.id}">Open</button>
                ${admin ? `<button class="link small" data-up="${m.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                <button class="link small" data-down="${m.id}" ${i === mats.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                <button class="link small" data-editmat="${m.id}">Edit</button>
                <button class="link small" data-delmat="${m.id}" style="color:var(--bad)">Delete</button>` : ""}
              </span>
            </li>`).join("") || `<li class="empty-li">No materials yet.${admin ? " Add a link, PDF, video or PowerPoint." : ""}</li>`}
          </ol>
        </div>

        <div class="card">
          <div class="card-head"><h2>Quiz</h2>${admin ? `<button class="small" data-addq>+ Add question</button>` : ""}</div>
          <p class="muted" style="margin-top:0">${qs.length ? `${qs.length} question${qs.length > 1 ? "s" : ""}. Staff need ${c.pass_mark ?? 80}% to pass. A pass records this training on their record straight away.` : "No quiz yet. Without a quiz, staff can view the materials but the course isn't recorded as completed."}</p>
          <ol class="q-list">${qs.map((q, i) => `
            <li>
              <div class="q-head"><strong>${i + 1}. ${esc(q.question)}</strong>
                ${admin ? `<span class="mat-actions"><button class="link small" data-qup="${q.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                  <button class="link small" data-qdown="${q.id}" ${i === qs.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                  <button class="link small" data-editq="${q.id}">Edit</button>
                  <button class="link small" data-delq="${q.id}" style="color:var(--bad)">Delete</button></span>` : ""}</div>
              <ul class="q-opts">${q.options.map((o, j) => `<li class="${j === q.correct ? "is-right" : ""}">${esc(o)}${j === q.correct ? ' <span class="muted">(correct)</span>' : ""}</li>`).join("")}</ul>
            </li>`).join("")}
          </ol>
        </div>

        <div class="card">
          <div class="card-head"><h2>Results</h2>${atts.length ? `<button class="secondary small" data-xls>Download</button>` : ""}</div>
          <p class="muted" style="margin-top:0">${atts.length ? `${passedPeople.size} of ${people.size} staff who took the quiz have passed · ${atts.length} attempt${atts.length > 1 ? "s" : ""} in total` : "No one has taken this quiz yet."}</p>
          ${atts.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Employee</th><th>Home</th><th>Score</th><th>Result</th></tr></thead>
            <tbody>${atts.map((a) => `<tr><td>${fmtDateTime(a.created_at)}</td>
              <td><button class="link" data-emp="${a.employee_id}">${esc(fullName(a.employees))}</button></td>
              <td>${esc(facilityName(a.employees?.facility_id))}</td>
              <td><strong>${Number(a.score)}%</strong> <span class="muted">(${a.correct}/${a.total})</span></td>
              <td>${a.passed ? badge("valid", "Passed") : badge("expired", "Not passed")}</td></tr>`).join("")}
            </tbody></table></div>` : ""}
        </div>`;

      const reload = () => route();
      $$("[data-openmat]", view).forEach((b) => b.onclick = async () => {
        const m = mats.find((x) => x.id === Number(b.dataset.openmat));
        const w = window.open("", "_blank");
        try { const u = await materialUrl(m); if (w) w.location.href = u; else location.href = u; }
        catch (ex) { if (w) w.close(); toast(ex.message, true); }
      });
      $$("[data-emp]", view).forEach((b) => b.onclick = () => showEmployee(Number(b.dataset.emp)));
      $("[data-xls]", view)?.addEventListener("click", () => offerDownload(async () => ({
        file: `TrainWell-${safeName(c.title)}-quiz-results-${todayISO()}`, title: `Quiz results: ${c.title}`,
        subtitle: filterLine([`Pass mark ${c.pass_mark ?? 80}%`, `${atts.length} attempts`]),
        columns: [{ h: "Date", w: 12, date: true }, { h: "Employee", w: 26 }, { h: "Home", w: 24 }, { h: "Score %", w: 9 }, { h: "Correct", w: 9 }, { h: "Questions", w: 10 }, { h: "Result", w: 12 }],
        rows: atts.map((a) => [{ v: a.created_at, date: true }, fullName(a.employees), facilityName(a.employees?.facility_id), Number(a.score), a.correct, a.total,
          { v: a.passed ? "Passed" : "Not passed", st: a.passed ? "valid" : "expired" }])
      }), "these quiz results"));
      if (admin) {
        $("[data-addmat]", view).onclick = () => editMaterial(c, null, mats);
        $$("[data-editmat]", view).forEach((b) => b.onclick = () => editMaterial(c, mats.find((x) => x.id === Number(b.dataset.editmat)), mats));
        $$("[data-delmat]", view).forEach((b) => b.onclick = async () => {
          const m = mats.find((x) => x.id === Number(b.dataset.delmat));
          if (!(await confirmBox(`Delete "${m.title}" from this course?`))) return;
          try { check(await sb.from("course_materials").delete().eq("id", m.id)); if (m.file_path) await sb.storage.from(MAT_BUCKET).remove([m.file_path]); toast("Material deleted"); reload(); }
          catch (ex) { toast(ex.message, true); }
        });
        const move = async (list, table, idv, dir) => {
          const i = list.findIndex((x) => x.id === idv), j = i + dir;
          if (i < 0 || j < 0 || j >= list.length) return;
          const order = list.map((x) => x.id); [order[i], order[j]] = [order[j], order[i]];
          try { for (let k = 0; k < order.length; k++) check(await sb.from(table).update({ sort: k + 1 }).eq("id", order[k])); reload(); }
          catch (ex) { toast(ex.message, true); }
        };
        $$("[data-up]", view).forEach((b) => b.onclick = () => move(mats, "course_materials", Number(b.dataset.up), -1));
        $$("[data-down]", view).forEach((b) => b.onclick = () => move(mats, "course_materials", Number(b.dataset.down), 1));
        $$("[data-qup]", view).forEach((b) => b.onclick = () => move(qs, "quiz_questions", Number(b.dataset.qup), -1));
        $$("[data-qdown]", view).forEach((b) => b.onclick = () => move(qs, "quiz_questions", Number(b.dataset.qdown), 1));
        $("[data-addq]", view).onclick = () => editQuestion(c, null, qs);
        $$("[data-editq]", view).forEach((b) => b.onclick = () => editQuestion(c, qs.find((x) => x.id === Number(b.dataset.editq)), qs));
        $$("[data-delq]", view).forEach((b) => b.onclick = async () => {
          if (!(await confirmBox("Delete this question?"))) return;
          try { check(await sb.from("quiz_questions").delete().eq("id", Number(b.dataset.delq))); toast("Question deleted"); reload(); }
          catch (ex) { toast(ex.message, true); }
        });
      }
      this.onAction = (act) => {
        if (act === "preview") goTo(`#learn/${id}`);
        if (act === "edit") editCourse(c);
      };
    }
  };

  function editMaterial(course, m, mats) {
    const isNew = !m;
    m = m || { kind: "pdf" };
    const { form } = openModal({
      title: isNew ? `Add material · ${course.title}` : "Edit material", submitText: isNew ? "Add material" : "Save",
      body: `
        <div class="grid2">
          <div class="field"><label>Type *</label>
            <select name="kind" ${isNew ? "" : "disabled"}>${Object.entries(MAT_KIND).map(([k, v]) => `<option value="${k}" ${m.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Title *</label><input name="title" required value="${esc(m.title)}" placeholder="e.g. WHMIS training slides"></div>
        </div>
        ${isNew ? `<div class="field" data-srcrow><label>Source</label>
          <div class="choices"><label class="choice"><input type="radio" name="src" value="file" checked> Upload a file</label>
          <label class="choice"><input type="radio" name="src" value="url"> Web link</label></div></div>` : ""}
        <div class="field" data-filerow><label>File * <span class="muted">up to 50 MB</span></label><input type="file" name="file"></div>
        <div class="field" data-urlrow><label>Web address *</label><input name="url" type="url" placeholder="https://" value="${esc(m.url)}"></div>
        <p class="muted" data-hint style="font-size:.85rem;margin:0"></p>`,
      async onSubmit(d, frm) {
        const kind = isNew ? d.kind : m.kind;
        const useUrl = isNew ? (kind === "link" || d.src === "url") : !m.file_path;
        const row = { title: d.title.trim() };
        if (useUrl) {
          const u = String(d.url || "").trim();
          if (!safeUrl(u)) throw new Error("Enter a full web address starting with https://");
          row.url = u;
        }
        if (!isNew) { check(await sb.from("course_materials").update(row).eq("id", m.id)); toast("Material saved"); route(); return; }
        Object.assign(row, { course_id: course.id, kind, sort: (mats.reduce((mx, x) => Math.max(mx, x.sort || 0), 0) || mats.length) + 1 });
        if (!useUrl) {
          const file = $("input[name=file]", frm).files[0];
          if (!file) throw new Error("Choose the file to upload.");
          if (file.size > MAT_MAX) throw new Error(kind === "video"
            ? "That video is over 50 MB. Upload it to YouTube (as Unlisted) or Vimeo and add it as a web link instead."
            : "That file is over 50 MB. Try saving a smaller version, or add it as a web link.");
          const ext = (file.name.split(".").pop() || "").toLowerCase();
          const path = `${course.id}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80)}`;
          const { error } = await sb.storage.from(MAT_BUCKET).upload(path, file, { contentType: file.type || MIME_BY_EXT[ext] || undefined, upsert: false });
          if (error) throw new Error(/mime|type/i.test(error.message) ? "That type of file can't be uploaded. Use PDF, MP4 video, PowerPoint, Word or an image."
            : /bucket/i.test(error.message) ? "Course uploads aren't set up yet. Run the online-courses update in Supabase (see README)." : error.message);
          row.file_path = path;
        }
        const { error } = await sb.from("course_materials").insert(row);
        if (error) { if (row.file_path) await sb.storage.from(MAT_BUCKET).remove([row.file_path]); throw new Error(error.message); }
        toast("Material added"); route();
      }
    });
    const sync = () => {
      const kind = isNew ? form.kind.value : m.kind;
      const src = isNew ? (kind === "link" ? "url" : (form.querySelector("input[name=src]:checked") || {}).value) : (m.file_path ? "file" : "url");
      if (isNew) $("[data-srcrow]", form).classList.toggle("hidden", kind === "link");
      $("[data-filerow]", form).classList.toggle("hidden", src !== "file" || !isNew);
      $("[data-urlrow]", form).classList.toggle("hidden", src !== "url");
      if (isNew) $("input[name=file]", form).accept = MAT_ACCEPT[kind] || "";
      $("[data-hint]", form).textContent = {
        video: "Videos up to 50 MB can be uploaded (MP4 works best). For longer videos, put them on YouTube as Unlisted, or on Vimeo, and paste the link: they play right inside the course.",
        ppt: "Staff see the slides in the browser through Microsoft's free online viewer. Saving the slides as a PDF also works well and opens faster on phones.",
        pdf: "PDFs open right inside the course.", link: "Opens in a new tab, for example a website, a Google Slides deck or a SharePoint page.",
        file: "For Word documents and images. Staff download or open them."
      }[kind] || "";
    };
    $$("select[name=kind], input[name=src]", form).forEach((el) => el.addEventListener("change", sync));
    if (!isNew) $("[data-filerow]", form).classList.add("hidden");
    sync();
  }

  function editQuestion(course, q, qs) {
    const isNew = !q;
    q = q || { question: "", options: ["", "", ""], correct: -1 };
    const optRow = (val, i, checked) => `<div class="opt-row">
      <input type="radio" name="correct" value="${i}" ${checked ? "checked" : ""} aria-label="Correct answer">
      <input name="opt" value="${esc(val)}" placeholder="Answer ${i + 1}">
      <button type="button" class="link small" data-rmopt aria-label="Remove answer">Remove</button></div>`;
    const { form } = openModal({
      title: isNew ? `Add question · ${course.title}` : "Edit question", submitText: isNew ? "Add question" : "Save",
      body: `
        <div class="field"><label>Question *</label><textarea name="question" rows="2" required>${esc(q.question)}</textarea></div>
        <div class="field"><label>Answers <span class="muted">select the correct one</span></label>
          <div data-opts>${q.options.map((o, i) => optRow(o, i, i === q.correct)).join("")}</div>
          <button type="button" class="link small" data-addopt>+ Add answer</button></div>`,
      async onSubmit(d, frm) {
        const rows = $$(".opt-row", frm).map((r) => ({ text: $("input[name=opt]", r).value.trim(), right: $("input[name=correct]", r).checked }));
        const kept = rows.filter((r) => r.text);
        if (kept.length < 2) throw new Error("Give at least two answers.");
        if (kept.length > 6) throw new Error("Use at most six answers.");
        const correct = kept.findIndex((r) => r.right);
        if (correct < 0) throw new Error("Select which answer is correct.");
        const row = { question: d.question.trim(), options: kept.map((r) => r.text), correct };
        if (isNew) check(await sb.from("quiz_questions").insert({ ...row, course_id: course.id, sort: (qs.reduce((mx, x) => Math.max(mx, x.sort || 0), 0) || qs.length) + 1 }));
        else check(await sb.from("quiz_questions").update(row).eq("id", q.id));
        toast(isNew ? "Question added" : "Question saved"); route();
      }
    });
    const box = $("[data-opts]", form);
    const renumber = () => $$(".opt-row", box).forEach((r, i) => { $("input[name=correct]", r).value = i; $("input[name=opt]", r).placeholder = `Answer ${i + 1}`; });
    const wire = () => $$("[data-rmopt]", box).forEach((b) => b.onclick = () => {
      if ($$(".opt-row", box).length <= 2) { toast("A question needs at least two answers.", true); return; }
      b.closest(".opt-row").remove(); renumber();
    });
    $("[data-addopt]", form).onclick = () => {
      const n = $$(".opt-row", box).length;
      if (n >= 6) { toast("Six answers is the most a question can have.", true); return; }
      box.insertAdjacentHTML("beforeend", optRow("", n, false)); wire(); $$("input[name=opt]", box).at(-1).focus();
    };
    wire();
  }

  // ---- Training area: list of online courses (staff with a login) and the course player
  async function loadLearning() {
    const emp = state.me.employee_id;
    const [mats, qc, viewsRes, attRes] = await Promise.all([
      sb.from("course_materials").select("id, course_id"), sb.rpc("quiz_counts"),
      emp ? sb.from("material_views").select("material_id").eq("employee_id", emp) : Promise.resolve({ data: [] }),
      emp ? sb.from("quiz_attempts").select("course_id, score, passed, created_at").eq("employee_id", emp).order("created_at", { ascending: false }) : Promise.resolve({ data: [] })]);
    if (mats.error) throw new Error(/course_materials|relation|schema cache/i.test(mats.error.message) ? "Online courses aren't set up yet. Ask your administrator." : mats.error.message);
    const seen = new Set((viewsRes.data || []).map((v) => v.material_id));
    const by = new Map();
    const get = (id) => by.get(id) || by.set(id, { materials: [], questions: 0, attempts: [] }).get(id);
    (mats.data || []).forEach((m) => get(m.course_id).materials.push(m.id));
    (qc.data || []).forEach((q) => { get(q.course_id).questions = q.questions; });
    (attRes.data || []).forEach((a) => by.has(a.course_id) && get(a.course_id).attempts.push(a));
    return { by, seen };
  }

  views.learn = {
    title: "My courses", everyone: true, navAs() { return isEmployee() ? "learn" : "courses"; },
    actions() { return isEmployee() || !this.arg ? "" : `<a class="btn secondary" href="#course/${esc(this.arg)}">← Back to course</a>`; },
    async render(view) {
      if (this.arg) return renderPlayer(view, Number(this.arg));
      if (!isEmployee()) { goTo("#courses"); return; }
      const { by, seen } = await loadLearning();
      const { rows } = await loadMyTraining();
      const trainingStatus = new Map(rows.map((r) => [r.course.id, r.status]));
      const list = state.courses.filter((c) => c.active && by.has(c.id) && (by.get(c.id).materials.length || by.get(c.id).questions))
        .map((c) => {
          const x = by.get(c.id), viewed = x.materials.filter((m) => seen.has(m)).length;
          const lastPass = x.attempts.find((a) => a.passed), ts = trainingStatus.get(c.id);
          let state_, label;
          if (lastPass && ts !== "expired" && ts !== "expiring") { state_ = "done"; label = `Passed ${Number(lastPass.score)}% on ${fmtDate(lastPass.created_at)}`; }
          else if (lastPass) { state_ = "due"; label = ts === "expired" ? "Expired: please take it again" : "Due again soon"; }
          else if (viewed || x.attempts.length) { state_ = "going"; label = x.attempts.length ? `Last score ${Number(x.attempts[0].score)}%. Not passed yet` : `${viewed} of ${x.materials.length} items done`; }
          else { state_ = "new"; label = "Not started"; }
          return { c, x, viewed, state_, label };
        })
        .sort((a, b) => ({ due: 0, going: 1, new: 2, done: 3 }[a.state_] - { due: 0, going: 1, new: 2, done: 3 }[b.state_]) || (b.c.mandatory - a.c.mandatory) || a.c.title.localeCompare(b.c.title));
      view.innerHTML = list.length ? `<div class="course-grid">${list.map(({ c, x, viewed, state_, label }) => {
          const total = x.materials.length + (x.questions ? 1 : 0), done = viewed + (state_ === "done" ? (x.questions ? 1 : 0) : 0);
          return `<a class="course-card" href="#learn/${c.id}">
            <div class="cc-top">${c.mandatory ? badge("admin", "Required") : badge("neutral", "Optional")}<span class="cc-state ${state_}">${esc(label)}</span></div>
            <h3>${esc(c.title)}</h3>
            <p class="muted">${esc(c.description || "")}</p>
            <div class="cc-meta">${x.materials.length ? `${x.materials.length} item${x.materials.length > 1 ? "s" : ""}` : ""}${x.materials.length && x.questions ? " · " : ""}${x.questions ? `${x.questions}-question quiz` : ""}</div>
            <div class="bar"><span style="width:${total ? Math.round(done / total * 100) : 0}%"></span></div>
            <span class="cc-go">${state_ === "new" ? "Start course" : state_ === "done" ? "Review" : "Continue"}</span>
          </a>`; }).join("")}</div>`
        : `<div class="card empty">There are no online courses yet. Your manager can still record training for you, and you can upload certificates on <a href="#my">My training</a>.</div>`;
    }
  };

  async function renderPlayer(view, courseId) {
    const c = state.courses.find((x) => x.id === courseId);
    if (!c) { view.innerHTML = `<div class="card empty">That course isn't available.</div>`; return; }
    $("#pageTitle").textContent = c.title; document.title = `${c.title} · Train Well`;
    const preview = !isEmployee();
    const mats = await loadMaterials(courseId);
    const { by, seen } = await loadLearning();
    const info = by.get(courseId) || { questions: 0, attempts: [] };
    const allSeen = () => preview || mats.every((m) => seen.has(m.id));
    let current = mats.findIndex((m) => !seen.has(m.id));
    if (current < 0) current = mats.length ? (info.questions && !preview ? "quiz" : 0) : "quiz";
    if (preview && mats.length) current = 0;

    view.innerHTML = `
      ${preview ? `<div class="alert info">Preview: this is what staff see. Your answers are marked but nothing is saved.</div>` : ""}
      <div class="player">
        <aside class="card player-steps">
          <h2>Course content</h2>
          <ol data-steps></ol>
        </aside>
        <section class="card player-main" data-main></section>
      </div>`;

    const drawSteps = () => {
      $("[data-steps]", view).innerHTML = mats.map((m, i) => `
        <li><button type="button" class="step ${current === i ? "is-current" : ""} ${seen.has(m.id) ? "is-done" : ""}" data-step="${i}">
          <span class="step-mark" aria-hidden="true">${seen.has(m.id) ? "✓" : i + 1}</span>
          <span><span class="step-title">${esc(m.title)}</span><span class="step-kind">${esc(MAT_KIND[m.kind])}</span></span></button></li>`).join("")
        + (info.questions ? `<li><button type="button" class="step ${current === "quiz" ? "is-current" : ""} ${info.attempts.some((a) => a.passed) ? "is-done" : ""}" data-step="quiz" ${allSeen() ? "" : "disabled"}>
          <span class="step-mark" aria-hidden="true">${info.attempts.some((a) => a.passed) ? "✓" : "?"}</span>
          <span><span class="step-title">Quiz</span><span class="step-kind">${allSeen() ? `${info.questions} questions · pass mark ${c.pass_mark ?? 80}%` : "Opens after all items"}</span></span></button></li>` : "");
      $$("[data-step]", view).forEach((b) => b.onclick = () => { current = b.dataset.step === "quiz" ? "quiz" : Number(b.dataset.step); show(); });
    };

    const markSeen = async (m) => {
      if (preview || seen.has(m.id)) return;
      const { error } = await sb.from("material_views").upsert({ employee_id: state.me.employee_id, material_id: m.id }, { onConflict: "employee_id,material_id", ignoreDuplicates: true });
      if (!error) { seen.add(m.id); drawSteps(); }
    };

    const nextButton = (i) => {
      const nextIsQuiz = i === mats.length - 1 && info.questions;
      if (i < mats.length - 1) return `<button type="button" data-next>Next: ${esc(mats[i + 1].title)} →</button>`;
      if (nextIsQuiz) return `<button type="button" data-next>Go to the quiz →</button>`;
      return `<a class="btn secondary" href="${isEmployee() ? "#learn" : `#course/${courseId}`}">Finish</a>`;
    };

    async function show() {
      drawSteps();
      const main = $("[data-main]", view);
      if (current === "quiz") return showQuiz(main);
      const m = mats[current];
      if (!m) { main.innerHTML = `<p class="muted">This course has no materials yet.</p>`; return; }
      main.innerHTML = `<div class="viewer-head"><div>${kindBadge(m.kind)}<h2>${esc(m.title)}</h2></div></div><div class="viewer" data-viewer><p class="muted">Loading…</p></div>
        <div class="viewer-foot"><span class="muted" data-hint></span>${nextButton(current)}</div>`;
      let url;
      try { url = await materialUrl(m); } catch (ex) { $("[data-viewer]", main).innerHTML = `<div class="alert error">${esc(ex.message)}</div>`; return; }
      const v = $("[data-viewer]", main), hint = $("[data-hint]", main);
      const openBtn = (label) => `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener" data-ext>${label}</a>`;
      const ext = (m.file_path || m.url || "").split("?")[0].split(".").pop().toLowerCase();
      if (m.kind === "video") {
        const emb = !m.file_path && videoEmbed(url);
        v.innerHTML = emb ? `<div class="frame16x9"><iframe src="${esc(emb)}" title="${esc(m.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
          : m.file_path ? `<video controls playsinline preload="metadata" src="${esc(url)}"></video>` : `<p>This video is on another website.</p>${openBtn("Watch the video")}`;
        markSeen(m);
      } else if (m.kind === "pdf" || (m.kind === "file" && ext === "pdf")) {
        v.innerHTML = `<iframe class="doc-frame" src="${esc(url)}" title="${esc(m.title)}"></iframe><p class="viewer-alt">Can't see it? ${openBtn("Open the PDF")}</p>`;
        markSeen(m);
      } else if (m.kind === "ppt" && m.file_path) {
        v.innerHTML = `<iframe class="doc-frame" src="https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}" title="${esc(m.title)}" allowfullscreen></iframe>
          <p class="viewer-alt">Slides not showing? ${openBtn("Download the slides")}</p>`;
        hint.textContent = "Use the arrows under the slides to move through them.";
        markSeen(m);
      } else if (m.kind === "file" && /^(jpe?g|png)$/.test(ext)) {
        v.innerHTML = `<img class="doc-img" src="${esc(url)}" alt="${esc(m.title)}">`; markSeen(m);
      } else {
        v.innerHTML = `<div class="open-panel"><p>${m.kind === "link" ? "This opens in a new tab. Come back here when you're done." : "Open the file to read it, then come back here."}</p>${openBtn(m.kind === "link" ? "Open the link" : "Open the file")}</div>`;
        $("[data-ext]", v).addEventListener("click", () => markSeen(m));
        if (preview) markSeen(m);
      }
      $("[data-next]", main)?.addEventListener("click", () => { current = current < mats.length - 1 ? current + 1 : "quiz"; show(); main.scrollIntoView({ behavior: "smooth", block: "start" }); });
    }

    async function showQuiz(main) {
      if (!allSeen()) { main.innerHTML = `<h2>Quiz</h2><p>Open every item in the course first, then the quiz will unlock.</p>`; return; }
      main.innerHTML = `<p class="muted">Loading quiz…</p>`;
      const { data, error } = await sb.rpc("get_quiz", { p_course: courseId });
      if (error) { main.innerHTML = `<div class="alert error">${esc(error.message)}</div>`; return; }
      const qs = data.questions || [];
      if (!qs.length) { main.innerHTML = `<h2>Quiz</h2><p class="muted">This course doesn't have a quiz yet.</p>`; return; }
      const last = info.attempts[0];
      main.innerHTML = `
        <form class="quiz" novalidate>
          <div class="viewer-head"><div><h2>Quiz</h2><p class="muted" style="margin:.2rem 0 0">${qs.length} questions · you need ${data.pass_mark}% to pass${last ? ` · your last score was ${Number(last.score)}%` : ""}</p></div></div>
          ${qs.map((q, i) => `<fieldset class="quiz-q" data-q="${q.id}"><legend><span class="qn">${i + 1}</span>${esc(q.question)}</legend>
            ${q.options.map((o, j) => `<label class="quiz-opt"><input type="radio" name="q${q.id}" value="${j}"> <span>${esc(o)}</span></label>`).join("")}</fieldset>`).join("")}
          <div class="alert error hidden" data-qerr></div>
          <div class="viewer-foot"><span class="muted" data-left></span><button type="submit" data-submit>Submit answers</button></div>
        </form>`;
      const form = $("form", main);
      const left = () => { const n = qs.filter((q) => form.querySelector(`input[name=q${q.id}]:checked`)).length; $("[data-left]", main).textContent = `${n} of ${qs.length} answered`; };
      form.addEventListener("change", left); left();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const answers = {}; let missing = 0;
        qs.forEach((q) => { const r = form.querySelector(`input[name=q${q.id}]:checked`); if (r) answers[q.id] = Number(r.value); else missing++; });
        const err = $("[data-qerr]", main);
        if (missing) { err.textContent = `Answer all the questions first (${missing} left).`; err.classList.remove("hidden"); return; }
        const btn = $("[data-submit]", main); btn.disabled = true; err.classList.add("hidden");
        const { data: res, error } = await sb.rpc("submit_quiz", { p_course: courseId, p_answers: answers });
        btn.disabled = false;
        if (error) { err.textContent = error.message; err.classList.remove("hidden"); return; }
        if (!preview) info.attempts.unshift({ course_id: courseId, score: res.score, passed: res.passed, created_at: new Date().toISOString() });
        showResult(main, qs, answers, res);
        drawSteps(); refreshBell();
      });
    }

    function showResult(main, qs, answers, res) {
      const byId = new Map((res.results || []).map((r) => [String(r.id), r]));
      main.innerHTML = `
        <div class="result ${res.passed ? "pass" : "fail"}">
          <div class="result-score"><strong>${Number(res.score)}%</strong><span>${res.correct} of ${res.total} correct</span></div>
          <div>
            <h2>${res.passed ? "You passed" : "Not passed this time"}</h2>
            <p>${res.passed
              ? (res.preview ? "Preview only: nothing was saved." : `Well done. This course is now on your training record${res.expires_on ? ` and is valid until ${fmtDate(res.expires_on)}` : ""}.`)
              : `You need ${res.pass_mark}% to pass. Have another look at the course materials, then try the quiz again.`}</p>
            <div class="result-actions">
              ${res.passed ? "" : `<button type="button" data-retry>Try the quiz again</button>`}
              <a class="btn secondary" href="${isEmployee() ? "#learn" : `#course/${courseId}`}">${isEmployee() ? "Back to my courses" : "Back to the course"}</a>
            </div>
          </div>
        </div>
        <h3>Your answers</h3>
        <ol class="review">${qs.map((q) => { const r = byId.get(String(q.id)) || {}; const mine = answers[q.id];
          return `<li class="${r.is_correct ? "ok" : "no"}"><strong>${esc(q.question)}</strong>
            <span>Your answer: ${esc(q.options[mine] ?? "—")} ${r.is_correct ? badge("valid", "Correct") : badge("expired", "Incorrect")}</span>
            ${!r.is_correct && r.correct != null ? `<span class="muted">Correct answer: ${esc(q.options[r.correct])}</span>` : ""}</li>`; }).join("")}</ol>
        ${res.passed ? "" : `<p class="muted" style="font-size:.85rem">The correct answers are shown once you pass.</p>`}`;
      $("[data-retry]", main)?.addEventListener("click", () => showQuiz(main));
      main.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    show();
  }

  // =============================================================== CLICK-THROUGHS
  // data-pre="view:filter:value" sets that page's filter before going there; data-go makes a row a link
  function applyPre(el) {
    const pre = el.dataset.pre; if (!pre) return;
    const [vName, key, ...rest] = pre.split(":"); const val = rest.join(":");
    const v = views[vName]; if (!v || !v.filters) return;
    if (vName === "compliance") Object.assign(v.filters, { status: "", month: "", facility: v.filters.facility, course: "" });
    if (vName === "compliance" && key !== "facility" && !isAdmin()) v.filters.facility = "";
    v.filters[key] = val;
  }
  function wireLinks(root) {
    $$("a[data-pre]", root).forEach((a) => a.addEventListener("click", () => applyPre(a)));
    $$("[data-go], [data-open-emp]", root).forEach((row) => {
      const go = () => {
        if (row.dataset.openEmp) return showEmployee(Number(row.dataset.openEmp));
        applyPre(row); goTo(row.dataset.go);
      };
      row.addEventListener("click", (e) => { if (!e.target.closest("a, button")) go(); });
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  // ---- Chart tooltip (one for the page; values lead, labels follow)
  function vizTip() {
    let t = $("#vizTip");
    if (!t) { t = document.createElement("div"); t.id = "vizTip"; t.className = "viz-tip hidden"; t.setAttribute("role", "tooltip"); document.body.appendChild(t); }
    return t;
  }
  function wireTips(root) {
    const tip = vizTip();
    const showFor = (el, x, y) => {
      tip.replaceChildren();
      const v = document.createElement("strong"); v.textContent = el.dataset.tipValue || "";
      const l = document.createElement("span"); l.textContent = el.dataset.tipLabel || "";
      tip.append(v, l);
      if (el.dataset.tipHint) { const h = document.createElement("em"); h.textContent = el.dataset.tipHint; tip.append(h); }
      tip.classList.remove("hidden");
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
      tip.style.top = Math.max(8, y - r.height - 12) + "px";
    };
    $$("[data-tip-value]", root).forEach((el) => {
      el.addEventListener("pointermove", (e) => showFor(el, e.clientX, e.clientY));
      el.addEventListener("pointerleave", () => tip.classList.add("hidden"));
      el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); showFor(el, r.left + r.width / 2, r.top); });
      el.addEventListener("blur", () => tip.classList.add("hidden"));
    });
  }

  // =============================================================== COMPLIANCE (charts)
  const ST_ORDER = ["valid", "expiring", "expired", "missing"];
  const ST_LABEL = { valid: "Up to date", expiring: `Due in ${WARN_DAYS} days`, expired: "Expired", missing: "Never done" };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function stackRow(label, list, filterKey, filterVal, extra = "") {
    const total = list.length;
    const c = Object.fromEntries(ST_ORDER.map((st) => [st, list.filter((i) => i.status === st).length]));
    const pct = total ? Math.round((c.valid + c.expiring) / total * 100) : 100;
    return `<div class="stack-row">
      <div class="stack-label"><strong>${esc(label)}</strong><span class="muted">${extra}</span></div>
      <div class="stack" role="img" aria-label="${esc(label)}: ${ST_ORDER.map((st) => `${c[st]} ${ST_LABEL[st].toLowerCase()}`).join(", ")}">
        ${total ? ST_ORDER.filter((st) => c[st]).map((st) => `<button type="button" class="seg seg-${st}" style="flex-grow:${c[st]}"
          data-tip-value="${c[st]} of ${total} (${Math.round(c[st] / total * 100)}%)" data-tip-label="${esc(label)} · ${ST_LABEL[st]}" data-tip-hint="Click to list them"
          data-seg="${st}" ${filterKey ? `data-fk="${filterKey}" data-fv="${esc(filterVal)}"` : ""} aria-label="${esc(label)}, ${ST_LABEL[st]}: ${c[st]}"></button>`).join("")
          : `<span class="stack-empty">No mandatory training</span>`}
      </div>
      <div class="stack-pct"><strong>${pct}%</strong><span class="muted">current</span></div>
    </div>`;
  }

  views.compliance = {
    title: "Compliance", navAs: "compliance",
    filters: { facility: "", course: "", status: "", month: "", q: "" },
    actions() { return `<button class="secondary" data-act="excel">Download</button>`; },
    async render(view) {
      const f = this.filters;
      if (!isAdmin()) f.facility = "";
      const employees = await loadEmployees({ activeOnly: true });
      const { items: all } = await complianceMatrix(employees);
      const mandatory = state.courses.filter((c) => c.mandatory && c.active);
      const homes = state.facilities.filter((x) => isAdmin() || x.id === state.me.facility_id);
      const scoped = all.filter((i) => (!f.facility || String(i.employee.facility_id) === f.facility) && (!f.course || String(i.course.id) === f.course));
      const n = (st, list = scoped) => list.filter((i) => i.status === st).length;
      const current = n("valid") + n("expiring");
      const pct = scoped.length ? Math.round(current / scoped.length * 100) : 100;
      const people = new Set(scoped.map((i) => i.employee.id)).size;

      // Expiry forecast: next 12 months, by month the current certificate runs out
      const months = [...Array(12)].map((_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + k); return d.toISOString().slice(0, 7); });
      const byMonth = months.map((m) => ({ m, items: scoped.filter((i) => i.expires_on && i.expires_on.slice(0, 7) === m && i.status !== "expired") }));
      const maxM = Math.max(1, ...byMonth.map((x) => x.items.length));
      const peak = byMonth.reduce((a, b) => (b.items.length > a.items.length ? b : a), byMonth[0]);
      const monthName = (m, long) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, long ? { month: "long", year: "numeric" } : { month: "short" });

      // Action list
      const statusOk = (i) => f.month ? (i.expires_on && i.expires_on.slice(0, 7) === f.month && i.status !== "expired")
        : f.status === "all" ? true : f.status ? i.status === f.status : i.status !== "valid";
      const q = f.q.toLowerCase();
      const list = scoped.filter(statusOk).filter((i) => !q || fullName(i.employee).toLowerCase().includes(q) || i.course.title.toLowerCase().includes(q))
        .sort((a, b) => ST_ORDER.indexOf(b.status) - ST_ORDER.indexOf(a.status) || String(a.expires_on || "").localeCompare(String(b.expires_on || "")) || fullName(a.employee).localeCompare(fullName(b.employee)));
      const listTitle = f.month ? `Expiring in ${monthName(f.month, true)}` : f.status === "all" ? "Everyone" : f.status ? ST_LABEL[f.status] : "Needs action";
      const daysTo = (d) => d ? Math.round((new Date(d + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000) : null;

      view.innerHTML = `
        <div class="filter-row">
          ${isAdmin() ? `<label>Home <select data-f="facility">${facilityOptions(f.facility, { includeAll: true })}</select></label>` : ""}
          <label>Course <select data-f="course"><option value="">All mandatory courses</option>${mandatory.map((c) => `<option value="${c.id}" ${String(c.id) === f.course ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select></label>
          ${f.facility || f.course ? `<button type="button" class="link small" data-clear>Clear filters</button>` : ""}
        </div>

        ${!mandatory.length ? `<div class="card empty">No mandatory courses yet. Mark courses as mandatory on the <a href="#courses">Courses</a> page to track compliance.</div>` : `
        <div class="card hero-card">
          <div class="hero-num">
            <span class="hero-value">${pct}%</span>
            <span class="hero-label">of mandatory training is current</span>
            <span class="muted">${plural(people, "employee", "employees")} · ${plural(f.course ? 1 : mandatory.length, "course", "courses")} · ${plural(scoped.length, "requirement", "requirements")}</span>
          </div>
          <div class="hero-break">
            ${stackRow("All requirements", scoped, null, null)}
            <ul class="legend">${ST_ORDER.map((st) => `<li><button type="button" class="legend-btn" data-legend="${st}"><span class="sw sw-${st}" aria-hidden="true"></span>${ST_LABEL[st]} <strong>${n(st)}</strong></button></li>`).join("")}</ul>
          </div>
        </div>

        <div class="cols">
          ${homes.length > 1 && !f.facility ? `<div class="card">
            <h2>By home</h2>
            <p class="muted chart-sub">Share of each home's mandatory training. Click a colour to list those people.</p>
            ${homes.map((h) => { const l = scoped.filter((i) => i.employee.facility_id === h.id);
              return stackRow(h.name, l, "facility", String(h.id), plural(new Set(l.map((i) => i.employee.id)).size, "employee", "employees")); }).join("")}
            <details class="table-view"><summary>View as table</summary><div class="table-wrap"><table>
              <thead><tr><th>Home</th>${ST_ORDER.map((st) => `<th>${ST_LABEL[st]}</th>`).join("")}<th>Current</th></tr></thead>
              <tbody>${homes.map((h) => { const l = scoped.filter((i) => i.employee.facility_id === h.id);
                return `<tr><td>${esc(h.name)}</td>${ST_ORDER.map((st) => `<td>${n(st, l)}</td>`).join("")}<td>${l.length ? Math.round((n("valid", l) + n("expiring", l)) / l.length * 100) : 100}%</td></tr>`; }).join("")}</tbody></table></div></details>
          </div>` : ""}
          ${!f.course ? `<div class="card">
            <h2>By course</h2>
            <p class="muted chart-sub">Worst first. Click a colour to list those people.</p>
            ${mandatory.map((c) => ({ c, l: scoped.filter((i) => i.course.id === c.id) }))
              .sort((a, b) => (n("valid", a.l) + n("expiring", a.l)) / (a.l.length || 1) - (n("valid", b.l) + n("expiring", b.l)) / (b.l.length || 1))
              .map(({ c, l }) => stackRow(c.title, l, "course", String(c.id), c.validity_months ? `renew every ${c.validity_months} months` : "no expiry")).join("")}
            <details class="table-view"><summary>View as table</summary><div class="table-wrap"><table>
              <thead><tr><th>Course</th>${ST_ORDER.map((st) => `<th>${ST_LABEL[st]}</th>`).join("")}</tr></thead>
              <tbody>${mandatory.map((c) => { const l = scoped.filter((i) => i.course.id === c.id); return `<tr><td>${esc(c.title)}</td>${ST_ORDER.map((st) => `<td>${n(st, l)}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div></details>
          </div>` : ""}
        </div>

        <div class="card">
          <h2>Renewals coming up</h2>
          <p class="muted chart-sub">Certificates that run out each month over the next year${peak.items.length ? `. Busiest: <strong>${monthName(peak.m, true)}</strong> (${peak.items.length})` : ""}. Click a month to see who.</p>
          <div class="cols-chart" role="img" aria-label="Certificates expiring per month for the next 12 months">
            <span class="cols-max" aria-hidden="true">${maxM}</span>
            <div class="cols-grid" aria-hidden="true"><span></span><span></span><span></span></div>
            ${byMonth.map((x) => `<button type="button" class="col ${f.month === x.m ? "is-on" : ""}" data-month="${x.m}"
                data-tip-value="${plural(x.items.length, "certificate", "certificates")}" data-tip-label="Expire in ${monthName(x.m, true)}" ${x.items.length ? `data-tip-hint="Click to list them"` : ""}
                aria-label="${monthName(x.m, true)}: ${x.items.length}">
                <span class="col-val">${x === peak && x.items.length ? x.items.length : ""}</span>
                <span class="col-bar" style="height:${x.items.length ? Math.max(4, Math.round(x.items.length / maxM * 100)) : 0}%"></span>
                <span class="col-lbl">${monthName(x.m)}</span></button>`).join("")}
          </div>
          <details class="table-view"><summary>View as table</summary><div class="table-wrap"><table>
            <thead><tr><th>Month</th><th>Certificates expiring</th></tr></thead>
            <tbody>${byMonth.map((x) => `<tr><td>${monthName(x.m, true)}</td><td>${x.items.length}</td></tr>`).join("")}</tbody></table></div></details>
        </div>

        <div class="card" id="actionList">
          <div class="card-head"><h2>${esc(listTitle)} <span class="muted" style="font-weight:500">(${list.length})</span></h2>
            <div class="toolbar" style="margin:0">
              <input type="search" placeholder="Search name or course…" value="${esc(f.q)}" data-f="q" style="min-width:200px">
              <select data-f="status">
                <option value="" ${!f.status && !f.month ? "selected" : ""}>Needs action</option>
                ${ST_ORDER.map((st) => `<option value="${st}" ${f.status === st && !f.month ? "selected" : ""}>${ST_LABEL[st]}</option>`).join("")}
                <option value="all" ${f.status === "all" && !f.month ? "selected" : ""}>Everyone</option>
                ${f.month ? `<option selected>Expiring in ${monthName(f.month, true)}</option>` : ""}
              </select></div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Employee</th><th>Home</th><th>Course</th><th>Status</th><th>Expires</th><th></th></tr></thead>
            <tbody>${list.slice(0, 300).map((i) => { const d = daysTo(i.expires_on);
              return `<tr class="row-link" tabindex="0" data-open-emp="${i.employee.id}">
                <td><strong>${esc(fullName(i.employee))}</strong></td><td>${esc(facilityName(i.employee.facility_id))}</td><td>${esc(i.course.title)}</td>
                <td><span class="st-chip"><span class="sw sw-${i.status}" aria-hidden="true"></span>${ST_LABEL[i.status]}</span></td>
                <td>${i.expires_on ? `${fmtDate(i.expires_on)} <span class="muted">(${d < 0 ? `${-d} days ago` : d === 0 ? "today" : `in ${d} days`})</span>` : "—"}</td>
                <td class="actions"><span class="muted small-arrow">Open →</span></td></tr>`; }).join("")
              || `<tr><td colspan="6" class="empty">${f.status || f.month ? "No one in this group." : "Everyone is up to date. 🎉"}</td></tr>`}
              ${list.length > 300 ? `<tr><td colspan="6" class="empty">Showing the first 300. Use Download for the full list.</td></tr>` : ""}
            </tbody></table></div>
        </div>`}`;

      const self = this;
      const focusList = () => setTimeout(() => $("#actionList")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      $$("[data-f]", view).forEach((inp) => inp.addEventListener(inp.dataset.f === "q" ? "change" : "input", () => {
        f[inp.dataset.f] = inp.value; if (inp.dataset.f === "status") f.month = "";
        route().then(() => { if (inp.dataset.f === "q" || inp.dataset.f === "status") focusList(); });
      }));
      $("[data-clear]", view)?.addEventListener("click", () => { f.facility = ""; f.course = ""; route(); });
      $$("[data-seg]", view).forEach((b) => b.addEventListener("click", () => {
        f.status = b.dataset.seg; f.month = "";
        if (b.dataset.fk) f[b.dataset.fk] = b.dataset.fv;
        vizTip().classList.add("hidden"); route().then(focusList);
      }));
      $$("[data-legend]", view).forEach((b) => b.addEventListener("click", () => { f.status = b.dataset.legend; f.month = ""; route().then(focusList); }));
      $$("[data-month]", view).forEach((b) => b.addEventListener("click", () => { f.month = f.month === b.dataset.month ? "" : b.dataset.month; f.status = ""; vizTip().classList.add("hidden"); route().then(focusList); }));
      wireTips(view); wireLinks(view);
      this.onAction = (act) => {
        if (act === "excel") offerDownload(async () => ({
          file: `TrainWell-compliance-${todayISO()}`, title: `Compliance: ${listTitle}`,
          subtitle: filterLine([f.facility ? facilityName(Number(f.facility)) : (isAdmin() ? "All homes" : facilityName(state.me.facility_id)),
            f.course ? courseTitle(Number(f.course)) : "All mandatory courses", f.q ? `Search: "${f.q}"` : "", `${list.length} rows`]),
          columns: [{ h: "Employee", w: 26 }, { h: "Home", w: 24 }, { h: "Course", w: 28 }, { h: "Status", w: 16 }, { h: "Expires", w: 12, date: true }, { h: "Last completed", w: 14, date: true }],
          rows: list.map((i) => [fullName(i.employee), facilityName(i.employee.facility_id), i.course.title, { v: ST_LABEL[i.status], st: i.status },
            i.expires_on ? { v: i.expires_on, st: i.status } : "", i.completed_on || ""])
        }), "this compliance list");
      };
    }
  };

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
      const online = await courseContentCounts().catch(() => new Map());
      const hasCourse = (id) => { const x = online.get(id); return x && (x.materials || x.questions); };
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
              <td class="actions" style="vertical-align:middle">${hasCourse(r.course.id) ? `<a class="btn small" href="#learn/${r.course.id}">Take course</a> ` : ""}<button class="small ${hasCourse(r.course.id) ? "secondary" : ""}" data-up="${r.course.id}">Upload</button></td></tr>`).join("")
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

  // ============================================================== NOTIFICATIONS (bell)
  // Worked out from the live data each time a page loads. "Seen" is remembered per person on this device.
  const seenKey = () => `trainwell.seen.${state.me.id}`;
  const seenGet = () => { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch (_) { return new Set(); } };
  const seenPut = (set) => { try { localStorage.setItem(seenKey(), JSON.stringify([...set].slice(-400))); } catch (_) { /* private mode */ } };
  let bellNotes = [], bellRun = 0;
  const goTo = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const namesPreview = (list) => {
    const shown = list.slice(0, 3).map((i) => `${fullName(i.employee)} (${i.course.title})`).join(", ");
    return list.length > 3 ? `${shown} and ${list.length - 3} more` : shown;
  };

  async function buildNotifications() {
    const notes = [];
    const today = todayISO(), soon = addDaysISO(7);
    if (isEmployee()) {
      const { rows } = await loadMyTraining();
      for (const r of rows.filter((x) => x.course.mandatory && x.status !== "valid")) {
        const when = r.rec?.expires_on ? fmtDate(r.rec.expires_on) : "";
        notes.push({
          key: `my:${r.course.id}:${r.status}:${r.rec?.expires_on || ""}`, level: r.status === "expiring" ? "warn" : "bad",
          title: r.status === "expired" ? `${r.course.title} has expired` : r.status === "expiring" ? `${r.course.title} expires ${when}` : `${r.course.title} still to complete`,
          detail: "Upload your certificate once it's done.", go: () => goTo("#my")
        });
      }
      const { data: sess } = await sb.from("sessions").select("id, starts_at, course_id, location").gte("starts_at", new Date().toISOString()).order("starts_at");
      for (const x of (sess || []).filter((y) => y.starts_at.slice(0, 10) <= soon))
        notes.push({ key: `sess:${x.id}`, level: "info", title: `${courseTitle(x.course_id)} on ${fmtDateTime(x.starts_at)}`,
          detail: x.location ? `Location: ${x.location}` : "Training session you're booked into.", go: () => goTo("#mysessions") });
      return notes;
    }

    // Managers and admins
    const { items } = await complianceMatrix(await loadEmployees({ activeOnly: true }));
    const group = (status) => items.filter((i) => i.status === status).sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
    const sig = (list) => list.map((i) => `${i.employee.id}.${i.course.id}.${i.expires_on || ""}`).join("|");
    const openOne = (list, fallback) => () => (list.length === 1 ? showEmployee(list[0].employee.id) : goTo(fallback));
    const expired = group("expired"), expiring = group("expiring"), missing = group("missing");
    if (expired.length) notes.push({ key: `exp:${sig(expired)}`, level: "bad",
      title: `${expired.length} training record${expired.length > 1 ? "s have" : " has"} expired`, detail: namesPreview(expired), go: openOne(expired, "#dashboard") });
    if (expiring.length) notes.push({ key: `soon:${sig(expiring)}`, level: "warn",
      title: `${expiring.length} expiring in the next ${WARN_DAYS} days`, detail: namesPreview(expiring), go: openOne(expiring, "#dashboard") });

    const sched = await loadSchedule();
    for (const x of sched.filter((y) => y.scheduled_date < today))
      notes.push({ key: `drill-late:${x.id}`, level: "bad", title: `Fire drill overdue at ${facilityName(x.facility_id)}`,
        detail: `Scheduled for ${fmtDate(x.scheduled_date)}. Record it once it's done.`, go: () => goTo("#drills") });
    for (const x of sched.filter((y) => y.scheduled_date >= today && y.scheduled_date <= soon)) {
      const days = Math.round((new Date(x.scheduled_date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
      notes.push({ key: `drill-soon:${x.id}:${x.scheduled_date}`, level: days <= 1 ? "warn" : "info",
        title: `Fire drill ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`} at ${facilityName(x.facility_id)}`,
        detail: `${fmtDate(x.scheduled_date)}${x.scheduled_time ? " at " + hhmm(x.scheduled_time) : ""}${x.coordinator ? " · " + x.coordinator : ""}`, go: () => goTo("#drills") });
    }

    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: ups } = await sb.from("completions").select("id, course_id, created_at, employee_id, employees(first_name, last_name)")
      .eq("uploaded_by_employee", true).gte("created_at", since).order("created_at", { ascending: false }).limit(20);
    for (const u of ups || [])
      notes.push({ key: `up:${u.id}`, level: "info", title: `${fullName(u.employees)} uploaded a certificate`,
        detail: `${courseTitle(u.course_id)} · ${fmtDate(u.created_at)}`, go: () => showEmployee(u.employee_id) });

    if (missing.length) notes.push({ key: `miss:${sig(missing)}`, level: "info",
      title: `${missing.length} mandatory course${missing.length > 1 ? "s" : ""} never completed`, detail: namesPreview(missing), go: openOne(missing, "#dashboard") });
    return notes;
  }

  async function refreshBell() {
    const run = ++bellRun;
    let notes;
    try { notes = await buildNotifications(); } catch (_) { return; }
    if (run !== bellRun) return; // a newer refresh has started
    bellNotes = notes;
    const seen = seenGet(), unseen = notes.filter((n) => !seen.has(n.key)).length;
    const c = $("#bellCount");
    c.textContent = unseen > 9 ? "9+" : String(unseen);
    c.classList.toggle("hidden", !unseen);
    $("#bellBtn").setAttribute("aria-label", unseen ? `Notifications, ${unseen} new` : "Notifications");
    if (!$("#bellPanel").classList.contains("hidden")) drawBell(seen);
  }

  function drawBell(seen = seenGet()) {
    const panel = $("#bellPanel");
    panel.innerHTML = `
      <div class="bell-head"><strong>Notifications</strong><span class="muted">${bellNotes.length ? bellNotes.length + " active" : ""}</span></div>
      <div class="bell-list">${bellNotes.map((n, i) => `
        <button type="button" class="bell-item ${n.level} ${seen.has(n.key) ? "" : "is-new"}" data-note="${i}">
          <span class="bell-dot" aria-hidden="true"></span>
          <span class="bell-text"><span class="bell-title">${esc(n.title)}</span><span class="bell-detail">${esc(n.detail)}</span></span>
        </button>`).join("") || `<p class="bell-empty">You're all caught up. Nothing needs attention right now.</p>`}</div>`;
    $$("[data-note]", panel).forEach((b) => b.onclick = () => { closeBell(); bellNotes[Number(b.dataset.note)].go(); });
  }
  function openBell() {
    const seen = seenGet();
    drawBell(seen);                      // new items keep their highlight while the panel is open
    const panel = $("#bellPanel");
    panel.style.top = matchMedia("(max-width: 860px)").matches ? `${Math.round($("#bellBtn").getBoundingClientRect().bottom + 8)}px` : "";
    panel.classList.remove("hidden");
    $("#bellBtn").setAttribute("aria-expanded", "true");
    bellNotes.forEach((n) => seen.add(n.key)); seenPut(seen);
    $("#bellCount").classList.add("hidden");
  }
  function closeBell() {
    $("#bellPanel").classList.add("hidden");
    $("#bellBtn").setAttribute("aria-expanded", "false");
  }
  $("#bellBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#bellPanel").classList.contains("hidden") ? openBell() : closeBell(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".bell-wrap")) closeBell(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBell(); });

  // ============================================================== ROUTER
  let currentView = null;
  async function route() {
    const home = isEmployee() ? "my" : "dashboard";
    let [name, arg] = (location.hash || "#" + home).slice(1).split("/");
    let v = views[name];
    if (!v || (v.adminOnly && !isAdmin()) || (!v.everyone && !!v.employee !== isEmployee())) {
      name = home; v = views[home]; arg = undefined;
      history.replaceState(null, "", "#" + name);
    }
    currentView = v; v.arg = arg;
    const navName = (typeof v.navAs === "function" ? v.navAs() : v.navAs) || name;
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + navName));
    $("#pageTitle").textContent = v.title;
    document.title = `${v.title} · Train Well`;
    $("#pageActions").innerHTML = v.actions ? v.actions() : "";
    $("#sidebar").classList.remove("open");
    const view = $("#view");
    view.innerHTML = `<div class="card empty">Loading…</div>`;
    try { await v.render(view); }
    catch (ex) { view.innerHTML = `<div class="alert error">Couldn't load this page: ${esc(ex.message)}</div>`; }
    refreshBell();
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
