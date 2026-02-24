const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const sessions = new Map();
const authFolder = path.join(__dirname, 'wa_auth');
if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Inicializa o banco SQLite local para guardar o backup bruto
let dbPromise = open({
    filename: path.join(__dirname, 'wa_history.db'),
    driver: sqlite3.Database
}).then(async (db) => {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            jid TEXT NOT NULL,
            sender TEXT,
            timestamp INTEGER,
            text_content TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_jid ON messages(jid);
    `);
    return db;
});

async function saveMessageToLocalDB(msg) {
    if (!msg.message || !msg.key || !msg.key.remoteJid) return;

    // Ignorar status e afins
    if (msg.key.remoteJid === 'status@broadcast') return;

    const jid = jidNormalizedUser(msg.key.remoteJid);
    const id = msg.key.id;
    const sender = msg.key.fromMe ? 'ME' : (msg.key.participant || jid);
    const timestamp = msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now();

    // Extrai o texto da mensagem (tenta achar texto simples ou legenda de imagem)
    let textBody = '';
    const m = msg.message;
    if (m.conversation) textBody = m.conversation;
    else if (m.extendedTextMessage?.text) textBody = m.extendedTextMessage.text;
    else if (m.imageMessage?.caption) textBody = m.imageMessage.caption;
    else if (m.videoMessage?.caption) textBody = m.videoMessage.caption;

    if (!textBody) return; // Se não tem texto legível, ignoramos pro relatório

    const db = await dbPromise;
    try {
        await db.run(
            `INSERT OR IGNORE INTO messages (id, jid, sender, timestamp, text_content) VALUES (?, ?, ?, ?, ?)`,
            [id, jid, sender, timestamp, textBody]
        );
    } catch (e) {
        console.error('Erro ao salvar no DB:', e);
    }
}

async function startSession(sessionId) {
    if (sessions.has(sessionId)) return sessions.get(sessionId);

    // Reserva a sessão na memória com status INITIALIZING para que os pings não achem que está offline
    const sessionData = { sock: null, qrBase64: null, status: 'INITIALIZING', isSyncing: false };
    sessions.set(sessionId, sessionData);

    const sessionDir = path.join(authFolder, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        printQRInTerminal: false,
        syncFullHistory: false, // Historicos GIGANTES fazem o celular falhar ("Não foi possível concluir a sincronização")
        markOnlineOnConnect: false, // Menos intrusivo
    });

    sessionData.sock = sock;

    let syncTimeout = null;

    sock.ev.on('creds.update', saveCreds);

    // Eventos de histórico retroativo (WhatsApp envia logo que conecta um novo dispositivo)
    sock.ev.on('messaging-history.set', async ({ messages, contacts, chats, isLatest }) => {
        console.log(`[WA Baileys] Recebendo lote de histórico! Total de msgs: ${messages.length}`);
        sessionData.isSyncing = true;

        for (const m of messages) {
            await saveMessageToLocalDB(m);
        }

        if (syncTimeout) clearTimeout(syncTimeout);

        if (isLatest) {
            console.log(`[WA Baileys] Terminou bloco final de sync histórico.`);
            sessionData.isSyncing = false;
        } else {
            // Se o celular abortar a nuvem ou demorar mais de 15s pra mandar o próx bloco, consideramos finalizado pacientemente.
            syncTimeout = setTimeout(() => {
                console.log(`[WA Baileys] Tempo esgotado para nova remessa. Abortando Sincronização graciosamente.`);
                sessionData.isSyncing = false;
            }, 15000);
        }
    });

    // Mensagens novas e carregadas (via web scroll-up virtual)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const m of messages) await saveMessageToLocalDB(m);
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            sessionData.status = 'QR_READY';
            sessionData.qrBase64 = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            sessionData.status = 'DISCONNECTED';
            sessionData.qrBase64 = null;
            if (!shouldReconnect) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                sessions.delete(sessionId);
            } else {
                sessions.delete(sessionId);
                setTimeout(() => startSession(sessionId), 3000);
            }
        } else if (connection === 'open') {
            sessionData.status = 'CONNECTED';
            sessionData.qrBase64 = null;
        }
    });

    return sessionData;
}

/**
 * Puxa histórico do SQLite local e pede a OpenAI para lapidar em JSON para 1 ÚNICO chat
 */
async function fetchAndAnalyzeHistory(sessionId, contactPhoneOrJid, dataIni, dataFim) {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    if (!openai) throw new Error('OPENAI_API_KEY não configurada no backend!');

    let jidTarget = contactPhoneOrJid;
    if (!jidTarget.includes('@')) {
        jidTarget = jidTarget.replace(/\D/g, '') + '@s.whatsapp.net';
    }

    const startTs = new Date(dataIni + 'T00:00:00').getTime();
    const endTs = new Date(dataFim + 'T23:59:59').getTime();

    const db = await dbPromise;
    const history = await db.all(`
        SELECT timestamp, sender, text_content 
        FROM messages 
        WHERE jid = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
    `, [jidTarget, startTs, endTs]);

    if (!history || history.length === 0) {
        return { success: false, error: 'Sem histórico capturado pelo Baileys no banco local para este período.' };
    }

    const rawText = history.map(h => {
        const dateStr = new Date(h.timestamp).toISOString();
        const origin = h.sender === 'ME' ? 'Eu (Atendente)' : 'Cliente';
        return `[${dateStr}] ${origin}: ${h.text_content}`;
    }).join('\n');

    const prompt = `
    Abaixo, você tem um histórico bruto de conversa de WhatsApp extraído de um servidor web.
    Sua missão é gerar um relatório de conversas agrupado POR DIA (apenas as datas presentes no chat), em formato JSON.
    As chaves do JSON principal devem ser datas no formato YYYY-MM-DD.
    Para cada data, defina um objeto com as seguintes chaves:
      - num_mensagens: Inteiro representando o TOTAL de mensagens trocadas no dia (cliente + atendente).
      - ultima_mensagem_resumo: Uma frase que represente bem o final da conversa ou a última mensagem enviada/recebida no dia.

    Apenas me devolva o JSON sem introdução ou contra as tags markdown extras (Apenas o conteúdo bruto).
    
    Histórico:
    ${rawText}
    `;

    try {
        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.1
        });

        let content = aiResponse.choices[0].message.content.trim();
        if (content.startsWith('```json')) content = content.substring(7);
        if (content.startsWith('```')) content = content.substring(3);
        if (content.endsWith('```')) content = content.substring(0, content.length - 3);

        const parsedJson = JSON.parse(content);
        return { success: true, data: parsedJson, rawCount: history.length };
    } catch (e) {
        throw new Error('Erro na integração com OpenAI: ' + e.message);
    }
}

