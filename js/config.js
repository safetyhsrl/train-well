// =====================================================================
// Train Well — connection settings
// Paste the values from Supabase: Project Settings -> API
// The "anon public" key is safe to put here: the database security rules
// (Row Level Security in supabase/schema.sql) decide what each login can see.
// NEVER put the "service_role" key in this file.
// =====================================================================
window.TRAINWELL_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  COMPANY_NAME: "Train Well",
  EXPIRY_WARNING_DAYS: 30
};
