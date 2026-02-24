import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ATENÇÃO: Webhook não usa verify_jwt pois ele é chamado pela InfinityPay pública!
serve(async (req: Request) => {
    // CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'content-type',
            }
        })
    }

    try {
        // Service Role Key — tenta ambos os nomes de secret
        const serviceKey = Deno.env.get('MY_SERVICE_ROLE_KEY')
            || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
            || ''

        if (!serviceKey) {
            console.error('❌ NENHUMA SERVICE ROLE KEY encontrada nos secrets!')
            return new Response(JSON.stringify({ error: 'Config error: service key missing' }), { status: 500 })
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            serviceKey
        )

        const rawText = await req.text()
        console.log("🔔 [Webhook RAW] Body recebido:", rawText)

        let payload: any = {}
        try {
            payload = JSON.parse(rawText)
        } catch (e) {
            try {
                const params = new URLSearchParams(rawText)
                payload = Object.fromEntries(params.entries())
            } catch (_) {
                payload = { raw: rawText }
            }
        }

        console.log("📦 [Webhook] Payload parseado:", JSON.stringify(payload))

        // Salvar payload bruto na tabela de logs para debug
        try {
            await supabaseAdmin.from('webhook_logs').insert({
                payload: payload,
                raw_body: rawText
            })
            console.log("📝 [Webhook] Payload salvo em webhook_logs")
        } catch (logErr) {
            console.log("⚠️ [Webhook] Erro ao salvar log (tabela peut não existir):", logErr)
        }

        // =================================================================================
        // IMPORTANTE: A InfinitePay NÃO envia campo "status" no webhook de checkout.
        // O simples fato de receber este webhook já significa que o pagamento foi APROVADO.
        // O payload contém: order_nsu, receipt_url, slug, capture_method, transaction_nsu
        // Customer data NÃO é incluída no webhook callback.
        // =================================================================================

        // Se houver um campo "status" (para compatibilidade com outros provedores), verificar
        const data = payload.transaction || payload.data || payload;
        const status = (data.status || data.payment_status || data.state || payload.status || '').toUpperCase()

        // Se tiver status explícito e for negativo, rejeitar. 
        // VAZIO ou AUSENTE = aprovado (padrão InfinitePay)
        const statusRejeitados = ['DECLINED', 'REFUSED', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED', 'PENDING', 'WAITING']
        if (status && statusRejeitados.includes(status)) {
            console.log(`⏳ [Webhook] Ignorado. Status "${status}" é negativo.`)
            return new Response(JSON.stringify({
                message: `Ignorado. Status ${status} indica transação não aprovada.`
            }), { status: 200 })
        }

        console.log(`✅ [Webhook] Pagamento considerado APROVADO (status: "${status || 'N/A - padrão InfinitePay'}")`)

        // Extrair order_nsu — formato novo: UUID__MODELO__TIMESTAMP (usando __ como separador seguro)
        // Também suporta o formato antigo com hifens: UUID-MODELO-TIMESTAMP
        let order_nsu = data.order_nsu || data.order_id
            || data.metadata?.order_nsu || data.metadata?.order_id
            || payload.order_nsu || payload.order_id
            || ''

        console.log("🔑 [Webhook] order_nsu original:", order_nsu)

        let userId = ''

        if (order_nsu.includes('__')) {
            // Formato novo (seguro): UUID__PRO__1234567890
            const nsuParts = order_nsu.split('__')
            userId = nsuParts[0]
        } else if (order_nsu) {
            // Formato antigo (compatibilidade): UUID-PRO-1234567890 ou UUID-BASIC-1234567890
            const parts = order_nsu.split('-')
            if (parts.length >= 7) {
                userId = parts.slice(0, 5).join('-')
            } else if (parts.length >= 5) {
                userId = parts.slice(0, 5).join('-')
            }
        }

        console.log("👤 [Webhook] userId extraído:", userId)

        if (!userId || userId.length < 30) {
            // FALLBACK: A InfinitePay NÃO envia dados do customer no webhook,
            // porém salvamos o customer email no order_nsu podemos não ter.
            // Nesse caso tentamos buscar pelo email se veio em algum campo
            const customerEmail = data.customer?.email || data.email || payload.customer?.email || payload.email || ''
            console.log("📧 [Webhook] Tentando fallback por email:", customerEmail)

            if (customerEmail) {
                const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers()
                if (!listErr && users) {
                    const matchedUser = users.find((u: any) => u.email?.toLowerCase() === customerEmail.toLowerCase())
                    if (matchedUser) {
                        userId = matchedUser.id
                        console.log("✅ [Webhook] User encontrado via email fallback:", userId)
                    }
                }
            }

            if (!userId || userId.length < 30) {
                console.error("❌ [Webhook] Nenhum userId válido encontrado! Payload:", JSON.stringify(payload))

                // ÚLTIMO RECURSO: Salvar o payload bruto para debug
                // e tentar buscar o último user que gerou checkout recentemente
                const { data: { users: allUsers }, error: allErr } = await supabaseAdmin.auth.admin.listUsers()
                if (!allErr && allUsers && allUsers.length > 0) {
                    // Pega o usuário mais recentemente criado/atualizado como fallback extremo
                    const sortedUsers = allUsers.sort((a: any, b: any) =>
                        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
                    )

                    // Se existe apenas 1 user, é provável que seja ele
                    if (allUsers.length <= 3) {
                        userId = sortedUsers[0].id
                        console.log(`🔄 [Webhook] FALLBACK EXTREMO: Usando user mais recente: ${sortedUsers[0].email} (${userId})`)
                    } else {
                        return new Response(JSON.stringify({
                            error: 'Nenhum Usuário Vinculado. Pagamento Órfão.',
                            order_nsu,
                            payload_keys: Object.keys(data)
                        }), { status: 400 })
                    }
                }
            }
        }

        const rawPrice = data.amount || data.price || data.value || payload.amount || 0
        const price = typeof rawPrice === 'number' && rawPrice > 1000 ? rawPrice / 100 : rawPrice
        const api_enabled = price >= 50

        console.log(`💰 [Webhook] Preço: R$${price} | API habilitada: ${api_enabled}`)

        // Obter user email real do Supabase
        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId)
        if (userError || !user) {
            console.error("❌ [Webhook] Usuário não encontrado no auth:", userError?.message)
            throw new Error('Usuário pagante não encontrado no banco: ' + userId)
        }

        console.log(`✅ [Webhook] Usuário autenticado: ${user.email}`)

        // Dá 30 dias a partir de agora
        const expiry = new Date()
        expiry.setMonth(expiry.getMonth() + 1)

        // Upsert na tabela licenses
        const { error: dbError } = await supabaseAdmin
            .from('licenses')
            .upsert({
                user_id: user.id,
                email: user.email,
                plan_expires_at: expiry.toISOString(),
                amount_paid: price,
                api_enabled: api_enabled
            }, { onConflict: 'email' })

        if (dbError) {
            console.error("❌ [Webhook] Erro ao gravar licença:", dbError)
            throw dbError
        }

        console.log(`🎉 [Webhook] Sucesso! Licença para ${user.email} ativa até ${expiry.toISOString()}`)

        return new Response(JSON.stringify({
            success: true,
            user: user.email,
            validity: expiry.toISOString(),
            api_enabled
        }), { status: 200 })

    } catch (error: any) {
        console.error('❌ [Webhook] Erro geral:', error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }
})