/**
 * Puxa histórico DE TODOS os JIDs do SQLite local no período e pede a OpenAI para relatar tudo!
 */
async function fetchAndAnalyzeAllHistory(sessionId, dataIni, dataFim, onProgress = null) {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    if (!openai) throw new Error('OPENAI_API_KEY não configurada no backend!');

    const startTs = new Date(dataIni + 'T00:00:00').getTime();
    const endTs = new Date(dataFim + 'T23:59:59').getTime();

    // Busca SQLite agrupado por JID no periodo
    const db = await dbPromise;
    const history = await db.all(`
        SELECT jid, timestamp, sender, text_content 
        FROM messages 
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY jid, timestamp ASC
    `, [startTs, endTs]);

    if (!history || history.length === 0) {
        return { success: false, error: 'Sem mensagens no banco local para este período.' };
    }

    // Agrupa mensagens por JID
    const grouped = {};
    history.forEach(h => {
        if (!grouped[h.jid]) grouped[h.jid] = [];
        grouped[h.jid].push(h);
    });

    const finalResults = [];
    const jids = Object.keys(grouped);

    console.log(`[WA Baileys AI] Processando resumo de ${jids.length} clientes... (Isso pode custar tokens e tempo)`);

    // DICA VITAL: Se a lista for gigantesca de pessoas, devemos quebrar a array. 
    // Para simplificar agora, iremos processar um por vez no loop contra o ChatGPT para evitar perda de foco de prompt dele
    let counter = 0;
    for (const jid of jids) {
        counter++;
        if (onProgress) onProgress(counter, jids.length, jid);

        const msgs = grouped[jid];
        const isGroup = jid.includes('@g.us');

        // Formata as mensagens daquele cliente X
        const rawText = msgs.map(h => {
            const dateStr = new Date(h.timestamp).toISOString();
            let origin = 'Cliente';
            if (h.sender === 'ME') {
                origin = 'Eu (Atendente)';
            } else if (isGroup) {
                origin = `Membro do Grupo (${h.sender.split('@')[0]})`;
            }
            return `[${dateStr}] ${origin}: ${h.text_content}`;
        }).join('\n');

        const prompt = `
        Abaixo, você tem um histórico de conversa bruta originada de ${isGroup ? 'um GRUPO de WhatsApp' : 'um CONTATO/CLIENTE de WhatsApp'}.
        O identificador do chat é: "${jid.split('@')[0]}"
        Sua missão é gerar um array de objetos JSON que represente o dia-a-dia da conversa. O Array não pode estar contido em objeto raiz.
        Cada objeto deve obrigatoriamente ter:
          - "date": String no formato YYYY-MM-DD daquelas mensagens.
          - "contato": ${isGroup
                ? `Tente DESCOBRIR O NOME DESSE GRUPO pelo contexto das mensagens. Se descobrir o nome real, escreva-o e adicione (Grupo). Se for impossível achar o nome no meio da conversa, devolva apenas "Grupo ${jid.split('@')[0]}".`
                : `Tente DESCOBRIR O NOME DA PESSOA lendo as mensagens (seja porque o atendente a chamou pelo nome ou ela mesma se apresentou). Se achar, devolva apenas o Nome Real com a primeira letra maiúscula (ex: "Carlos"). Somente se for IMPOSSÍVEL achar qualquer nome no texto inteiro, devolva o telefone original "${jid.split('@')[0]}".`
            }
          - "numMensagens": Inteiro representando o número de balões de mensagens lidos nesse dia.
          - "horaInicio": String no formato HH:MM (ex: "10:00") correspondente ao horário da PRIMEIRA mensagem deste dia.
          - "horaFim": String no formato HH:MM (ex: "17:30") correspondente ao horário da ÚLTIMA mensagem deste dia.
          - "ultimaMensagem": Responda OBRIGATORIAMENTE um resumo de 10-40 palavras sobre os principais assuntos negociados/tratados no dia. OBRIGATORIAMENTE inicie o texto deste resumo citando quem estava na conversa no formato "Participantes: [nome das pessoas ou números] - " seguido do resumo.
        Apenas me devolva o JSON bruto do array.
        
        Conversa:
        ${rawText}
        `;

        try {
            const aiResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: prompt }],
                temperature: 0.2
            });

            let content = aiResponse.choices[0].message.content.trim();
            if (content.startsWith('```json')) content = content.substring(7);
            if (content.startsWith('```')) content = content.substring(3);
            if (content.endsWith('```')) content = content.substring(0, content.length - 3);

            const parsedJson = JSON.parse(content);
            if (Array.isArray(parsedJson)) {
                finalResults.push(...parsedJson);
            }
        } catch (e) {
            console.error(`Erro OpenAI p/ ${jid}:`, e.message);
        }
    }

    return {
        success: true,
        totalProcessedContacs: jids.length,
        data: finalResults
    };
}

