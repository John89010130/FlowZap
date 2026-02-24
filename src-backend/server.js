// ==========================================================================
// FlowZap — Servidor Local Unificado de Pagamentos (Checkout + Webhook)
// Roda na porta 3001 — A extensão e a InfinityPay comunicam com ele.
// ==========================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jrqwakwdvzeuqynesqbn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sua_service_role_key_aqui';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sua_anon_key_aqui';
const INFINITYPAY_HANDLE = 'johnerix';
const PORT = process.env.PORT || 3001;

const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ──────────────────────────────────────────────────────────────────────────────
// ROTA 1 — GERAR LINK DE CHECKOUT INFINITYPAY
// POST /api/checkout   { amount: 20 }
// Header: Authorization: Bearer <supabase_access_token>
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Token ausente' });

        const token = authHeader.replace('Bearer ', '');

        // Valida usuário pelo token do Supabase Auth
        const supaUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } }
        });
        const { data: { user }, error: authErr } = await supaUser.auth.getUser();
        if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

        const amount = parseInt(req.body.amount, 10);
        if (!amount || amount < 5) return res.status(400).json({ error: 'Valor mínimo R$ 5,00' });

        const priceInCents = amount * 100;
        const isApiTier = amount >= 50;
        const order_nsu = `${user.id}__${isApiTier ? 'PRO' : 'BASIC'}__${Date.now()}`;

        console.log(`💳 Gerando checkout InfinityPay para ${user.email} | R$ ${amount} | Tier: ${isApiTier ? 'PRO+API' : 'BASIC'}`);

        const payload = {
            handle: INFINITYPAY_HANDLE,
            items: [{
                quantity: 1,
                price: priceInCents,
                description: `FlowZap Mensal – ${isApiTier ? 'PRO + API Externa' : 'Padrão'}`
            }],
            order_nsu,
            redirect_url: 'https://web.whatsapp.com/?FlowZap_paid=true',
            webhook_url: `https://SEU_DOMINIO_PUBLICO/api/webhooks/infinitypay`, // trocar depois por ngrok/domínio
            customer: {
                email: user.email,
                name: user.user_metadata?.name || 'Usuário FlowZap'
            }
        };

        const ipRes = await fetch('https://api.infinitepay.io/invoices/public/checkout/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const ipData = await ipRes.json();
        console.log('↩️  Resposta InfinityPay:', JSON.stringify(ipData));

        if (!ipRes.ok) return res.status(502).json({ error: 'InfinityPay recusou', detail: ipData });

        // A InfinityPay retorna o link de checkout no campo "url" ou "checkout_url"
        const checkoutUrl = ipData.url || ipData.checkout_url || ipData.link;
        if (!checkoutUrl) return res.status(502).json({ error: 'Sem URL no retorno', detail: ipData });

        res.json({ url: checkoutUrl });

    } catch (err) {
        console.error('❌ Erro checkout:', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// ROTA 2 — WEBHOOK DA INFINITYPAY (chamada automática após pagamento confirmado)
// POST /api/webhooks/infinitypay
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/webhooks/infinitypay', async (req, res) => {
    try {
        const payload = req.body;
        console.log('🔔 [Webhook InfinityPay] Payload:', JSON.stringify(payload));

        // InfinitePay NÃO envia campo status - receber o webhook = pagamento aprovado
        const status = (payload.status || payload.payment_status || '').toUpperCase();
        const statusRejeitados = ['DECLINED', 'REFUSED', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED', 'PENDING', 'WAITING'];
        if (status && statusRejeitados.includes(status)) {
            console.log('⏳ Status negativo:', status);
            return res.json({ ignored: true, status });
        }
        console.log('✅ Pagamento considerado APROVADO (status:', status || 'N/A', ')');

        // Extrair o order_nsu que mandamos na criação
        const nsu = payload.order_nsu || '';
        let userId = '';
        let tier = 'BASIC';

        if (nsu.includes('__')) {
            // Formato novo: UUID__TIER__TIMESTAMP
            const nsuParts = nsu.split('__');
            userId = nsuParts[0];
            tier = nsuParts[1] || 'BASIC';
        } else if (nsu) {
            // Formato antigo: UUID-TIER-TIMESTAMP (hifens misturados com UUID)
            const parts = nsu.split('-');
            userId = parts.slice(0, 5).join('-');
            tier = parts[5] || 'BASIC';
        }

        if (!userId || userId.length < 30) {
            // Fallback: tenta localizar pelo email do customer
            const email = payload.customer?.email || payload.email || payload.customer_email;
            if (email) {
                return await processPaymentByEmail(email, payload, res);
            }
            return res.status(400).json({ error: 'NSU sem user_id válido' });
        }

        // Buscar o usuário no Supabase Auth
        const { data: { user }, error: uerr } = await supaAdmin.auth.admin.getUserById(userId);
        if (uerr || !user) return res.status(404).json({ error: 'Usuário não encontrado' });

        const amountPaid = (payload.amount || payload.price || 0) / 100;
        const apiEnabled = tier === 'PRO' || amountPaid >= 50;
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 1);

        const { error: dbErr } = await supaAdmin.from('licenses').upsert({
            user_id: user.id,
            email: user.email,
            plan_expires_at: expiry.toISOString(),
            amount_paid: amountPaid,
            api_enabled: apiEnabled
        }, { onConflict: 'email' });

        if (dbErr) throw dbErr;

        console.log(`🎉 Licença ativada! ${user.email} → Até ${expiry.toLocaleDateString()} | API: ${apiEnabled}`);
        res.json({ success: true, email: user.email, expires: expiry, api: apiEnabled });

    } catch (err) {
        console.error('❌ Erro webhook:', err);
        res.status(500).json({ error: err.message });
    }
});

