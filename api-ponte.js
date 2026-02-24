// ==========================================================================
// FlowZap — API Ponte (Micro servidor Node para Postman -> Extensão)
// Roda na porta 3000 — Recebe ordens via HTTP e enfileira para a extensão
// ==========================================================================

const http = require('http');

let queue = []; // Fila de mensagens pendentes

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // ── POST /send — Enfileira uma mensagem (chamado pelo Postman/N8N) ──
    if (req.method === 'POST' && req.url === '/send') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (!data.number || !data.text) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Campos "number" e "text" são obrigatórios' }));
                    return;
                }

                queue.push({ number: data.number, text: data.text, queued_at: new Date().toISOString() });
                console.log(`📥 Mensagem enfileirada para ${data.number}: "${data.text.substring(0, 50)}..."`);
                console.log(`📋 Fila atual: ${queue.length} mensagem(ns)`);

                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: 'Mensagem enfileirada! A extensão vai consumir em até 3 segundos.',
                    queue_size: queue.length
                }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'JSON inválido', detail: e.message }));
            }
        });
        return;
    }

    // ── GET /FlowZap_pull — A extensão consome a próxima msg da fila ──
    if (req.method === 'GET' && req.url === '/FlowZap_pull') {
        if (queue.length > 0) {
            const msg = queue.shift();
            console.log(`📤 Entregue à extensão: ${msg.number} → "${msg.text.substring(0, 50)}..."`);
            console.log(`📋 Restam na fila: ${queue.length}`);
            res.writeHead(200);
            res.end(JSON.stringify(msg));
        } else {
            res.writeHead(200);
            res.end(JSON.stringify({}));
        }
        return;
    }

    // ── GET /queue — Ver fila atual (debug) ──
    if (req.method === 'GET' && req.url === '/queue') {
        res.writeHead(200);
        res.end(JSON.stringify({ queue_size: queue.length, messages: queue }));
        return;
    }

    // ── GET / — Status ──
    if (req.method === 'GET' && (req.url === '/' || req.url === '/status')) {
        res.writeHead(200);
        res.end(JSON.stringify({
            status: 'online',
            service: 'FlowZap API Ponte',
            queue_size: queue.length,
            endpoints: {
                'POST /send': 'Envia mensagem (body: { number, text })',
                'GET /FlowZap_pull': 'Extensão consome a fila (interno)',
                'GET /queue': 'Ver fila pendente (debug)',
                'GET /status': 'Status do servidor'
            }
        }));
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Rota não encontrada' }));
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 FlowZap API Ponte rodando em http://localhost:${PORT}`);
    console.log(`\n📌 Endpoints:`);
    console.log(`   POST http://localhost:${PORT}/send          → Enviar mensagem`);
    console.log(`   GET  http://localhost:${PORT}/FlowZap_pull → Extensão consome (automático)`);
    console.log(`   GET  http://localhost:${PORT}/queue         → Ver fila (debug)`);
    console.log(`   GET  http://localhost:${PORT}/status        → Status\n`);
    console.log(`📱 Certifique-se que o WhatsApp Web está aberto e a extensão FlowZap está ativa.\n`);
});
