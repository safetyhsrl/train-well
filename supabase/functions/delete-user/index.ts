// Train Well — "delete-user" Edge Function
// Lets an ADMIN permanently delete manager/admin logins from the Users page.
// Runs on Supabase's servers, so the secret service-role key never reaches the browser.
//
// Deploy:  Supabase dashboard -> Edge Functions -> Deploy a new function -> Via Editor,
//          name it exactly  delete-user  and paste this file.
//    or:   supabase functions deploy delete-user

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
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Only administrators can delete users." }, 403);

  // 2. Validate input
  let body: { ids?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return json({ error: "No users selected." }, 400);
  if (ids.includes(user.id)) return json({ error: "You can't delete your own account." }, 400);

  // 3. Delete each login (its profile row is removed automatically)
  const failed: string[] = [];
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) failed.push(error.message);
    await admin.from("profiles").delete().eq("id", id); // in case the login was already gone
  }
  if (failed.length) return json({ error: `Some users could not be deleted: ${failed[0]}` }, 400);
  return json({ ok: true, deleted: ids.length });
});
