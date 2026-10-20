// Train Well — "employee-access" Edge Function
// Lets an ADMIN give an employee their own login, or take it away.
//
//   { action: "invite",   employee_id, email, redirect_to }  -> emails the employee a link to set their password
//   { action: "password", employee_id, email, password }     -> creates the login with a temporary password (no email sent)
//   { action: "remove",   employee_id }                      -> deletes the employee's login (their records stay)
//
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via Editor,
//         name it exactly  employee-access  and paste this file.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Works with both the classic and the newer Supabase key settings
function envKey(classic: string, modern: string): string {
  const v = Deno.env.get(classic);
  if (v) return v;
  const raw = Deno.env.get(modern) ?? "";
  try { const j = JSON.parse(raw); return typeof j === "string" ? j : String(Object.values(j)[0] ?? ""); }
  catch { return raw; }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = envKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Who is calling? (checked with the secure key)
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) return json({ error: "Not signed in." }, 401);

  const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Only administrators can manage employee logins." }, 403);

  // 2. Input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = String(body.action ?? "");
  const employeeId = Number(body.employee_id);
  if (!employeeId) return json({ error: "Missing employee." }, 400);

  const { data: emp } = await admin.from("employees").select("id, first_name, last_name, facility_id").eq("id", employeeId).maybeSingle();
  if (!emp) return json({ error: "Employee not found." }, 404);
  const fullName = `${emp.first_name} ${emp.last_name}`;
  const { data: existing } = await admin.from("profiles").select("id, email").eq("employee_id", employeeId).maybeSingle();

  // ---- Remove login
  if (action === "remove") {
    if (!existing) return json({ ok: true });
    const { error } = await admin.auth.admin.deleteUser(existing.id);
    if (error && !/not found/i.test(error.message)) return json({ error: error.message }, 400);
    await admin.from("profiles").delete().eq("id", existing.id);
    return json({ ok: true });
  }

  if (action !== "invite" && action !== "password") return json({ error: "Unknown action." }, 400);
  if (existing) return json({ error: `${fullName} already has a login (${existing.email}).` }, 400);

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required." }, 400);

  // ---- Create the login
  let newId: string;
  if (action === "invite") {
    const redirectTo = typeof body.redirect_to === "string" ? body.redirect_to : undefined;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: fullName } });
    if (error || !data.user) {
      const msg = error?.message ?? "Could not send the invite.";
      if (/already/i.test(msg)) return json({ error: "That email already has a login." }, 400);
      if (/rate|limit/i.test(msg)) return json({ error: "Supabase's email limit was reached. Try again later, or use 'Set a temporary password' instead." }, 429);
      return json({ error: msg }, 400);
    }
    newId = data.user.id;
  } else {
    const password = String(body.password ?? "");
    if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error || !data.user) {
      const msg = error?.message ?? "Could not create the login.";
      return json({ error: /already/i.test(msg) ? "That email already has a login." : msg }, 400);
    }
    newId = data.user.id;
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: newId, full_name: fullName, email, role: "employee",
    facility_id: emp.facility_id, employee_id: employeeId, active: true,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(newId); // roll back
    return json({ error: profErr.message }, 400);
  }
  // Keep the employee record's email in step with the login
  await admin.from("employees").update({ email }).eq("id", employeeId);
  return json({ ok: true, id: newId });
});
