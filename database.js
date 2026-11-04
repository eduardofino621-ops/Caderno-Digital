
import { createClient } from
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://lzmpartyirwmmfazezyx.supabase.co";

const SUPABASE_KEY = "sb_publishable_eiucFgPNRD5ZTv6vrVNyNQ_mcl4DhIn";

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage
        }
    }
);