// Fallback de pagamento caso o NSU esteja sem UUID (busca por email)
async function processPaymentByEmail(email, payload, res) {
    const { data } = await supaAdmin.auth.admin.listUsers();
    let user = (data?.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
        // Cria conta nova automaticamente
        const pwd = Math.random().toString(36).slice(-8);
        const { data: nu, error: ne } = await supaAdmin.auth.admin.createUser({
            email, password: pwd, email_confirm: true, user_metadata: { name: payload.customer?.name || '' }
        });
        if (ne) return res.status(500).json({ error: ne.message });
        user = nu.user;
        console.log(`🔑 Novo usuário criado para ${email} — Senha: ${pwd}`);
    }

    const amountPaid = (payload.amount || payload.price || 0) / 100;
    const apiEnabled = amountPaid >= 50;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1);

    await supaAdmin.from('licenses').upsert({
        user_id: user.id, email: user.email,
        plan_expires_at: expiry.toISOString(),
        amount_paid: amountPaid, api_enabled: apiEnabled
    }, { onConflict: 'email' });

    console.log(`🎉 Licença (fallback email) para ${email} até ${expiry.toLocaleDateString()}`);
    res.json({ success: true, email, expires: expiry, api: apiEnabled });
}

// ──────────────────────────────────────────────────────────────────────────────
// ROTA 3 — ATIVAR LICENÇA MANUAL (Para você, Master, via Postman)
// POST /api/admin/activate   { email, days, api_enabled }
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/admin/activate', async (req, res) => {
    try {
        const { email, days = 30, api_enabled = false, password } = req.body;
        if (!email) return res.status(400).json({ error: 'Email obrigatório' });

        const { data } = await supaAdmin.auth.admin.listUsers();
        let user = (data?.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());

        if (!user) {
            const pwd = password || Math.random().toString(36).slice(-8);
            const { data: nu, error: ne } = await supaAdmin.auth.admin.createUser({
                email, password: pwd, email_confirm: true
            });
            if (ne) return res.status(500).json({ error: ne.message });
            user = nu.user;
            console.log(`🔑 Usuário criado: ${email} / Senha: ${pwd}`);
        }

        const expiry = new Date();
        expiry.setDate(expiry.getDate() + days);

        await supaAdmin.from('licenses').upsert({
            user_id: user.id, email: user.email,
            plan_expires_at: expiry.toISOString(),
            api_enabled
        }, { onConflict: 'email' });

        console.log(`✅ Licença manual: ${email} → ${days} dias | API: ${api_enabled}`);
        res.json({ success: true, email, expires: expiry, api_enabled });

    } catch (err) {
        console.error('❌ Erro admin:', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// ROTA 4 — WHATSAPP BAILEYS (Relatório IA)
// ──────────────────────────────────────────────────────────────────────────────
const waService = require('./whatsapp_service');

app.get('/api/wa/status', (req, res) => {
    const { session } = req.query;
    if (!session) return res.status(400).json({ error: 'Sessão não informada' });
    res.json(waService.getStatus(session));
});

app.post('/api/wa/connect', async (req, res) => {
    const { session } = req.body;
    if (!session) return res.status(400).json({ error: 'Sessão não informada' });

    try {
        const data = await waService.startSession(session);
        res.json({ success: true, status: data.status, qr: data.qrBase64 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/wa/import-history', async (req, res) => {
    const { session, contact, dataIni, dataFim } = req.body;
    if (!session || !contact || !dataIni || !dataFim) {
        return res.status(400).json({ error: 'Parâmetros incompletos (session, contact, dataIni, dataFim)' });
    }

    try {
        console.log(`[WA] Extraindo histórico de ${contact} | Período: ${dataIni} -> ${dataFim}`);
        const result = await waService.fetchAndAnalyzeHistory(session, contact, dataIni, dataFim);
        res.json(result);
    } catch (e) {
        console.error('Erro /import-history:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/wa/import-history-stream', async (req, res) => {
    const { session, dataIni, dataFim } = req.query;
    if (!session || !dataIni || !dataFim) {
        return res.status(400).json({ error: 'Parâmetros incompletos (session, dataIni, dataFim)' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Ensure that frontend receives messages immediately
    res.flushHeaders();

    try {
        console.log(`[WA] Extraindo TODO o histórico STREAM | Período: ${dataIni} -> ${dataFim}`);

        const result = await waService.fetchAndAnalyzeAllHistory(session, dataIni, dataFim, (current, total, jid) => {
            // Emite progresso de cada cliente processado
            res.write(`data: ${JSON.stringify({ type: 'progress', current, total, jid })}\n\n`);
        });

        // Quando termina o loop da IA, emite o grande final
        res.write(`data: ${JSON.stringify({ type: 'end', data: result.data || result })}\n\n`);
    } catch (e) {
        console.error('Erro /import-history-stream:', e);
        res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
    } finally {
        res.end();
    }
});

app.post('/api/wa/send', async (req, res) => {
    const { session, number, text } = req.body;
    if (!session || !number || !text) {
        return res.status(400).json({ error: 'Parâmetros incompletos (session, number, text)' });
    }

    try {
        console.log(`[WA] Disparando msg para ${number} via API de Sockets`);
        const result = await waService.sendMessageDirect(session, number, text);
        res.json({ success: true, result });
    } catch (e) {
        console.error('Erro /api/wa/send:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/wa/sessions', (req, res) => {
    res.json({ active_sessions: waService.getAllSessions() });
});

const xlsxLib = require('xlsx');

app.post('/api/export-xlsx', (req, res) => {
    try {
        const { list } = req.body;
        if (!list || !Array.isArray(list)) {
            return res.status(400).json({ error: 'Nenhuma lista fornecida' });
        }

        const ws = xlsxLib.utils.json_to_sheet(list);
        const wb = xlsxLib.utils.book_new();
        xlsxLib.utils.book_append_sheet(wb, ws, 'Relatorios');

        const buffer = xlsxLib.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename="relatorio_crm.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) {
        console.error('Erro export-xlsx:', e);
        res.status(500).json({ error: e.message });
    }
});

// ──────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 FlowZap Payment Server rodando em http://localhost:${PORT}`);
    console.log(`\n📌 Rotas disponíveis:`);
    console.log(`   POST /api/checkout                → Gera link InfinityPay (extensão chama)`);
    console.log(`   POST /api/webhooks/infinitypay     → Webhook da InfinityPay (automático)`);
    console.log(`   POST /api/admin/activate           → Ativa licença manual (Postman)`);
    console.log(`   GET  /api/wa/status                → Baileys: Status e QR Code`);
    console.log(`   POST /api/wa/connect               → Baileys: Inicia nova sessão`);
    console.log(`   POST /api/wa/import-history        → Baileys + OpenAI: Extrai e lapida 1 chat`);
    console.log(`   POST /api/wa/import-history-all    → Baileys + OpenAI: Extrai TUDO em lote`);
    console.log(`   POST /api/wa/send                  → Baileys: Dispara Nova Mensagem\n`);
});
