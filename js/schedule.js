/* =====================================================================
   Train Well — Staff schedule
   Sections:
     MY SCHEDULE         Week · Month · Upcoming
     EVERYONE'S SCHEDULE Day · Week · Month · Chart · In-Out
     TRADEBOARD          My Shifts · Offered · Week · Month · Recent (+ Approvals for managers)
     PRINT

   In Train Well, app.js mounts this on the Schedule page with its own
   adapter (employees as staff, ids passed as text), and the top-bar home
   picker decides which home is shown.
   ===================================================================== */
(function () {
  'use strict';

  // ---------------- helpers ----------------
  const DAY = 864e5;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const sow = (d) => addDays(sod(d), -sod(d).getDay());              // Sunday
  const som = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const sameDay = (a, b) => sod(a).getTime() === sod(b).getTime();
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseIsoDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const t = (d) => { const h = d.getHours(), m = d.getMinutes();
    return `${h % 12 || 12}${m ? ':' + pad(m) : ''}${h < 12 ? 'a' : 'p'}`; };
  const tLong = (d) => d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
    .replace('a.m.', 'AM').replace('p.m.', 'PM');
  const fmtDay = (d) => d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDayLong = (d) => d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtMonth = (d) => d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hrs = (s) => (s.end - s.start) / 36e5;
  const fmtHrs = (h) => (Math.round(h * 10) / 10).toString().replace(/\.0$/, '');
  const kind = (s) => { const h = s.start.getHours(); return h >= 5 && h < 13 ? 'day' : h >= 13 && h < 21 ? 'eve' : 'night'; };
  const KIND_LABEL = { day: 'Day', eve: 'Evening', night: 'Night' };
  const overlaps = (a, b) => a.start < b.end && a.end > b.start;
  const norm = (s) => ({ ...s, start: new Date(s.starts_at), end: new Date(s.ends_at) });
  const rangeLabel = (a, b) => {
    const e = addDays(b, -1);
    if (a.getMonth() === e.getMonth())
      return `${a.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} – ${e.getDate()}, ${e.getFullYear()}`;
    return `${a.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };
  const initials = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const POSITIONS = ['PCA', 'LPN', 'RN', 'Supervisor', 'Cook', 'Dietary Aide', 'Housekeeping', 'Laundry', 'Recreation', 'Maintenance'];
  const PRESETS = [['Day', '07:00', '15:00'], ['Evening', '15:00', '23:00'], ['Night', '23:00', '07:00']];

  const SECTIONS = {
    mine:     { label: 'My schedule', short: 'Mine',         views: [['week', 'Week'], ['month', 'Month'], ['upcoming', 'Upcoming']] },
    everyone: { label: "Everyone's schedule", short: 'Everyone', views: [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['chart', 'Chart'], ['inout', 'In-Out']] },
    trade:    { label: 'Tradeboard', short: 'Trades',          views: [['myshifts', 'My shifts'], ['offered', 'Offered'], ['week', 'Week'], ['month', 'Month'], ['recent', 'Recent']] },
  };

  // ---------------- component ----------------
  function init(opts) {
    const root = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    const api = opts.adapter;
    // If init() is called again on the same element, retire the old instance.
    if (root._scDestroy) root._scDestroy();
    const instance = {};
    root._scInstance = instance;
    const S = {
      me: null, facilities: [], staff: [], shifts: [], myShifts: [], trades: [],
      facilityId: opts.facilityId ?? null, sec: 'mine', view: 'week', anchor: sod(new Date()),
      loading: false, error: null, seq: 0,
    };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('trainwell.schedule') || '{}'); } catch (e) {}
    if (saved.sec && SECTIONS[saved.sec]) { S.sec = saved.sec; S.view = saved.view; }

    const lead = () => S.me && (S.me.role === 'admin' || S.me.role === 'manager');
    const fid = () => (lead() ? S.facilityId : S.me && S.me.facility_id);
    const staffById = () => Object.fromEntries(S.staff.map((p) => [p.id, p]));
    const facName = (id) => (S.facilities.find((f) => f.id === id) || {}).name || '';
    const nameOf = (id, map) => (id ? (map[id] ? map[id].full_name : 'Former staff') : 'Open shift');

    function views() {
      const v = SECTIONS[S.sec].views.slice();
      if (S.sec === 'trade' && lead()) v.push(['approvals', 'Approvals']);
      return v;
    }

    function range() {
      const a = S.anchor;
      const v = S.view;
      if (['day', 'chart', 'inout'].includes(v)) return [sod(a), addDays(sod(a), 1)];
      if (v === 'week') return [sow(a), addDays(sow(a), 7)];
      if (v === 'month') { const s = sow(som(a)); return [s, addDays(s, 42)]; }
      return null;
    }

    // ---------- loading ----------
    async function load() {
      const my = ++S.seq;
      S.loading = true; S.error = null; paint();
      try {
        if (!S.me) {
          S.me = await api.me();
          S.facilities = await api.facilities();
        }
        const f = fid();
        const now = new Date();
        const r = range();
        const tasks = [api.staff(f), api.trades({ facilityId: f, since: addDays(now, -30) })];
        let mFrom = addDays(sod(now), -42), mTo = addDays(sod(now), 70);
        if (r && S.sec === 'mine') { if (r[0] < mFrom) mFrom = r[0]; if (r[1] > mTo) mTo = r[1]; }
        tasks.push(api.shifts({ from: mFrom, to: mTo, employeeId: S.me.id }));
        tasks.push(r && S.sec !== 'trade' ? api.shifts({ from: r[0], to: r[1], facilityId: f }) : Promise.resolve([]));
        const [staff, trades, mine, shifts] = await Promise.all(tasks);
        if (my !== S.seq) return;
        S.staff = staff;
        S.trades = trades.map((x) => ({ ...x, shift: x.shift ? norm(x.shift) : null }));
        S.myShifts = mine.map(norm);
        S.shifts = shifts.map(norm);
      } catch (e) {
        if (my !== S.seq) return;
        S.error = e.message || String(e);
      }
      S.loading = false; paint();
    }

    function go(patch) {
      Object.assign(S, patch);
      if (!views().some(([k]) => k === S.view)) S.view = views()[0][0];
      try { localStorage.setItem('trainwell.schedule', JSON.stringify({ sec: S.sec, view: S.view })); } catch (e) {}
      load();
    }

    // ---------- shell ----------
    function paint() {
      if (root._scInstance !== instance) return;
      if (!S.me && S.error) { root.innerHTML = `<div class="sc"><p class="sc-error">${esc(S.error)}</p></div>`; return; }
      if (!S.me) { root.innerHTML = '<div class="sc"><p class="sc-muted sc-pad">Loading schedule…</p></div>'; return; }
      const r = range();
      const badge = tradeBadge();
      const fname = fid() ? facName(fid()) : 'All facilities';
      root.innerHTML = `
        <div class="sc">
          <nav class="sc-sections" role="tablist" aria-label="Schedule sections">
            ${Object.entries(SECTIONS).map(([k, s]) => `
              <button type="button" role="tab" class="sc-sec ${S.sec === k ? 'is-on' : ''}" aria-selected="${S.sec === k}" data-sec="${k}">
                <span class="sc-long">${esc(s.label)}</span><span class="sc-short">${esc(s.short)}</span>${k === 'trade' && badge ? `<span class="sc-badge">${badge}</span>` : ''}</button>`).join('')}
            <button type="button" class="sc-print-btn" data-act="print">Print</button>
          </nav>
          <div class="sc-toolbar">
            <div class="sc-views" role="tablist" aria-label="Views">
              ${views().map(([k, l]) => `<button type="button" role="tab" class="sc-view ${S.view === k ? 'is-on' : ''}" aria-selected="${S.view === k}" data-view="${k}">${esc(l)}${k === 'approvals' && pendingCount() ? `<span class="sc-badge">${pendingCount()}</span>` : ''}</button>`).join('')}
            </div>
            ${r ? `<div class="sc-datenav">
              <button type="button" class="sc-ico" data-nav="-1" aria-label="Previous">‹</button>
              <button type="button" class="sc-today" data-nav="0">Today</button>
              <button type="button" class="sc-ico" data-nav="1" aria-label="Next">›</button>
              <span class="sc-range">${esc(rangeText())}</span>
            </div>` : ''}
            ${lead() && S.sec === 'everyone' ? '<button type="button" class="sc-primary" data-act="add">+ Add shift</button>' : ''}
          </div>
          <h2 class="sc-print-title">${esc(fname)} — ${esc(SECTIONS[S.sec].label)}: ${esc((views().find(([k]) => k === S.view) || [, ''])[1])}${r ? ' · ' + esc(rangeText()) : ''}</h2>
          <div class="sc-body ${S.loading ? 'is-loading' : ''}">
            ${S.error ? `<p class="sc-error">${esc(S.error)}</p>` : body()}
          </div>
        </div>`;
      root.querySelectorAll('.sc-sec.is-on, .sc-view.is-on').forEach((el) => {
        const bar = el.parentElement;
        if (el.offsetLeft < bar.scrollLeft || el.offsetLeft + el.offsetWidth > bar.scrollLeft + bar.clientWidth)
          bar.scrollLeft = el.offsetLeft - 8;
      });
    }

    function rangeText() {
      const r = range();
      if (!r) return '';
      if (['day', 'chart', 'inout'].includes(S.view)) return fmtDayLong(S.anchor);
      if (S.view === 'month') return fmtMonth(S.anchor);
      return rangeLabel(r[0], r[1]);
    }

    const pendingCount = () => S.trades.filter((x) => x.status === 'pending').length;
    function tradeBadge() {
      if (lead()) return pendingCount();
      const now = new Date();
      return S.trades.filter((x) => x.status === 'offered' && x.offered_by !== S.me.id && x.shift && x.shift.start > now).length;
    }

    function body() {
      if (!lead() && !S.me.facility_id)
        return empty("You haven't been assigned to a home yet. Ask your manager to add you, then your schedule will show here.");
      const k = S.sec + ':' + S.view;
      switch (k) {
        case 'mine:week': return myWeek();
        case 'mine:month': return monthGrid(S.myShifts, 'mine');
        case 'mine:upcoming': return upcoming(false);
        case 'everyone:day': return dayList();
        case 'everyone:week': return rota();
        case 'everyone:month': return monthGrid(S.shifts, 'everyone');
        case 'everyone:chart': return chart();
        case 'everyone:inout': return inOut();
        case 'trade:myshifts': return upcoming(true);
        case 'trade:offered': return offered();
        case 'trade:week': return tradeCal('week');
        case 'trade:month': return tradeCal('month');
        case 'trade:recent': return recent();
        case 'trade:approvals': return approvals();
      }
      return '';
    }

    const openTradeFor = (shiftId) => S.trades.find((x) => x.shift_id === shiftId && (x.status === 'offered' || x.status === 'pending'));
    const empty = (msg) => `<div class="sc-empty">${esc(msg)}</div>`;

    function shiftChip(s, map, o = {}) {
      const tr = openTradeFor(s.id);
      const who = o.name ? `<span class="sc-chip-name">${esc(nameOf(s.employee_id, map))}</span>` : '';
      const tag = tr ? `<span class="sc-chip-tag" title="${tr.status === 'pending' ? 'Trade waiting for approval' : 'Offered on tradeboard'}">⇄</span>` : '';
      const clickable = lead() && o.edit !== false;
      const el = clickable ? 'button type="button"' : 'div';
      return `<${el} class="sc-chip k-${kind(s)} ${s.employee_id ? '' : 'is-open'}" ${clickable ? `data-act="edit" data-id="${s.id}"` : ''}>
        <span class="sc-chip-time">${t(s.start)}–${t(s.end)}</span>${who}
        ${s.position ? `<span class="sc-chip-pos">${esc(s.position)}</span>` : ''}${tag}</${clickable ? 'button' : 'div'}>`;
    }

    // ---------- MY SCHEDULE ----------
    function myWeek() {
      const [a] = range();
      const days = [...Array(7)].map((_, i) => addDays(a, i));
      const wk = S.myShifts.filter((s) => s.start >= a && s.start < addDays(a, 7));
      const total = wk.reduce((h, s) => h + hrs(s), 0);
      const today = sod(new Date());
      return `
        <div class="sc-summary"><strong>${wk.length}</strong> shift${wk.length === 1 ? '' : 's'} · <strong>${fmtHrs(total)}</strong> hours this week</div>
        <div class="sc-week">
          ${days.map((d) => {
            const list = wk.filter((s) => sameDay(s.start, d));
            return `<div class="sc-wday ${sameDay(d, today) ? 'is-today' : ''}">
              <div class="sc-wday-head"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></div>
              ${list.length ? list.map((s) => `
                <div class="sc-myshift k-${kind(s)}">
                  <div class="sc-myshift-time">${tLong(s.start)} – ${tLong(s.end)}</div>
                  <div class="sc-myshift-meta">${esc(s.position || '')}${lead() || !S.me.facility_id ? ' · ' + esc(facName(s.facility_id)) : ''} · ${fmtHrs(hrs(s))}h</div>
                  ${tradeStatus(s)}
                </div>`).join('') : '<div class="sc-off">Off</div>'}
            </div>`;
          }).join('')}
        </div>`;
    }

    function tradeStatus(s) {
      const tr = openTradeFor(s.id);
      if (!tr) return '';
      if (tr.status === 'offered') return '<div class="sc-status st-offered">Offered on tradeboard</div>';
      return `<div class="sc-status st-pending">Picked up by ${esc(nameOf(tr.picked_up_by, staffById()))} · waiting for manager</div>`;
    }

    function upcoming(tradeMode) {
      const now = new Date();
      const list = S.myShifts.filter((s) => s.end > now).sort((a, b) => a.start - b.start);
      if (!S.me.facility_id && !list.length && !lead())
        return empty("You haven't been assigned to a home yet. Ask your manager to add you.");
      if (!list.length) return empty('No upcoming shifts scheduled.');
      const next = list[0];
      const head = tradeMode
        ? '<p class="sc-help">Can\'t make a shift? Offer it here. A colleague at your home can pick it up, then a manager approves the swap. You\'re still responsible for the shift until it\'s approved.</p>'
        : `<div class="sc-summary">Next shift: <strong>${fmtDay(next.start)}, ${tLong(next.start)} – ${tLong(next.end)}</strong>${next.start <= now ? ' <span class="sc-live">On now</span>' : ''}</div>`;
      let lastDay = '';
      return head + `<div class="sc-list">` + list.map((s) => {
        const tr = openTradeFor(s.id);
        const dk = isoDate(s.start);
        const header = dk !== lastDay ? `<div class="sc-list-date">${fmtDay(s.start)}</div>` : '';
        lastDay = dk;
        let action = '';
        if (tradeMode) {
          if (!tr && s.start > now) action = `<button type="button" class="sc-btn" data-act="offer" data-id="${s.id}">Offer shift</button>`;
          else if (tr) action = `<button type="button" class="sc-btn sc-btn-quiet" data-act="cancel" data-id="${tr.id}">Withdraw</button>`;
        }
        return `${header}<div class="sc-row k-${kind(s)}">
          <div class="sc-row-main"><b>${tLong(s.start)} – ${tLong(s.end)}</b>
            <span class="sc-muted">${esc(s.position || '')} · ${esc(facName(s.facility_id))} · ${fmtHrs(hrs(s))}h</span>
            ${tradeStatus(s)}</div>
          ${action}</div>`;
      }).join('') + '</div>';
    }

    // ---------- EVERYONE ----------
    function visibleStaff() {
      const f = fid();
      return S.staff.filter((p) => (f ? p.facility_id === f : true) && p.facility_id);
    }

    function dayList() {
      const [a, b] = range();
      const map = staffById();
      const list = S.shifts.filter((s) => s.start >= a && s.start < b).sort((x, y) => x.start - y.start || nameOf(x.employee_id, map).localeCompare(nameOf(y.employee_id, map)));
      if (!list.length) return empty('No shifts scheduled for this day.');
      const groups = ['day', 'eve', 'night'].map((k) => [k, list.filter((s) => kind(s) === k)]).filter(([, l]) => l.length);
      const showHome = !fid();
      return groups.map(([k, l]) => `
        <section class="sc-group">
          <h3 class="sc-group-head"><span class="sc-dot k-${k}"></span>${KIND_LABEL[k]} <span class="sc-muted">${l.length} on shift${l.some((s) => !s.employee_id) ? ` · <span class="sc-warn">${l.filter((s) => !s.employee_id).length} open</span>` : ''}</span></h3>
          <div class="sc-list">${l.map((s) => `
            <div class="sc-row ${s.employee_id ? '' : 'is-open'}">
              <div class="sc-avatar">${s.employee_id ? esc(initials(nameOf(s.employee_id, map))) : '?'}</div>
              <div class="sc-row-main"><b>${esc(nameOf(s.employee_id, map))}</b>
                <span class="sc-muted">${tLong(s.start)} – ${tLong(s.end)} · ${esc(s.position || '')}${showHome ? ' · ' + esc(facName(s.facility_id)) : ''}</span></div>
              ${lead() ? `<button type="button" class="sc-btn sc-btn-quiet" data-act="edit" data-id="${s.id}">Edit</button>` : ''}
            </div>`).join('')}</div>
        </section>`).join('');
    }

    function rota() {
      const [a] = range();
      const days = [...Array(7)].map((_, i) => addDays(a, i));
      const map = staffById();
      const wk = S.shifts.filter((s) => s.start >= a && s.start < addDays(a, 7));
      const today = sod(new Date());
      const facIds = fid() ? [fid()] : S.facilities.map((f) => f.id);
      const staffAll = visibleStaff();
      let rows = '';
      for (const f of facIds) {
        const people = staffAll.filter((p) => p.facility_id === f).map((p) => p.id);
        wk.filter((s) => s.facility_id === f && s.employee_id && !people.includes(s.employee_id)).forEach((s) => people.push(s.employee_id));
        people.sort((x, y) => nameOf(x, map).localeCompare(nameOf(y, map)));
        const open = wk.filter((s) => s.facility_id === f && !s.employee_id);
        if (!fid()) rows += `<tr class="sc-rota-fac"><th colspan="9">${esc(facName(f))}</th></tr>`;
        const line = (label, sub, list, empId) => {
          const total = list.reduce((h, s) => h + hrs(s), 0);
          return `<tr><th scope="row" class="sc-rota-name">${label}${sub ? `<small>${sub}</small>` : ''}</th>
            ${days.map((d) => {
              const cell = list.filter((s) => sameDay(s.start, d));
              const add = lead() && empId !== undefined && !cell.length
                ? `<button type="button" class="sc-cell-add" data-act="add" data-emp="${empId || ''}" data-fac="${f}" data-date="${isoDate(d)}" aria-label="Add shift">+</button>` : '';
              return `<td class="${sameDay(d, today) ? 'is-today' : ''}">${cell.map((s) => shiftChip(s, map)).join('')}${add}</td>`;
            }).join('')}
            <td class="sc-rota-hrs">${total ? fmtHrs(total) : ''}</td></tr>`;
        };
        rows += line('<span class="sc-warn">Open shifts</span>', open.length ? `${open.length} to fill` : '', open, '');
        for (const id of people) {
          const p = map[id];
          rows += line(esc(nameOf(id, map)), p && p.role !== 'employee' ? (p.role === 'admin' ? 'Admin' : 'Manager') : '', wk.filter((s) => s.employee_id === id), id);
        }
        if (!people.length) rows += `<tr><td colspan="9" class="sc-muted sc-pad">No staff assigned to this home yet.</td></tr>`;
      }
      return `<div class="sc-scroll"><table class="sc-rota">
        <thead><tr><th>Staff</th>${days.map((d) => `<th class="${sameDay(d, today) ? 'is-today' : ''}">${WD[d.getDay()]} <b>${d.getDate()}</b></th>`).join('')}<th>Hrs</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    }

    function monthGrid(list, mode) {
      const [a] = range();
      const month = S.anchor.getMonth();
      const today = sod(new Date());
      const map = staffById();
      const cells = [...Array(42)].map((_, i) => addDays(a, i));
      return `<div class="sc-month">
        ${WD.map((w) => `<div class="sc-month-wd">${w}</div>`).join('')}
        ${cells.map((d) => {
          const day = list.filter((s) => sameDay(s.start, d)).sort((x, y) => x.start - y.start);
          let inner = '';
          if (mode === 'mine') inner = day.map((s) => `<div class="sc-mchip k-${kind(s)}">${t(s.start)}–${t(s.end)}</div>`).join('');
          else if (day.length) {
            const c = { day: 0, eve: 0, night: 0 }; day.forEach((s) => c[kind(s)]++);
            const open = day.filter((s) => !s.employee_id).length;
            inner = ['day', 'eve', 'night'].filter((k) => c[k]).map((k) => `<div class="sc-mcount"><span class="sc-dot k-${k}"></span>${KIND_LABEL[k]} ${c[k]}</div>`).join('')
              + (open ? `<div class="sc-mcount sc-warn">${open} open</div>` : '');
          }
          const out = d.getMonth() !== month;
          const tag = mode === 'everyone' ? 'button type="button"' : 'div';
          return `<${tag} class="sc-mcell ${out ? 'is-out' : ''} ${sameDay(d, today) ? 'is-today' : ''}" ${mode === 'everyone' ? `data-goday="${isoDate(d)}" aria-label="${fmtDay(d)}: ${day.length} shifts"` : ''}>
            <span class="sc-mnum">${d.getDate()}</span>${inner}</${mode === 'everyone' ? 'button' : 'div'}>`;
        }).join('')}
      </div>${mode === 'everyone' ? '<p class="sc-help">Tap a day to see who\'s working.</p>' : ''}`;
    }

    function chart() {
      const [a, b] = range();
      const map = staffById();
      const list = S.shifts.filter((s) => s.start < b && s.end > a).sort((x, y) => x.start - y.start);
      if (!list.length) return empty('No shifts on this day.');
      const now = new Date();
      const pct = (d) => Math.max(0, Math.min(100, ((d - a) / DAY) * 100));
      const ticks = [...Array(13)].map((_, i) => i * 2);
      const nowLine = now >= a && now < b ? `<div class="sc-now" style="left:${pct(now)}%"><span>Now</span></div>` : '';
      return `<div class="sc-scroll"><div class="sc-chart">
        <div class="sc-chart-axis"><div></div><div class="sc-chart-track">${ticks.map((h) => `<span style="left:${(h / 24) * 100}%">${h === 24 ? '' : t(new Date(2000, 0, 1, h))}</span>`).join('')}</div></div>
        ${list.map((s) => {
          const l = pct(s.start), r = pct(s.end);
          return `<div class="sc-chart-row">
            <div class="sc-chart-label">${esc(nameOf(s.employee_id, map))}<small>${esc(s.position || '')}${!fid() ? ' · ' + esc(facName(s.facility_id)) : ''}</small></div>
            <div class="sc-chart-track">${ticks.map((h) => `<i style="left:${(h / 24) * 100}%"></i>`).join('')}
              <div class="sc-bar k-${kind(s)} ${s.employee_id ? '' : 'is-open'}" style="left:${l}%;width:${Math.max(r - l, 1)}%" title="${tLong(s.start)} – ${tLong(s.end)}">${t(s.start)}–${t(s.end)}</div>
              ${nowLine}</div></div>`;
        }).join('')}
      </div></div>`;
    }

    function inOut() {
      const [a, b] = range();
      const map = staffById();
      const now = new Date();
      const isToday = now >= a && now < b;
      const todays = S.shifts.filter((s) => s.start < b && s.end > a && s.employee_id);
      const working = new Set(todays.map((s) => s.employee_id));
      const off = visibleStaff().filter((p) => !working.has(p.id)).sort((x, y) => x.full_name.localeCompare(y.full_name));
      const card = (s) => `<div class="sc-io-card"><div class="sc-avatar">${esc(initials(nameOf(s.employee_id, map)))}</div>
        <div><b>${esc(nameOf(s.employee_id, map))}</b><span class="sc-muted">${t(s.start)}–${t(s.end)} · ${esc(s.position || '')}${!fid() ? ' · ' + esc(facName(s.facility_id)) : ''}</span></div></div>`;
      const col = (title, cls, items, html) => `<section class="sc-io-col ${cls}"><h3>${title} <span class="sc-count">${items.length}</span></h3>
        ${items.length ? items.map(html).join('') : '<p class="sc-muted">Nobody</p>'}</section>`;
      const offCard = (p) => `<div class="sc-io-card is-off"><div class="sc-avatar">${esc(initials(p.full_name))}</div><div><b>${esc(p.full_name)}</b>${!fid() ? `<span class="sc-muted">${esc(facName(p.facility_id))}</span>` : ''}</div></div>`;
      const by = (x, y) => x.start - y.start;
      if (isToday) {
        return `<div class="sc-io">
          ${col('In now', 'io-in', todays.filter((s) => s.start <= now && s.end > now).sort(by), card)}
          ${col('Coming in later', 'io-later', todays.filter((s) => s.start > now).sort(by), card)}
          ${col('Done for today', 'io-done', todays.filter((s) => s.end <= now).sort(by), card)}
          ${col('Off today', 'io-off', off, offCard)}
        </div>`;
      }
      return `<div class="sc-io">${col('Working', 'io-in', todays.sort(by), card)}${col('Off', 'io-off', off, offCard)}</div>`;
    }

    // ---------- TRADEBOARD ----------
    function offered() {
      const now = new Date();
      const map = staffById();
      const list = S.trades.filter((x) => x.status === 'offered' && x.shift && x.shift.start > now).sort((x, y) => x.shift.start - y.shift.start);
      if (!list.length) return empty('No shifts are being offered right now.');
      return `<div class="sc-list">${list.map((x) => {
        const s = x.shift;
        const mineOffer = x.offered_by === S.me.id;
        const clash = S.myShifts.find((m) => m.id !== s.id && overlaps(m, s));
        let action = '';
        if (mineOffer) action = `<button type="button" class="sc-btn sc-btn-quiet" data-act="cancel" data-id="${x.id}">Withdraw</button>`;
        else if (!lead()) action = clash
          ? `<button type="button" class="sc-btn" disabled title="You're working ${t(clash.start)}–${t(clash.end)} then">You're working then</button>`
          : `<button type="button" class="sc-btn sc-btn-go" data-act="pickup" data-id="${x.id}">Pick up</button>`;
        return `<div class="sc-row k-${kind(s)}">
          <div class="sc-date-tile"><span>${WD[s.start.getDay()]}</span><b>${s.start.getDate()}</b><span>${s.start.toLocaleDateString('en-CA', { month: 'short' })}</span></div>
          <div class="sc-row-main"><b>${tLong(s.start)} – ${tLong(s.end)}</b>
            <span class="sc-muted">${esc(s.position || '')} · ${fmtHrs(hrs(s))}h · offered by ${mineOffer ? 'you' : esc(nameOf(x.offered_by, map))}${!fid() ? ' · ' + esc(facName(x.facility_id)) : ''}</span>
            ${x.note ? `<span class="sc-note">“${esc(x.note)}”</span>` : ''}</div>
          ${action}</div>`;
      }).join('')}</div>`;
    }

    function tradeCal(mode) {
      const [a, b] = range();
      const map = staffById();
      const list = S.trades.filter((x) => (x.status === 'offered' || x.status === 'pending') && x.shift && x.shift.start >= a && x.shift.start < b);
      const today = sod(new Date());
      const chip = (x) => `<div class="sc-tchip st-${x.status}" title="${x.status === 'pending' ? 'Waiting for manager' : 'Available'}">
        <b>${t(x.shift.start)}–${t(x.shift.end)}</b> ${esc(nameOf(x.offered_by, map))}${x.status === 'pending' ? ' → ' + esc(nameOf(x.picked_up_by, map)) : ''}</div>`;
      const legend = '<div class="sc-legend"><span class="sc-tchip st-offered">Available to pick up</span><span class="sc-tchip st-pending">Waiting for manager</span></div>';
      if (mode === 'week') {
        const days = [...Array(7)].map((_, i) => addDays(a, i));
        return legend + `<div class="sc-week">${days.map((d) => {
          const l = list.filter((x) => sameDay(x.shift.start, d));
          return `<div class="sc-wday ${sameDay(d, today) ? 'is-today' : ''}"><div class="sc-wday-head"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></div>
            ${l.length ? l.map(chip).join('') : '<div class="sc-off">—</div>'}</div>`;
        }).join('')}</div>`;
      }
      const month = S.anchor.getMonth();
      return legend + `<div class="sc-month">${WD.map((w) => `<div class="sc-month-wd">${w}</div>`).join('')}
        ${[...Array(42)].map((_, i) => addDays(a, i)).map((d) => `<div class="sc-mcell ${d.getMonth() !== month ? 'is-out' : ''} ${sameDay(d, today) ? 'is-today' : ''}">
          <span class="sc-mnum">${d.getDate()}</span>${list.filter((x) => sameDay(x.shift.start, d)).map(chip).join('')}</div>`).join('')}</div>`;
    }

    function recent() {
      const map = staffById();
      const ev = (x) => new Date(x.decided_at || x.picked_at || x.offered_at);
      const list = S.trades.slice().sort((x, y) => ev(y) - ev(x));
      if (!list.length) return empty('No tradeboard activity in the last 30 days.');
      const label = { offered: 'Offered', pending: 'Waiting for manager', approved: 'Approved', declined: 'Declined', cancelled: 'Withdrawn' };
      return `<div class="sc-list">${list.map((x) => {
        const s = x.shift;
        const who = x.status === 'approved' ? `${esc(nameOf(x.offered_by, map))} → ${esc(nameOf(x.picked_up_by, map))}`
          : x.picked_up_by ? `${esc(nameOf(x.offered_by, map))} → ${esc(nameOf(x.picked_up_by, map))}` : esc(nameOf(x.offered_by, map));
        return `<div class="sc-row">
          <div class="sc-row-main"><b>${who}</b>
            <span class="sc-muted">${s ? `${fmtDay(s.start)}, ${t(s.start)}–${t(s.end)}${s.position ? ' · ' + esc(s.position) : ''}` : 'Shift removed'} · ${ev(x).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span></div>
          <span class="sc-pill st-${x.status}">${label[x.status]}</span></div>`;
      }).join('')}</div>`;
    }

    function approvals() {
      const map = staffById();
      const list = S.trades.filter((x) => x.status === 'pending' && x.shift).sort((x, y) => x.shift.start - y.shift.start);
      if (!list.length) return empty('Nothing waiting for approval.');
      return `<div class="sc-list">${list.map((x) => {
        const s = x.shift;
        return `<div class="sc-row k-${kind(s)}">
          <div class="sc-row-main"><b>${esc(nameOf(x.offered_by, map))} → ${esc(nameOf(x.picked_up_by, map))}</b>
            <span class="sc-muted">${fmtDay(s.start)}, ${tLong(s.start)} – ${tLong(s.end)} · ${esc(s.position || '')} · ${esc(facName(x.facility_id))}</span>
            ${x.note ? `<span class="sc-note">“${esc(x.note)}”</span>` : ''}</div>
          <div class="sc-actions">
            <button type="button" class="sc-btn sc-btn-quiet" data-act="decline" data-id="${x.id}">Decline</button>
            <button type="button" class="sc-btn sc-btn-go" data-act="approve" data-id="${x.id}">Approve</button>
          </div></div>`;
      }).join('')}</div>`;
    }

    // ---------- dialogs ----------
    function modal(html, onSubmit) {
      const wrap = document.createElement('div');
      wrap.className = 'sc-modal';
      wrap.innerHTML = `<form class="sc-dialog" role="dialog" aria-modal="true">${html}<p class="sc-error" hidden></p></form>`;
      document.body.appendChild(wrap);
      const form = wrap.querySelector('form');
      const err = wrap.querySelector('.sc-error');
      const close = () => wrap.remove();
      wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.submitter || form.querySelector('[type=submit]');
        const old = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saving…'; err.hidden = true;
        try { await onSubmit(form, btn); close(); load(); }
        catch (ex) { err.textContent = ex.message || String(ex); err.hidden = false; btn.disabled = false; btn.textContent = old; }
      });
      const first = form.querySelector('input,select,textarea');
      if (first) first.focus();
      return form;
    }

    function shiftDialog(existing, preset = {}) {
      const s = existing;
      const f = s ? s.facility_id : preset.fac || fid() || (S.facilities[0] && S.facilities[0].id);
      const date = s ? isoDate(s.start) : preset.date || isoDate(S.anchor);
      const st = s ? hhmm(s.start) : '07:00', en = s ? hhmm(s.end) : '15:00';
      const emp = s ? s.employee_id || '' : preset.emp || '';
      const staffOpts = (facId) => '<option value="">— Open shift (anyone can be assigned) —</option>' +
        S.staff.filter((p) => p.facility_id === facId).sort((a, b) => a.full_name.localeCompare(b.full_name))
          .map((p) => `<option value="${p.id}" ${p.id === emp ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('');
      const form = modal(`
        <h2>${s ? 'Edit shift' : 'Add shift'}</h2>
        <label>Home
          <select name="facility" ${s ? '' : ''}>${S.facilities.map((x) => `<option value="${x.id}" ${x.id === f ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Staff member <select name="employee">${staffOpts(f)}</select></label>
        <div class="sc-presets" role="group" aria-label="Quick times">${PRESETS.map(([l, a, b]) => `<button type="button" class="sc-btn sc-btn-quiet" data-preset="${a}-${b}">${l} ${t(new Date('2000-01-01T' + a))}–${t(new Date('2000-01-01T' + b))}</button>`).join('')}</div>
        <div class="sc-row3">
          <label>Date <input type="date" name="date" value="${date}" required></label>
          <label>Start <input type="time" name="start" value="${st}" required></label>
          <label>End <input type="time" name="end" value="${en}" required></label>
        </div>
        <p class="sc-help sc-overnight" hidden>Ends the next morning (overnight shift).</p>
        <label>Position <input name="position" list="sc-positions" value="${esc(s ? s.position || '' : preset.position || 'PCA')}" maxlength="40">
          <datalist id="sc-positions">${POSITIONS.map((p) => `<option value="${p}">`).join('')}</datalist></label>
        <label>Notes <span class="sc-opt">(optional)</span><input name="notes" value="${esc(s ? s.notes || '' : '')}" maxlength="200"></label>
        <div class="sc-dialog-actions">
          ${s ? '<button type="button" class="sc-btn sc-btn-danger" data-delete>Delete</button>' : ''}
          <span class="sc-spacer"></span>
          <button type="button" class="sc-btn sc-btn-quiet" data-close>Cancel</button>
          <button type="submit" class="sc-btn sc-btn-go">${s ? 'Save' : 'Add shift'}</button>
        </div>`, async (form) => {
        const d = parseIsoDate(form.date.value);
        const [sh, sm] = form.start.value.split(':').map(Number);
        const [eh, em] = form.end.value.split(':').map(Number);
        const start = new Date(d); start.setHours(sh, sm, 0, 0);
        const end = new Date(d); end.setHours(eh, em, 0, 0);
        if (end <= start) end.setDate(end.getDate() + 1);
        await api.saveShift({
          id: s ? s.id : undefined,
          facility_id: form.facility.value,
          employee_id: form.employee.value || null,
          position: form.position.value.trim() || null,
          notes: form.notes.value.trim() || null,
          starts_at: start.toISOString(), ends_at: end.toISOString(),
        });
        toast(s ? 'Shift updated' : 'Shift added');
      });
      const overnight = form.querySelector('.sc-overnight');
      const upd = () => { overnight.hidden = !(form.start.value && form.end.value && form.end.value <= form.start.value); };
      form.start.addEventListener('input', upd); form.end.addEventListener('input', upd); upd();
      form.facility.addEventListener('change', () => { form.employee.innerHTML = staffOpts(form.facility.value); });
      form.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const [a, c] = b.dataset.preset.split('-'); form.start.value = a; form.end.value = c; upd();
      }));
      const del = form.querySelector('[data-delete]');
      if (del) del.addEventListener('click', async () => {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Tap again to delete'; return; }
        try { await api.deleteShift(s.id); form.parentElement.remove(); toast('Shift deleted'); load(); }
        catch (ex) { const e = form.querySelector('.sc-error'); e.textContent = ex.message; e.hidden = false; }
      });
    }

    function offerDialog(shift) {
      modal(`
        <h2>Offer this shift</h2>
        <p class="sc-dialog-shift">${fmtDay(shift.start)}, ${tLong(shift.start)} – ${tLong(shift.end)}${shift.position ? ' · ' + esc(shift.position) : ''}</p>
        <p class="sc-help">Colleagues at your home will see it on the tradeboard. If someone picks it up, a manager approves the swap. Until then, it's still your shift.</p>
        <label>Note <span class="sc-opt">(optional)</span><input name="note" maxlength="140" placeholder="e.g. Family event — happy to swap for a weekend"></label>
        <div class="sc-dialog-actions"><span class="sc-spacer"></span>
          <button type="button" class="sc-btn sc-btn-quiet" data-close>Cancel</button>
          <button type="submit" class="sc-btn sc-btn-go">Offer shift</button></div>`,
      async (form) => { await api.offerShift(shift.id, form.note.value); toast('Shift offered on the tradeboard'); });
    }

    function toast(msg, bad) {
      document.querySelectorAll('.sc-toast').forEach((x) => x.remove());
      const el = document.createElement('div');
      el.className = 'sc-toast' + (bad ? ' is-bad' : '');
      el.setAttribute('role', 'status');
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    }

    async function act(fn, ok) {
      try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message || String(e), true); }
      load();
    }

    // ---------- events ----------
    const onClick = (e) => {
      const b = e.target.closest('button,[data-goday]');
      if (!b || !root.contains(b) || b.disabled) return;
      if (b.dataset.sec) return go({ sec: b.dataset.sec, view: SECTIONS[b.dataset.sec].views[0][0] });
      if (b.dataset.view) return go({ view: b.dataset.view });
      if (b.dataset.nav !== undefined) {
        const n = Number(b.dataset.nav);
        if (n === 0) return go({ anchor: sod(new Date()) });
        const v = S.view;
        const step = ['day', 'chart', 'inout'].includes(v) ? addDays(S.anchor, n) : v === 'week' ? addDays(S.anchor, 7 * n) : addMonths(S.anchor, n);
        return go({ anchor: step });
      }
      if (b.dataset.goday) return go({ sec: 'everyone', view: 'day', anchor: parseIsoDate(b.dataset.goday) });
      const a = b.dataset.act, id = b.dataset.id;
      if (a === 'print') return opts.onPrint ? opts.onPrint() : window.print();
      if (a === 'add') return shiftDialog(null, { emp: b.dataset.emp, fac: b.dataset.fac, date: b.dataset.date });
      if (a === 'edit') return shiftDialog(S.shifts.find((s) => s.id === id) || S.myShifts.find((s) => s.id === id));
      if (a === 'offer') return offerDialog(S.myShifts.find((s) => s.id === id));
      if (a === 'cancel') return act(() => api.cancelTrade(id), 'Offer withdrawn');
      if (a === 'pickup') return act(() => api.pickUp(id), 'Request sent — a manager will approve it');
      if (a === 'approve') return act(() => api.decide(id, true), 'Trade approved — schedule updated');
      if (a === 'decline') return act(() => api.decide(id, false), 'Trade declined');
    };
    root.addEventListener('click', onClick);
    root._scDestroy = () => { root.removeEventListener('click', onClick); root._scDestroy = null; };

    if (!views().some(([k]) => k === S.view)) S.view = SECTIONS[S.sec].views[0][0];
    load();

    return {
      setFacility(id) {
        S.facilityId = id || null;
        if (id && !S.facilities.some((f) => f.id === id)) S.me = null;   // new home added — refetch list
        load();
      },
      refresh: load,
      get state() { return S; },
    };
  }

  // ---------------- Supabase adapter ----------------
  function SupabaseAdapter(db) {
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    async function all(build) {
      const out = [];
      for (let i = 0; ; i += 1000) {
        const page = ok(await build().range(i, i + 999));
        out.push(...page);
        if (page.length < 1000) return out;
      }
    }
    return {
      async me() {
        const { data: { user } } = await db.auth.getUser();
        if (!user) throw new Error('Please sign in');
        return ok(await db.from('profiles').select('id, full_name, role, facility_id').eq('id', user.id).single());
      },
      facilities: async () => ok(await db.from('facilities').select('id, name').order('name')),
      staff: (facilityId) => all(() => {
        let q = db.from('profiles').select('id, full_name, role, facility_id').order('full_name');
        return facilityId ? q.eq('facility_id', facilityId) : q;
      }),
      shifts: ({ from, to, facilityId, employeeId }) => all(() => {
        let q = db.from('shifts').select('*').lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at');
        if (facilityId) q = q.eq('facility_id', facilityId);
        if (employeeId) q = q.eq('employee_id', employeeId);
        return q;
      }),
      trades: ({ facilityId, since }) => all(() => {
        let q = db.from('shift_trades').select('*, shift:shifts(*)')
          .or(`status.in.(offered,pending),offered_at.gte.${since.toISOString()}`)
          .order('offered_at', { ascending: false });
        return facilityId ? q.eq('facility_id', facilityId) : q;
      }),
      async saveShift(s) {
        const { id, ...row } = s;
        if (id) ok(await db.from('shifts').update(row).eq('id', id).select());
        else ok(await db.from('shifts').insert(row).select());
      },
      deleteShift: async (id) => ok(await db.from('shifts').delete().eq('id', id)),
      offerShift: async (id, note) => ok(await db.rpc('offer_shift', { p_shift_id: id, p_note: note || null })),
      cancelTrade: async (id) => ok(await db.rpc('cancel_trade', { p_trade_id: id })),
      pickUp: async (id) => ok(await db.rpc('pick_up_shift', { p_trade_id: id })),
      decide: async (id, approve) => ok(await db.rpc('decide_trade', { p_trade_id: id, p_approve: approve })),
    };
  }

  // ---------------- Demo adapter (no database; same rules) ----------------
  function DemoAdapter(cfg) {
    const D = cfg.data; // { facilities, staff, shifts, trades }
    const me = () => D.staff.find((p) => p.id === cfg.userId());
    const isLead = () => ['admin', 'manager'].includes(me().role);
    const myFac = () => me().facility_id;
    const canSee = (facId) => isLead() || facId === myFac();
    const uid = () => 'x' + Math.random().toString(36).slice(2, 10);
    const delay = (v) => new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(v))), 60));
    const shiftById = (id) => D.shifts.find((s) => s.id === id);
    const clash = (empId, s, ignore) => D.shifts.some((x) => x.employee_id === empId && x.id !== ignore &&
      new Date(x.starts_at) < new Date(s.ends_at) && new Date(x.ends_at) > new Date(s.starts_at));
    const fail = (m) => { throw new Error(m); };
    return {
      me: () => delay(me()),
      facilities: () => delay(D.facilities.filter((f) => canSee(f.id))),
      staff: (f) => delay(D.staff.filter((p) => (isLead() || (p.facility_id && p.facility_id === myFac()) || p.id === me().id) && (!f || p.facility_id === f))),
      shifts: ({ from, to, facilityId, employeeId }) => delay(D.shifts.filter((s) => canSee(s.facility_id) &&
        new Date(s.starts_at) < to && new Date(s.ends_at) > from && (!facilityId || s.facility_id === facilityId) && (!employeeId || s.employee_id === employeeId))),
      trades: ({ facilityId, since }) => delay(D.trades.filter((x) => canSee(x.facility_id) && (!facilityId || x.facility_id === facilityId) &&
        (['offered', 'pending'].includes(x.status) || new Date(x.offered_at) >= since)).map((x) => ({ ...x, shift: shiftById(x.shift_id) || null }))),
      async saveShift(s) {
        if (!isLead()) fail('Only managers can change the schedule');
        const e = new Date(s.ends_at) - new Date(s.starts_at);
        if (e <= 0 || e > DAY) fail('Shift must be between 1 minute and 24 hours long');
        if (s.employee_id && clash(s.employee_id, s, s.id)) fail('This person already has a shift that overlaps this time');
        if (s.id) {
          const old = shiftById(s.id);
          if (old.employee_id !== s.employee_id) D.trades.filter((x) => x.shift_id === s.id && ['offered', 'pending'].includes(x.status)).forEach((x) => { x.status = 'cancelled'; x.decided_at = new Date().toISOString(); });
          Object.assign(old, s);
        } else D.shifts.push({ ...s, id: uid() });
        return delay(null);
      },
      async deleteShift(id) {
        if (!isLead()) fail('Only managers can change the schedule');
        D.shifts = D.shifts.filter((s) => s.id !== id);
        D.trades = D.trades.filter((x) => x.shift_id !== id);
        return delay(null);
      },
      async offerShift(id, note) {
        const s = shiftById(id);
        if (!s || s.employee_id !== me().id) fail('You can only offer your own shifts');
        if (new Date(s.starts_at) <= new Date()) fail('This shift has already started');
        if (D.trades.some((x) => x.shift_id === id && ['offered', 'pending'].includes(x.status))) fail('This shift is already on the tradeboard');
        D.trades.push({ id: uid(), shift_id: id, facility_id: s.facility_id, offered_by: me().id, offered_at: new Date().toISOString(), note: (note || '').trim() || null, status: 'offered' });
        return delay(null);
      },
      async cancelTrade(id) {
        const x = D.trades.find((y) => y.id === id);
        if (!x || x.offered_by !== me().id) fail('You can only withdraw your own offers');
        if (!['offered', 'pending'].includes(x.status)) fail('This trade is already closed');
        x.status = 'cancelled'; x.decided_at = new Date().toISOString();
        return delay(null);
      },
      async pickUp(id) {
        const x = D.trades.find((y) => y.id === id);
        if (!x || x.status !== 'offered') fail('This shift is no longer available');
        if (x.offered_by === me().id) fail("You can't pick up your own shift");
        if (x.facility_id !== myFac()) fail('You can only pick up shifts at your own home');
        const s = shiftById(x.shift_id);
        if (new Date(s.starts_at) <= new Date()) fail('This shift has already started');
        if (clash(me().id, s)) fail("You're already working during this shift");
        Object.assign(x, { picked_up_by: me().id, picked_at: new Date().toISOString(), status: 'pending' });
        return delay(null);
      },
      async decide(id, approve) {
        if (!isLead()) fail('Only a manager or admin can approve trades');
        const x = D.trades.find((y) => y.id === id);
        if (!x || x.status !== 'pending') fail("This trade isn't waiting for approval");
        const s = shiftById(x.shift_id);
        if (approve && clash(x.picked_up_by, s, s.id)) fail('That person now has a clashing shift');
        Object.assign(x, { status: approve ? 'approved' : 'declined', decided_by: me().id, decided_at: new Date().toISOString() });
        if (approve) s.employee_id = x.picked_up_by;
        return delay(null);
      },
    };
  }

  window.Schedule = { init, SupabaseAdapter, DemoAdapter };
})();
