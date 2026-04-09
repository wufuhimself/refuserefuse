/**
 * Supabase client skeleton.
 *
 * Replace the placeholders with your Supabase project URL and anon key.
 * For secure builds, keep keys in environment variables (app.json extra or eas secrets).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key-here';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