async function sendMessageDirect(sessionId, number, text) {
    const sessionData = sessions.get(sessionId);

    console.log(`[sendMessageDirect] Session: ${sessionId}, status: ${sessionData?.status}, sock: ${!!sessionData?.sock}`);

    if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão Baileys não iniciada. Use POST /api/wa/connect primeiro!');
    }

    if (sessionData.status !== 'CONNECTED') {
        throw new Error(`Sessão ainda não conectada. Status atual: ${sessionData.status}. Aguarde ou escaneie o QR Code.`);
    }

    // Formata o JID (número -> número@s.whatsapp.net)
    let jidTarget = number.trim();
    if (!jidTarget.includes('@')) {
        jidTarget = jidTarget.replace(/\D/g, '') + '@s.whatsapp.net';
    }

    console.log(`[sendMessageDirect] Enviando para JID: ${jidTarget}`);

    try {
        // Envia diretamente sem validar onWhatsApp() que pode retornar falso positivo
        const sent = await sessionData.sock.sendMessage(jidTarget, { text });
        console.log(`[sendMessageDirect] ✅ Mensagem enviada! messageId: ${sent?.key?.id}`);
        return { success: true, jid: jidTarget, messageId: sent?.key?.id };
    } catch (e) {
        console.error(`[sendMessageDirect] ❌ Erro ao enviar:`, e.message);
        throw new Error(`Falha ao enviar mensagem: ${e.message}`);
    }
}

module.exports = {
    startSession,
    getStatus: (sessionId) => {
        if (!sessions.has(sessionId)) return { status: 'NOT_STARTED' };
        const s = sessions.get(sessionId);
        return { status: s.status, qrBase64: s.qrBase64, isSyncing: Boolean(s.isSyncing) };
    },
    getAllSessions: () => Array.from(sessions.keys()),
    fetchAndAnalyzeHistory,
    fetchAndAnalyzeAllHistory,
    sendMessageDirect
};
