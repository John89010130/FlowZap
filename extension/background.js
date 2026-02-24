// FlowZap - Background Service Worker v1.0.6
// Gerencia alarmes, notificações, comunicação popup/content e injeção do hook de mensagens

// ===== INICIALIZAÇÃO =====
chrome.runtime.onInstalled.addListener(() => {
  console.log('[FlowZap] Extensão instalada!');
  chrome.storage.local.get(['FlowZap_data'], (result) => {
    if (!result.FlowZap_data) {
      chrome.storage.local.set({
        FlowZap_data: {
          funis: [],
          campanhas: [],
          autoatendimento: [],
          calendario: [],
          notificacoes: [],
          configuracoes: { idioma: 'pt', modoEscuro: false, temaMenu: 'verde' }
        }
      });
    }
  });
});

// ===== HOOK DE NOTIFICAÇÕES (intercepta mensagens no contexto da página) =====
// Toda mensagem que chega no WhatsApp Web dispara um new Notification(remetente, {body: texto})
// Ao injetar no mundo MAIN (contexto da página), interceptamos TODAS as mensagens
// de qualquer chat, com o texto completo, antes do DOM ser atualizado.

function injectNotificationHook(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN', // Contexto da página — acessa window.Notification real
    func: () => {
      // Evita dupla injeção
      if (window.__FlowZapNotifHook) return;
      window.__FlowZapNotifHook = true;

      const OriginalNotification = window.Notification;

      // Substitui o construtor de Notification
      function FlowZapNotification(title, options) {
        // Dispara evento customizado que o content.js irá escutar
        try {
          if (title && options && options.body) {
            document.dispatchEvent(new CustomEvent('__FlowZap_incoming_msg', {
              detail: {
                sender: title,           // Nome do remetente
                text: options.body,      // Texto COMPLETO da mensagem
                tag: options.tag || '',  // ID único da mensagem (ex: "false_55119999@c.us_3EB012")
                icon: options.icon || ''
              }
            }));
          }
        } catch (e) { /* silencia erros */ }

        // Chama o construtor original normalmente
        return new OriginalNotification(title, options);
      }

      // Copia propriedades estáticas (permission, requestPermission, etc.)
      FlowZapNotification.prototype = OriginalNotification.prototype;
      Object.defineProperty(FlowZapNotification, 'permission', {
        get: () => OriginalNotification.permission,
        configurable: true
      });
      FlowZapNotification.requestPermission = OriginalNotification.requestPermission?.bind(OriginalNotification);

      window.Notification = FlowZapNotification;
      console.log('[FlowZap] ✅ Hook de notificações ativo — interceptando mensagens de todos os chats!');
    }
  }).catch(err => {
    console.log('[FlowZap BG] Erro ao injetar hook:', err.message);
  });
}

// Injeta quando o WhatsApp Web carrega
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('web.whatsapp.com')) {
    // Aguarda o WhatsApp carregar seus módulos
    setTimeout(() => injectNotificationHook(tabId), 4000);
  }
});

// Também injeta em abas que já estão abertas quando a extensão é recarregada
chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
  tabs.forEach(tab => {
    if (tab.id) setTimeout(() => injectNotificationHook(tab.id), 2000);
  });
});

// ===== LISTENER DE MENSAGENS DO CONTENT SCRIPT E POPUP =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DATA') {
    chrome.storage.local.get(['FlowZap_data'], (result) => {
      sendResponse({ data: result.FlowZap_data || {} });
    });
    return true;
  }

  if (message.type === 'SAVE_DATA') {
    chrome.storage.local.set({ FlowZap_data: message.data }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'SCHEDULE_ALARM') {
    const { id, when } = message;
    chrome.alarms.create(id, { when });
    sendResponse({ success: true });
    return true;
  }

  // Solicita reinjeção do hook (caso WhatsApp tenha recarregado)
  if (message.type === 'REINJECT_HOOK' && sender.tab?.id) {
    injectNotificationHook(sender.tab.id);
    sendResponse({ success: true });
    return true;
  }
});

// ===== ALARMES DO CALENDÁRIO =====
chrome.alarms.onAlarm.addListener((alarm) => {
  chrome.storage.local.get(['FlowZap_data'], (result) => {
    const data = result.FlowZap_data || {};
    const evento = (data.calendario || []).find(e => e.id === alarm.name);
    if (evento) {
      chrome.notifications.create(alarm.name, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'FlowZap - Lembrete',
        message: evento.titulo || 'Evento agendado',
        priority: 2
      });
    }
  });
});

// ===== API LOCAL (Integração Externa via extensão) =====
// Permite que sites ou scripts externos (com o ID da extensão) enviem requisições de mensagem
// Exemplo de uso num site local: chrome.runtime.sendMessage(EXTENSION_ID, { action: 'api_send_message', number: '551199999999', text: 'Olá api!' })
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === 'api_send_message') {
    if (!request.number || !request.text) {
      sendResponse({ success: false, error: 'Número e texto são obrigatórios.' });
      return;
    }
    fireKanbanApi(request.number, request.text);
    sendResponse({ success: true, message: 'Ordem processada com sucesso via API Local.' });
    return true; // async
  }
});

// ===== API SERVER-POLLING (Postman -> NodeJS -> FlowZap) =====
// Manifest V3: setInterval NÃO funciona porque o service worker hiberna!
// Usamos chrome.alarms que persiste mesmo com o worker inativo.

// Cria o alarme de polling ao iniciar
chrome.alarms.create('FlowZap_api_poll', { periodInMinutes: 0.05 }); // ~3 segundos (mínimo MV3 ≈ 0.033)

// Também registra o alarm no onInstalled para garantir que existe
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('FlowZap_api_poll', { periodInMinutes: 0.05 });
});

// Handler do alarm — roda TODA vez que o alarm dispara
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'FlowZap_api_poll') {
    try {
      const resp = await fetch('http://127.0.0.1:3000/FlowZap_pull');
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.number && data.text) {
          console.log("[FlowZap] 📬 Fila API detectada! Despachando:", data);
          fireKanbanApi(data.number, data.text);
        }
      }
    } catch (e) {
      // Node não está rodando — silencia
    }
  }
});

// Helper central de despacho pro Content Script
function fireKanbanApi(telefone, mensagem) {
  chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
    if (tabs.length === 0) return;
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: (telefone, mensagem) => {
        document.dispatchEvent(new CustomEvent('__FlowZap_api_send', { detail: { telefone, mensagem } }));
      },
      args: [telefone, mensagem]
    });
  });
}
