require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
// O InfinityPay (e Stripe) muitas vezes mandam payload raw ou webhook events, o express.json resolve para objs normais na maioria
app.use(express.json());

// INICIALIZAR SUPABASE COM "SERVICE ROLE KEY" (Secret Key) PARA PODER BURLAR RLS E INSERIR LICENÇAS
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jrqwakwdvzeuqynesqbn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'sua_service_role_key_aqui';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// ==========================================
// ROTA PÚBLICA PARA O INFINITYPAY / PUGPAY MANDAR O WEBHOOK DE PAGAMENTO
// ==========================================
app.post('/api/webhooks/infinitypay', async (req, res) => {
    try {
        const payload = req.body;
        console.log("🔔 [InfinityPay Webhook] Recebido:", JSON.stringify(payload));

        // *************************************************************************
        // ATENÇÃO ERIC: Como não sei exatamente as chaves do payload da Infinity, 
        // coloquei abaixo uma heurística simples. Você precisa adaptar se as 
        // keys do json de deles for "customer_email" ou "status" diferente.
        // *************************************************************************
        const emailComprador = payload.email || payload.customer?.email || payload.customer_email;
        const nomeComprador = payload.name || payload.customer?.name || '';

        if (!emailComprador) {
            return res.status(400).json({ error: 'Falta e-mail do comprador no payload' });
        }

        // InfinitePay NÃO envia campo status - receber o webhook = pagamento aprovado
        const statusRejeitados = ['DECLINED', 'REFUSED', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED', 'PENDING', 'WAITING'];
        const statusPagamento = (payload.status || payload.payment_status || '').toUpperCase();
        if (statusPagamento && statusRejeitados.includes(statusPagamento)) {
            console.log("⏳ Status negativo:", statusPagamento);
            return res.json({ message: 'Ignorado. Status negativo.' });
        }

        console.log(`✅ Pagamento aprovado para: ${emailComprador}. Renovando/Criando licença...`);

        // 1. Tenta achar o cara na Auth do Supabase
        const { data: userData, error: userError } = await supabase.auth.admin.listUsers();
        let authUser = (userData?.users || []).find(u => u.email.toLowerCase() === emailComprador.toLowerCase());

        // 2. Se a pessoa não tiver conta criada pela Landing Page, nós criamos agora na raça!
        if (!authUser) {
            console.log(`👤 Usuário novo detectado. Criando Auth para ${emailComprador}...`);
            const generatedPassword = Math.random().toString(36).slice(-8); // senha aleatoria de 8 letras
            const { data: newAuth, error: newAuthErr } = await supabase.auth.admin.createUser({
                email: emailComprador,
                password: generatedPassword,
                email_confirm: true,
                user_metadata: { name: nomeComprador }
            });

            if (newAuthErr) {
                console.error("❌ Erro ao criar Auth User:", newAuthErr);
                return res.status(500).json({ error: 'Erro Auth', desc: newAuthErr.message });
            }
            authUser = newAuth.user;

            // TODO: Aqui você poderia mandar um e-mail oficial (via Resend, Sendgrid, N8N)
            // ex: "Parabéns por comprar o FlowZap! Sua senha de acesso temporária da extensão é: XXXXX"
            console.log(`🔑 ATENÇÃO: Contato novo! A senha do ${emailComprador} é: ${generatedPassword}`);
        }

        // 3. Atualizar a tabela de `licenses` dando mais 30 dias pra ele (ou criando a linha se não houver)
        // Calcula validade
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1); // Dá +1 Mês

        // Upsert no Supabase
        const { data: licenseData, error: licError } = await supabase
            .from('licenses')
            .upsert({
                user_id: authUser.id,
                email: emailComprador,
                plan_expires_at: expiryDate.toISOString()
            }, { onConflict: 'email' })
            .select();

        if (licError) {
            console.error("❌ Erro ao adicionar Licença no Banco:", licError);
            return res.status(500).json({ error: 'Erro Database', desc: licError.message });
        }

        console.log(`🎉 Sucesso! Extensão liberada para ${emailComprador} até ${expiryDate.toLocaleDateString()}`);
        res.status(200).json({ success: true, message: 'Conta gerada / Licença renovada com sucesso!' });

    } catch (err) {
        console.error("❌ Erro Catastrófico Webhook:", err);
        res.status(500).json({ error: 'Erro Catastrófico' });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🚀 FlowZap Billing Auth Node rodando na porta ${PORT}`);
    console.log(`👉 Webhook URL p/ InifityPay (Via Ngrok durante os testes): POST http://localhost:${PORT}/api/webhooks/infinitypay`);
});
