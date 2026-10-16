// Train Well — "create-user" Edge Function
// Lets an ADMIN create a new manager/admin login from the Users page.
// Runs on Supabase's servers, so the secret service-role key never reaches the browser.
//
// Deploy:  supabase functions deploy create-user
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Who is calling? Must be a signed-in, active admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return json({ error: "Not signed in." }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Only administrators can add users." }, 403);

  // 2. Validate input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const full_name = String(body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = body.role === "admin" ? "admin" : "manager";
  const facility_id = role === "admin" ? null : Number(body.facility_id) || null;

  if (!full_name) return json({ error: "Full name is required." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  if (role === "manager" && !facility_id) return json({ error: "Managers need a facility." }, 400);

  // 3. Create the login, then the profile
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? "Could not create user.";
    return json({ error: /already/i.test(msg) ? "A user with that email already exists." : msg }, 400);
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id, full_name, email, role, facility_id, active: true,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id); // roll back
    return json({ error: profErr.message }, 400);
  }

  return json({ ok: true, id: created.user.id });
});
