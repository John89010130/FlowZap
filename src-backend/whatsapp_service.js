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

const DB_PATH = path.join(__dirname, 'wa_history.db');
console.log(`[WA DB] Banco SQLite em: ${DB_PATH}`);

let dbPromise = open({
    filename: DB_PATH,
    driver: sqlite3.Database
}).then(async (db) => {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            jid TEXT NOT NULL,
            sender TEXT,
            sender_name TEXT,
            timestamp INTEGER,
            text_content TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_jid ON messages(jid);

        CREATE TABLE IF NOT EXISTS ai_analysis_log (
            jid TEXT NOT NULL,
            date_str TEXT NOT NULL,
            msg_count INTEGER NOT NULL,
            ai_json TEXT NOT NULL,
            PRIMARY KEY (jid, date_str)
        );
    `);
    try {
        await db.exec('ALTER TABLE messages ADD COLUMN sender_name TEXT;');
    } catch (e) { }
    return db;
});

async function saveMessageToLocalDB(msg) {
    if (!msg.message || !msg.key || !msg.key.remoteJid) return;

    // Ignorar status e afins
    if (msg.key.remoteJid === 'status@broadcast') return;

    const jid = jidNormalizedUser(msg.key.remoteJid);
    const id = msg.key.id;
    const sender = msg.key.fromMe ? 'ME' : (msg.key.participant || jid);
    const pushName = msg.pushName ? msg.pushName.trim() : '';
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
            `INSERT OR IGNORE INTO messages (id, jid, sender, sender_name, timestamp, text_content) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, jid, sender, pushName, timestamp, textBody]
        );
    } catch (e) {
        console.error('Erro ao salvar no DB:', e);
    }
}

const authStates = new Map();

