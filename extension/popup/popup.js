// FlowZap - Popup Script

document.addEventListener('DOMContentLoaded', () => {
    // Carrega estatísticas
    chrome.storage.local.get(['FlowZap_data'], (result) => {
        const data = result.FlowZap_data || {};
        const funis = data.funis || [];
        const totalCards = funis.reduce((acc, f) => acc + (f.cards || []).length, 0);
        const totalCamp = (data.campanhas || []).length;
        const totalBots = (data.autoatendimento || []).filter(b => b.ativo).length;

        document.getElementById('stat-funis').textContent = totalCards;
        document.getElementById('stat-camp').textContent = totalCamp;
        document.getElementById('stat-bot').textContent = totalBots;
    });

    // Abre WhatsApp Web
    document.getElementById('btn-open-wa')?.addEventListener('click', () => {
        chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, { active: true });
                window.close();
            } else {
                chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
                window.close();
            }
        });
    });

    // Botões que ativam o painel no WhatsApp Web
    const actions = {
        'btn-dashboard': 'OPEN_DASHBOARD',
        'btn-funis': 'OPEN_FUNIS',
        'btn-campanhas': 'OPEN_CAMPANHAS',
        'btn-bot': 'OPEN_BOT',
        'btn-relatorios': 'OPEN_RELATORIOS',
        'btn-cal': 'OPEN_CALENDAR',
        'btn-cfg': 'OPEN_SETTINGS',
    };

    Object.entries(actions).forEach(([btnId, action]) => {
        document.getElementById(btnId)?.addEventListener('click', () => {
            chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
                if (tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: action });
                    chrome.tabs.update(tabs[0].id, { active: true });
                } else {
                    chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
                }
                window.close();
            });
        });
    });
});
