import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Faltam as variáveis de Supabase.");
}

export const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);

export async function getAdminSession() {
  const { data, error } = await supabaseAuth.auth.getSession();

  if (error || !data?.session) {
    return null;
  }

  return data.session;
}