async function startSession(sessionId) {
    let sessionData = sessions.get(sessionId);

    if (sessionData && sessionData.sock) {
        return sessionData;
    }

    if (!sessionData) {
        sessionData = { sock: null, qrBase64: null, status: 'INITIALIZING', isSyncing: false };
        sessions.set(sessionId, sessionData);
    }

    const sessionDir = path.join(authFolder, sessionId);

    // O SEGREDO DO EBUSY ESTAVA AQUI: Salvar o State do disco na memória pra não recriar fileWatchers e Locks!
    let authState = authStates.get(sessionId);
    if (!authState) {
        authState = await useMultiFileAuthState(sessionDir);
        authStates.set(sessionId, authState);
    }
    const { state, saveCreds } = authState;

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        printQRInTerminal: false,
        syncFullHistory: true, // ✅ Restaurado para TRUE. O erro 401 era por causa do User Agent inválido antes, agora temos 'Windows', 'Chrome'
        markOnlineOnConnect: false, // Menos intrusivo
        browser: ['Windows', 'Chrome', '120.0.0.0'] // Fake browser seguro
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
            // Aumentamos o limite para 120 segundos porque o pacote de Full History demora para ser compactado no celular
            syncTimeout = setTimeout(() => {
                console.log(`[WA Baileys] Tempo esgotado (120s) para nova remessa. Abortando Sincronização pacientemente.`);
                sessionData.isSyncing = false;
            }, 120000);
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
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const errStr = String(lastDisconnect?.error || '');

            // 401 Logs you out, anything else (like 515) is temporary
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !errStr.includes('401') && !errStr.includes('device_removed');

            sessionData.sock = null; // Destrói o ponteiro, permite recriar na mesma session

            if (!shouldReconnect) {
                console.log('[WA Baileys] Sessão Desconectada permanente.');
                sessionData.status = 'DISCONNECTED';
                sessionData.qrBase64 = null;
                fs.rmSync(sessionDir, { recursive: true, force: true });
                sessions.delete(sessionId);
                authStates.delete(sessionId);
            } else {
                console.log(`[WA Baileys] Erro Temporário na Conexão (${statusCode || 'Stream'}). Recarregando gentilmente...`);
                // Mantemos initializing pra tela não ser destruída no meio!
                sessionData.status = 'INITIALIZING';
                sessionData.qrBase64 = null;
                setTimeout(() => startSession(sessionId), 3000);
            }
        } else if (connection === 'open') {
            sessionData.status = 'CONNECTED';
            sessionData.qrBase64 = null;
            console.log(`[WA Baileys] ✨ CONEXÃO ABERTA COM SUCESSO!`);
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
        SELECT timestamp, sender, sender_name, text_content 
        FROM messages 
        WHERE jid = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
    `, [jidTarget, startTs, endTs]);

    if (!history || history.length === 0) {
        return { success: false, error: 'Sem histórico capturado pelo Baileys no banco local para este período.' };
    }

    const rawText = history.map(h => {
        const dateStr = new Date(h.timestamp).toISOString();
        let origin = 'Cliente';
        if (h.sender === 'ME') {
            origin = 'Eu (Atendente)';
        } else if (h.sender_name && h.sender_name.trim()) {
            origin = h.sender_name.trim();
        }
        return `[${dateStr}] ${origin}: ${h.text_content}`;
    }).join('\n');

    const prompt = `
    Abaixo, você tem um histórico bruto de conversa de WhatsApp extraído de um servidor web.
    Sua missão é gerar um relatório de conversas agrupado POR DIA (apenas as datas presentes no chat), em formato JSON.
    As chaves do JSON principal devem ser datas no formato YYYY-MM-DD.
    Para cada data, defina um objeto com as seguintes chaves:
      - num_mensagens: Inteiro representando o TOTAL de mensagens trocadas no dia (cliente + atendente).
      - ultima_mensagem_resumo: Escreva um resumo direto, objetivo e em 1ª pessoa (1 a 3 frases) sob a perspectiva do atendente/empresa (ex: "me chamou", "informei a ela", "fizemos o ajuste", "ficou combinado que...").
        REGRAS RÍGIDAS DO RESUMO:
        1. NUNCA inicie com "Participantes identificados:", "Resumo:", "Neste dia," ou qualquer outro cabeçalho artificial.
        2. NUNCA inclua frases genéricas sobre o tom da conversa (ex: "atendimento conduzido de forma profissional", "tom cordial", etc.).
        3. Exemplo esperado: "Flavia me chamou para verificar a situação X, informei que o Thiago já está analisando e vai retornar."

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
async function fetchAndAnalyzeAllHistory(sessionId, dataIni, dataFim, isForceUpdate = false, onProgress = null) {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    if (!openai) throw new Error('OPENAI_API_KEY não configurada no backend!');

    const startTs = new Date(dataIni + 'T00:00:00').getTime();
    const endTs = new Date(dataFim + 'T23:59:59').getTime();

    // Busca SQLite agrupado por JID no periodo
    const db = await dbPromise;
    const history = await db.all(`
        SELECT jid, timestamp, sender, sender_name, text_content 
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

        // Agrupar mensagens deste JID por data local (Assumindo GMT-3)
        const msgsByDate = {};
        msgs.forEach(h => {
            const dateStr = new Date(h.timestamp - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
            if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
            msgsByDate[dateStr].push(h);
        });

        const sortedDates = Object.keys(msgsByDate).sort();
        const datesToAnalyze = [];
        const cachedResults = [];

        // Checar quais dias podemos reusar do banco local
        for (const dateStr of sortedDates) {
            const dayMsgs = msgsByDate[dateStr];

            if (!isForceUpdate) {
                const cachedRow = await db.get(`SELECT msg_count, ai_json FROM ai_analysis_log WHERE jid = ? AND date_str = ?`, [jid, dateStr]);
                if (cachedRow && cachedRow.msg_count === dayMsgs.length) {
                    try {
                        const parsed = JSON.parse(cachedRow.ai_json);
                        // Garante que o parsed é um objeto plano (não um array ou primitivo)
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            cachedResults.push(parsed);
                            console.log(`[Cache OK] ${jid} - ${dateStr} (Ignorado IA)`);
                        } else if (Array.isArray(parsed) && parsed.length > 0) {
                            // Caso raro: foi salvo um array - usa o primeiro item
                            cachedResults.push(parsed[0]);
                            console.log(`[Cache OK array] ${jid} - ${dateStr} (Ignorado IA)`);
                        }
                        continue;
                    } catch (e) { }
                }
            }
            datesToAnalyze.push(dateStr);
        }

        // Se todas as datas deste cliente já estiverem processadas e o número de mensagens for idêntico
        if (datesToAnalyze.length === 0) {
            finalResults.push(...cachedResults);
            continue;
        }

        // Formata as mensagens SOMENTE das datas que precisam de análise
        const rawText = datesToAnalyze.map(dateStr => {
            return msgsByDate[dateStr].map(h => {
                const dtStr = new Date(h.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                let origin = 'Cliente';
                if (h.sender === 'ME') {
                    origin = 'Eu (Atendente)';
                } else if (isGroup) {
                    const pName = h.sender_name ? h.sender_name.trim() : '';
                    const phone = h.sender ? h.sender.split('@')[0] : '';
                    origin = pName ? `${pName} (no grupo)` : `Membro ${phone} (no grupo)`;
                } else {
                    const pName = h.sender_name ? h.sender_name.trim() : '';
                    origin = pName ? pName : 'Cliente';
                }
                return `[${dtStr}] ${origin}: ${h.text_content}`;
            }).join('\n');
        }).join('\n');

        const prompt = `
        Abaixo, você tem um histórico de conversa bruta originada de ${isGroup ? 'um GRUPO de WhatsApp' : 'um CONTATO/CLIENTE individual de WhatsApp'}.
        O identificador técnico deste chat é: "${jid.split('@')[0]}"
        Sua missão é atuar como um analista de qualidade CRM e gerar um array de objetos JSON que represente um relatório analítico do atendimento, separado por dias. O Array não pode estar contido em objeto raiz.
        Cada objeto deve obrigatoriamente ter:
          - "date": String no formato YYYY-MM-DD daquelas mensagens.
          - "contato": ${isGroup
                ? `Analise o contexto das mensagens para identificar o NOME DO GRUPO e/ou as PESSOAS do grupo que conversaram no dia. Formato preferencial: "NomeDoGrupo (Grupo - Pessoas)". Se não identificar o nome do grupo, use "Grupo (com Pessoas)". Exemplo: "Comercial FlowZap (Grupo - Taiz, Flávia)" ou "Grupo (com Taiz, Flávia)".`
                : `Analise ativamente as mensagens para DESCOBRIR O NOME DA PESSOA com quem a empresa conversou (ex: "Flávia", "Taiz", "Carlos Daniel"). Somente se for IMPOSSÍVEL achar qualquer nome no texto, devolva o telefone original "${jid.split('@')[0]}".`
            }
          - "numMensagens": Inteiro representando o número de balões de mensagens movimentados nesse dia.
          - "horaInicio": String no formato HH:MM correspondente ao horário da primeira mensagem no FUSO HORÁRIO DE BRASÍLIA (BRT / UTC-3).
          - "horaFim": String no formato HH:MM correspondente ao horário da última mensagem no FUSO HORÁRIO DE BRASÍLIA (BRT / UTC-3).
          - "ultimaMensagem": Resumo direto, objetivo e humanizado da conversa do dia em 1 a 3 frases, SEMPRE em primeira pessoa sob a perspectiva do atendente/empresa (ex: "me chamou", "informei a ela", "fizemos o ajuste", "ficou combinado que...").
            REGRAS OBRIGATÓRIAS DO RESUMO:
            1. NUNCA inicie com "Participantes identificados:", "Resumo:", "Neste dia," ou qualquer outro cabeçalho artificial.
            2. NUNCA inclua frases genéricas sobre o tom da conversa (como "O atendimento foi conduzido de forma profissional", "tom cordial", etc.).
            3. Especifique com clareza QUEM chamou/falou, QUAL a demanda/assunto específico, O QUE foi respondido ou feito, e O DESFECHO do atendimento.
            Exemplos de formato esperado:
            - "Flavia me chamou para verificar a situação X, informei a ela que o Thiago já está vendo isso e vai retornar."
            - "Taiz me chamou para ver algumas demandas como nota de devolução do dia anterior. Fizemos o ajuste e o assunto foi solucionado."
            - "Carlos me pediu segunda via da fatura do mês. Enviei o boleto em PDF e ele confirmou o recebimento."

        Deixe o JSON perfeito para \`JSON.parse()\`. Devolva APENAS O JSON BRUTO em array, não inclua marcação markdown como "\`\`\`json".
        
        Conteúdo da Conversa Transcrita:
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

            const parsedJson = JSON.parse(content.trim());
            // A IA deve retornar um array. Se retornou objeto, converte para array.
            let aiArray = [];
            if (Array.isArray(parsedJson)) {
                aiArray = parsedJson;
            } else if (parsedJson && typeof parsedJson === 'object') {
                // Tenta extrair de chave wrapper ou converte via Object.values
                const firstVal = Object.values(parsedJson)[0];
                aiArray = Array.isArray(firstVal) ? firstVal : Object.values(parsedJson);
                console.warn(`[WA Baileys AI] IA retornou objeto em vez de array para ${jid}. Convertido automaticamente.`);
            }

            if (aiArray.length > 0) {
                // Junta cache + O que veio novo da IA
                finalResults.push(...cachedResults, ...aiArray);

                // Salva o que a IA acabou de responder no SQLite (Cache local)
                for (const item of aiArray) {
                    const itemDate = item.date;
                    if (itemDate && msgsByDate[itemDate]) {
                        await db.run(
                            `INSERT OR REPLACE INTO ai_analysis_log (jid, date_str, msg_count, ai_json) VALUES (?, ?, ?, ?)`,
                            [jid, itemDate, msgsByDate[itemDate].length, JSON.stringify(item)]
                        );
                    }
                }
            } else {
                // Sem dados novos da IA mas há cache
                finalResults.push(...cachedResults);
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

/**
 * Retorna estatísticas do banco local para diagnóstico
 */
async function getDbStats(dataIni, dataFim) {
    const db = await dbPromise;

    const total = await db.get('SELECT COUNT(*) as cnt FROM messages');
    const byJid = await db.all('SELECT jid, COUNT(*) as cnt FROM messages GROUP BY jid ORDER BY cnt DESC LIMIT 20');

    let inPeriod = null;
    let dateRange = null;

    if (dataIni && dataFim) {
        const startTs = new Date(dataIni + 'T00:00:00').getTime();
        const endTs = new Date(dataFim + 'T23:59:59').getTime();
        inPeriod = await db.get('SELECT COUNT(*) as cnt FROM messages WHERE timestamp >= ? AND timestamp <= ?', [startTs, endTs]);
    }

    // Busca o intervalo de datas real no banco
    const minMax = await db.get('SELECT MIN(timestamp) as minTs, MAX(timestamp) as maxTs FROM messages');
    if (minMax && minMax.minTs) {
        dateRange = {
            oldest: new Date(minMax.minTs).toISOString(),
            newest: new Date(minMax.maxTs).toISOString()
        };
    }

    return {
        dbPath: DB_PATH,
        totalMessages: total?.cnt || 0,
        inSelectedPeriod: inPeriod?.cnt || 0,
        dateRange,
        topContacts: byJid
    };
}

module.exports = {
    startSession,
    getStatus: (sessionId) => {
        if (!sessions.has(sessionId)) return { status: 'NOT_STARTED' };
        const s = sessions.get(sessionId);
        return { status: s.status, qrBase64: s.qrBase64, isSyncing: Boolean(s.isSyncing) };
    },
    getAllSessions: () => Array.from(sessions.keys()),
    getDbStats,
    fetchAndAnalyzeHistory,
    fetchAndAnalyzeAllHistory,
    sendMessageDirect
};
