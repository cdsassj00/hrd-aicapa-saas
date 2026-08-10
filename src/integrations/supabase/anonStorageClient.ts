// Anon-only Supabase client used EXCLUSIVELY for answer-file storage uploads.
// Reason: storage-api intermittently rejects the user's authenticated JWT with
// a 403 "row-level security" message. Uploading with the publishable anon key
// bypasses that JWT verification path. RLS on storage.objects still restricts
// access, but for the `answer-files` bucket we explicitly allow anon
// INSERT/UPDATE (see migrations). Use only for this bucket.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const anonStorage = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'sb-anon-storage-only',
  },
});
