import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
    try {
        // 1. Init Supabase Client (Admin/Service Role recommended for background tasks)
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || ''
        const supabase = createClient(supabaseUrl, supabaseKey)

        // 2. Perform a lightweight query to "wake up" the DB
        // querying 'users' or any small table with limit 1 is sufficient
        const { data, error } = await supabase.from('users').select('id').limit(1)

        if (error) throw error

        return new Response(
            JSON.stringify({ message: "Supabase DB is awake!", data }),
            { headers: { "Content-Type": "application/json" } },
        )
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        })
    }
})
