import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        // Verifica usuário através do JWT enviado pela Extensão
        const { data: { user }, error: authErr } = await supabaseClient.auth.getUser()
        if (authErr || !user) throw new Error('Não autenticado ou token inválido')

        const { amount } = await req.json()
        const isApiUnlocked = amount >= 50
        const priceInCents = Math.round(amount * 100)

        if (priceInCents < 500) throw new Error('Valor mínimo é R$ 5,00')

        const handle = Deno.env.get('INFINITEPAY_HANDLE')
        if (!handle) throw new Error('INFINITEPAY_HANDLE ausente nos Secrets do Supabase')

        const order_nsu = `${user.id}__${isApiUnlocked ? 'PRO' : 'BASIC'}__${Date.now()}`

        const payload = {
            handle: handle,
            items: [{
                quantity: 1,
                price: priceInCents,
                description: `FlowZap Assinatura - ${isApiUnlocked ? 'API Liberada' : 'Acesso Padrão'}`
            }],
            order_nsu: order_nsu,
            // Redireciona de volta p/ whats web. O WhatsApp recarrega e a ext confere a licença dinamicamente.
            redirect_url: "https://web.whatsapp.com/?FlowZap_paid=true",
            webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/infinitepay-webhook`,
            customer: {
                email: user.email,
                name: user.user_metadata?.name || "Usuário FlowZap"
            }
        }

        // Call API InfinitePay de Checkout
        const ipRes = await fetch('https://api.infinitepay.io/invoices/public/checkout/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        const ipData = await ipRes.json()

        if (!ipRes.ok) {
            console.error('Erro InfinitePay:', ipData)
            throw new Error('Falha ao gerar link na InfinitePay')
        }

        return new Response(JSON.stringify({ url: ipData.url || ipData.checkout_url }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
