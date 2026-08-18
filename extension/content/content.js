// FlowZap - Content Script
// Versão: 1.3.0
// Changelog: v1.3.0 - Motor de regras Kanban reescrito, exportação XLSX nativa, fuso Brasília, Kanban expandido por padrão.

(function () {
  'use strict';

  const CRM_VERSION = '1.3.0';
  const SIDEBAR_W = 55; // largura em px da sidebar FlowZap (deve ser igual ao --crm-sidebar-width do CSS)

  if (document.getElementById('FlowZap-sidebar')) return;

  // ===== AJUSTE DE LAYOUT DO WHATSAPP =====
  // Move o #app do WhatsApp para começar após nossa sidebar, via JS direto (CSS não funciona pois WA usa 100vw internamente)
  function applyLayoutAdjustment() {
    const app = document.getElementById('app');
    if (app) {
      app.style.setProperty('margin-left', SIDEBAR_W + 'px', 'important');
      app.style.setProperty('width', `calc(100vw - ${SIDEBAR_W}px)`, 'important');
      app.style.setProperty('max-width', `calc(100vw - ${SIDEBAR_W}px)`, 'important');
    }
  }

  // Aplica agora e observa o DOM para garantir que funciona após o WA terminar de carregar
  applyLayoutAdjustment();
  const _layoutObserver = new MutationObserver(applyLayoutAdjustment);
  _layoutObserver.observe(document.documentElement, { childList: true, subtree: false });
  // Para de observar após 15s (WA já carregou)
  setTimeout(() => _layoutObserver.disconnect(), 15000);


  // ===== ESTADO GLOBAL =====
  let state = {
    data: {
      funis: [
        {
          id: 1, nome: 'Vendas',
          colunas: [
            { id: 'c1', nome: 'Novo Lead', autoAdd: false, ignorarSeEmOutra: true, ignoradasIds: [] },
            { id: 'c2', nome: 'Em Contato', autoAdd: false, ignorarSeEmOutra: true, ignoradasIds: [] },
            { id: 'c3', nome: 'Proposta Enviada', autoAdd: false, ignorarSeEmOutra: true, ignoradasIds: [] },
            { id: 'c4', nome: 'Fechado', autoAdd: false, ignorarSeEmOutra: true, ignoradasIds: [] }
          ],
          cards: []
        }
      ],
      campanhas: [],
      autoatendimento: [],
      calendario: { eventos: [] },
      atendimentos: [],
      configuracoes: { idioma: 'pt', modoEscuro: false }
    }
  };

  function loadData() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_DATA' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.data && Object.keys(res.data).length > 0) {
          state.data = { ...state.data, ...res.data };

          // MIGRACAO: Colunas de array de string para array de objetos
          if (state.data.funis && state.data.funis[0] && state.data.funis[0].colunas) {
            let modificado = false;
            state.data.funis[0].colunas = state.data.funis[0].colunas.map((col, idx) => {
              if (typeof col === 'string') {
                modificado = true;
                return { id: 'col_' + Date.now() + '_' + idx, nome: col, autoAdd: false, ignorarSeEmOutra: true, ignoradasIds: [] };
              }
              return col;
            });
            if (modificado) saveData();
          }

          applySettings();
        }
      });
    } catch (e) { }
  }

  function saveData() {
    try {
      chrome.runtime.sendMessage({ type: 'SAVE_DATA', data: state.data });
    } catch (e) { }
  }

  function applySettings() {
    document.body.classList.toggle('crm-dark', !!state.data.configuracoes?.modoEscuro);
  }

  // ===== SVG ICONS =====
  const I = {
    dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    campanhas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
    calendario: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    funis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="6" width="5" height="15" rx="1"/><rect x="17" y="9" width="5" height="12" rx="1"/></svg>`,
    bot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="7" y1="16" x2="7" y2="16" stroke-width="3" stroke-linecap="round"/><line x1="12" y1="16" x2="12" y2="16" stroke-width="3" stroke-linecap="round"/><line x1="17" y1="16" x2="17" y2="16" stroke-width="3" stroke-linecap="round"/></svg>`,
    notif: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    yt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon fill="white" points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/></svg>`,
    relatorios: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  };

  // ===== OVERLAY =====
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'FlowZap-overlay';
    overlay.addEventListener('click', closeAll);
    document.body.appendChild(overlay);
  }

  function showOverlay() { document.getElementById('FlowZap-overlay')?.classList.add('visible'); }
  function hideOverlay() { document.getElementById('FlowZap-overlay')?.classList.remove('visible'); }

  function closeAll() {
    document.querySelectorAll('.crm-modal, .crm-panel').forEach(el => el.classList.remove('visible'));
    hideOverlay();
    document.getElementById('crm-kanban-bg')?.remove(); // ← O causador do fundo em blur bloqueado
    document.querySelectorAll('.crm-nav-item').forEach(b => b.classList.remove('active'));
    if (_kanbanRefreshInterval) { clearInterval(_kanbanRefreshInterval); _kanbanRefreshInterval = null; }
  }

  // ===== MODAL / PANEL HELPERS =====
  // footer NUNCA fica vazio - sempre tem pelo menos o botão fechar
  function makeModal(id, title, wide = false) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'crm-modal';
    if (wide) modal.style.width = Math.min(900, window.innerWidth - 80) + 'px';

    // Header
    const header = document.createElement('div');
    header.className = 'crm-modal-header';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'crm-modal-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = I.close;
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeAll(); });
    header.appendChild(h2);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'crm-modal-body';
    body.id = id + '-body';

    // Footer - sempre visível com pelo menos fechar
    const footer = document.createElement('div');
    footer.className = 'crm-modal-footer';
    footer.id = id + '-footer';
    footer.style.display = 'flex';

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    document.body.appendChild(modal);
    return modal;
  }

  function makePanel(id, title) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const panel = document.createElement('div');
    panel.id = id;
    panel.className = 'crm-panel';

    const header = document.createElement('div');
    header.className = 'crm-panel-header';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'crm-modal-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = I.close;
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeAll(); });
    header.appendChild(h2);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'crm-panel-body';
    body.id = id + '-body';

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
    return panel;
  }

  function openModal(id) {
    closeAll();
    document.getElementById(id)?.classList.add('visible');
    showOverlay();
  }

  function openPanel(id, navId) {
    closeAll();
    document.getElementById(id)?.classList.add('visible');
    showOverlay();
    if (navId) document.getElementById('crm-nav-' + navId)?.classList.add('active');
  }

  function btn(text, cls, clickFn, inlineStyle = '') {
    const b = document.createElement('button');
    b.className = 'crm-btn ' + cls;
    b.innerHTML = text;
    if (inlineStyle) b.style.cssText = inlineStyle;
    b.addEventListener('click', clickFn);
    return b;
  }

  function input(id, placeholder, type = 'text') {
    const el = document.createElement('input');
    el.id = id; el.className = 'crm-input'; el.placeholder = placeholder; el.type = type;
    return el;
  }

  function textarea(id, placeholder, rows = 4) {
    const el = document.createElement('textarea');
    el.id = id; el.className = 'crm-input'; el.placeholder = placeholder; el.rows = rows;
    return el;
  }

  function select(id, options) {
    const el = document.createElement('select');
    el.id = id; el.className = 'crm-select';
    options.forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      el.appendChild(opt);
    });
    return el;
  }

  function formGroup(labelText, ...children) {
    const g = document.createElement('div');
    g.className = 'crm-form-group';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    g.appendChild(lbl);
    children.forEach(c => g.appendChild(c));
    return g;
  }

  // ===== SIDEBAR =====
  function createSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'FlowZap-sidebar';

    const logo = document.createElement('div');
    logo.className = 'crm-logo';
    logo.title = 'FlowZap';
    logo.innerHTML = `<svg viewBox="0 0 24 24" fill="white" width="22" height="22"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>`;
    logo.addEventListener('click', openDashboard);
    sidebar.appendChild(logo);

    const items = [
      { id: 'dashboard', icon: I.dashboard, label: 'Dashboard', fn: openDashboard },
      { id: 'campanhas', icon: I.campanhas, label: 'Campanhas', fn: openCampanhas },
      { id: 'calendario', icon: I.calendario, label: 'Calendário', fn: openCalendario },
      { id: 'funis', icon: I.funis, label: 'Kanban', fn: openFunis },
      { id: 'bot', icon: I.bot, label: 'Auto Atendimento', fn: openAutoAtendimento },
      { id: 'relatorios', icon: I.relatorios, label: 'Relatórios', fn: openRelatorios },
      { id: 'api', icon: '🔌', label: 'API Baileys', fn: openApiPanel },
      null, // divider
      { id: 'youtube', icon: I.yt, label: 'Tutoriais', fn: () => window.open('https://youtube.com', '_blank'), color: '#FF0000' },
      null,
      { id: 'notif', icon: I.notif, label: 'Notificações', fn: openNotificacoes },
      { id: 'settings', icon: I.settings, label: 'Configurações', fn: openConfiguracoes },
    ];

    items.forEach(item => {
      if (!item) {
        const d = document.createElement('div');
        d.className = 'crm-divider';
        sidebar.appendChild(d);
        return;
      }
      const navBtn = document.createElement('button');
      navBtn.className = 'crm-nav-item';
      navBtn.id = 'crm-nav-' + item.id;
      navBtn.title = item.label;
      if (item.color) navBtn.style.color = item.color;
      navBtn.innerHTML = item.icon;

      const tooltip = document.createElement('span');
      tooltip.className = 'crm-tooltip';
      tooltip.textContent = item.label;
      navBtn.appendChild(tooltip);

      navBtn.addEventListener('click', item.fn);
      sidebar.appendChild(navBtn);
    });

    const ver = document.createElement('div');
    ver.className = 'crm-version';
    ver.textContent = 'v1.0';
    sidebar.appendChild(ver);

    document.body.appendChild(sidebar);
  }

  // ===== DASHBOARD =====
  function openDashboard() {
    const modal = makeModal('crm-dashboard-modal', '📊 Dashboard');
    const body = document.getElementById('crm-dashboard-modal-body');

    const totalCards = state.data.funis.reduce((a, f) => a + f.cards.length, 0);
    const totalCamp = state.data.campanhas.length;
    const totalBots = (state.data.autoatendimento || []).filter(b => b.ativo).length;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
        <div class="crm-stat-card" style="--c:#00a884">${I.funis}<div class="crm-stat-val">${totalCards}</div><div class="crm-stat-lbl">No Funil</div></div>
        <div class="crm-stat-card" style="--c:#6366f1">${I.campanhas}<div class="crm-stat-val">${totalCamp}</div><div class="crm-stat-lbl">Campanhas</div></div>
        <div class="crm-stat-card" style="--c:#f59e0b">${I.bot}<div class="crm-stat-val">${totalBots}</div><div class="crm-stat-lbl">Bots Ativos</div></div>
      </div>
      <div class="crm-section-box">
        <h3>Funis de Venda</h3>
        ${state.data.funis.map(f => `
          <div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
              <span style="font-size:13px;font-weight:500">${f.nome}</span>
              <span style="font-size:12px;color:var(--crm-text-secondary)">${f.cards.length} contatos</span>
            </div>
            <div class="crm-progress-bar"><div class="crm-progress-fill" style="width:${Math.min(100, (f.cards.length / 5) * 100)}%"></div></div>
          </div>
        `).join('')}
      </div>
    `;
    openModal('crm-dashboard-modal');
  }

  // ===== RELATÓRIOS =====
  // Salva atendimentos no Supabase (tabela: crm_atendimentos)
  async function saveAtendimentoSupabase(record) {
    const token = await new Promise(r => chrome.storage.local.get('sb_token', d => r(d.sb_token)));
    const userId = await new Promise(r => chrome.storage.local.get('sb_uid', d => r(d.sb_uid)));
    if (!token || !userId) return false;
    try {
      // Ajusta propriedades para bater com os nomes das colunas (snake_case) da tabela do Supabase
      const payload = {
        id: record.id,
        user_id: userId,
        date: record.date || record.data,
        contato: record.contato,
        num_mensagens: record.numMensagens || 1,
        ultima_mensagem: record.ultimaMensagem || '',
        created_at: record.created_at,
        updated_at: record.updated_at
      };

      // Usamos on_conflict para UPSERT (atualiza registro se a data, user e contato já existirem)
      const res = await fetch(`${SUPA_URL}/rest/v1/crm_atendimentos?on_conflict=user_id,date,contato`, {
        method: 'POST',
        headers: {
          'apikey': SUPA_ANON,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errObj = await res.json().catch(() => ({}));
        console.error('[FlowZap] Supabase Error ao salvar atendimentos:', errObj);
      }
      return res.ok || res.status === 409;
    } catch (e) {
      console.error('[FlowZap] Fetch Error Supabase:', e);
      return false;
    }
  }

  // Carrega atendimentos do Supabase para o período
  async function loadAtendimentosSupabase(ini, fim) {
    const token = await new Promise(r => chrome.storage.local.get('sb_token', d => r(d.sb_token)));
    const userId = await new Promise(r => chrome.storage.local.get('sb_uid', d => r(d.sb_uid)));
    if (!token || !userId) return null;
    try {
      const res = await fetch(
        `${SUPA_URL}/rest/v1/crm_atendimentos?user_id=eq.${userId}&date=gte.${ini}&date=lte.${fim}&order=date.desc,contato.asc`,
        { headers: { 'apikey': SUPA_ANON, 'Authorization': `Bearer ${token}` } }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  function openRelatorios() {
    closeAll();
    const modalId = 'crm-relatorios';
    makePanel(modalId, '📊 Relatório de Atendimentos');

    const body = document.getElementById(modalId + '-body');
    const dNow = new Date();
    const todayStr = dNow.toISOString().slice(0, 10);
    const firstDayStr = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}-01`;

    body.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:120px;">
          <label style="display:block;font-size:12px;color:var(--crm-text-secondary);margin-bottom:4px;">Data Início</label>
          <input type="date" id="rel-dt-ini" value="${firstDayStr}" style="width:100%;background:var(--crm-bg);color:var(--crm-text);border:1px solid var(--crm-border);padding:8px;border-radius:4px;color-scheme:dark;">
        </div>
        <div style="flex:1;min-width:120px;">
          <label style="display:block;font-size:12px;color:var(--crm-text-secondary);margin-bottom:4px;">Data Fim</label>
          <input type="date" id="rel-dt-fim" value="${todayStr}" style="width:100%;background:var(--crm-bg);color:var(--crm-text);border:1px solid var(--crm-border);padding:8px;border-radius:4px;color-scheme:dark;">
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="rel-btn-filtrar" style="background:#00a884;color:#111b21;border:none;padding:9px 14px;border-radius:4px;font-weight:bold;cursor:pointer;white-space:nowrap;">🔍 Filtrar</button>
          <button id="rel-btn-auto" style="background:linear-gradient(90deg, #6366f1, #a855f7);color:#fff;border:none;padding:9px 12px;border-radius:4px;font-weight:bold;cursor:pointer;white-space:nowrap;" title="Usa Inteligência Artificial e Baileys p/ ler o celular sem travar a tela!">🤖 Importação IA</button>
          <button id="rel-btn-importar" style="background:var(--crm-bg-light);color:var(--crm-text);border:1px solid var(--crm-border);padding:9px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;" title="Importa somente o chat aberto agora">📥 Chat Aberto</button>
          <button id="rel-btn-excel" style="background:#217346;color:#fff;border:none;padding:9px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;" title="Exportar tabela para Excel / CSV">📊 Excel</button>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--crm-text-secondary);margin-bottom:12px;cursor:pointer;">
        <input type="checkbox" id="rel-chk-force" style="accent-color:var(--crm-primary);">
        Forçar reanálise completa (Apaga o histórico local daquele período e recria tudo)
      </label>
      <div id="rel-status" style="font-size:12px;color:var(--crm-text-secondary);min-height:18px;margin-bottom:8px;"></div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;color:var(--crm-text);text-align:left;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--crm-border);background:var(--crm-bg-light);">
               <th style="padding:10px;white-space:nowrap;">Data</th>
               <th style="padding:10px;">Contato</th>
               <th style="padding:10px;">Última mensagem do dia</th>
               <th style="padding:10px;text-align:center;">Ver</th>
            </tr>
          </thead>
          <tbody id="rel-table-body"><tr><td colspan="4" style="text-align:center;padding:20px;color:var(--crm-text-secondary);">Carregando...</td></tr></tbody>
        </table>
      </div>
    `;

    document.getElementById('rel-btn-filtrar').addEventListener('click', () => renderRelTable(true));
    document.getElementById('rel-btn-importar').addEventListener('click', importarUmChat);
    document.getElementById('rel-btn-auto').addEventListener('click', importarTudoAutomatico);
    document.getElementById('rel-btn-excel').addEventListener('click', exportarExcel);

    const MONTH_MAP = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5,
      'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11,
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
    };

    function parseDateSeparator(rawText) {
      if (!rawText) return null;
      const t = rawText.toLowerCase().trim();
      const base = new Date(dNow);
      if (t === 'hoje' || t === 'today') return todayStr;
      if (t === 'ontem' || t === 'yesterday') { base.setDate(base.getDate() - 1); return base.toISOString().slice(0, 10); }
      const longMatch = t.match(/^(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/);
      if (longMatch) {
        const dDay = parseInt(longMatch[1], 10);
        const dMon = MONTH_MAP[longMatch[2]];
        const dYr = longMatch[3] ? parseInt(longMatch[3], 10) : base.getFullYear();
        if (dMon !== undefined) return new Date(dYr, dMon, dDay).toISOString().slice(0, 10);
      }
      const slashMatch = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
      if (slashMatch) {
        const dDay = parseInt(slashMatch[1], 10);
        const dMon = parseInt(slashMatch[2], 10) - 1;
        let dYr = slashMatch[3] ? parseInt(slashMatch[3], 10) : base.getFullYear();
        if (dYr < 100) dYr += 2000;
        return new Date(dYr, dMon, dDay).toISOString().slice(0, 10);
      }
      const wdMap = { domingo: 0, sunday: 0, segunda: 1, 'segunda-feira': 1, monday: 1, terça: 2, terca: 2, 'terça-feira': 2, tuesday: 2, quarta: 3, 'quarta-feira': 3, wednesday: 3, quinta: 4, 'quinta-feira': 4, thursday: 4, sexta: 5, 'sexta-feira': 5, friday: 5, sábado: 6, sabado: 6, saturday: 6 };
      for (const [k, v] of Object.entries(wdMap)) {
        if (t.startsWith(k)) {
          const diff = ((base.getDay() - v) + 7) % 7 || 7;
          base.setDate(base.getDate() - diff);
          return base.toISOString().slice(0, 10);
        }
      }
      return null;
    }

    function extractDatesFromOpenChat(contactName, filterIni, filterFim) {
      const mainEl = document.querySelector('#main');
      if (!mainEl) return { mapped: {} };

      // Para garantir a ordem, pegamos todas as "rows" (linhas do flexbox/virtual-list do WPP)
      // O wpp põe tanto as mensagens quanto os separadores de data dentro de div[role="row"]
      const rows = mainEl.querySelectorAll('div[role="row"]');
      const mapped = {}; // { "YYYY-MM-DD": ["msg1", "msg2", ...] }
      let currentDate = todayStr; // Fallback caso comece sem separador (muito comum se a conversa do dia for longa)

      rows.forEach(row => {
        // Verifica se é um separador de data
        const dateNodes = row.querySelectorAll('[dir="auto"] > span, .message-date-row span, [role="separator"], span[dir="auto"]');
        let isSeparator = false;

        // Tenta achar um texto curto no meio de tudo que pareça um separador de dia ("Ontem", "23 de fev", etc)
        for (const el of dateNodes) {
          const txt = el.textContent?.trim();
          if (txt && txt.length < 40 && txt.length > 2) {
            const parsed = parseDateSeparator(txt);
            if (parsed) {
              currentDate = parsed;
              isSeparator = true;
              break;
            }
          }
        }

        if (isSeparator) return; // Se era separador, não é mensagem

        // Verifica se é uma mensagem (entrou/saiu)
        const msgWrapper = row.querySelector('[class*="message-in"], [class*="message-out"]');
        if (msgWrapper) {
          // Usa .copyable-text ou [data-testid="msg-text"] sem forçar 'span', para capturar o nó de texto base inteiro
          const textWrapper = msgWrapper.querySelector('.copyable-text, [data-testid="msg-text"]');
          let msgText = '';
          if (textWrapper) {
            // O texto da mensagem às vezes fica dentro de um span interno principal
            const innerSpan = textWrapper.querySelector('span[dir="ltr"], span[dir="rtl"], span.selectable-text');
            msgText = (innerSpan ? innerSpan.textContent : textWrapper.textContent)?.trim() || '';
          }

          if (msgText && currentDate >= filterIni && currentDate <= filterFim) {
            if (!mapped[currentDate]) mapped[currentDate] = [];

            // Só adiciona se não for uma string vazia real (para não quebrar join) e pra evitar lixo
            if (msgText.length > 0) {
              mapped[currentDate].push(msgText.replace(/\n/g, ' '));
            }
          }
        }
      });

      // Tenta achar as datas pelo fallback agressivo também (caso mude o layout da data separator)
      const allSpans = mainEl.querySelectorAll('span');
      allSpans.forEach(sp => {
        if (sp.children.length > 0) return;
        const txt = sp.textContent?.trim();
        if (txt && txt.length < 40 && txt.length > 2) {
          const dt = parseDateSeparator(txt);
          if (dt && dt >= filterIni && dt <= filterFim) {
            if (!mapped[dt]) mapped[dt] = [];
          }
        }
      });

      console.log(`[FlowZap] extractDates: ${Object.keys(mapped).length} datas extraídas para ${contactName}`, mapped);
      return { mapped };
    }

    async function persistRecord(contactName, dateStr, joinedMessages, msgCount, horaInicio = '', horaFim = '', forceOverwrite = false) {
      if (!state.data.atendimentos) state.data.atendimentos = [];

      const existingIdx = state.data.atendimentos.findIndex(a => a.date === dateStr && a.contato === contactName);

      const isImportedDefault = (msg) => !msg || msg === '(histórico importado)';
      const cleanIncoming = joinedMessages || '(histórico importado)';

      // Se houver registro existente e importamos mensagens para o dia, mesclar e não ignorar!
      if (existingIdx !== -1) {
        const ex = state.data.atendimentos[existingIdx];

        let shouldUpdate = false;
        if (forceOverwrite) {
          shouldUpdate = true; // Sempre reescreve o resumo velho pelo novo da IA
        } else if (isImportedDefault(ex.ultimaMensagem) && !isImportedDefault(cleanIncoming)) {
          // Tinha registro vazio, achamos novas mensagens
          shouldUpdate = true;
        } else if (!isImportedDefault(cleanIncoming) && cleanIncoming !== ex.ultimaMensagem) {
          // Tinha msgs, mas as novas podem ser mais completas
          if (cleanIncoming.length > ex.ultimaMensagem.length) {
            shouldUpdate = true;
          }
        }

        if (shouldUpdate) {
          ex.ultimaMensagem = cleanIncoming;
          ex.numMensagens = Math.max(ex.numMensagens || 1, msgCount || 1);
          ex.horaInicio = horaInicio || ex.horaInicio || '';
          ex.horaFim = horaFim || ex.horaFim || '';
          ex.updated_at = new Date().toISOString();
          saveAtendimentoSupabase(ex);
          saveData();
          return true; // Fez um update construtivo
        }
        return false;
      }

      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        date: dateStr,
        contato: contactName,
        numMensagens: msgCount || 1,
        ultimaMensagem: cleanIncoming,
        horaInicio: horaInicio || '',
        horaFim: horaFim || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      state.data.atendimentos.push(record);
      saveData();
      saveAtendimentoSupabase(record);
      return true;
    }

    // ── Modal de Progresso FLUTUANTE (não interfere com navegação) ─────────────
    function createProgressModal() {
      const existing = document.getElementById('crm-import-modal');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = 'crm-import-modal';
      el.style.cssText = `
        position:fixed;bottom:20px;right:20px;width:340px;
        background:#1e2a35;border:1px solid #2d3d4a;border-radius:12px;
        box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:9999999;
        font-family:'Segoe UI',sans-serif;overflow:hidden;`;
      el.innerHTML = `
        <div style="background:#0d1b22;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
          <span style="color:#00a884;font-weight:700;font-size:13px;">🔄 Importando histórico...</span>
          <button id="crm-imp-cancel" style="background:transparent;border:none;color:#667781;cursor:pointer;font-size:16px;" title="Cancelar">✕</button>
        </div>
        <div style="padding:14px 16px;">
          <div style="background:#2d3d4a;border-radius:4px;height:6px;overflow:hidden;margin-bottom:10px;">
            <div id="crm-imp-bar" style="background:linear-gradient(90deg,#00a884,#6366f1);height:100%;width:0%;transition:width .4s;"></div>
          </div>
          <div id="crm-imp-label" style="font-size:12px;color:#8696a0;margin-bottom:8px;"></div>
          
          <div id="crm-imp-qr-container" style="display:none; text-align:center; margin: 10px 0;">
            <p style="font-size:11px; color:#f59e0b; margin-bottom: 5px;">Abra seu WhatsApp no celular e escaneie o código abaixo para plugar a Inteligência artificial:</p>
            <img id="crm-imp-qr-img" src="" style="width:200px; height:200px; border-radius:8px;" />
          </div>

          <div id="crm-imp-log" style="max-height:160px;overflow-y:auto;font-size:11px;color:#8696a0;"></div>
        </div>
      `;
      document.body.appendChild(el);
      let cancelled = false;
      el.querySelector('#crm-imp-cancel').addEventListener('click', () => { cancelled = true; el.remove(); });
      return {
        el,
        isCancelled: () => cancelled,
        update(pct, label) {
          if (!document.getElementById('crm-import-modal')) return;
          document.getElementById('crm-imp-bar').style.width = pct + '%';
          document.getElementById('crm-imp-label').textContent = label;
        },
        log(msg, color = '#8696a0') {
          if (!document.getElementById('crm-import-modal')) return;
          const div = document.createElement('div');
          div.style.cssText = `color:${color};padding:2px 0;border-bottom:1px solid #2d3d4a;`;
          div.textContent = msg;
          const logEl = document.getElementById('crm-imp-log');
          if (logEl) { logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight; }
        },
        showQR(base64) {
          const container = document.getElementById('crm-imp-qr-container');
          const img = document.getElementById('crm-imp-qr-img');
          if (container && img) {
            container.style.display = 'block';
            img.src = base64;
          }
        },
        hideQR() {
          const container = document.getElementById('crm-imp-qr-container');
          if (container) container.style.display = 'none';
        },
        finish(msg, isError = false) {
          const el = document.getElementById('crm-import-modal');
          if (!el) return;
          el.querySelector('#crm-imp-bar').style.width = '100%';
          if (isError) el.querySelector('#crm-imp-bar').style.background = '#ef4444';
          el.querySelector('#crm-imp-label').style.color = isError ? '#ef4444' : '#00a884';
          el.querySelector('#crm-imp-label').textContent = msg;
          if (!isError) {
            setTimeout(() => el.remove(), 6000);
          }
        }
      };
    }

    // ── Importar chat aberto manualmente ─────────────────────────────────────
    async function importarUmChat() {
      const ini = document.getElementById('rel-dt-ini').value;
      const fim = document.getElementById('rel-dt-fim').value;
      const statusEl = document.getElementById('rel-status');
      const contactSelectors = ['#main header span[title]', '#main header [data-testid="conversation-info-header-chat-title"] span', '#main header .copyable-text span'];
      let contactName = '';
      for (const sel of contactSelectors) {
        const el = document.querySelector(sel);
        const txt = el?.getAttribute('title') || el?.textContent?.trim();
        if (txt && txt.length > 1) { contactName = txt; break; }
      }
      if (!contactName) { statusEl.style.color = '#ef4444'; statusEl.textContent = '❌ Nenhum chat aberto.'; return; }
      statusEl.style.color = '#00a884'; statusEl.textContent = `🔍 Lendo "${contactName}"...`;
      const { mapped } = extractDatesFromOpenChat(contactName, ini, fim);
      let imported = 0;

      for (const dateStr of Object.keys(mapped)) {
        const msgs = mapped[dateStr] || [];
        const joined = msgs.join(' | ');
        const ok = await persistRecord(contactName, dateStr, joined, msgs.length || 1);
        if (ok) imported++;
      }

      setTimeout(() => { renderRelTable(false); statusEl.textContent = `✅ ${Object.keys(mapped).length} dia(s) processados de "${contactName}". ${imported} info(s) adicionada(s).`; }, 800);
    }

    // ── Importação automática com Inteligência Artificial (Baileys) ───────────
    async function importarTudoAutomatico() {
      const ini = document.getElementById('rel-dt-ini').value;
      const fim = document.getElementById('rel-dt-fim').value;
      const statusEl = document.getElementById('rel-status');

      if (!ini || !fim) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = '❌ Selecione Data de Início e Fim.';
        return;
      }

      const prog = createProgressModal();
      prog.log(`🚀 Iniciando Motor de IA na nuvem...`, '#a855f7');
      prog.update(5, 'Conectando ao Backend...');

      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const backendUrl = 'http://localhost:3001/api/wa';
      const userJidPhone = state.user?.phone || state.user?.numero || 'FlowZap_session';

      try {
        // Pede pra ligar o bailey local
        const startRes = await fetch(`${backendUrl}/connect`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: userJidPhone })
        });

        if (!startRes.ok) {
          prog.finish('🚫 Erro ao ligar backend IA.');
          return;
        }

        // Fica aguardando o status estar CONNECTED
        let isConnected = false;
        let poolCount = 0;

        while (!isConnected && !prog.isCancelled() && poolCount < 600) { // Timeout de 10 minutos
          const stRes = await fetch(`${backendUrl}/status?session=${userJidPhone}`);
          const stData = await stRes.json();

          if (stData.status === 'QR_READY' && stData.qrBase64) {
            prog.showQR(stData.qrBase64);
            prog.update(20, 'Aguardando QRCode...');
          } else if (stData.status === 'CONNECTED') {
            prog.hideQR();
            prog.log(`✅ Conectado ao Celular! Aguardando o início da Sincronização...`, '#00a884');
            isConnected = true; // Quebra o while master

            // Aguarda até 15 segundos para ver se o "isSyncing" é disparado (caso não seja, ele já tinha backup em cache)
            let waitSync = 0;
            let actuallySyncing = false;
            while (waitSync < 8 && !prog.isCancelled()) {
              await sleep(2000);
              const st = await fetch(`${backendUrl}/status?session=${userJidPhone}`).then(r => r.json());
              if (st.isSyncing) {
                actuallySyncing = true;
                break;
              }
              waitSync++;
            }

            if (actuallySyncing) {
              prog.log(`⏳ Baixando histórico gigante do celular. Deixe o Whatsapp aberto...`, '#f59e0b');
              prog.update(30, 'Baixando DB do WhatsApp...');

              // Espera parar de sincronizar SQLite
              while (!prog.isCancelled()) {
                await sleep(3000);
                const cRes = await fetch(`${backendUrl}/status?session=${userJidPhone}`);
                const cData = await cRes.json();
                if (!cData.isSyncing && cData.status !== 'INITIALIZING') break; // Terminou de baixar e salvar a db (ou desconectou)
              }
              prog.log(`✅ Banco de dados Puxado com sucesso!`, '#00a884');
            } else {
              prog.log(`ℹ️ Sem remessa nova para baixar (Cache já atualizado).`, '#667781');
            }
          } else if (stData.status === 'DISCONNECTED') {
            prog.hideQR();
            prog.finish('🚫 Whatsapp Desconectado ou QR Code expirou.', true);
            return;
          } else {
            prog.hideQR();
            prog.update(10, 'Iniciando container WA...');
          }

          if (isConnected) break;
          await sleep(2000);
          poolCount++;
        }

        const forceUpdate = document.getElementById('rel-chk-force')?.checked || false;

        if (prog.isCancelled() || !isConnected) {
          prog.finish('🚫 Conexão cancelada ou não realizada a tempo.', true);
          return;
        }

        if (forceUpdate) {
          prog.log(`⚠️ Modo Forçado: Apagando todos os resumos do período (${ini} até ${fim})...`, '#ef4444');

          if (state.data && state.data.atendimentos) {
            const sizeBefore = state.data.atendimentos.length;
            state.data.atendimentos = state.data.atendimentos.filter(a => a.date < ini || a.date > fim);
            const removed = sizeBefore - state.data.atendimentos.length;

            if (removed > 0) {
              prog.log(`🗑️ Limpados ${removed} relatórios antigos. (Recriando do zero)`, '#8b5cf6');
              saveData();

              // Apagar do Supabase também para não dar duplicidade
              const uuid = await new Promise(r => chrome.storage.local.get('sb_uid', d => r(d.sb_uid)));
              const sbtk = await new Promise(r => chrome.storage.local.get('sb_token', d => r(d.sb_token)));
              if (uuid && sbtk) {
                try {
                  await fetch(`${SUPA_URL}/rest/v1/crm_atendimentos?user_id=eq.${uuid}&date=gte.${ini}&date=lte.${fim}`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPA_ANON, 'Authorization': `Bearer ${sbtk}` }
                  });
                  prog.log(`☁️ Supabase limpo com sucesso para essas datas!`, '#00a884');
                } catch (e) { }
              }
            }
          }
        } else {
          prog.log(`⏭️ Modo Atualização (Ignorando conversas que não tiveram novas mensagens)`, '#0ea5e9');
        }

        // Diagnóstico: verifica quantas mensagens há no banco antes de chamar a IA
        try {
          const statsRes = await fetch(`${backendUrl}/db-stats?dataIni=${ini}&dataFim=${fim}`);
          if (statsRes.ok) {
            const stats = await statsRes.json();
            if (stats.totalMessages === 0) {
              prog.finish(`❌ Banco vazio! O Baileys ainda não sincronizou mensagens. Tente desconectar e reconectar para forçar um novo sync.`, true);
              prog.log(`📁 Banco em: ${stats.dbPath}`, '#667781');
              return;
            }
            if (stats.inSelectedPeriod === 0) {
              const oldest = stats.dateRange?.oldest ? new Date(stats.dateRange.oldest).toLocaleDateString('pt-BR') : '?';
              const newest = stats.dateRange?.newest ? new Date(stats.dateRange.newest).toLocaleDateString('pt-BR') : '?';
              prog.finish(`❌ 0 mensagens no período ${ini} → ${fim}. O banco tem ${stats.totalMessages} msgs de ${oldest} até ${newest}.`, true);
              return;
            }
            prog.log(`📊 Banco OK: ${stats.inSelectedPeriod} msgs no período (${stats.totalMessages} total, ${stats.topContacts?.length || 0} contatos)`, '#00a884');
          }
        } catch (_) { /* silencioso se o endpoint não existe */ }

        // Envia comando para que o Backend faça todo o massivo processamento OpenAI (MODO STREAM)
        prog.update(50, 'Enviando histórico para o ChatGPT...');
        prog.log(`🧠 Inteligência Artificial analisando ${ini} até ${fim}...`, '#6366f1');

        const streamUrl = `${backendUrl}/import-history-stream?session=${userJidPhone}&dataIni=${ini}&dataFim=${fim}&force=${forceUpdate}`;
        const eventSource = new EventSource(streamUrl);

        eventSource.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'progress') {
              const { current, total, jid } = msg;
              const perc = 50 + Math.floor((current / total) * 35); // de 50% até 85%
              prog.update(perc, `Analisando Contatos (${current}/${total})`);
              prog.log(`🤖 OpenAI Resumiu: ${jid.split('@')[0]}`, '#8b5cf6');
            }
            else if (msg.type === 'end') {
              eventSource.close();
              // Garante que arrayData é sempre um array iterável, mesmo que a IA retorne objeto ou dado inesperado
              let arrayData = msg.data;
              if (!Array.isArray(arrayData)) {
                arrayData = (arrayData && typeof arrayData === 'object') ? Object.values(arrayData) : [];
              }

              if (arrayData.length === 0) {
                prog.finish('Nenhuma conversa encontrada neste limite de datas.', true);
                return;
              }

              prog.update(90, 'Salvando Json de Alta Qualidade Localmente...');
              let savedCount = 0;

              // Debug: mostra os primeiros itens recebidos no console
              console.log(`[FlowZap IA] Recebidos ${arrayData.length} items da IA:`, arrayData.slice(0, 3));

              for (const item of arrayData) {
                // Aceita 'ultimaMensagem' OU 'ultima_mensagem_resumo' (compatibilidade com variação da IA)
                const resumo = item.ultimaMensagem || item.ultima_mensagem_resumo || item.resumo || '';
                const contato = item.contato || item.contact || item.jid || '';
                const date = item.date || item.data || '';
                if (date && contato && resumo) {
                  const ok = await persistRecord(
                    contato,
                    date,
                    resumo,
                    item.numMensagens || item.num_mensagens || 1,
                    item.horaInicio || item.hora_inicio || '',
                    item.horaFim || item.hora_fim || '',
                    forceUpdate
                  );
                  if (ok) savedCount++;
                } else {
                  console.warn('[FlowZap IA] Item ignorado (campos faltando):', item);
                }
              }

              saveData(); // Save after all records are processed
              prog.update(100, `Finalizado! ${savedCount} registros de IA salvos.`);
              if (savedCount === 0 && arrayData.length > 0) {
                prog.log(`⚠️ A IA retornou ${arrayData.length} itens mas nenhum tinha os campos obrigatórios. Verifique o console (F12) para detalhes.`, '#f59e0b');
              }
              prog.log(`🎉 Sucesso Absoluto!`, '#00a884');
              prog.finish(`Concluído! ${savedCount} chats IA processados.`);

              openRelatorios(); // Refresh panel
            }
            else if (msg.type === 'error') {
              eventSource.close();
              prog.finish(`❌ Erro no Servidor IA: ${msg.error}`, true);
            }
          } catch (e) {
            console.error('Falha processando stream da IA:', e);
            prog.finish(`❌ Erro ao processar dados da IA: ${e.message}`, true);
          }
        };

        eventSource.onerror = (err) => {
          eventSource.close();
          prog.finish('❌ Conexão Stream com IA falhou no meio.', true);
        };

      } catch (err) {
        prog.finish(`🔥 Erro Fatal Backend: ${err.message}`);
      }
    }

    // ── Exportar para XLSX (Verdadeiro via Backend) ───────────────────────────
    function exportarExcel() {
      const funil = getFunil();
      const colOptions = funil.colunas.map((colObj, idx) => {
        const c = _normCol(colObj);
        return `<label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:14px;cursor:pointer;"><input type="checkbox" class="rel-col-chk" value="${idx}" checked style="accent-color:var(--crm-primary);"> ${c.nome}</label>`;
      }).join('');

      const mId = 'crm-excel-modal';
      makeModal(mId, '📊 Filtro de Exportação');
      const b = document.getElementById(mId + '-body');
      b.innerHTML = `
        <div style="margin-bottom:12px;color:var(--crm-text-secondary);font-size:13px;">Quais status do funil de vendas (Kanban) você deseja exportar? Contatos que não estão nas colunas selecionadas serão ocultados do Excel.</div>
        <div style="background:var(--crm-bg-light);padding:12px;border-radius:6px;border:1px solid var(--crm-border);max-height:260px;overflow-y:auto;color:var(--crm-text);margin-bottom:10px;">
          ${colOptions}
        </div>
      `;
      const ftr = document.getElementById(mId + '-footer');
      ftr.innerHTML = ''; // limpa

      const cancelBtn = btn('Cancelar', 'crm-btn crm-btn-secondary', () => { closeAll(); openRelatorios(); });
      const dlBtn = btn('Baixar Planilha', 'crm-btn crm-btn-primary', () => {
        const permitidas = Array.from(document.querySelectorAll('.rel-col-chk:checked')).map(el => parseInt(el.value));

        // Salva as datas do filtro atual ANTES de fechar a tela que vai recarregar tudo
        const ini = document.getElementById('rel-dt-ini') ? document.getElementById('rel-dt-ini').value : '';
        const fim = document.getElementById('rel-dt-fim') ? document.getElementById('rel-dt-fim').value : '';

        closeAll();
        openRelatorios(); // reabre a tela original por baixo (que infelizmente reseta os campos para o dia 01)

        // Devolve as datas escolhidas pelo usuario
        if (ini) document.getElementById('rel-dt-ini').value = ini;
        if (fim) document.getElementById('rel-dt-fim').value = fim;

        exportarExcelReal(permitidas);
      });

      ftr.appendChild(cancelBtn);
      ftr.appendChild(dlBtn);
      document.getElementById(mId).classList.add('visible');
      showOverlay();
    }

    async function exportarExcelReal(colunasPermitidas) {
      const ini = document.getElementById('rel-dt-ini').value;
      const fim = document.getElementById('rel-dt-fim').value;
      const statusEl = document.getElementById('rel-status');

      let list = (state.data.atendimentos || []).filter(a => { const d = a.date || ''; return d >= ini && d <= fim; });

      // Filtragem cruzada pelo Kanban (opcional: se não estiver no kanban, marca como "Sem Coluna" e passa se a coluna "Sem Coluna" estiver marcada, ou passa direto se não tiver isso)
      const funil = getFunil();
      // O usuário selecionou checkboxes das colunas.
      // Se ele permitiu "todas as listadas", e os que não estão no kanban não tem coluna listada, então nós vamos exportar GERAL independentemente caso o cara mande exportar (para não sumir dados) - Modificacao: Exportar sem filtrar out quem não está no kanban, ou incluir "Fora do Funil" na checagem.

      list = list.filter(a => {
        const targetLower = (a.contato || '').toLowerCase();
        const card = funil.cards.find(c => c.nome.toLowerCase() === targetLower || (c.telefone && c.telefone === a.contato));
        if (!card) return true; // EXPORTA MESMO QUE NAO ESTEJA NO KANBAN!
        return colunasPermitidas.includes(card.coluna);
      });

      list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.contato || '').localeCompare(b.contato || ''));
      if (list.length === 0) {
        if (statusEl) statusEl.textContent = '⚠️ Nenhum dado para exportar nas colunas e período selecionados.';
        return;
      }

      function getHoraBrasilia(val, isoTimestamp) {
        if (isoTimestamp) {
          try {
            const d = new Date(isoTimestamp);
            if (!isNaN(d.getTime())) {
              return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
            }
          } catch (e) {}
        }
        if (!val) return '';
        if (typeof val === 'string' && val.includes('T')) {
          try {
            const d2 = new Date(val);
            if (!isNaN(d2.getTime())) {
              return d2.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
            }
          } catch (e) {}
        }
        if (/^\d{2}:\d{2}$/.test(val)) return val;
        if (/^\d{2}:\d{2}:\d{2}$/.test(val)) return val.substring(0, 5);
        return String(val);
      }

      const payloadList = list.map(a => {
        const parts = (a.date || '').split('-');
        const brDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : (a.date || '');
        const targetLower = (a.contato || '').toLowerCase();
        const card = funil.cards.find(c => c.nome.toLowerCase() === targetLower || (c.telefone && c.telefone === a.contato));
        const colunaNome = card && funil.colunas[card.coluna] ? _normCol(funil.colunas[card.coluna]).nome : 'Desconhecida';

        const horaIni = getHoraBrasilia(a.horaInicio || a.hora_inicio, a.created_at);
        const horaFim = getHoraBrasilia(a.horaFim || a.hora_fim, a.updated_at);

        return {
          'Data': brDate,
          'Contato': a.contato || '',
          'Coluna Kanban': colunaNome,
          'Última Mensagem': a.ultimaMensagem || '',
          'Mensagens': a.numMensagens || 1,
          'Hora Início': horaIni,
          'Hora Fim': horaFim
        };
      });

      if (statusEl) {
        statusEl.style.color = '#f59e0b';
        statusEl.textContent = '⏳ Gerando arquivo Excel (.xlsx)...';
      }

      function exportClientSideXLSX(dataList, fileName) {
        if (!dataList || dataList.length === 0) return false;
        try {
          const xlsxLib = (typeof XLSX !== 'undefined' && XLSX.utils) ? XLSX : (typeof window !== 'undefined' && window.XLSX && window.XLSX.utils ? window.XLSX : null);
          if (xlsxLib) {
            const ws = xlsxLib.utils.json_to_sheet(dataList);
            const wb = xlsxLib.utils.book_new();
            xlsxLib.utils.book_append_sheet(wb, ws, 'Relatorios');
            const wbout = xlsxLib.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            return true;
          } else {
            console.warn('[FlowZap Export] Objeto global XLSX não encontrado.');
          }
        } catch (e) {
          console.error('[FlowZap XLSX Export Erro]', e);
        }
        return false;
      }

      function exportClientSideCSV(dataList, fileName) {
        if (!dataList || dataList.length === 0) return false;
        const headers = Object.keys(dataList[0]);
        let csv = '\uFEFF';
        csv += headers.join(';') + '\n';
        dataList.forEach(row => {
          const line = headers.map(h => {
            let val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
            val = val.replace(/"/g, '""');
            if (val.includes(';') || val.includes('\n') || val.includes('\r') || val.includes('"')) {
              val = `"${val}"`;
            }
            return val;
          }).join(';');
          csv += line + '\n';
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return true;
      }

      // Tenta primeiro gerar o arquivo .XLSX real direto no front-end
      const fileNameXlsx = `relatorio_atendimentos_${ini}_${fim}.xlsx`;
      const generatedXlsx = exportClientSideXLSX(payloadList, fileNameXlsx);

      if (generatedXlsx) {
        if (statusEl) {
          statusEl.style.color = '#00a884';
          statusEl.textContent = `✅ ${list.length} registro(s) exportados com sucesso (.xlsx)!`;
        }
        return;
      }

      // Se falhar o XLSX no front, tenta chamar a API local ou fallback CSV
      try {
        const res = await fetch('http://localhost:3001/api/export-xlsx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list: payloadList })
        });

        if (!res.ok) throw new Error('Servidor local não respondeu');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileNameXlsx;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (statusEl) {
          statusEl.style.color = '#00a884';
          statusEl.textContent = `✅ ${list.length} registro(s) exportados com sucesso (.xlsx)!`;
        }
      } catch (err) {
        console.warn('[FlowZap Export] Servidor local indisponível, gerando CSV de fallback...', err);
        const exported = exportClientSideCSV(payloadList, `relatorio_atendimentos_${ini}_${fim}.csv`);
        if (exported && statusEl) {
          statusEl.style.color = '#00a884';
          statusEl.textContent = `✅ ${list.length} registro(s) exportados com sucesso para Excel (.csv)!`;
        } else if (statusEl) {
          statusEl.style.color = '#ef4444';
          statusEl.textContent = `❌ Erro ao exportar dados: ${err.message}`;
        }
      }
    }

    // ── Renderiza tabela (loadFromSupabase=true faz query no Supabase) ─────────
    async function renderRelTable(loadFromSupabase = false) {
      const ini = document.getElementById('rel-dt-ini')?.value;
      const fim = document.getElementById('rel-dt-fim')?.value;
      const tbody = document.getElementById('rel-table-body');
      if (!tbody || !ini || !fim) return;
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--crm-text-secondary);">Carregando...</td></tr>';

      let list = [];

      if (loadFromSupabase) {
        const sbData = await loadAtendimentosSupabase(ini, fim);
        if (sbData && Array.isArray(sbData) && sbData.length > 0) {
          // Mescla dados Supabase com estado local (Supabase tem prioridade)
          sbData.forEach(rec => {
            const local = state.data.atendimentos?.find(a => a.date === rec.date && a.contato === rec.contato);
            if (!local) state.data.atendimentos.push(rec);
          });
          saveData();
        }
      }

      list = (state.data.atendimentos || []).filter(a => { const d = a.date || ''; return d >= ini && d <= fim; });
      list.sort((a, b) => { const dc = (b.date || '').localeCompare(a.date || ''); return dc !== 0 ? dc : (a.contato || '').localeCompare(b.contato || ''); });

      tbody.innerHTML = '';
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--crm-text-secondary);">
          Nenhum atendimento neste período.<br>
          <small>Use "🔄 Importar Tudo" para carregar o histórico.</small>
        </td></tr>`;
        return;
      }

      const statusEl = document.getElementById('rel-status');
      if (statusEl) { statusEl.style.color = '#667781'; statusEl.textContent = `${list.length} atendimento(s) no período`; }

      list.forEach(a => {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--crm-border);transition:background .15s;';
        tr.addEventListener('mouseenter', () => tr.style.background = 'var(--crm-bg-light)');
        tr.addEventListener('mouseleave', () => tr.style.background = '');

        const parts = (a.date || '').split('-');
        const brDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : (a.date || '');

        const tdData = document.createElement('td');
        tdData.style.cssText = 'padding:10px;white-space:nowrap;font-size:12px;color:var(--crm-text-secondary);';
        tdData.textContent = brDate;

        const tdName = document.createElement('td');
        tdName.style.cssText = 'padding:10px;font-weight:600;';
        tdName.textContent = a.contato || '---';

        const tdMsg = document.createElement('td');
        tdMsg.style.cssText = 'padding:10px;font-size:12px;color:var(--crm-text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        tdMsg.title = a.ultimaMensagem || '';
        tdMsg.textContent = a.ultimaMensagem || '---';

        const tdAction = document.createElement('td');
        tdAction.style.cssText = 'padding:10px;text-align:center;';
        const btnOpen = document.createElement('button');
        btnOpen.style.cssText = 'background:var(--crm-bg-light);border:1px solid var(--crm-border);color:var(--crm-text);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;';
        btnOpen.textContent = '💬 Chat';
        btnOpen.addEventListener('click', () => { navigateToChat(a.contato); });
        tdAction.appendChild(btnOpen);

        tr.appendChild(tdData); tr.appendChild(tdName); tr.appendChild(tdMsg); tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });
    }

    renderRelTable(true); // Carrega do Supabase ao abrir
    openPanel(modalId, 'relatorios');
  }



  // ===== CAMPANHAS =====
  function openCampanhas() {
    const modal = makeModal('crm-campanhas-modal', '✉️ Campanhas');
    renderCampanhasBody();
    const footer = document.getElementById('crm-campanhas-modal-footer');
    const addBtn = btn(I.plus + ' Nova Campanha', 'crm-btn crm-btn-primary', openNovaCampanha);
    footer.appendChild(addBtn);
    openModal('crm-campanhas-modal');
  }

  function renderCampanhasBody() {
    const body = document.getElementById('crm-campanhas-modal-body');
    if (!body) return;
    body.innerHTML = '';
    if (!state.data.campanhas.length) {
      body.innerHTML = `<div class="crm-empty-state">${I.campanhas}<p>Nenhuma campanha criada ainda.<br>Clique em "Nova Campanha" para começar.</p></div>`;
      return;
    }
    state.data.campanhas.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'crm-campanha-item';
      card.innerHTML = `
        <div class="crm-campanha-header">
          <div class="crm-campanha-name">${c.nome}</div>
          <span class="crm-status-badge ${c.status === 'ativa' ? 'ativo' : 'inativo'}">${c.status || 'rascunho'}</span>
        </div>
        <div style="font-size:12px;color:var(--crm-text-secondary);margin:6px 0">${(c.mensagem || '').substring(0, 80)}...</div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--crm-text-secondary)">
          <span>👥 ${c.contatos || 0} contatos</span>
          <span>📅 ${c.data || 'Não agendada'}</span>
        </div>
      `;
      body.appendChild(card);
    });
  }

  function openNovaCampanha() {
    const modal = makeModal('crm-nova-camp-modal', '✉️ Nova Campanha');
    const body = document.getElementById('crm-nova-camp-modal-body');
    const footer = document.getElementById('crm-nova-camp-modal-footer');

    const nomeInput = input('crm-camp-nome', 'Ex: Promoção de Março');
    const msgInput = textarea('crm-camp-msg', 'Digite a mensagem que será enviada...');
    const dataInput = input('crm-camp-data', '', 'datetime-local');
    const intervInput = input('crm-camp-intervalo', '', 'number');
    intervInput.value = '5'; intervInput.min = '1';

    body.appendChild(formGroup('Nome da Campanha', nomeInput));
    body.appendChild(formGroup('Mensagem', msgInput));
    body.appendChild(formGroup('Data de Envio', dataInput));
    body.appendChild(formGroup('Intervalo entre mensagens (segundos)', intervInput));

    const cancelBtn = btn('Cancelar', 'crm-btn crm-btn-secondary', closeAll);
    const saveBtn = btn('Criar Campanha', 'crm-btn crm-btn-primary', () => {
      const nome = nomeInput.value.trim();
      if (!nome) { alert('Informe o nome da campanha.'); return; }
      state.data.campanhas.push({
        id: Date.now(), nome,
        mensagem: msgInput.value,
        data: dataInput.value,
        intervalo: intervInput.value,
        contatos: 0, status: 'rascunho'
      });
      saveData();
      closeAll();
      openCampanhas();
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    document.getElementById('crm-nova-camp-modal').classList.add('visible');
    showOverlay();
  }

  // ===== CALENDÁRIO =====
  function openCalendario() {
    const modal = makeModal('crm-cal-modal', '📅 Calendário', true);
    const body = document.getElementById('crm-cal-modal-body');
    const now = new Date();
    let curMonth = now.getMonth();
    let curYear = now.getFullYear();
    const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    function render() {
      body.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'crm-calendar-grid';

      // Coluna de meses
      const monthsCol = document.createElement('div');
      monthsCol.className = 'crm-calendar-months';

      const yearRow = document.createElement('div');
      yearRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;color:white';
      const prevYearBtn = document.createElement('button');
      prevYearBtn.className = 'crm-cal-nav'; prevYearBtn.innerHTML = '‹'; prevYearBtn.style.cssText = 'color:white;border-color:rgba(255,255,255,0.3)';
      prevYearBtn.addEventListener('click', () => { curYear--; render(); });
      const yearSpan = document.createElement('span');
      yearSpan.style.fontWeight = '700'; yearSpan.textContent = curYear;
      const nextYearBtn = document.createElement('button');
      nextYearBtn.className = 'crm-cal-nav'; nextYearBtn.innerHTML = '›'; nextYearBtn.style.cssText = 'color:white;border-color:rgba(255,255,255,0.3)';
      nextYearBtn.addEventListener('click', () => { curYear++; render(); });
      yearRow.appendChild(prevYearBtn); yearRow.appendChild(yearSpan); yearRow.appendChild(nextYearBtn);
      monthsCol.appendChild(yearRow);

      MONTHS.forEach((m, i) => {
        const mEl = document.createElement('div');
        mEl.className = 'crm-month-item' + (i === curMonth ? ' active' : '');
        mEl.textContent = m;
        mEl.addEventListener('click', () => { curMonth = i; render(); });
        monthsCol.appendChild(mEl);
      });

      // Coluna principal
      const main = document.createElement('div');
      main.className = 'crm-calendar-main';

      const calHeader = document.createElement('div');
      calHeader.className = 'crm-cal-header';
      const prevBtn = document.createElement('button');
      prevBtn.className = 'crm-cal-nav'; prevBtn.textContent = '‹';
      prevBtn.addEventListener('click', () => { curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; } render(); });
      const titleSpan = document.createElement('span');
      titleSpan.className = 'crm-cal-title';
      titleSpan.textContent = MONTHS[curMonth].toUpperCase() + ' ' + curYear;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'crm-cal-nav'; nextBtn.textContent = '›';
      nextBtn.addEventListener('click', () => { curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; } render(); });
      calHeader.appendChild(prevBtn); calHeader.appendChild(titleSpan); calHeader.appendChild(nextBtn);

      const weekdays = document.createElement('div');
      weekdays.className = 'crm-cal-weekdays';
      ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].forEach(d => {
        const el = document.createElement('div'); el.className = 'crm-cal-weekday'; el.textContent = d;
        weekdays.appendChild(el);
      });

      const daysGrid = document.createElement('div');
      daysGrid.className = 'crm-cal-days';
      const firstDay = new Date(curYear, curMonth, 1).getDay();
      const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
      const today = new Date();
      const eventos = state.data.calendario?.eventos || [];
      const eventDays = eventos.filter(e => {
        const d = new Date(e.data);
        return d.getMonth() === curMonth && d.getFullYear() === curYear;
      }).map(e => new Date(e.data).getDate());

      for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div'); empty.className = 'crm-cal-day other-month';
        daysGrid.appendChild(empty);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dayEl = document.createElement('div');
        const isToday = d === today.getDate() && curMonth === today.getMonth() && curYear === today.getFullYear();
        dayEl.className = 'crm-cal-day' + (isToday ? ' today' : '') + (eventDays.includes(d) ? ' has-event' : '');
        dayEl.textContent = d;
        dayEl.addEventListener('click', () => openNovoEvento(curYear, curMonth, d));
        daysGrid.appendChild(dayEl);
      }

      main.appendChild(calHeader);
      main.appendChild(weekdays);
      main.appendChild(daysGrid);

      // Coluna de eventos do dia
      const sideInfo = document.createElement('div');
      sideInfo.className = 'crm-cal-side';
      const todayEvents = eventos.filter(e => {
        const d = new Date(e.data);
        return d.getDate() === today.getDate() && d.getMonth() === curMonth && d.getFullYear() === curYear;
      });
      const dateTitle = document.createElement('div');
      dateTitle.style.cssText = 'font-size:15px;font-weight:700;color:var(--crm-text);margin-bottom:12px';
      dateTitle.textContent = MONTHS[today.getMonth()] + ' ' + today.getDate() + ', ' + today.getFullYear();
      const addEvBtn = btn('+', 'crm-btn crm-btn-primary', openNovoEvento);
      addEvBtn.style.cssText = 'padding:2px 8px;font-size:14px;float:right;margin-top:-2px';
      sideInfo.appendChild(dateTitle);
      sideInfo.appendChild(addEvBtn);

      if (todayEvents.length) {
        todayEvents.forEach(e => {
          const evEl = document.createElement('div');
          evEl.style.cssText = 'background:var(--crm-primary-light);border-left:3px solid var(--crm-primary);padding:8px 10px;border-radius:6px;margin-bottom:6px;font-size:12px';
          evEl.innerHTML = `<strong>${e.titulo}</strong><br>${e.hora || ''}`;
          sideInfo.appendChild(evEl);
        });
      } else {
        const empty = document.createElement('p');
        empty.style.cssText = 'font-size:13px;color:var(--crm-text-secondary)';
        empty.textContent = 'Nenhum evento';
        sideInfo.appendChild(empty);
      }

      grid.appendChild(monthsCol);
      grid.appendChild(main);
      grid.appendChild(sideInfo);
      body.appendChild(grid);
    }

    render();
    openModal('crm-cal-modal');
  }

  function openNovoEvento(year, month, day) {
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month !== undefined ? month : now.getMonth();
    const d = day || now.getDate();
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const modal = makeModal('crm-novo-ev-modal', '📅 Novo Evento');
    const body = document.getElementById('crm-novo-ev-modal-body');
    const footer = document.getElementById('crm-novo-ev-modal-footer');

    const tituloInput = input('crm-ev-titulo', 'Ex: Reunião com cliente');
    const dataInput = input('crm-ev-data', '', 'date');
    dataInput.value = dateStr;
    const horaInput = input('crm-ev-hora', '', 'time');
    const descInput = textarea('crm-ev-desc', 'Detalhes do evento...', 3);

    body.appendChild(formGroup('Título do Evento', tituloInput));
    body.appendChild(formGroup('Data', dataInput));
    body.appendChild(formGroup('Hora', horaInput));
    body.appendChild(formGroup('Descrição', descInput));

    footer.appendChild(btn('Cancelar', 'crm-btn crm-btn-secondary', closeAll));
    footer.appendChild(btn('Salvar Evento', 'crm-btn crm-btn-primary', () => {
      const titulo = tituloInput.value.trim();
      if (!titulo) { alert('Informe o título.'); return; }
      if (!state.data.calendario) state.data.calendario = { eventos: [] };
      state.data.calendario.eventos.push({
        id: Date.now(), titulo,
        data: dataInput.value,
        hora: horaInput.value,
        desc: descInput.value
      });
      saveData();
      closeAll();
      openCalendario();
    }));

    document.getElementById('crm-novo-ev-modal').classList.add('visible');
    showOverlay();
  }

  // ===== KANBAN CRM (CONVERSAS REAIS) =====

  // Scrape de conversas da sidebar do WhatsApp Web
  function scrapeChatsFromSidebar() {
    const chats = [];

    // Tenta múltiplos seletores para encontrar o painel de chats
    const paneSelectors = [
      '#pane-side',
      '#side',
      '[data-testid="chat-list"]',
      '[aria-label="Lista de conversas"]',
      '[aria-label="Conversas"]',
      '[aria-label="Chat list"]',
      '[aria-label="Chats"]',
      'div[role="navigation"] div[role="grid"]',
      'div[role="grid"]'
    ];
    let pane = null;
    for (const sel of paneSelectors) {
      pane = document.querySelector(sel);
      if (pane) break;
    }
    if (!pane) {
      console.warn('[FlowZap Kanban] ⚠️ Sidebar não encontrada. Seletores tentados:', paneSelectors.join(', '));
      return chats;
    }
    console.log('[FlowZap Kanban] ✅ Sidebar encontrada:', pane.tagName, pane.id || pane.className?.substring(0, 30));

    // Busca os itens de chat - tenta múltiplas abordagens
    let items = pane.querySelectorAll('[data-testid="cell-frame-container"]');
    if (!items.length) items = pane.querySelectorAll('[data-testid="list-item-container"]');
    if (!items.length) items = pane.querySelectorAll('[role="listitem"]');
    if (!items.length) items = pane.querySelectorAll('[role="row"]');
    if (!items.length) items = pane.querySelectorAll('[tabindex="-1"]');
    // Fallback: todos os divs clicáveis com span[title]
    if (!items.length) {
      const allSpans = pane.querySelectorAll('span[title]');
      const parents = new Set();
      allSpans.forEach(sp => {
        // Sobe até 5 níveis para achar o container do chat
        let el = sp;
        for (let i = 0; i < 5; i++) { el = el.parentElement; if (!el) break; }
        if (el) parents.add(el);
      });
      items = [...parents];
    }

    console.log(`[FlowZap Kanban] 📋 Encontrados ${items.length} itens no sidebar`);

    items.forEach(item => {
      try {
        // Título oficial do chat/grupo (prioriza container de título para evitar lista de participantes no subtítulo)
        const titleContainer = item.querySelector('[data-testid="cell-frame-title"]') || item.querySelector('.copyable-text');
        const titleEl = titleContainer ? titleContainer.querySelector('span[title]') : item.querySelector('span[title]');
        let nome = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '';
        if (!nome || nome.length < 2) return;

        // Detecta se é um grupo
        const isGroup = !!(item.querySelector('[data-icon*="group"]') || item.querySelector('[data-icon*="community"]') || (item.innerHTML && item.innerHTML.includes('avatar-group')));

        // Se for grupo e o nome parecer lista de pessoas (várias vírgulas), busca o elemento pai único
        if (isGroup && nome.includes(',')) {
          const mainTitleNode = item.querySelector('[data-testid="cell-frame-title"] span');
          if (mainTitleNode && mainTitleNode.textContent && !mainTitleNode.textContent.includes(',')) {
            nome = mainTitleNode.textContent.trim();
          }
        }

        // Última mensagem - múltiplas tentativas
        let lastMsg = '';
        const spans = item.querySelectorAll('span[dir="ltr"], span[dir="rtl"], span[dir="auto"]');
        if (spans.length >= 2) {
          lastMsg = spans[spans.length - 1]?.textContent?.trim() || '';
        }
        if (!lastMsg) {
          const msgSpan = item.querySelector('[data-testid="last-msg-status"]');
          if (msgSpan) lastMsg = msgSpan.closest('div')?.textContent?.trim() || '';
        }

        // Badge de não lidos
        let unread = 0;
        const unreadEl = item.querySelector('[data-testid="icon-unread-count"]') ||
          item.querySelector('span[aria-label*="mensagen"]') ||
          item.querySelector('span[aria-label*="unread"]');
        if (unreadEl) {
          const n = parseInt(unreadEl.textContent);
          if (!isNaN(n)) unread = n;
        }

        // Hora
        let time = '';
        const allSmallSpans = item.querySelectorAll('span');
        for (const sp of allSmallSpans) {
          const t = sp.textContent?.trim();
          if (t && /^\d{1,2}:\d{2}/.test(t)) { time = t; break; }
          if (t && /^(ontem|yesterday|hoje|today)/i.test(t)) { time = t; break; }
          if (t && /^\d{1,2}\/\d{1,2}/.test(t)) { time = t; break; }
        }

        chats.push({ nome, lastMsg: lastMsg.substring(0, 80), unread, time, isGroup });
      } catch (e) { }
    });

    console.log(`[FlowZap Kanban] ✅ Scraped ${chats.length} conversas`, chats.slice(0, 3));
    return chats;
  }

  function navigateToChat(chatName) {
    if (!chatName) return false;
    const cleanTarget = chatName.toLowerCase().replace(/^👥\s*/, '').replace(/\(\d+\)/g, '').trim();

    const pane = document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]');
    let items = pane ? pane.querySelectorAll('[data-testid="cell-frame-container"]') : [];
    if (!items || !items.length) {
      items = document.querySelectorAll('#pane-side div[role="row"], #pane-side div[role="listitem"]');
    }

    console.log('[FlowZap] 🔍 Procurando "' + cleanTarget + '" em ' + items.length + ' itens visíveis');

    for (const item of items) {
      const titleEl = item.querySelector('[data-testid="cell-frame-title"] span[title]') || item.querySelector('span[title]');
      const name = (titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '').toLowerCase();

      if (name && (name === cleanTarget || name.includes(cleanTarget) || cleanTarget.includes(name))) {
        const clickTarget = titleEl ? (titleEl.closest('div[role="button"]') || titleEl.closest('div')) : item;

        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        const mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
        const click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });

        clickTarget.dispatchEvent(mousedown);
        clickTarget.dispatchEvent(mouseup);
        clickTarget.dispatchEvent(click);
        console.log('[FlowZap] ✅ Click sintético disparado em:', name);
        return true;
      }
    }

    // Fallback 1: Rola a lista virtual
    if (pane && pane.scrollTop !== undefined) {
      pane.scrollTop += 250;
    }

    // Fallback 2: Tenta a barra de pesquisa do WhatsApp Web
    const searchInput = document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
      document.querySelector('[data-testid="chat-list-search"]') ||
      document.querySelector('#side input');

    if (searchInput) {
      console.log('[FlowZap] 🔍 Usando busca do WhatsApp para encontrar:', cleanTarget);
      searchInput.focus();
      try { document.execCommand('insertText', false, cleanTarget); } catch (e) { searchInput.textContent = cleanTarget; }
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      setTimeout(() => {
        const firstRes = document.querySelector('#pane-side [data-testid="cell-frame-container"]') ||
          document.querySelector('#pane-side div[role="row"]');
        if (firstRes) {
          firstRes.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          firstRes.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          firstRes.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
      }, 500);
      return true;
    }

    return false;
  }

  // ===== NAV TO CHAT =====
  function openChatInWa(chatName, suppressCloseAll = false) {
    // 1. FECHA TODO O KANBAN e O OVERLAY (se não estiver voltando de envio passivo)
    if (!suppressCloseAll) closeAll();

    // 2. Retry: tenta navegar pro chat até dar certo
    let navRetries = 0;
    function tryNavigate() {
      const found = navigateToChat(chatName);
      if (found) {
        console.log('[FlowZap] 🎯 Navegação OK para o WhatsApp Principal!');
        // Espera carregar o chat para focar no campo de digitação
        setTimeout(() => {
          const waInput = document.querySelector('#main footer [contenteditable="true"]') ||
            document.querySelector('[data-testid="conversation-compose-box-input"]') ||
            document.querySelector('footer [contenteditable="true"]');
          if (waInput) waInput.focus();
        }, 800);
      } else if (navRetries < 20) {
        navRetries++;
        // Scrola o sidebar para cima force o React a renderizar a virtual list
        const pane = document.querySelector('#pane-side');
        if (pane && navRetries % 3 === 0) pane.scrollTop = 0;

        setTimeout(tryNavigate, 400);
      } else {
        console.log('[FlowZap] ❌ Não conseguiu navegar após 20 tentativas');
      }
    }
    // Espera 300ms para a tela limpar e o react voltar
    setTimeout(tryNavigate, 300);
  }

  // Importa conversas visíveis do WhatsApp sidebar que ainda não estão no Kanban
  // A ordem do sidebar DO WHATSAPP é usada diretamente (posição 0 = conversa mais recente)
  function importChatsToKanban() {
    const funil = getFunil();
    const chats = scrapeChatsFromSidebar();
    let added = 0;
    const contactsWithNewIncoming = [];

    chats.forEach((chat, idx) => {
      const existingCard = funil.cards.find(c =>
        c.nome.toLowerCase() === chat.nome.toLowerCase()
      );

      if (!existingCard) {
        // Novo contato detectado na sidebar — adiciona na coluna 0
        funil.cards.push({
          id: Date.now() + Math.floor(Math.random() * 10000) + added,
          nome: chat.nome,
          telefone: '',
          coluna: 0,
          lastMsg: chat.lastMsg || '',
          unread: chat.unread || 0,
          time: chat.time || '',
          label: '',
          sidebarOrder: idx
        });
        added++;
      } else {
        // Detecta se houve nova mensagem RECEBIDA (unread aumentou ou mensagem mudou)
        const prevUnread = existingCard._lastSeenUnread || 0;
        const curUnread = chat.unread || 0;
        const hasMoreUnread = curUnread > prevUnread;
        const hasNewMsg = chat.lastMsg && chat.lastMsg !== existingCard.lastMsg;

        // Atualiza dados visuais
        existingCard.lastMsg = chat.lastMsg || existingCard.lastMsg;
        existingCard.unread = curUnread;
        existingCard.time = chat.time || existingCard.time;
        existingCard.sidebarOrder = idx;
        existingCard._lastSeenUnread = curUnread;

        // Se o unread aumentou OU a mensagem mudou, há atividade nova
        if (hasMoreUnread || hasNewMsg) {
          contactsWithNewIncoming.push({ nome: chat.nome, lastMsg: chat.lastMsg });
        }
      }
    });

    if (added > 0 || chats.length > 0) {
      saveData();
    }

    // Dispara automação para contatos com nova atividade detectada na sidebar
    // O tryAutoAddKanban vai decidir se é new_message ou message_sent (via isRecentSent)
    if (contactsWithNewIncoming.length > 0) {
      console.log(`[FlowZap Kanban] 🔔 Sidebar detectou ${contactsWithNewIncoming.length} contatos com atividade nova:`, contactsWithNewIncoming.map(c => c.nome).join(', '));
      contactsWithNewIncoming.forEach(c => {
        tryAutoAddKanban(c.nome, c.lastMsg, 'new_message');
      });
    }

    return added;
  }

  function getFunil() {
    if (!state.data.funis || !state.data.funis[0]) {
      state.data.funis = [{
        id: 1, nome: 'CRM',
        colunas: [
          { id: 'c1', nome: '📥 Novos', autoAdd: true, ignorarSeEmOutra: true },
          { id: 'c2', nome: '💬 Em Contato', autoAdd: false, ignorarSeEmOutra: true },
          { id: 'c3', nome: '📝 Proposta', autoAdd: false, ignorarSeEmOutra: true },
          { id: 'c4', nome: '✅ Fechado', autoAdd: false, ignorarSeEmOutra: true }
        ],
        cards: []
      }];
    }
    if (!state.data.funis[0].colunas) {
      state.data.funis[0].colunas = [
        { id: 'c1', nome: '📥 Novos', autoAdd: true, ignorarSeEmOutra: true }
      ];
    }
    if (!state.data.funis[0].cards) state.data.funis[0].cards = [];
    return state.data.funis[0];
  }

  function openNovaColuna() {
    const pId = 'crm-prompt-coluna';
    document.getElementById(pId)?.remove();

    makeModal(pId, '➕ Criar Nova Coluna');
    const pBody = document.getElementById(pId + '-body');
    const pFooter = document.getElementById(pId + '-footer');

    const iNome = document.createElement('input');
    iNome.className = 'crm-input';
    iNome.placeholder = 'Nome da coluna: (ex: Negociação)';
    iNome.style.width = '100%';

    pBody.appendChild(formGroup('Nome da Nova Coluna', iNome));

    pFooter.appendChild(btn('Cancelar', 'crm-btn crm-btn-secondary', () => {
      document.getElementById(pId)?.remove();
      openFunis();
    }));

    pFooter.appendChild(btn('Criar', 'crm-btn crm-btn-primary', () => {
      const nome = iNome.value.trim();
      if (!nome) { iNome.style.border = '1px solid #ef4444'; iNome.focus(); return; }
      const funil = getFunil();
      funil.colunas.push({
        id: 'col_' + Date.now(),
        nome: nome,
        autoAdd: false,
        ignorarSeEmOutra: true
      });
      saveData();
      document.getElementById(pId)?.remove();
      openFunis();
    }));

    openModal(pId);
    setTimeout(() => iNome.focus(), 100);
    iNome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pFooter.querySelector('button:last-child').click();
    });
  }

  function openConfigColuna(colIndex) {
    const funil = getFunil();
    const colObj = funil.colunas[colIndex];
    if (!colObj || typeof colObj === 'string') return;

    // Garante array de rules
    if (!colObj.rules) {
      // Migra dados antigos para o novo formato
      colObj.rules = [];
      if (colObj.autoAdd) {
        colObj.rules.push({
          id: 'rule_migrated',
          active: true,
          trigger: 'new_message',
          conditions: colObj.ignorarSeEmOutra !== false
            ? [{ type: 'not_in_any' }]
            : [],
          label: 'Regra migrada'
        });
      }
    }

    const mId = 'crm-config-col-modal';
    document.getElementById(mId)?.remove();
    const modal = makeModal(mId, '⚙️ ' + colObj.nome, true);
    modal.style.width = Math.min(700, window.innerWidth - 80) + 'px';
    const body = document.getElementById(mId + '-body');
    const footer = document.getElementById(mId + '-footer');

    body.style.padding = '0';
    body.style.overflow = 'auto';

    // === SEÇÃO 1: CONFIGURAÇÃO GERAL ===
    const secGeral = document.createElement('div');
    secGeral.style.cssText = 'padding:16px 20px;border-bottom:1px solid var(--crm-border);';

    const nomeInput = document.createElement('input');
    nomeInput.className = 'crm-input';
    nomeInput.value = colObj.nome;
    nomeInput.style.width = '100%';
    secGeral.appendChild(formGroup('Nome da Coluna', nomeInput));
    body.appendChild(secGeral);

    // === SEÇÃO 2: REGRAS DE AUTOMAÇÃO (FLOW BUILDER) ===
    const secRules = document.createElement('div');
    secRules.style.cssText = 'padding:16px 20px;';

    const rulesHeader = document.createElement('div');
    rulesHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    rulesHeader.innerHTML = '<div style="font-weight:700;font-size:15px;color:var(--crm-text);">⚡ Regras de Automação</div>';

    const addRuleBtn = document.createElement('button');
    addRuleBtn.className = 'crm-btn crm-btn-primary';
    addRuleBtn.innerHTML = '+ Nova Regra';
    addRuleBtn.style.fontSize = '12px';
    addRuleBtn.addEventListener('click', () => {
      colObj.rules.push({
        id: 'rule_' + Date.now(),
        active: true,
        trigger: 'new_message',
        conditions: [],
        label: 'Nova Regra'
      });
      rerenderRules();
    });
    rulesHeader.appendChild(addRuleBtn);
    secRules.appendChild(rulesHeader);

    // Info text
    const infoEl = document.createElement('div');
    infoEl.style.cssText = 'font-size:11px;color:var(--crm-text-secondary);margin-bottom:16px;padding:8px 12px;background:#f0f9ff;border-radius:8px;border-left:3px solid #0ea5e9;';
    infoEl.innerHTML = '💡 <b>Regras</b> definem quando um contato é automaticamente adicionado a esta coluna. Cada regra tem um <b>gatilho</b> (quando), <b>condições</b> (se), e a <b>ação</b> (adicionar aqui).';
    secRules.appendChild(infoEl);

    const rulesContainer = document.createElement('div');
    rulesContainer.id = 'crm-rules-container';
    secRules.appendChild(rulesContainer);

    // Empty state
    const emptyState = document.createElement('div');
    emptyState.id = 'crm-rules-empty';
    emptyState.style.cssText = 'text-align:center;padding:32px 16px;color:var(--crm-text-secondary);';
    emptyState.innerHTML = '<div style="font-size:32px;margin-bottom:8px;">📋</div><div style="font-size:13px;">Nenhuma regra de automação configurada.</div><div style="font-size:11px;margin-top:4px;">Clique em <b>+ Nova Regra</b> para começar.</div>';
    secRules.appendChild(emptyState);

    body.appendChild(secRules);

    // Trigger options
    const TRIGGERS = [
      { value: 'new_message', label: '📨 Nova mensagem recebida', icon: '📨' },
      { value: 'message_sent', label: '📤 Mensagem enviada por mim', icon: '📤' },
      { value: 'any_message', label: '💬 Qualquer mensagem (env/rec)', icon: '💬' },
      { value: 'new_contact', label: '👤 Contato novo (primeira mensagem)', icon: '👤' },
      { value: 'keyword', label: '🔑 Mensagem com palavra-chave', icon: '🔑' },
    ];

    // Condition options
    const CONDITION_TYPES = [
      { value: 'not_in_any', label: 'NÃO está em nenhuma outra coluna', icon: '🚫', needsValue: false },
      { value: 'not_in_column', label: 'NÃO está na coluna específica...', icon: '🏷️', needsValue: true, valueType: 'column' },
      { value: 'in_column', label: 'ESTÁ na coluna específica...', icon: '📌', needsValue: true, valueType: 'column' },
      { value: 'keyword', label: 'Mensagem contém palavra-chave...', icon: '💬', needsValue: true, valueType: 'text' },
      { value: 'not_keyword', label: 'Mensagem NÃO contém...', icon: '🚫💬', needsValue: true, valueType: 'text' },
      { value: 'is_group', label: 'É um grupo', icon: '👥', needsValue: false },
      { value: 'is_not_group', label: 'NÃO é um grupo', icon: '👤', needsValue: false },
      { value: 'business_hours', label: 'Horário comercial (8h-18h)', icon: '🕐', needsValue: false },
      { value: 'outside_hours', label: 'Fora do horário comercial', icon: '🌙', needsValue: false },
    ];

    function rerenderRules() {
      const container = document.getElementById('crm-rules-container');
      const empty = document.getElementById('crm-rules-empty');
      container.innerHTML = '';
      empty.style.display = colObj.rules.length === 0 ? 'block' : 'none';

      colObj.rules.forEach((rule, ri) => {
        const ruleCard = document.createElement('div');
        ruleCard.style.cssText = 'background:white;border:1px solid var(--crm-border);border-radius:12px;margin-bottom:12px;overflow:hidden;transition:all 0.2s;' + (rule.active ? '' : 'opacity:0.5;');
        ruleCard.addEventListener('mouseenter', () => { if (rule.active) ruleCard.style.borderColor = 'var(--crm-primary)'; });
        ruleCard.addEventListener('mouseleave', () => { ruleCard.style.borderColor = 'var(--crm-border)'; });

        // ── Rule Header ──
        const rHeader = document.createElement('div');
        rHeader.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(135deg,#f8fafc,#f0f9ff);border-bottom:1px solid var(--crm-border);';

        // Toggle
        const toggle = document.createElement('div');
        toggle.style.cssText = 'width:36px;height:20px;border-radius:10px;cursor:pointer;position:relative;transition:background 0.2s;' + (rule.active ? 'background:#00a884;' : 'background:#ccc;');
        const toggleDot = document.createElement('div');
        toggleDot.style.cssText = 'width:16px;height:16px;background:white;border-radius:50%;position:absolute;top:2px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);' + (rule.active ? 'left:18px;' : 'left:2px;');
        toggle.appendChild(toggleDot);
        toggle.addEventListener('click', () => { rule.active = !rule.active; rerenderRules(); });

        const rTitle = document.createElement('span');
        rTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--crm-text);flex:1;';
        rTitle.textContent = rule.label || 'Regra ' + (ri + 1);

        const rDelete = document.createElement('button');
        rDelete.style.cssText = 'background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;padding:2px 6px;border-radius:4px;';
        rDelete.innerHTML = '🗑️';
        rDelete.title = 'Excluir regra';
        rDelete.addEventListener('click', () => { colObj.rules.splice(ri, 1); rerenderRules(); });

        rHeader.appendChild(toggle);
        rHeader.appendChild(rTitle);
        rHeader.appendChild(rDelete);
        ruleCard.appendChild(rHeader);

        // ── Flow Body ──
        const rBody = document.createElement('div');
        rBody.style.cssText = 'padding:14px 16px;';

        // TRIGGER BLOCK
        const triggerBlock = createFlowBlock('🎯 QUANDO', '#e0f2fe', '#0284c7');
        const triggerSelect = document.createElement('select');
        triggerSelect.className = 'crm-input';
        triggerSelect.style.cssText = 'width:100%;margin-top:6px;font-size:12px;';
        TRIGGERS.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.value;
          opt.textContent = t.label;
          if (rule.trigger === t.value) opt.selected = true;
          triggerSelect.appendChild(opt);
        });
        triggerSelect.addEventListener('change', () => { rule.trigger = triggerSelect.value; rerenderRules(); });
        triggerBlock.appendChild(triggerSelect);

        // Keyword input for trigger
        if (rule.trigger === 'keyword') {
          const kwInput = document.createElement('input');
          kwInput.className = 'crm-input';
          kwInput.style.cssText = 'width:100%;margin-top:6px;font-size:12px;';
          kwInput.placeholder = 'Palavras-chave (separar por vírgula)';
          kwInput.value = rule.triggerKeywords || '';
          kwInput.addEventListener('input', () => { rule.triggerKeywords = kwInput.value; });
          triggerBlock.appendChild(kwInput);
        }
        rBody.appendChild(triggerBlock);

        // CONNECTOR
        rBody.appendChild(createConnector());

        // CONDITIONS BLOCK
        const condBlock = createFlowBlock('🔍 SE (condições)', '#fef3c7', '#d97706');

        if (rule.conditions.length === 0) {
          const noCondText = document.createElement('div');
          noCondText.style.cssText = 'font-size:11px;color:var(--crm-text-secondary);margin:6px 0;font-style:italic;';
          noCondText.textContent = 'Sem condições — será acionado sempre que o gatilho ocorrer.';
          condBlock.appendChild(noCondText);
        }

        rule.conditions.forEach((cond, ci) => {
          const condRow = document.createElement('div');
          condRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';

          // Condition type select
          const condSelect = document.createElement('select');
          condSelect.className = 'crm-input';
          condSelect.style.cssText = 'flex:1;font-size:11px;padding:4px 6px;';
          CONDITION_TYPES.forEach(ct => {
            const opt = document.createElement('option');
            opt.value = ct.value;
            opt.textContent = ct.icon + ' ' + ct.label;
            if (cond.type === ct.value) opt.selected = true;
            condSelect.appendChild(opt);
          });
          condSelect.addEventListener('change', () => {
            cond.type = condSelect.value;
            const ct = CONDITION_TYPES.find(c => c.value === cond.type);
            if (!ct?.needsValue) cond.value = '';
            rerenderRules();
          });
          condRow.appendChild(condSelect);

          // Value input (if needed)
          const condDef = CONDITION_TYPES.find(c => c.value === cond.type);
          if (condDef?.needsValue) {
            if (condDef.valueType === 'column') {
              const colSel = document.createElement('select');
              colSel.className = 'crm-input';
              colSel.style.cssText = 'width:120px;font-size:11px;padding:4px 6px;';
              funil.colunas.forEach((c, ci2) => {
                if (ci2 === colIndex) return; // Exclui a coluna atual
                const cName = typeof c === 'string' ? c : c.nome;
                const opt = document.createElement('option');
                opt.value = ci2;
                opt.textContent = cName;
                if (String(cond.value) === String(ci2) || String(cond.value) === String(c.id) || String(cond.value).toLowerCase() === cName.toLowerCase()) {
                  opt.selected = true;
                }
                colSel.appendChild(opt);
              });
              if ((cond.value === undefined || cond.value === '') && colSel.options.length > 0) {
                cond.value = colSel.options[0].value;
              }
              colSel.addEventListener('change', () => { cond.value = colSel.value; });
              condRow.appendChild(colSel);
            } else {
              const valIn = document.createElement('input');
              valIn.className = 'crm-input';
              valIn.style.cssText = 'width:120px;font-size:11px;padding:4px 6px;';
              valIn.placeholder = 'valor...';
              valIn.value = cond.value || '';
              valIn.addEventListener('input', () => { cond.value = valIn.value; });
              condRow.appendChild(valIn);
            }
          }

          // Delete condition
          const delCond = document.createElement('button');
          delCond.style.cssText = 'background:none;border:none;cursor:pointer;color:#aaa;font-size:12px;padding:2px;';
          delCond.innerHTML = '✕';
          delCond.addEventListener('click', () => { rule.conditions.splice(ci, 1); rerenderRules(); });
          condRow.appendChild(delCond);

          // AND text between conditions
          if (ci > 0) {
            const andLabel = document.createElement('div');
            andLabel.style.cssText = 'font-size:10px;font-weight:700;color:#d97706;margin:4px 0 2px;text-transform:uppercase;letter-spacing:1px;';
            andLabel.textContent = 'E TAMBÉM';
            condBlock.insertBefore(andLabel, condBlock.lastChild);
          }

          condBlock.appendChild(condRow);
        });

        // Add condition button
        const addCondBtn = document.createElement('button');
        addCondBtn.style.cssText = 'background:none;border:1px dashed var(--crm-border);border-radius:6px;padding:4px 10px;font-size:11px;color:var(--crm-text-secondary);cursor:pointer;margin-top:8px;width:100%;text-align:center;';
        addCondBtn.innerHTML = '+ Adicionar Condição';
        addCondBtn.addEventListener('click', () => {
          rule.conditions.push({ type: 'not_in_any', value: '' });
          rerenderRules();
        });
        condBlock.appendChild(addCondBtn);
        rBody.appendChild(condBlock);

        // CONNECTOR
        rBody.appendChild(createConnector());

        // ACTION BLOCK
        const actionBlock = createFlowBlock('✅ ENTÃO', '#dcfce7', '#16a34a');
        const actionText = document.createElement('div');
        actionText.style.cssText = 'font-size:12px;color:#16a34a;font-weight:600;margin-top:6px;';
        actionText.textContent = '➡️ Adicionar contato na coluna "' + colObj.nome + '"';
        actionBlock.appendChild(actionText);
        rBody.appendChild(actionBlock);

        ruleCard.appendChild(rBody);
        container.appendChild(ruleCard);
      });
    }

    function createFlowBlock(title, bgColor, borderColor) {
      const block = document.createElement('div');
      block.style.cssText = `background:${bgColor};border:1px solid ${borderColor}30;border-left:3px solid ${borderColor};border-radius:8px;padding:10px 14px;`;
      const titleEl = document.createElement('div');
      titleEl.style.cssText = `font-size:11px;font-weight:700;color:${borderColor};text-transform:uppercase;letter-spacing:0.5px;`;
      titleEl.textContent = title;
      block.appendChild(titleEl);
      return block;
    }

    function createConnector() {
      const conn = document.createElement('div');
      conn.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:4px 0;';
      conn.innerHTML = '<div style="width:2px;height:12px;background:var(--crm-border);"></div><div style="font-size:10px;color:var(--crm-text-secondary);font-weight:600;">▼</div><div style="width:2px;height:4px;background:var(--crm-border);"></div>';
      return conn;
    }

    rerenderRules();

    // === FOOTER ===
    footer.appendChild(btn('🗑️ Excluir Coluna', 'crm-btn', () => {
      if (confirm('Excluir coluna "' + colObj.nome + '"? Os cards nela serão removidos.')) {
        funil.colunas.splice(colIndex, 1);
        funil.cards = funil.cards.filter(c => c.coluna !== colIndex);
        funil.cards.forEach(c => { if (c.coluna > colIndex) c.coluna -= 1; });
        saveData();
        document.getElementById(mId)?.remove();
        openFunis();
      }
    }, 'background:#ef4444;color:white;'));

    footer.appendChild(btn('💾 Salvar', 'crm-btn crm-btn-primary', () => {
      const newNome = nomeInput.value.trim();
      if (newNome) colObj.nome = newNome;
      // Atualiza autoAdd baseado nas regras (para compatibilidade)
      colObj.autoAdd = colObj.rules.some(r => r.active);
      colObj.ignorarSeEmOutra = colObj.rules.some(r => r.active && r.conditions.some(c => c.type === 'not_in_any'));
      saveData();
      document.getElementById(mId)?.remove();
      openFunis();
    }));

    openModal(mId);
  }

  let dragColIdx = null;
  let _kanbanRefreshInterval = null;

  function openFunis() {
    document.getElementById('crm-kanban-modal')?.remove();
    clearInterval(_kanbanRefreshInterval);

    // Auto-importa ao abrir
    importChatsToKanban();

    const modal = makeModal('crm-kanban-modal', '📋 Kanban CRM', true);
    modal.style.width = Math.min(1250, window.innerWidth - 40) + 'px';
    modal.style.height = '88vh';
    modal.style.maxHeight = '88vh';

    const body = document.getElementById('crm-kanban-modal-body');
    const footer = document.getElementById('crm-kanban-modal-footer');

    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.height = '100%';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:8px;padding:10px 16px;border-bottom:1px solid var(--crm-border);align-items:center;flex-shrink:0;background:#f8fafc;';

    const liveIndicator = document.createElement('span');
    liveIndicator.style.cssText = 'font-size:11px;color:#00a884;font-weight:600;display:flex;align-items:center;gap:4px;';
    liveIndicator.innerHTML = '<span style="width:6px;height:6px;background:#00a884;border-radius:50%;display:inline-block;animation:crm-pulse 2s infinite;"></span> Ao vivo';

    const addColBtn = document.createElement('button');
    addColBtn.className = 'crm-btn crm-btn-secondary';
    addColBtn.innerHTML = '+ Coluna';
    addColBtn.style.fontSize = '12px';
    addColBtn.addEventListener('click', openNovaColuna);

    const bulkImportBtn = document.createElement('button');
    bulkImportBtn.className = 'crm-btn crm-btn-secondary';
    bulkImportBtn.innerHTML = '📥 Carregar em Massa';
    bulkImportBtn.style.fontSize = '12px';
    bulkImportBtn.addEventListener('click', () => openImportacaoMassa(0));

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'crm-btn crm-btn-secondary';
    fullscreenBtn.innerHTML = '🔲 Restaurar';
    fullscreenBtn.style.fontSize = '12px';
    let isFullscreen = true;

    // Abre expandido por padrão
    modal.dataset.origWidth = modal.style.width;
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.maxHeight = '100vh';
    modal.style.maxWidth = '100vw';
    modal.style.borderRadius = '0';

    fullscreenBtn.addEventListener('click', () => {
      isFullscreen = !isFullscreen;
      if (isFullscreen) {
        modal.dataset.origWidth = modal.style.width;
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.maxHeight = '100vh';
        modal.style.maxWidth = '100vw';
        modal.style.borderRadius = '0';
        fullscreenBtn.innerHTML = '🔲 Restaurar';
      } else {
        modal.style.width = modal.dataset.origWidth;
        modal.style.height = '88vh';
        modal.style.maxHeight = '88vh';
        modal.style.maxWidth = '';
        modal.style.borderRadius = '';
        fullscreenBtn.innerHTML = '🔲 Expandir';
      }
    });

    const infoText = document.createElement('span');
    infoText.id = 'crm-kanban-info';
    infoText.style.cssText = 'font-size:11px;color:var(--crm-text-secondary);margin-left:auto;font-weight:600;';
    const totalCards = getFunil().cards.length;
    infoText.textContent = `${totalCards} contatos no Kanban`;

    toolbar.appendChild(liveIndicator);
    toolbar.appendChild(addColBtn);
    toolbar.appendChild(bulkImportBtn);
    toolbar.appendChild(fullscreenBtn);
    toolbar.appendChild(infoText);
    body.appendChild(toolbar);

    // Search bar
    const searchBar = document.createElement('div');
    searchBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--crm-border);flex-shrink:0;display:flex;gap:8px;align-items:center;background:#ffffff;';

    const searchIcon = document.createElement('span');
    searchIcon.style.cssText = 'font-size:14px;';
    searchIcon.textContent = '🔍';

    const searchInput = document.createElement('input');
    searchInput.className = 'crm-input';
    searchInput.placeholder = 'Buscar contato por nome, número ou etiqueta...';
    searchInput.style.cssText = 'flex:1;font-size:12px;padding:6px 10px;border-radius:8px;';

    const searchResult = document.createElement('div');
    searchResult.id = 'crm-kanban-search-result';
    searchResult.style.cssText = 'font-size:11px;color:var(--crm-text-secondary);white-space:nowrap;';

    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = searchInput.value.trim().toLowerCase();
        highlightSearch(q, searchResult);
      }, 200);
    });

    const clearBtn = document.createElement('button');
    clearBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:#aaa;padding:2px;display:none;';
    clearBtn.innerHTML = '✕';
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      highlightSearch('', searchResult);
      clearBtn.style.display = 'none';
    });
    searchInput.addEventListener('input', () => {
      clearBtn.style.display = searchInput.value ? 'block' : 'none';
    });

    searchBar.appendChild(searchIcon);
    searchBar.appendChild(searchInput);
    searchBar.appendChild(clearBtn);
    searchBar.appendChild(searchResult);
    body.appendChild(searchBar);

    // Board container
    const boardContainer = document.createElement('div');
    boardContainer.id = 'crm-kanban-board-area';
    boardContainer.style.cssText = 'flex:1;overflow:hidden;padding:12px 16px;box-sizing:border-box;height:100%;';
    body.appendChild(boardContainer);

    renderKanban(boardContainer);

    footer.appendChild(btn('➕ Adicionar Contato Manual', 'crm-btn crm-btn-secondary', openNovoCardFunilComColuna));
    footer.appendChild(btn('📥 Carregar em Massa', 'crm-btn crm-btn-primary', () => openImportacaoMassa(0)));

    openModal('crm-kanban-modal');

    // Auto-refresh a cada 15 segundos enquanto o Kanban estiver aberto
    _kanbanRefreshInterval = setInterval(() => {
      if (!document.getElementById('crm-kanban-modal')) {
        clearInterval(_kanbanRefreshInterval);
        return;
      }
      importChatsToKanban();
      const area = document.getElementById('crm-kanban-board-area');
      if (area) {
        renderKanban(area);
        const info = document.getElementById('crm-kanban-info');
        if (info) info.textContent = `${getFunil().cards.length} contatos no Kanban`;
      }
    }, 15000);
  }

  function highlightSearch(query, resultEl) {
    const boardArea = document.getElementById('crm-kanban-board-area');
    if (!boardArea) return;

    const allCards = boardArea.querySelectorAll('.crm-kanban-card');
    let matchCount = 0;
    const matchLocations = [];

    allCards.forEach(cardEl => {
      cardEl.style.opacity = '';
      cardEl.style.borderColor = '';
      cardEl.style.boxShadow = '';
      const oldBadge = cardEl.querySelector('.crm-search-badge');
      if (oldBadge) oldBadge.remove();

      if (!query) return;

      const name = (cardEl.querySelector('[title*="WhatsApp"]')?.textContent || cardEl.textContent || '').toLowerCase();
      const match = name.includes(query);

      if (match) {
        matchCount++;
        cardEl.style.borderColor = '#00a884';
        cardEl.style.boxShadow = '0 0 0 2px rgba(0,168,132,0.25), 0 4px 12px rgba(0,168,132,0.15)';
        cardEl.style.opacity = '1';

        const colEl = cardEl.closest('.crm-kanban-col');
        const colTitle = colEl?.querySelector('.crm-kanban-col-title span')?.textContent || '?';
        matchLocations.push(colTitle);

        const badge = document.createElement('div');
        badge.className = 'crm-search-badge';
        badge.style.cssText = 'background:#00a884;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;position:absolute;top:-6px;right:8px;z-index:1;white-space:nowrap;';
        badge.textContent = '📍 ' + colTitle;
        cardEl.appendChild(badge);
      } else {
        cardEl.style.opacity = '0.2';
      }
    });

    if (!query) {
      resultEl.textContent = '';
    } else if (matchCount === 0) {
      resultEl.innerHTML = '<span style="color:#ef4444;">Nenhum resultado</span>';
    } else {
      const uniqueCols = [...new Set(matchLocations)];
      resultEl.innerHTML = `<span style="color:#00a884;font-weight:600;">${matchCount} encontrado${matchCount > 1 ? 's' : ''}</span>` +
        ` em: ${uniqueCols.join(', ')}`;
    }
  }

  function openLimparColuna(colIndex) {
    const funil = getFunil();
    const colObj = funil.colunas[colIndex];
    const colName = typeof colObj === 'string' ? colObj : colObj.nome;
    const cardsInCol = funil.cards.filter(c => c.coluna === colIndex);

    if (cardsInCol.length === 0) {
      alert(`A coluna "${colName}" já está vazia.`);
      return;
    }

    if (confirm(`🧹 Limpar coluna "${colName}"?\nRemover todos os ${cardsInCol.length} contatos desta coluna?`)) {
      funil.cards = funil.cards.filter(c => c.coluna !== colIndex);
      saveData();
      const area = document.getElementById('crm-kanban-board-area');
      if (area) renderKanban(area);
    }
  }

  function openImportacaoMassa(targetColIndex = 0) {
    const funil = getFunil();

    const mId = 'crm-bulk-import-modal';
    document.getElementById(mId)?.remove();

    const modal = makeModal(mId, `📥 Adicionar Contatos em Massa`, true);
    modal.style.width = Math.min(850, window.innerWidth - 60) + 'px';

    const body = document.getElementById(mId + '-body');
    const footer = document.getElementById(mId + '-footer');

    const chatsDisponiveis = scrapeChatsFromSidebar();

    const colOptionsHtml = funil.colunas.map((col, idx) => {
      const name = typeof col === 'string' ? col : col.nome;
      return `<option value="${idx}" ${idx === targetColIndex ? 'selected' : ''}>${name}</option>`;
    }).join('');

    body.innerHTML = `
      <div style="margin-bottom:14px;display:flex;align-items:center;gap:12px;background:#f8fafc;padding:10px 14px;border-radius:10px;border:1px solid #e2e8f0;">
        <label style="font-weight:600;font-size:13px;color:#334155;">Coluna de Destino:</label>
        <select id="crm-bulk-target-col" class="crm-select" style="width:220px;font-size:13px;padding:6px 10px;">
          ${colOptionsHtml}
        </select>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:12px;">
        <input type="text" id="crm-bulk-search" class="crm-input" placeholder="🔍 Filtrar conversas visíveis do WhatsApp..." style="flex:1;font-size:12px;padding:8px 12px;border-radius:8px;">
        <button id="crm-bulk-select-all" class="crm-btn crm-btn-secondary" style="font-size:12px;padding:8px 14px;white-space:nowrap;">Selecionar Todos</button>
      </div>

      <div id="crm-bulk-list" style="max-height:260px;overflow-y:auto;border:1px solid var(--crm-border);border-radius:10px;padding:6px;background:#ffffff;margin-bottom:14px;">
        ${chatsDisponiveis.length === 0 ? '<div style="text-align:center;padding:24px;color:#64748b;font-size:13px;">Nenhum chat visível no sidebar do WhatsApp. Navegue no WhatsApp para carregar mais.</div>' : ''}
        ${chatsDisponiveis.map((c, i) => `
          <label style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;border-radius:6px;transition:background 0.15s;" class="crm-bulk-item" data-name="${c.nome.toLowerCase()}">
            <input type="checkbox" class="crm-bulk-chk" value="${i}" style="width:16px;height:16px;accent-color:#00a884;">
            <div style="flex:1;overflow:hidden;">
              <div style="font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px;">
                ${c.isGroup ? '<span style="background:#e0e7ff;color:#4338ca;padding:1px 6px;border-radius:6px;font-size:10px;">👥 Grupo</span>' : ''}
                ${c.nome}
              </div>
              <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">${c.lastMsg || 'Sem mensagens recentes'}</div>
            </div>
          </label>
        `).join('')}
      </div>

      <div>
        <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:6px;">Ou Cole uma Lista em Lote (um nome ou número por linha):</label>
        <textarea id="crm-bulk-text" class="crm-input" rows="3" placeholder="Estacio Franco&#10;+5511999998888&#10;Clareamento Dental Odonto" style="font-size:12px;border-radius:8px;"></textarea>
      </div>
    `;

    const searchIn = document.getElementById('crm-bulk-search');
    searchIn?.addEventListener('input', () => {
      const q = searchIn.value.toLowerCase().trim();
      document.querySelectorAll('.crm-bulk-item').forEach(el => {
        const name = el.dataset.name || '';
        el.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
      });
    });

    let allSelected = false;
    document.getElementById('crm-bulk-select-all')?.addEventListener('click', () => {
      allSelected = !allSelected;
      document.querySelectorAll('.crm-bulk-chk').forEach(chk => {
        if (chk.closest('.crm-bulk-item').style.display !== 'none') {
          chk.checked = allSelected;
        }
      });
      document.getElementById('crm-bulk-select-all').textContent = allSelected ? 'Desmarcar Todos' : 'Selecionar Todos';
    });

    footer.appendChild(btn('Cancelar', 'crm-btn crm-btn-secondary', () => {
      document.getElementById(mId)?.remove();
    }));

    footer.appendChild(btn('📥 Adicionar Selecionados', 'crm-btn crm-btn-primary', () => {
      const targetCol = parseInt(document.getElementById('crm-bulk-target-col')?.value || targetColIndex);
      let addedCount = 0;

      // Checkboxes
      const checked = document.querySelectorAll('.crm-bulk-chk:checked');
      checked.forEach(chk => {
        const idx = parseInt(chk.value);
        const chat = chatsDisponiveis[idx];
        if (chat) {
          const existingCard = funil.cards.find(c => c.nome.toLowerCase() === chat.nome.toLowerCase());
          if (!existingCard) {
            funil.cards.push({
              id: Date.now() + Math.floor(Math.random() * 100000) + addedCount,
              nome: chat.nome,
              telefone: '',
              coluna: targetCol,
              lastMsg: chat.lastMsg || '',
              unread: chat.unread || 0,
              time: chat.time || '',
              isGroup: !!chat.isGroup,
              sidebarOrder: idx
            });
            addedCount++;
          } else {
            existingCard.coluna = targetCol;
            addedCount++;
          }
        }
      });

      // Texto em lote
      const textVal = document.getElementById('crm-bulk-text')?.value || '';
      const lines = textVal.split('\n').map(l => l.trim()).filter(l => l.length > 1);
      lines.forEach((lineName, li) => {
        const exists = funil.cards.some(c => c.nome.toLowerCase() === lineName.toLowerCase());
        if (!exists) {
          const isGrp = lineName.toLowerCase().includes('grupo') || lineName.startsWith('👥');
          funil.cards.push({
            id: Date.now() + Math.floor(Math.random() * 100000) + addedCount + li,
            nome: lineName,
            telefone: /^\+?\d+$/.test(lineName) ? lineName : '',
            coluna: targetCol,
            lastMsg: '',
            unread: 0,
            time: '',
            isGroup: isGrp,
            sidebarOrder: 9999
          });
          addedCount++;
        }
      });

      saveData();
      document.getElementById(mId)?.remove();
      const area = document.getElementById('crm-kanban-board-area');
      if (area) renderKanban(area);
    }));

    openModal(mId);
  }

  function renderKanban(container) {
    container.innerHTML = '';
    const funil = getFunil();

    const board = document.createElement('div');
    board.id = 'FlowZap-funis-board';

    let dragId = null, dragFromCol = null;

    funil.colunas.forEach((colObj, ci) => {
      const colName = typeof colObj === 'string' ? colObj : colObj.nome;
      const colAuto = typeof colObj === 'string' ? false : colObj.autoAdd;

      const col = document.createElement('div');
      col.className = 'crm-kanban-col';
      col.dataset.col = ci;
      col.draggable = true;

      // Drag coluna
      col.addEventListener('dragstart', (e) => {
        if (e.target === col) {
          dragColIdx = ci;
          col.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      col.addEventListener('dragend', () => { col.style.opacity = '1'; dragColIdx = null; });
      col.addEventListener('dragover', e => { if (dragColIdx !== null && dragColIdx !== ci) e.preventDefault(); });
      col.addEventListener('drop', e => {
        if (dragColIdx !== null && dragColIdx !== ci) {
          e.preventDefault();
          e.stopPropagation();
          const ref = [...funil.colunas];
          const [moved] = funil.colunas.splice(dragColIdx, 1);
          funil.colunas.splice(ci, 0, moved);
          funil.cards.forEach(card => {
            const orig = ref[card.coluna];
            card.coluna = funil.colunas.indexOf(orig);
          });
          saveData();
          renderKanban(container);
        }
      });

      const colCards = funil.cards.filter(c => c.coluna === ci)
        .sort((a, b) => (a.sidebarOrder ?? 9999) - (b.sidebarOrder ?? 9999));

      // Header da Coluna
      const colHeader = document.createElement('div');
      colHeader.className = 'crm-kanban-col-header';
      if (colAuto) colHeader.style.borderTop = '3px solid #00a884';

      const headerTitle = document.createElement('div');
      headerTitle.className = 'crm-kanban-col-title';
      headerTitle.innerHTML = `<span>${colName}</span> <span class="crm-kanban-count-badge">${colCards.length}</span>`;

      // Ações do cabeçalho da coluna (+ adic, 📥 massa, 🧹 limpar, ⚙️ config)
      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'crm-col-actions';

      const quickAddBtn = document.createElement('button');
      quickAddBtn.className = 'crm-col-action-btn add-btn';
      quickAddBtn.innerHTML = '+';
      quickAddBtn.title = 'Adicionar contato nesta coluna';
      quickAddBtn.onclick = (e) => { e.stopPropagation(); openNovoCardFunilComColuna(ci); };

      const bulkAddBtn = document.createElement('button');
      bulkAddBtn.className = 'crm-col-action-btn';
      bulkAddBtn.innerHTML = '📥';
      bulkAddBtn.title = 'Adicionar contatos em massa nesta coluna';
      bulkAddBtn.onclick = (e) => { e.stopPropagation(); openImportacaoMassa(ci); };

      const clearColBtn = document.createElement('button');
      clearColBtn.className = 'crm-col-action-btn';
      clearColBtn.innerHTML = '🧹';
      clearColBtn.title = 'Limpar contatos desta coluna';
      clearColBtn.onclick = (e) => { e.stopPropagation(); openLimparColuna(ci); };

      const confBtn = document.createElement('button');
      confBtn.className = 'crm-col-action-btn';
      confBtn.innerHTML = '⚙️';
      confBtn.title = 'Configurar automação da coluna';
      confBtn.onclick = (e) => { e.stopPropagation(); openConfigColuna(ci); };

      actionsGroup.appendChild(quickAddBtn);
      actionsGroup.appendChild(bulkAddBtn);
      actionsGroup.appendChild(clearColBtn);
      actionsGroup.appendChild(confBtn);

      colHeader.appendChild(headerTitle);
      colHeader.appendChild(actionsGroup);

      // Zona de Cards (com barra de rolagem individual)
      const cardsZone = document.createElement('div');
      cardsZone.className = 'crm-kanban-cards';
      cardsZone.dataset.col = ci;

      cardsZone.addEventListener('dragover', e => {
        if (dragId !== null) {
          e.preventDefault();
          cardsZone.style.background = 'rgba(0,168,132,0.07)';
        }
      });
      cardsZone.addEventListener('dragleave', () => { cardsZone.style.background = ''; });
      cardsZone.addEventListener('drop', e => {
        if (dragId !== null) {
          e.preventDefault();
          e.stopPropagation();
          cardsZone.style.background = '';
          const toCol = +cardsZone.dataset.col;
          if (dragFromCol !== toCol) {
            const card = funil.cards.find(c => c.id === dragId);
            if (card) { card.coluna = toCol; saveData(); }
          }
          dragId = null;
          renderKanban(container);
        }
      });

      // Renderiza os Cards
      colCards.forEach(card => {
        const isGrp = card.isGroup || card.nome.toLowerCase().includes('grupo') || card.nome.startsWith('👥');
        const cleanName = card.nome.replace(/^👥\s*/, '');

        const cardEl = document.createElement('div');
        cardEl.className = 'crm-kanban-card';
        cardEl.draggable = true;
        cardEl.dataset.id = card.id;

        // Card Header (Avatar + Nome + Ir p/ Chat + Del)
        const cardHeader = document.createElement('div');
        cardHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

        const avatar = document.createElement('div');
        avatar.className = 'crm-kanban-card-avatar ' + (isGrp ? 'crm-kanban-card-group-avatar' : '');
        avatar.textContent = isGrp ? '👥' : (cleanName.charAt(0).toUpperCase() || '👤');

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:13px;font-weight:700;color:#1e293b;flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameEl.textContent = cleanName;
        nameEl.title = isGrp ? `Grupo: ${cleanName} (Clique para abrir no WhatsApp)` : `${cleanName} (Clique para abrir no WhatsApp)`;
        nameEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openChatInWa(cleanName);
        });

  let _quickChatPollInterval = null;

  function openQuickChatModal(chatName) {
    const existing = document.getElementById('crm-quick-chat-modal');
    if (existing) existing.remove();
    if (_quickChatPollInterval) { clearInterval(_quickChatPollInterval); _quickChatPollInterval = null; }

    const cleanName = chatName.replace(/^👥\s*/, '').trim();

    // 1. Silenciosamente rola/busca o chat no WhatsApp Web sem fechar o Kanban
    navigateToChat(cleanName);

    // 2. Cria o modal flutuante de Chat Rápido
    const modal = document.createElement('div');
    modal.id = 'crm-quick-chat-modal';

    const isGrp = chatName.toLowerCase().includes('grupo') || chatName.startsWith('👥');

    // Cabeçalho
    const header = document.createElement('div');
    header.className = 'crm-qc-header';
    header.innerHTML = `
      <div class="crm-qc-avatar">${isGrp ? '👥' : (cleanName.charAt(0).toUpperCase() || '👤')}</div>
      <div class="crm-qc-info">
        <div class="crm-qc-name">${cleanName}</div>
        <div class="crm-qc-status">💬 Chat Rápido WhatsApp</div>
      </div>
      <button class="crm-qc-close" title="Fechar Chat Rápido">✕</button>
    `;

    header.querySelector('.crm-qc-close').addEventListener('click', () => {
      if (_quickChatPollInterval) { clearInterval(_quickChatPollInterval); _quickChatPollInterval = null; }
      modal.remove();
    });

    // Corpo de mensagens
    const body = document.createElement('div');
    body.className = 'crm-qc-body';
    body.id = 'crm-qc-body';
    body.innerHTML = `<div style="text-align:center;padding:30px;color:#667781;font-size:12px;">⚡ Carregando mensagens de "${cleanName}"...</div>`;

    // Rodapé de digitação
    const footer = document.createElement('div');
    footer.className = 'crm-qc-footer';

    const msgInput = document.createElement('input');
    msgInput.className = 'crm-qc-input';
    msgInput.placeholder = 'Digite uma mensagem...';
    msgInput.type = 'text';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'crm-qc-send-btn';
    sendBtn.innerHTML = '🚀';
    sendBtn.title = 'Enviar mensagem';

    footer.appendChild(msgInput);
    footer.appendChild(sendBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    document.body.appendChild(modal);

    setTimeout(() => msgInput.focus(), 150);

    // Event listener para dar Play nos áudios
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-trigger-audio]');
      if (btn) {
        const targetId = btn.dataset.triggerAudio;
        const targetWaBtn = document.querySelector(`[data-qc-audio-target="${targetId}"]`) ||
                            document.querySelector('#main [data-icon="audio-play"]')?.closest('button') ||
                            document.querySelector('#main button[aria-label*="Play"]') ||
                            document.querySelector('#main button[aria-label*="Reproduzir"]');
        if (targetWaBtn) {
          targetWaBtn.click();
          btn.textContent = btn.textContent === '▶️' ? '⏸️' : '▶️';
        }
      }
    });

    // Lê e renderiza mensagens (Textos, Imagens, Áudios, Documentos e Remetentes)
    function renderLiveMessages() {
      const mainEl = document.querySelector('#main');
      if (!mainEl) return false;

      let msgContainers = mainEl.querySelectorAll('[class*="message-in"], [class*="message-out"]');
      if (!msgContainers.length) msgContainers = mainEl.querySelectorAll('[data-testid="msg-container"]');
      if (!msgContainers.length) msgContainers = mainEl.querySelectorAll('div[role="row"]');

      if (!msgContainers.length) return false;

      let html = '';
      let msgCount = 0;

      msgContainers.forEach(container => {
        // Detecção ultra-precisa de mensagens enviadas pelo usuário
        const isOut = !!(
          container.classList?.contains('message-out') ||
          container.querySelector('[class*="message-out"], .message-out') ||
          container.closest('[class*="message-out"]') ||
          container.querySelector('[data-icon*="check"], [data-icon*="dblcheck"], [data-icon*="time"]') ||
          (container.innerHTML && (
            container.innerHTML.includes('wds-ic-read') ||
            container.innerHTML.includes('msg-dblcheck') ||
            container.innerHTML.includes('msg-check') ||
            container.innerHTML.includes('data-icon="check"')
          ))
        );

        const isGroupMsg = !isOut;

        // 1. Remetente (Quem enviou - Grupos)
        let senderName = '';
        if (isGroupMsg) {
          const senderEl = container.querySelector('[data-testid="author"]') ||
            container.querySelector('span[dir="auto"].copyable-text') ||
            container.querySelector('._ak72, ._ak73, [data-testid="chat-title"]');
          if (senderEl) {
            const sTxt = senderEl.textContent?.trim();
            if (sTxt && sTxt.length > 1 && !sTxt.includes(':')) senderName = sTxt;
          }
        }

        // 2. Imagens / Fotos
        let imgHtml = '';
        const imgEl = container.querySelector('img[src*="blob:"], img[src*="data:"], [data-testid="image-thumb"] img');
        if (imgEl && imgEl.src) {
          imgHtml = `<img src="${imgEl.src}" class="crm-qc-media-img" alt="Imagem" />`;
        }

        // 3. Áudios / Mensagens de Voz (com Botão Play ▶️ interativo)
        let audioHtml = '';
        const audioEl = container.querySelector('audio, [data-testid="audio-player"]');
        const audioSrc = audioEl?.querySelector('source')?.src || audioEl?.src;

        if (audioSrc) {
          audioHtml = `<audio controls src="${audioSrc}" style="max-width:100%;margin-top:4px;height:32px;"></audio>`;
        } else if (container.querySelector('[aria-label*="áudio"]') || container.querySelector('[data-icon*="audio"]') || container.querySelector('[data-icon*="ptt"]') || container.querySelector('[data-icon="audio-play"]') || container.querySelector('[data-testid="audio-play"]')) {
          const waPlayBtn = container.querySelector('[data-icon="audio-play"], [data-testid="audio-play"], button[aria-label*="Play"], button[aria-label*="Reproduzir"], span[data-icon="play"]')?.closest('button') ||
                            container.querySelector('button[aria-label*="áudio"]') ||
                            container.querySelector('span[data-icon="audio-play"]')?.parentElement;

          const audioId = 'qc-aud-' + Math.random().toString(36).substr(2, 7);
          if (waPlayBtn) {
            waPlayBtn.dataset.qcAudioTarget = audioId;
          }

          audioHtml = `
            <div class="crm-qc-media-audio">
              <button class="crm-qc-audio-btn" data-trigger-audio="${audioId}" title="Reproduzir áudio no WhatsApp">▶️</button>
              <span>🎙️ Mensagem de Voz</span>
            </div>
          `;
        }

        // 4. Documentos / Arquivos
        let docHtml = '';
        const docEl = container.querySelector('[data-testid="document-thumb"], [data-icon*="document"]');
        if (docEl) {
          const docTitle = container.querySelector('[title]')?.getAttribute('title') || 'Documento / Arquivo';
          docHtml = `<div class="crm-qc-media-doc">📄 ${docTitle}</div>`;
        }

        // 5. Texto principal
        const textWrapper = container.querySelector('.copyable-text, [data-testid="msg-text"]');
        let msgText = '';
        if (textWrapper) {
          const innerSpan = textWrapper.querySelector('span[dir="ltr"], span[dir="rtl"], span.selectable-text');
          msgText = (innerSpan ? innerSpan.textContent : textWrapper.textContent)?.trim() || '';
        }

        // Horário
        let timeText = '';
        const timeSpan = container.querySelector('span[dir="auto"], [data-testid="msg-meta"]');
        if (timeSpan) {
          let rawTime = timeSpan.textContent?.trim() || '';
          // Limpa qualquer código sujo do checkmark como "wds-ic-read"
          timeText = rawTime.replace(/wds-ic-read/gi, '').replace(/msg-dblcheck/gi, '').trim();
        }

        // Se encontrou qualquer conteúdo
        if (msgText || imgHtml || audioHtml || docHtml) {
          msgCount++;
          const safeText = msgText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += `
            <div class="crm-qc-msg ${isOut ? 'crm-qc-msg-out' : 'crm-qc-msg-in'}">
              ${senderName ? `<div class="crm-qc-sender-name">${senderName}</div>` : ''}
              ${imgHtml}
              ${audioHtml}
              ${docHtml}
              ${safeText ? `<div style="margin-top:2px;">${safeText}</div>` : ''}
              ${timeText ? `<span class="crm-qc-time">${timeText}</span>` : ''}
            </div>
          `;
        }
      });

      if (msgCount > 0) {
        const isScrolledBottom = body.scrollHeight - body.scrollTop <= body.clientHeight + 80;
        body.innerHTML = html;
        if (isScrolledBottom || body.dataset.initialScrolled !== 'true') {
          body.scrollTop = body.scrollHeight;
          body.dataset.initialScrolled = 'true';
        }
        return true;
      }
      return false;
    }

    // Loop de carregamento ultrarrápido inicial (a cada 100ms)
    let fastRetries = 0;
    const fastInterval = setInterval(() => {
      fastRetries++;
      const loaded = renderLiveMessages();
      if (loaded || fastRetries > 25) {
        clearInterval(fastInterval);
      } else if (fastRetries % 5 === 0) {
        // Se ainda não carregou após 500ms, tenta recarregar o chat no WhatsApp
        navigateToChat(cleanName);
      }
    }, 100);

    // Polling regular a cada 2s para mensagens novas
    _quickChatPollInterval = setInterval(() => {
      if (!document.getElementById('crm-quick-chat-modal')) {
        clearInterval(_quickChatPollInterval);
        _quickChatPollInterval = null;
        return;
      }
      renderLiveMessages();
    }, 2000);

    function doSend() {
      const text = msgInput.value.trim();
      if (!text) return;

      msgInput.value = '';
      sendQuickChatMessage(cleanName, text);

      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const tempMsg = document.createElement('div');
      tempMsg.className = 'crm-qc-msg crm-qc-msg-out';
      tempMsg.innerHTML = `${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')} <span class="crm-qc-time">${nowStr}</span>`;
      body.appendChild(tempMsg);
      body.scrollTop = body.scrollHeight;

      setTimeout(renderLiveMessages, 600);
    }

    sendBtn.addEventListener('click', doSend);
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });
  }

  function sendQuickChatMessage(chatName, text) {
    console.log(`[FlowZap QuickChat] Enviando para "${chatName}":`, text);
    // Marca envio ANTES de navegar para garantir que o Kanban reconheça
    markMessageSent(chatName, text);
    navigateToChat(chatName);

    setTimeout(() => {
      const composeBox = document.querySelector('#main footer [contenteditable="true"]') ||
        document.querySelector('[data-testid="conversation-compose-box-input"]') ||
        document.querySelector('footer [contenteditable="true"]');

      if (composeBox) {
        composeBox.focus();
        try {
          document.execCommand('insertText', false, text);
        } catch (e) {
          composeBox.textContent = text;
        }
        composeBox.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(() => {
          const sendBtnNode = document.querySelector('#main footer [data-testid="send"]') ||
            document.querySelector('#main footer button span[data-icon="send"]')?.closest('button') ||
            document.querySelector('footer [data-icon="send"]')?.closest('button');

          if (sendBtnNode) {
            sendBtnNode.click();
            console.log('[FlowZap QuickChat] ✅ Botão Enviar clicado!');
          } else {
            const enterEvt = new KeyboardEvent('keydown', {
              bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
            });
            composeBox.dispatchEvent(enterEvt);
            console.log('[FlowZap QuickChat] ⌨️ Evento Enter disparado no composer');
          }

          // Dispara automação do Kanban após envio (message_sent)
          setTimeout(() => {
            tryAutoAddKanban(chatName, text, 'message_sent');
          }, 300);
        }, 200);
      } else {
        console.warn('[FlowZap QuickChat] ⚠️ Campo de digitação não encontrado no WhatsApp Web');
      }
    }, 400);
  }

        const headerActions = document.createElement('div');
        headerActions.style.cssText = 'display:flex;align-items:center;gap:4px;';

        const chatBtn = document.createElement('button');
        chatBtn.style.cssText = 'background:#25D366;border:none;border-radius:50%;cursor:pointer;color:white;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,0.15);';
        chatBtn.innerHTML = '💬';
        chatBtn.title = 'Abrir Chat Rápido (Pop-up sem sair do Kanban)';
        chatBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openQuickChatModal(cleanName);
        });

        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:#94a3b8;font-size:13px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;';
        delBtn.innerHTML = '✕';
        delBtn.title = 'Remover do Kanban';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          funil.cards = funil.cards.filter(c => c.id !== card.id);
          saveData();
          renderKanban(container);
        });

        headerActions.appendChild(chatBtn);
        headerActions.appendChild(delBtn);

        cardHeader.appendChild(avatar);
        cardHeader.appendChild(nameEl);
        cardHeader.appendChild(headerActions);
        cardEl.appendChild(cardHeader);

        // Tags & Badges (Etiquetas)
        const tagsRow = document.createElement('div');
        tagsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;';

        if (card.label) {
          const lblPill = document.createElement('span');
          const lLower = card.label.toLowerCase();
          let cls = 'resolvido';
          if (lLower.includes('negoci')) cls = 'negociacao';
          else if (lLower.includes('urgent')) cls = 'urgente';
          else if (lLower.includes('odont') || lLower.includes('dent')) cls = 'odonto';
          else if (lLower.includes('abert') || lLower.includes('novo')) cls = 'aberto';
          else if (lLower.includes('pend')) cls = 'pendente';
          lblPill.className = `crm-tag-pill ${cls}`;
          lblPill.textContent = card.label;
          tagsRow.appendChild(lblPill);
        }

        if (card.unread > 0) {
          const unreadPill = document.createElement('span');
          unreadPill.className = 'crm-tag-pill urgente';
          unreadPill.textContent = `💬 ${card.unread} NÃO LIDA${card.unread > 1 ? 'S' : ''}`;
          tagsRow.appendChild(unreadPill);
        }

        if (tagsRow.children.length > 0) cardEl.appendChild(tagsRow);

        // Última mensagem
        if (card.lastMsg) {
          const msgEl = document.createElement('div');
          msgEl.style.cssText = 'font-size:11px;color:#64748b;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          msgEl.textContent = card.lastMsg;
          cardEl.appendChild(msgEl);
        }

        // Valor de negociação R$ (se houver)
        if (card.valor || card.val) {
          const valRow = document.createElement('div');
          valRow.className = 'crm-card-value-row';
          valRow.innerHTML = `<span>Valor da Negociação:</span> <span class="crm-card-value-val">R$ ${card.valor || card.val}</span>`;
          cardEl.appendChild(valRow);
        }

        // Card Footer (Hora / SLA / Telefone)
        const cardFooter = document.createElement('div');
        cardFooter.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px;font-size:10px;color:#94a3b8;';

        if (card.time) {
          const timeEl = document.createElement('span');
          timeEl.innerHTML = `⏱️ ${card.time}`;
          cardFooter.appendChild(timeEl);
        }

        if (card.telefone) {
          const telEl = document.createElement('span');
          telEl.textContent = card.telefone;
          cardFooter.appendChild(telEl);
        }

        cardEl.appendChild(cardFooter);

        // Drag events
        cardEl.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          dragId = card.id;
          dragFromCol = ci;
          cardEl.style.opacity = '0.4';
        });
        cardEl.addEventListener('dragend', (e) => {
          e.stopPropagation();
          cardEl.style.opacity = '1';
          dragId = null;
        });

        cardsZone.appendChild(cardEl);
      });

      col.appendChild(colHeader);
      col.appendChild(cardsZone);
      board.appendChild(col);
    });

    container.appendChild(board);
  }

  function openNovoCardFunilComColuna(colIndex = 0) {
    const funil = getFunil();
    const mId = 'crm-novo-card-modal';
    document.getElementById(mId)?.remove();
    makeModal(mId, '➕ Adicionar Contato');
    const body = document.getElementById(mId + '-body');
    const footer = document.getElementById(mId + '-footer');

    const nomeInput = input('crm-fc-nome', 'Nome do contato ou grupo');
    const telInput = input('crm-fc-tel', '+55 11 99999-0000');
    const valInput = input('crm-fc-val', '15.200,00');
    const mappedCols = funil.colunas.map((col, i) => {
      const nome = typeof col === 'string' ? col : col.nome;
      return [i, nome];
    });
    const colSelect = select('crm-fc-col', mappedCols);
    colSelect.value = colIndex;
    const labelInput = input('crm-fc-label', 'Ex: Em Negociação, Urgente, Odonto');

    body.appendChild(formGroup('Nome do Contato ou Grupo', nomeInput));
    body.appendChild(formGroup('Telefone (opcional)', telInput));
    body.appendChild(formGroup('Valor da Negociação R$ (opcional)', valInput));
    body.appendChild(formGroup('Coluna', colSelect));
    body.appendChild(formGroup('Etiqueta (opcional)', labelInput));

    footer.appendChild(btn('Cancelar', 'crm-btn crm-btn-secondary', () => {
      document.getElementById(mId)?.remove();
      openFunis();
    }));
    footer.appendChild(btn('Adicionar', 'crm-btn crm-btn-primary', () => {
      const nome = nomeInput.value.trim();
      if (!nome) { nomeInput.style.border = '1px solid #ef4444'; nomeInput.focus(); return; }
      const isGrp = nome.toLowerCase().includes('grupo') || nome.startsWith('👥');
      funil.cards.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        nome,
        telefone: telInput.value.trim(),
        valor: valInput.value.trim(),
        coluna: +colSelect.value,
        label: labelInput.value.trim(),
        lastMsg: '',
        unread: 0,
        time: '',
        isGroup: isGrp,
        sidebarOrder: -1
      });
      saveData();
      document.getElementById(mId)?.remove();
      openFunis();
    }));

    openModal(mId);
  }

  function openNovoCardFunil() {
    openNovoCardFunilComColuna(0);
  }

  // ===== AUTO ATENDIMENTO =====
  function openAutoAtendimento() {
    const modal = makeModal('crm-bot-modal', '🤖 Auto Atendimento');
    renderBotBody();
    // Footer SEMPRE com botão Criar (independente de ter bots ou não)
    const footer = document.getElementById('crm-bot-modal-footer');
    const criarBtn = btn(I.plus + ' Criar Auto Atendimento', 'crm-btn crm-btn-primary', openCriarBot);
    footer.appendChild(criarBtn);
    openModal('crm-bot-modal');
  }

  function renderBotBody() {
    const body = document.getElementById('crm-bot-modal-body');
    if (!body) return;
    body.innerHTML = '';
    const bots = state.data.autoatendimento || [];

    if (!bots.length) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'crm-empty-state';
      emptyDiv.innerHTML = I.bot + '<p>Nenhum autoatendimento encontrado.<br>Clique em "Criar" para adicionar um novo.</p>';
      const criarBtn = btn(I.plus + ' Criar', 'crm-btn crm-btn-primary', openCriarBot);
      emptyDiv.appendChild(criarBtn);
      body.appendChild(emptyDiv);
      return;
    }

    bots.forEach((b, i) => {
      const item = document.createElement('div');
      item.className = 'crm-bot-item';

      const info = document.createElement('div');
      info.style.flex = '1';

      const nameEl = document.createElement('div');
      nameEl.className = 'crm-bot-name';
      nameEl.textContent = b.nome;

      const triggerEl = document.createElement('div');
      triggerEl.className = 'crm-bot-trigger';
      triggerEl.textContent = `Gatilho: ${b.gatilho || 'Qualquer mensagem'}`;

      const tipoEl = document.createElement('div');
      tipoEl.style.cssText = 'font-size:11px;color:var(--crm-text-secondary);margin-top:2px';
      const tipoLabel = { 'palavra': 'Palavra-chave', 'primeira': 'Primeira mensagem', 'qualquer': 'Qualquer mensagem' };
      tipoEl.textContent = `Tipo: ${tipoLabel[b.tipo] || b.tipo || '-'} • Hora: ${b.horario || 'sempre'}`;

      info.appendChild(nameEl);
      info.appendChild(triggerEl);
      info.appendChild(tipoEl);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0';

      const badge = document.createElement('span');
      badge.className = 'crm-status-badge ' + (b.ativo ? 'ativo' : 'inativo');
      badge.textContent = b.ativo ? 'Ativo' : 'Inativo';

      // Botão EDITAR (novo)
      const editBtn = document.createElement('button');
      editBtn.className = 'crm-btn crm-btn-secondary crm-icon-btn';
      editBtn.type = 'button';
      editBtn.title = 'Editar gatilho e configurações';
      editBtn.innerHTML = I.edit;
      editBtn.style.cssText = 'padding:4px 8px;font-size:12px;width:30px;height:30px;display:flex;align-items:center;justify-content:center';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditarBot(i); });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'crm-btn crm-btn-secondary';
      toggleBtn.type = 'button';
      toggleBtn.style.cssText = 'padding:4px 10px;font-size:12px';
      toggleBtn.textContent = b.ativo ? 'Desativar' : 'Ativar';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.data.autoatendimento[i].ativo = !state.data.autoatendimento[i].ativo;
        saveData();
        closeAll();
        openAutoAtendimento();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'crm-btn crm-btn-secondary';
      delBtn.type = 'button';
      delBtn.style.cssText = 'padding:4px 8px;font-size:12px;color:var(--crm-danger);border-color:var(--crm-danger)';
      delBtn.textContent = '✕';
      delBtn.title = 'Remover bot';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Remover o bot "${b.nome}"?`)) {
          state.data.autoatendimento.splice(i, 1);
          saveData();
          renderBotBody();
        }
      });

      actions.appendChild(badge);
      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      actions.appendChild(delBtn);
      item.appendChild(info);
      item.appendChild(actions);
      body.appendChild(item);
    });
  }

  function openCriarBot() {
    const modal = makeModal('crm-criar-bot-modal', '🤖 Criar Auto Atendimento');
    const body = document.getElementById('crm-criar-bot-modal-body');
    const footer = document.getElementById('crm-criar-bot-modal-footer');

    const nomeInput = input('crm-bot-nome', 'Ex: Boas-vindas');
    body.appendChild(formGroup('Nome do Auto Atendimento', nomeInput));

    // Accordion: Acionamento
    body.appendChild(makeAccordion('Acionamento do Auto Atendimento', (content) => {
      const gatilhoInput = input('crm-bot-gatilho', 'Ex: oi, olá, início');
      const tipoInput = select('crm-bot-tipo', [
        ['palavra', 'Palavra-chave'],
        ['primeira', 'Primeira mensagem'],
        ['qualquer', 'Qualquer mensagem']
      ]);
      content.appendChild(formGroup('Palavra-chave (gatilho)', gatilhoInput));
      content.appendChild(formGroup('Tipo de Gatilho', tipoInput));
    }));

    // Accordion: Ação
    body.appendChild(makeAccordion('Ação', (content) => {
      const respostaInput = textarea('crm-bot-resposta', 'Digite a resposta automática...');
      content.appendChild(formGroup('Mensagem de Resposta', respostaInput));
    }));

    // Accordion: Regras
    body.appendChild(makeAccordion('Regras de Acionamento', (content) => {
      const horarioInput = select('crm-bot-horario', [
        ['sempre', 'Sempre'],
        ['comercial', 'Horário Comercial (8h-18h)'],
        ['fora', 'Fora do Horário Comercial']
      ]);
      content.appendChild(formGroup('Horário de Funcionamento', horarioInput));
    }));

    footer.appendChild(btn('Cancelar', 'crm-btn crm-btn-secondary', closeAll));
    footer.appendChild(btn('Criar', 'crm-btn crm-btn-primary', () => {
      const nome = nomeInput.value.trim();
      if (!nome) { alert('Informe o nome.'); return; }
      if (!state.data.autoatendimento) state.data.autoatendimento = [];
      state.data.autoatendimento.push({
        id: Date.now(), nome,
        gatilho: document.getElementById('crm-bot-gatilho')?.value || '',
        tipo: document.getElementById('crm-bot-tipo')?.value || 'palavra',
        resposta: document.getElementById('crm-bot-resposta')?.value || '',
        horario: document.getElementById('crm-bot-horario')?.value || 'sempre',
        ativo: true
      });
      saveData();
      closeAll();
      openAutoAtendimento();
    }));

    document.getElementById('crm-criar-bot-modal').classList.add('visible');
    showOverlay();
  }

  // ===== EDITAR BOT =====
  function openEditarBot(botIndex) {
    const b = state.data.autoatendimento[botIndex];
    if (!b) return;

    const modal = makeModal('crm-editar-bot-modal', '✏️ Editar Auto Atendimento');
    const body = document.getElementById('crm-editar-bot-modal-body');
    const footer = document.getElementById('crm-editar-bot-modal-footer');

    // Nome
    const nomeInput = input('crm-edit-bot-nome', 'Ex: Boas-vindas');
    nomeInput.value = b.nome || '';
    body.appendChild(formGroup('Nome do Auto Atendimento', nomeInput));

    // Accordion: Acionamento
    const accGatilho = makeAccordion('Acionamento do Auto Atendimento', (content) => {
      const gatilhoInput = input('crm-edit-bot-gatilho', 'Ex: oi, olá, início');
      gatilhoInput.value = b.gatilho || '';

      const tipoInput = select('crm-edit-bot-tipo', [
        ['palavra', 'Palavra-chave'],
        ['primeira', 'Primeira mensagem'],
        ['qualquer', 'Qualquer mensagem']
      ]);
      tipoInput.value = b.tipo || 'palavra';

      content.appendChild(formGroup('Palavra-chave (gatilho)', gatilhoInput));
      content.appendChild(formGroup('Tipo de Gatilho', tipoInput));
    });
    // Abre accordion automaticamente para facilitar edição
    accGatilho.querySelector('.crm-accordion-header').classList.add('open');
    accGatilho.querySelector('.crm-accordion-body').classList.add('open');
    body.appendChild(accGatilho);

    // Accordion: Ação
    const accAcao = makeAccordion('Ação (Resposta Automática)', (content) => {
      const respostaInput = textarea('crm-edit-bot-resposta', 'Digite a resposta automática...');
      respostaInput.value = b.resposta || '';
      content.appendChild(formGroup('Mensagem de Resposta', respostaInput));
    });
    accAcao.querySelector('.crm-accordion-header').classList.add('open');
    accAcao.querySelector('.crm-accordion-body').classList.add('open');
    body.appendChild(accAcao);

    // Accordion: Regras
    body.appendChild(makeAccordion('Regras de Acionamento', (content) => {
      const horarioInput = select('crm-edit-bot-horario', [
        ['sempre', 'Sempre'],
        ['comercial', 'Horário Comercial (8h-18h)'],
        ['fora', 'Fora do Horário Comercial']
      ]);
      horarioInput.value = b.horario || 'sempre';
      content.appendChild(formGroup('Horário de Funcionamento', horarioInput));
    }));

    // Pré-visualização da resposta
    const previewBox = document.createElement('div');
    previewBox.style.cssText = 'margin-top:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;font-size:13px;color:var(--crm-text)';
    previewBox.innerHTML = `<strong style="color:var(--crm-primary)">Pré-visualização atual:</strong><br><em>Gatilho:</em> "${b.gatilho || 'Qualquer mensagem'}" &rarr; <em>Resposta:</em> "${(b.resposta || '').substring(0, 60) || '(vazia)'}${b.resposta?.length > 60 ? '...' : ''}"</div>`;
    body.appendChild(previewBox);

    // Footer
    footer.appendChild(btn('Cancelar', 'crm-btn crm-btn-secondary', closeAll));
    footer.appendChild(btn('Salvar Alterações', 'crm-btn crm-btn-primary', () => {
      const nome = nomeInput.value.trim();
      if (!nome) { alert('Informe o nome do autoatendimento.'); return; }

      // Atualiza o bot no estado
      state.data.autoatendimento[botIndex] = {
        ...state.data.autoatendimento[botIndex],
        nome,
        gatilho: document.getElementById('crm-edit-bot-gatilho')?.value.trim() || '',
        tipo: document.getElementById('crm-edit-bot-tipo')?.value || 'palavra',
        resposta: document.getElementById('crm-edit-bot-resposta')?.value || '',
        horario: document.getElementById('crm-edit-bot-horario')?.value || 'sempre',
      };

      saveData();
      closeAll();
      openAutoAtendimento();
    }));

    document.getElementById('crm-editar-bot-modal').classList.add('visible');
    showOverlay();
  }

  function makeAccordion(title, fillContent) {
    const wrapper = document.createElement('div');
    wrapper.className = 'crm-accordion';

    const header = document.createElement('div');
    header.className = 'crm-accordion-header';
    header.innerHTML = `<span>${title}</span><span class="crm-accordion-icon">${I.chevron}</span>`;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'crm-accordion-body';
    fillContent(bodyEl);

    header.addEventListener('click', () => {
      const isOpen = bodyEl.classList.contains('open');
      bodyEl.classList.toggle('open', !isOpen);
      header.classList.toggle('open', !isOpen);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(bodyEl);
    return wrapper;
  }

  // ===== NOTIFICAÇÕES =====
  function openNotificacoes() {
    makePanel('crm-notif-panel', '🔔 Notificações', 'notif');
    const body = document.getElementById('crm-notif-panel-body');
    const tabs = ['Inbox', 'Comunicado', 'Atualizações', 'Notificações Pendentes'];
    let activeTab = 0;

    function renderTabs() {
      body.innerHTML = '';
      const nav = document.createElement('div');
      nav.className = 'crm-tabs-nav';
      tabs.forEach((t, i) => {
        const tb = document.createElement('button');
        tb.className = 'crm-tab-btn' + (i === activeTab ? ' active' : '');
        tb.textContent = t;
        tb.addEventListener('click', () => { activeTab = i; renderTabs(); });
        nav.appendChild(tb);
      });
      const empty = document.createElement('div');
      empty.className = 'crm-empty-state';
      empty.innerHTML = I.notif + '<p>Nenhuma notificação aqui.</p>';
      body.appendChild(nav);
      body.appendChild(empty);
    }

    openPanel('crm-notif-panel', 'notif');
    renderTabs();
  }

  // ===== API BAILEYS (NOVO PAINEL) =====
  function openApiPanel() {
    const modalId = 'crm-api-modal';
    const modal = makeModal(modalId, '🔌 API Baileys (Conexão Transparente)', true);
    const body = document.getElementById(modalId + '-body');

    body.innerHTML = `
      <div style="padding:16px;">
        <h3 style="color:var(--crm-text);margin-top:0;">API de Disparo e Eventos em Nuvem</h3>
        <p style="color:var(--crm-text-secondary);font-size:14px;margin-bottom:20px;line-height:1.4;">
          A API Baileys conecta o número mestre do seu WhatsApp diretamente com a inteligência do nosso servidor Node.
          Ao estar <b>✅ Ligada</b>, as automações param de mexer na sua tela física do WhatsApp (como pular de chat ou digitar invisivelmente) 
          e passam a usar sockets injetados nativos da Meta, poupando absurdamente os recursos do seu PC e não interrompendo sua experiência. 
          Também desbloqueia as pesquisas avançadas IA diárias.
        </p>
        
        <div style="background:var(--crm-bg-light);border:1px solid var(--crm-border);padding:20px;border-radius:8px;text-align:center;">
          <div id="api-panel-status" style="margin-bottom:15px;font-size:18px;font-weight:bold;color:var(--crm-text-secondary);">Verificando comunicação com o servidor...</div>
          <div id="api-panel-qr" style="margin-bottom:15px;"></div>
          <button id="api-btn-conectar" style="background:#00a884;color:#111b21;border:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px;cursor:pointer;display:none;margin:0 auto;">📍 Ligar API Agora</button>
        </div>
      </div>
    `;

    const statusEl = document.getElementById('api-panel-status');
    const qrEl = document.getElementById('api-panel-qr');
    const btnConectar = document.getElementById('api-btn-conectar');

    let pollingTimer = null;

    openModal(modalId);

    const apiBackendUrl = 'http://localhost:3001/api';
    const numSession = state.user?.phone || state.user?.numero || 'FlowZap_session';

    async function checarStatus() {
      try {
        const res = await fetch(`${apiBackendUrl}/wa/status?session=${numSession}`);
        const json = await res.json();

        if (json.status === 'CONNECTED') {
          statusEl.innerHTML = '✅ API Baileys 100% ONLINE E EXECUTANDO!';
          statusEl.style.color = '#00a884';
          qrEl.innerHTML = '<span style="font-size:13px;color:gray;">Tudo certo com os disparos silenciosos da API. Pode minimizar.</span>';
          btnConectar.style.display = 'none';
        } else if (json.status === 'INITIALIZING') {
          statusEl.innerHTML = '⏳ Inicializando túnel criptografado...';
          statusEl.style.color = '#eab308';
          qrEl.innerHTML = '<span style="font-size:13px;color:gray;">Aguarde, os metadados do login estão montando a conexão segura...</span>';
          btnConectar.style.display = 'none';
        } else if (json.status === 'QR_READY' && json.qrBase64) {
          statusEl.innerHTML = '⏳ Escaneie o QR Code abaixo para ligar a ponte:';
          statusEl.style.color = '#f59e0b';
          qrEl.innerHTML = `<img src="${json.qrBase64}" width="280" style="border-radius:8px;border:3px solid #f59e0b;">`;
          btnConectar.style.display = 'none';
        } else {
          statusEl.innerHTML = '❌ API Desligada';
          statusEl.style.color = '#ef4444';
          qrEl.innerHTML = '<span style="font-size:13px;color:gray;">Os robôs atuarão clicando na sua tela fisicamente até que você ligue a API.</span>';
          btnConectar.style.display = 'block';
        }
      } catch (e) {
        statusEl.innerHTML = '❌ Servidor Node Offline (Verifique se o backend na porta 3001 está rodando)';
        statusEl.style.color = '#ef4444';
        qrEl.innerHTML = '';
        btnConectar.style.display = 'none';
      }
    }

    btnConectar.onclick = async () => {
      btnConectar.disabled = true;
      statusEl.textContent = 'Iniciando instância da API Baileys...';
      try {
        await fetch(`${apiBackendUrl}/wa/connect`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: numSession })
        });
      } catch (e) { }
    };

    checarStatus();
    pollingTimer = setInterval(() => {
      if (!document.getElementById('api-panel-status')) {
        clearInterval(pollingTimer);
        return;
      }
      checarStatus();
    }, 3000);
  }

  // ===== CONFIGURAÇÕES =====
  function openConfiguracoes() {
    makePanel('crm-cfg-panel', '⚙️ Configurações', 'settings');
    const body = document.getElementById('crm-cfg-panel-body');
    const cfg = state.data.configuracoes || {};
    body.innerHTML = '';

    // Idioma
    const idiomaRow = document.createElement('div');
    idiomaRow.className = 'crm-settings-item';
    const idiomaLabel = document.createElement('span');
    idiomaLabel.className = 'crm-settings-label'; idiomaLabel.textContent = 'Idioma';
    const idiomaSelect = select('crm-cfg-idioma', [['pt', '🇧🇷 Português'], ['en', '🇺🇸 English'], ['es', '🇪🇸 Español']]);
    idiomaSelect.style.width = 'auto';
    idiomaSelect.value = cfg.idioma || 'pt';
    idiomaSelect.addEventListener('change', () => { state.data.configuracoes.idioma = idiomaSelect.value; saveData(); });
    idiomaRow.appendChild(idiomaLabel); idiomaRow.appendChild(idiomaSelect);
    body.appendChild(idiomaRow);

    // Modo Escuro
    const darkRow = document.createElement('div');
    darkRow.className = 'crm-settings-item';
    const darkLabel = document.createElement('span');
    darkLabel.className = 'crm-settings-label'; darkLabel.textContent = 'Modo Escuro';
    const toggle = document.createElement('div');
    toggle.className = 'crm-toggle' + (cfg.modoEscuro ? ' on' : '');
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('on');
      state.data.configuracoes.modoEscuro = toggle.classList.contains('on');
      saveData(); applySettings();
    });
    darkRow.appendChild(darkLabel); darkRow.appendChild(toggle);
    body.appendChild(darkRow);

    // Backup
    const settingItems = [
      {
        label: 'Criar Backup do Sistema', fn: () => {
          const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'FlowZap-backup.json'; a.click();
          URL.revokeObjectURL(url);
        }
      },
      {
        label: 'Importar Backup', fn: () => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
          inp.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = ev => {
              try {
                const imported = JSON.parse(ev.target.result);
                state.data = { ...state.data, ...imported };
                saveData(); alert('Backup importado com sucesso!');
              } catch { alert('Arquivo inválido.'); }
            };
            reader.readAsText(file);
          };
          inp.click();
        }
      },
      {
        label: 'Exportar Todos os Perfis (CSV)', fn: () => {
          const rows = [['Nome', 'Telefone', 'Funil', 'Coluna']];
          state.data.funis.forEach(f => {
            f.cards.forEach(c => rows.push([c.nome, c.telefone || '', f.nome, f.colunas[c.coluna] || '']));
          });
          const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
          const url = URL.createObjectURL(blob); const a = document.createElement('a');
          a.href = url; a.download = 'FlowZap-perfis.csv'; a.click();
        }
      },
    ];

    settingItems.forEach(si => {
      const row = document.createElement('div');
      row.className = 'crm-settings-item';
      row.style.cursor = 'pointer';
      const lbl = document.createElement('span'); lbl.className = 'crm-settings-label'; lbl.textContent = si.label;
      const arrow = document.createElement('span'); arrow.style.cssText = 'color:var(--crm-text-secondary);font-size:13px'; arrow.textContent = '▶';
      row.appendChild(lbl); row.appendChild(arrow);
      row.addEventListener('click', si.fn);
      body.appendChild(row);
    });

    // Botões
    const comprarBtn = btn('🛒 Comprar Mais Licenças', 'crm-btn crm-btn-primary', () => { });
    comprarBtn.style.cssText = 'width:100%;justify-content:center;margin-top:20px';
    body.appendChild(comprarBtn);

    const logoutBtn = btn('Deslogar da Conta', 'crm-btn crm-btn-danger', () => {
      if (confirm('Deseja realmente sair da sua conta FlowZap?')) {
        performLogout('Você saiu da sua conta com sucesso.');
      }
    });
    logoutBtn.style.cssText = 'width:100%;justify-content:center;margin-top:10px';
    body.appendChild(logoutBtn);

    const verDiv = document.createElement('div');
    verDiv.style.cssText = 'margin-top:16px;font-size:12px;color:var(--crm-text-secondary);display:flex;justify-content:space-between';
    verDiv.innerHTML = `<span>FlowZap</span><span>Versão ${CRM_VERSION}</span>`;
    body.appendChild(verDiv);

    openPanel('crm-cfg-panel', 'settings');
  }

  // ===== AUTO ATENDIMENTO - LISTENER DE MENSAGENS =====

  // Estados transitórios do header que NÃO indicam mudança de contato
  const TRANSIENT_STATES = [
    'digitando', 'typing', 'gravando', 'recording', 'online',
    'clique para mostrar', 'visto por último', 'last seen',
    'conta comercial', 'business account', 'ocupado', 'busy'
  ];

  function isTransientState(text) {
    const t = (text || '').toLowerCase();
    return TRANSIENT_STATES.some(s => t.includes(s));
  }

  // Verifica horário de funcionamento do bot
  function isWithinSchedule(horario) {
    if (!horario || horario === 'sempre') return true;
    const h = new Date().getHours();
    if (horario === 'comercial') return h >= 8 && h < 18;
    if (horario === 'fora') return h < 8 || h >= 18;
    return true;
  }

  // Verifica se a mensagem é recente pelo atributo data-pre-plain-text
  function isMessageRecent(el) {
    const copyableEl = el.querySelector('[data-pre-plain-text]');
    if (copyableEl) {
      const raw = copyableEl.getAttribute('data-pre-plain-text') || '';
      const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
      if (m) {
        let h = parseInt(m[1]);
        const min = parseInt(m[2]);
        if (m[3]) {
          if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
          if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
        }
        const now = new Date();
        const diff = Math.abs((h * 60 + min) - (now.getHours() * 60 + now.getMinutes()));
        return diff <= 2;
      }
    }
    return true; // sem timestamp → assume recente (grace period já filtra histórico)
  }

  // Lock global: impede enviar 2 mensagens ao mesmo tempo
  // Auto-release após 8s para não ficar travado
  let _botSending = false;
  let _botSendLockTimer = null;

  function _acquireSendLock() {
    if (_botSending) return false;
    _botSending = true;
    clearTimeout(_botSendLockTimer);
    _botSendLockTimer = setTimeout(() => {
      _botSending = false;
      console.log('[FlowZap Bot] 🔓 Lock auto-liberado após timeout.');
    }, 8000);
    return true;
  }

  function _releaseSendLock() {
    clearTimeout(_botSendLockTimer);
    setTimeout(() => { _botSending = false; }, 800);
  }

  // Envia mensagem no campo do WhatsApp
  // v1.0.9: Usa simulação pura de Colar (Paste) que é a forma mais nativa de contornar bloqueios do React/Lexical
  function sendWhatsAppMessage(text) {
    if (!_acquireSendLock()) {
      console.warn('[FlowZap Bot] ⚠️ Lock ativo, ignorando chamada duplicada.');
      return;
    }

    try {
      const boxSelectors = [
        'div[contenteditable="true"][data-tab="10"]',
        'footer div[contenteditable="true"]',
        'div[aria-label][contenteditable="true"]',
        '[data-testid="conversation-compose-box-input"]',
        'div[role="textbox"][contenteditable="true"]',
      ];
      let box = null;
      for (const sel of boxSelectors) { box = document.querySelector(sel); if (box) break; }

      if (!box) {
        console.warn('[FlowZap Bot] ❌ Campo de texto não encontrado no DOM.');
        _releaseSendLock();
        return;
      }

      // Foca no campo e garante que está livre
      box.focus();
      box.click();
      box.innerHTML = '';

      // SIMULAÇÃO DE CTRL+V Pura
      // É a única forma à prova de balas para editores como Lexical (novo padrão do Wpp Web)
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      box.dispatchEvent(pasteEvent);

      // Aguarda 800ms para o React do Wpp Web renderizar a entrada antes do envio
      setTimeout(() => {
        const sendSelectors = [
          '[data-testid="send"]',
          '[data-testid="compose-btn-send"]',
          'button[aria-label="Enviar"]',
          'span[data-testid="send"]',
          'button[data-icon="send"]',
        ];

        let sent = false;
        for (const sel of sendSelectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            btn.click();
            sent = true;
            console.log('[FlowZap Bot] ✅ Enviado:', text.substring(0, 40));
            break;
          }
        }

        // Se por algum motivo o botão não apareceu/clicou, manda um Enter cru
        if (!sent) {
          box.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
          sent = true;
          console.log('[FlowZap Bot] ✅ Enviado via tecla Enter.');
        }

        // Garante que o painel identifique a mensagem enviada simulada
        if (sent && currentChatKey) {
          tryAutoAddKanban(currentChatKey, text, 'message_sent');
        }

        _releaseSendLock();
      }, 800);

    } catch (e) {
      console.error('[FlowZap Bot] ❌ Erro fatal ao enviar:', e);
      _releaseSendLock();
    }
  }

  // Verifica gatilho e retorna o bot que deve responder (ou null)
  function findMatchingBot(msgText) {
    const bots = (state.data.autoatendimento || []).filter(b => b.ativo && b.resposta);
    const text = (msgText || '').toLowerCase().trim();
    if (!text || !bots.length) return null;

    for (const bot of bots) {
      if (!isWithinSchedule(bot.horario)) continue;
      let matched = false;
      if (bot.tipo === 'qualquer' || bot.tipo === 'primeira') {
        matched = true;
      } else {
        const kws = (bot.gatilho || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        matched = kws.length === 0 || kws.some(kw => text.includes(kw));
      }
      if (matched) return bot;
    }
    return null;
  }

  function checkBotResponse(msgText) {
    const bot = findMatchingBot(msgText);
    if (!bot) return;
    // Mínimo 2s, máximo 4s (simula humano digitando, evita corrida)
    const delay = 2000 + Math.round(Math.random() * 2000);
    console.log(`[FlowZap Bot] 🎯 Gatilho "${bot.gatilho || bot.tipo}" ativado! Respondendo em ${delay}ms...`);
    setTimeout(() => sendWhatsAppMessage(bot.resposta), delay);
  }

  // Extrai texto de uma mensagem do WhatsApp
  function extractMessageText(el) {
    const selectors = ['[data-testid="msg-text"] span', 'span.selectable-text span[dir]', '.copyable-text span[dir]'];
    for (const sel of selectors) {
      const found = el.querySelector(sel);
      if (found && found.textContent.trim()) return found.textContent.trim();
    }
    const spans = el.querySelectorAll('span[dir="ltr"], span[dir="auto"]');
    for (const sp of spans) { if (sp.textContent.trim().length > 1) return sp.textContent.trim(); }
    return '';
  }

  function isIncomingMsg(el) {
    if (el.classList?.contains('message-in')) return true;
    if (el.classList?.contains('message-out')) return false;
    if (el.closest?.('[class*="message-in"]')) return true;
    if (el.closest?.('[class*="message-out"]')) return false;

    // Fallback: se o WhatsApp empacotar num contêiner-pai neutro, precisamos checar os filhos
    if (el.querySelector?.('[class*="message-out"]')) return false;
    if (el.querySelector?.('[class*="message-in"]')) return true;

    // Se falhar tudo, como é uma mensagem injetada localmente, consideramos outgoing falsamente para n dar match com trigger de recebidas automáticas
    return false;
  }

  // Verifica se a mensagem é texto puro (não é PDF, áudio, imagem, vídeo, sticker)
  // v1.0.8: usa seletores EXATOS (sem wildcard *= que bloqueava texto normal)
  function isTextOnlyMessage(el) {
    // Seletores EXATOS para tipos de mídia no WhatsApp Web
    const mediaSelectors = [
      '[data-testid="audio-play"]',        // áudio
      '[data-testid="document-thumb"]',    // documento PDF/Word etc.
      '[data-testid="img-loaded"]',        // imagem carregada
      '[data-testid="sticker"]',           // sticker
      '[data-testid="location-map"]',      // localização
      'audio',                             // áudio HTML
      'video',                             // vídeo HTML
      '[data-icon="document-pdf"]',        // ícone de PDF
      'span[data-testid="doc-description"]', // descrição de documento
    ];
    for (const sel of mediaSelectors) {
      if (el.querySelector?.(sel)) return false;
    }
    // Verifica pelo texto: extensão de arquivo comum = não é texto
    const text = extractMessageText(el).trim();
    if (text && /\.(pdf|docx?|xlsx?|pptx?|mp[34]|avi|mov|zip|rar|jpe?g|png|gif|webp|ogg|opus|wav|aac)$/i.test(text)) {
      return false;
    }
    return true;
  }

  // Retorna os dados normalizados formatados, caso a coluna ainda use strings velhas
  function _normCol(col) {
    return typeof col === 'string' ? { nome: col, autoAdd: false, ignorarSeEmOutra: true } : col;
  }

  // Auxiliar para logar atendimentos
  function logAtendimento(sender, stringMsg, eventType) {
    if (!state.data.atendimentos) state.data.atendimentos = [];
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${day}`;

    let match = state.data.atendimentos.find(a => a.date === todayStr && a.contato === sender);
    if (!match) {
      match = { id: Date.now() + Math.random().toString(36).substring(2), date: todayStr, contato: sender, numMensagens: 0, ultimaMensagem: '', created_at: d.toISOString(), updated_at: d.toISOString() };
      state.data.atendimentos.push(match);
    }
    match.numMensagens += 1;
    if (stringMsg && typeof stringMsg === 'string') {
      match.ultimaMensagem = stringMsg.substring(0, 100);
    }
    match.updated_at = d.toISOString();
    saveData();
  }

  const lastSentMap = new Map();

  function markMessageSent(contactName, text) {
    if (!contactName) return;
    const key = String(contactName).trim().toLowerCase();
    lastSentMap.set(key, { text: text || '', time: Date.now() });
    console.log(`[FlowZap Kanban] 📤 Envio recente registrado para "${contactName}"`);
  }

  function isRecentSent(contactName) {
    if (!contactName) return false;
    const key = String(contactName).trim().toLowerCase();
    const rec = lastSentMap.get(key);
    if (!rec) return false;
    if (Date.now() - rec.time < 30000) return true; // 30s janela
    lastSentMap.delete(key);
    return false;
  }

  function isContactMatch(card, sender) {
    if (!card || !sender) return false;
    const cardName = (card.nome || '').trim().toLowerCase();
    const targetName = String(sender).trim().toLowerCase();
    // Correspondência exata de nome
    if (cardName === targetName) return true;
    // Correspondência por telefone (dígitos finais)
    const cardDigits = (card.telefone || '').replace(/\D/g, '');
    const targetDigits = String(sender).replace(/\D/g, '');
    if (cardDigits.length >= 8 && targetDigits.length >= 8) {
      if (cardDigits === targetDigits || cardDigits.endsWith(targetDigits.slice(-8)) || targetDigits.endsWith(cardDigits.slice(-8))) {
        return true;
      }
    }
    return false;
  }

  function normalizeColRef(ref, funil) {
    if (ref === undefined || ref === null || ref === '') return [];
    const funilObj = funil || getFunil();
    const colList = funilObj.colunas || [];

    const matches = new Set();
    const refStr = String(ref).trim();
    const refLower = refStr.toLowerCase();
    const refClean = refLower.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').trim();
    const refNum = parseInt(refStr, 10);

    colList.forEach((colObj, idx) => {
      const col = _normCol(colObj);
      const colNameLower = String(col.nome || '').trim().toLowerCase();
      const colNameClean = colNameLower.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').trim();

      // Correspondência por índice numérico
      if (!isNaN(refNum) && String(refNum) === refStr && idx === refNum) matches.add(idx);
      // Correspondência por ID da coluna
      if (col.id && String(col.id).toLowerCase() === refLower) matches.add(idx);
      // Correspondência por nome exato (com ou sem emoji)
      if (colNameLower === refLower) matches.add(idx);
      if (colNameClean && refClean && colNameClean === refClean) matches.add(idx);
    });

    return Array.from(matches);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOTOR DE REGRAS DO KANBAN — tryAutoAddKanban
  // ═══════════════════════════════════════════════════════════════════════════
  function tryAutoAddKanban(sender, msgText, eventType = 'new_message') {
    if (!sender) return;

    // Se o usuário enviou mensagem recentemente para este contato,
    // promover qualquer evento genérico para message_sent
    if (eventType === 'new_message' && isRecentSent(sender)) {
      console.log(`[FlowZap Kanban] ⚡ Promovendo "${sender}" de new_message → message_sent (envio recente detectado)`);
      eventType = 'message_sent';
    }

    logAtendimento(sender, typeof msgText === 'string' ? msgText : '...', eventType);
    const funil = getFunil();

    // Descobre em quais colunas o contato já está
    const existingCards = funil.cards.filter(c => isContactMatch(c, sender));
    const existingColIndices = existingCards.map(c => c.coluna);
    const isNewContact = existingCards.length === 0;

    // Verificação precisa de grupo
    const senderLower = sender.toLowerCase();
    const isGroup = senderLower.endsWith('@g.us') || senderLower.includes('[grupo]');

    console.log(`[FlowZap Kanban] ══════════════════════════════════════════`);
    console.log(`[FlowZap Kanban] 🔄 Processando: "${sender}"`);
    console.log(`[FlowZap Kanban]    Event: ${eventType} | Colunas: [${existingColIndices.join(', ')}] | Novo: ${isNewContact}`);

    // Atualiza info de cards existentes (hora, msg, unread)
    if (existingCards.length > 0) {
      existingCards.forEach(c => {
        c.sidebarOrder = -1;
        c.time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (msgText) c.lastMsg = String(msgText).substring(0, 60);
        if (eventType === 'new_message') c.unread = (c.unread || 0) + 1;
      });
    }

    // ─── AVALIAÇÃO DE REGRAS ───────────────────────────────────────────
    // Coleta TODAS as regras que passam, depois escolhe a melhor
    const candidateRules = [];

    for (let colIdx = 0; colIdx < funil.colunas.length; colIdx++) {
      const colObj = funil.colunas[colIdx];
      const col = _normCol(colObj);

      // ─── COLUNAS SEM REGRAS (legado) ───
      if (!col.rules || col.rules.length === 0) {
        if (col.autoAdd && eventType === 'new_message') {
          if ((!col.ignorarSeEmOutra || existingColIndices.length === 0) && !existingColIndices.includes(colIdx)) {
            candidateRules.push({
              colIdx,
              colName: col.nome,
              rule: { label: 'Adição Automática Legada', trigger: 'new_message' },
              priority: 0 // prioridade mais baixa
            });
          }
        }
        continue;
      }

      // ─── COLUNAS COM REGRAS ───
      for (const rule of col.rules) {
        if (!rule.active) continue;

        // ── CHECK TRIGGER ──
        let triggerMatch = false;
        switch (rule.trigger) {
          case 'new_contact':
            triggerMatch = isNewContact && eventType === 'new_message';
            break;
          case 'new_message':
            triggerMatch = eventType === 'new_message';
            break;
          case 'message_sent':
            triggerMatch = eventType === 'message_sent';
            break;
          case 'any_message':
            triggerMatch = eventType === 'new_message' || eventType === 'message_sent';
            break;
          case 'keyword': {
            const keywords = (rule.triggerKeywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            const text = (msgText || '').toLowerCase();
            triggerMatch = keywords.length > 0 && keywords.some(kw => text.includes(kw));
            break;
          }
          default:
            triggerMatch = false;
        }

        if (!triggerMatch) {
          console.log(`[FlowZap Kanban]    ⏭ "${rule.label}" em "${col.nome}" — trigger "${rule.trigger}" não corresponde a "${eventType}"`);
          continue;
        }

        // ── CHECK CONDITIONS (ALL must pass) ──
        let allPass = true;
        let failedReason = '';
        for (const cond of (rule.conditions || [])) {
          switch (cond.type) {
            case 'not_in_any':
              if (existingColIndices.length > 0) { allPass = false; failedReason = `not_in_any (já está em col [${existingColIndices}])`; }
              break;
            case 'not_in_column': {
              const targetIndices = normalizeColRef(cond.value, funil);
              if (targetIndices.some(idx => existingColIndices.includes(idx))) {
                allPass = false; failedReason = `not_in_column (está na col "${cond.value}" → idx [${targetIndices}])`;
              }
              break;
            }
            case 'in_column': {
              const targetIndices = normalizeColRef(cond.value, funil);
              console.log(`[FlowZap Kanban]    🔍 in_column: cond.value="${cond.value}" → indices resolvidos: [${targetIndices}] | contato está em: [${existingColIndices}]`);
              if (!targetIndices.some(idx => existingColIndices.includes(idx))) {
                allPass = false; failedReason = `in_column (cond="${cond.value}" → [${targetIndices}], contato em [${existingColIndices}])`;
              }
              break;
            }
            case 'keyword': {
              const kws = (cond.value || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
              const txt = (msgText || '').toLowerCase();
              if (kws.length > 0 && !kws.some(kw => txt.includes(kw))) { allPass = false; failedReason = 'keyword não encontrada'; }
              break;
            }
            case 'not_keyword': {
              const nkws = (cond.value || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
              const ntxt = (msgText || '').toLowerCase();
              if (nkws.length > 0 && nkws.some(kw => ntxt.includes(kw))) { allPass = false; failedReason = 'not_keyword encontrada'; }
              break;
            }
            case 'is_group':
              if (!isGroup) { allPass = false; failedReason = 'is_group (não é grupo)'; }
              break;
            case 'is_not_group':
              if (isGroup) { allPass = false; failedReason = 'is_not_group (é grupo)'; }
              break;
            case 'business_hours': {
              const h = new Date().getHours();
              if (h < 8 || h >= 18) { allPass = false; failedReason = 'business_hours (fora do horário)'; }
              break;
            }
            case 'outside_hours': {
              const h2 = new Date().getHours();
              if (h2 >= 8 && h2 < 18) { allPass = false; failedReason = 'outside_hours (dentro do horário)'; }
              break;
            }
          }
          if (!allPass) break;
        }

        if (!allPass) {
          console.log(`[FlowZap Kanban]    ❌ "${rule.label}" em "${col.nome}" — condição falhou: ${failedReason}`);
          continue;
        }

        // Se o contato já está nesta mesma coluna alvo, pula
        if (existingColIndices.includes(colIdx)) {
          console.log(`[FlowZap Kanban]    ℹ️ "${sender}" já está na coluna "${col.nome}", ignorando`);
          continue;
        }

        // Calcula prioridade:
        // 3 = message_sent + in_column (regra de transferência entre colunas)
        // 2 = keyword trigger ou message_sent
        // 1 = regras com condições (in_column, not_in_column, etc)
        // 0 = regra genérica sem condições
        let priority = 0;
        const hasInColumn = (rule.conditions || []).some(c => c.type === 'in_column');
        if (rule.trigger === 'message_sent' && hasInColumn) priority = 3;
        else if (rule.trigger === 'keyword' || rule.trigger === 'message_sent') priority = 2;
        else if ((rule.conditions || []).length > 0) priority = 1;

        console.log(`[FlowZap Kanban]    ✅ "${rule.label}" em "${col.nome}" — PASSED (prioridade: ${priority})`);
        candidateRules.push({ colIdx, colName: col.nome, rule, priority });
      }
    }

    // ─── ESCOLHE A MELHOR REGRA ─────────────────────────────────────────
    if (candidateRules.length === 0) {
      console.log(`[FlowZap Kanban]    ⚠️ Nenhuma regra correspondeu para "${sender}"`);
      if (existingCards.length > 0) { saveData(); }
      return;
    }

    // Ordena por prioridade decrescente
    candidateRules.sort((a, b) => b.priority - a.priority);
    const winner = candidateRules[0];
    const matchedTargetColIdx = winner.colIdx;
    const matchedRule = winner.rule;

    console.log(`[FlowZap Kanban]    🏆 Regra vencedora: "${matchedRule.label}" → coluna "${winner.colName}" (prioridade ${winner.priority})`);

    const targetColObj = _normCol(funil.colunas[matchedTargetColIdx]);
    let addedOrMoved = false;

    if (existingCards.length > 0) {
      // MOVE: Transfere o contato para a nova coluna alvo
      const cardToMove = existingCards[0];
      const fromColIdx = cardToMove.coluna;
      const fromColName = funil.colunas[fromColIdx]
        ? (typeof funil.colunas[fromColIdx] === 'string' ? funil.colunas[fromColIdx] : funil.colunas[fromColIdx].nome)
        : fromColIdx;

      cardToMove.coluna = matchedTargetColIdx;
      cardToMove.sidebarOrder = -1;
      cardToMove.time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (msgText) cardToMove.lastMsg = String(msgText).substring(0, 60);

      console.log(`[FlowZap Kanban] ✨✨ MOVIDO: "${sender}" de "${fromColName}" → "${targetColObj.nome}" (Regra: ${matchedRule.label})`);
      addedOrMoved = true;
    } else {
      // ADD: cria novo card na coluna alvo
      _addToKanban(funil, sender, matchedTargetColIdx, targetColObj.nome, msgText);
      console.log(`[FlowZap Kanban] ✨✨ ADICIONADO: "${sender}" → "${targetColObj.nome}" (Regra: ${matchedRule.label})`);
      addedOrMoved = true;
    }

    console.log(`[FlowZap Kanban] ══════════════════════════════════════════`);

    if (addedOrMoved || existingCards.length > 0) {
      saveData();
      const boardArea = document.getElementById('crm-kanban-board-area');
      if (boardArea) renderKanban(boardArea);
    }
  }

  function _addToKanban(funil, sender, colIdx, colNome, msgText) {
    funil.cards.push({
      id: Date.now() + Math.floor(Math.random() * 1000),
      nome: sender,
      telefone: '',
      coluna: colIdx,
      label: 'Auto',
      lastMsg: (msgText || '').substring(0, 60),
      unread: 1,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      sidebarOrder: -1
    });
  }

  // ===== SETUP PRINCIPAL DO BOT =====
  // Estratégia primária: intercepta window.Notification (hook injetado pelo background.js)
  // Estratégia fallback: MutationObserver no #main (para quando notificações estão desativadas)
  function setupBotListener() {
    const processedIds = new Set();

    // ── Listener da API Local de Envio Externa ────────────────────────────────
    document.addEventListener('__FlowZap_api_send', (event) => {
      try {
        const { telefone, mensagem } = event.detail;
        if (!telefone || !mensagem) return;

        console.log(`[FlowZap Bot] 🚀 Recebido comando via API externa para ${telefone}`);
        navigateAndRespond(telefone, mensagem);

      } catch (error) {
        console.error('[FlowZap Bot] ❌ Falha no despachante da API externa:', error);
      }
    });

    // ── Polling direto da API Ponte (Content Script fica vivo na aba!) ────────
    // Desativado: Estava causando spam de ERR_CONNECTION_REFUSED no console.
    /*
    setInterval(async () => {
      try {
        const resp = await fetch('http://127.0.0.1:3000/FlowZap_pull');
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.number && data.text) {
            console.log('[FlowZap API] 📬 Mensagem recebida da fila:', data.number);
            navigateAndRespond(data.number, data.text);
          }
        }
      } catch (e) {
        // Servidor Node não está rodando — ignora silenciosamente
      }
    }, 3000);
    */

    // ── ESTRATÉGIA 1: Evento de notificação interceptada ─────────────────────
    // O background.js injeta um hook no window.Notification do WhatsApp.
    // Toda mensagem recebida (qualquer chat) dispara __FlowZap_incoming_msg
    // com o texto COMPLETO e o nome do remetente.
    document.addEventListener('__FlowZap_incoming_msg', (event) => {
      try {
        const { sender, text, tag } = event.detail;
        if (!text || !sender) return;

        // ID único para evitar processar 2x
        const msgId = 'NOTIF_' + (tag || (sender + '_' + text.substring(0, 20)));
        // Verifica se o notification handler já processou esta mensagem
        if (processedIds.has(msgId)) return;
        processedIds.add(msgId);

        // Automação de Kanban
        tryAutoAddKanban(sender, text);

        console.log(`[FlowZap Bot] 📨 Mensagem de "${sender}": "${text.substring(0, 60)}"`);

        const bot = findMatchingBot(text);
        if (!bot) {
          console.log('[FlowZap Bot] Nenhum gatilho correspondeu.');
          return;
        }

        // Verifica se já estamos na conversa desse contato
        const isCurrentChat = currentChatKey &&
          (currentChatKey.toLowerCase().includes(sender.toLowerCase()) ||
            sender.toLowerCase().includes(currentChatKey.toLowerCase()));

        if (isCurrentChat) {
          // Já estamos no chat — responde diretamente com delay natural
          const delay = 1200 + Math.round(Math.random() * 1500);
          console.log(`[FlowZap Bot] 🎯 Respondendo em ${delay}ms no chat aberto...`);
          setTimeout(() => sendWhatsAppMessage(bot.resposta), delay);
        } else {
          // Outro chat — navega, responde e volta
          console.log(`[FlowZap Bot] 📱 Chat em background: "${sender}". Navegando...`);
          navigateAndRespond(sender, bot.resposta);
        }
      } catch (e) {
        console.error('[FlowZap Bot] Erro no listener de notificação:', e);
      }
    });

    console.log('[FlowZap Bot] ✅ Listener de notificações registrado!');

    // Solicita reinserção do hook caso o WhatsApp tenha recarregado (SPA navigation)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        try { chrome.runtime.sendMessage({ type: 'REINJECT_HOOK' }); } catch (e) { }
      }
    });

    // ── ESTRATÉGIA 2 (FALLBACK): Dom Observer no chat aberto ─────────────────
    // Usado quando notificações do WhatsApp estão desativadas pelo usuário.
    const GRACE_MS = 3000;
    let botReadyAt = Date.now() + GRACE_MS;
    let currentChatKey = '';
    let changeDebounce = null;
    let msgObserver = null;

    const TRANSIENT = ['digitando', 'typing', 'gravando', 'recording', 'online', 'clique para', 'visto por', 'last seen', 'conta comercial', 'business'];
    function isTransient(t) { return TRANSIENT.some(s => (t || '').toLowerCase().includes(s)); }

    function getStableChatKey() {
      const sels = ['#main header [data-testid="conversation-info-header-chat-title"] span', '#main header span[title]', '#main header .copyable-text span'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        const txt = el?.getAttribute('title') || el?.textContent?.trim();
        if (txt && !isTransient(txt) && txt.length > 1) return txt;
      }
      return null;
    }

    function handleAddedNode(node) {
      if (node.nodeType !== 1) return;
      const isPendingSent = !!node.querySelector('[data-icon="msg-time"]');
      const isOutgoingNode = node.classList?.contains('message-out') || !!node.querySelector?.('[class*="message-out"]');

      // Bloqueia velhas msgs do histórico mas autoriza mensagens enviadas (message-out) ou pendentes
      if (!isPendingSent && !isOutgoingNode && Date.now() < botReadyAt) return;

      const candidates = [];
      if (node.classList?.contains('message-in') || node.classList?.contains('message-out')) candidates.push(node);
      node.querySelectorAll?.('[class*="message-in"], [class*="message-out"]').forEach(c => candidates.push(c));

      for (const msgEl of candidates) {
        const isIncoming = isIncomingMsg(msgEl);
        const isOutgoing = !isIncoming;

        // ID sem prefixo DOM_ para cruzar com o notification handler (mesmo msgId)
        const closestWithId = msgEl.closest('[data-id]');
        const dataId = msgEl.getAttribute('data-id') || (closestWithId ? closestWithId.getAttribute('data-id') : null);
        const textSnippet = extractMessageText(msgEl).substring(0, 20);
        const msgId = dataId || (currentChatKey + '_' + textSnippet);

        // Automação de Kanban: Dispara imediatamente para mensagens enviadas por você
        const text = extractMessageText(msgEl);
        if (currentChatKey && isOutgoing) {
          if (!processedIds.has('SENT_' + msgId)) {
            processedIds.add('SENT_' + msgId);
            markMessageSent(currentChatKey, text);
            tryAutoAddKanban(currentChatKey, text, 'message_sent');
          }
        }

        // Verifica se o notification handler já processou esta mensagem
        if (processedIds.has(msgId) || processedIds.has('NOTIF_' + msgId)) continue;
        processedIds.add(msgId);

        if (currentChatKey && isIncoming) {
          tryAutoAddKanban(currentChatKey, text, 'new_message');
        }

        // ⛔ Ignora mensagens de mídia/documentos (PDF, áudio, imagem, etc.) para o Bot
        if (!isTextOnlyMessage(msgEl)) {
          console.log('[FlowZap Bot] ⏭ Mídia/documento ignorado pelo bot.');
          continue;
        }

        if (isOutgoing) continue; // BOT não processa próprias mensagens

        if (!isIncomingMsg(msgEl)) continue;
        if (!isMessageRecent(msgEl)) continue;

        if (text) {
          console.log('[FlowZap Bot] 📨 [Fallback DOM]', text.substring(0, 50));
          // Só checa as respostas se houver bots ativos
          if ((state.data.autoatendimento || []).some(b => b.ativo)) {
            checkBotResponse(text);
          }
        }
      }
    }

    function setupComposerSendListener() {
      // Captura envio via tecla Enter no teclado (no editor de mensagem do WhatsApp Web)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          const footer = document.querySelector('#main footer');
          if (footer && (footer.contains(e.target) || e.target.closest('#main footer'))) {
            const chatKey = getStableChatKey();
            const text = e.target.textContent || e.target.innerText || '';
            if (chatKey) {
              markMessageSent(chatKey, text);
              console.log(`[FlowZap Bot] 📤 Envio detectado por tecla Enter no chat "${chatKey}": "${text.substring(0, 40)}"`);
              setTimeout(() => {
                tryAutoAddKanban(chatKey, text, 'message_sent');
              }, 100);
            }
          }
        }
      }, true);

      // Captura envio via clique no botão de enviar (ícone de avião de papel)
      document.addEventListener('click', (e) => {
        const sendBtn = e.target.closest?.('[data-testid="send"], [data-testid="compose-btn-send"], button[aria-label="Enviar"], span[data-icon="send"]');
        if (sendBtn) {
          const chatKey = getStableChatKey();
          const box = document.querySelector('#main footer [contenteditable="true"], #main footer div[role="textbox"]');
          const text = box ? (box.textContent || box.innerText || '') : '';
          if (chatKey) {
            markMessageSent(chatKey, text);
            console.log(`[FlowZap Bot] 📤 Envio detectado por clique no botão de enviar no chat "${chatKey}": "${text.substring(0, 40)}"`);
            setTimeout(() => {
              tryAutoAddKanban(chatKey, text, 'message_sent');
            }, 100);
          }
        }
      }, true);
    }

    function startDomObserver() {
      if (msgObserver) msgObserver.disconnect();
      const main = document.querySelector('#main');
      if (!main) { setTimeout(startDomObserver, 1500); return; }
      msgObserver = new MutationObserver(mutations => {
        mutations.forEach(m => m.addedNodes.forEach(handleAddedNode));
      });
      msgObserver.observe(main, { childList: true, subtree: true });
    }

    function watchChatChanges() {
      const header = document.querySelector('#main header');
      if (!header) {
        setTimeout(watchChatChanges, 1000);
        return;
      }
      const obs = new MutationObserver(() => {
        clearTimeout(changeDebounce);
        changeDebounce = setTimeout(() => {
          const key = getStableChatKey();
          if (key && key !== currentChatKey) {
            currentChatKey = key;
            botReadyAt = Date.now() + GRACE_MS;
            console.log(`[FlowZap Bot] 🔄 Chat aberto alterado para: "${key}"`);
          }
        }, 500);
      });
      obs.observe(header, { childList: true, subtree: true, characterData: true });
    }

    currentChatKey = getStableChatKey() || '';
    setupComposerSendListener();
    startDomObserver();
    watchChatChanges();
  }

  // Navega para o chat do remetente, envia resposta e tenta voltar
  async function navigateAndRespond(senderName, responseText) {
    const apiBackendUrl = 'http://localhost:3001/api';
    const numSession = state.user?.phone || state.user?.numero || 'FlowZap_session';

    if (numSession) {
      try {
        const req = await fetch(`${apiBackendUrl}/wa/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: numSession, number: senderName, text: responseText })
        });
        const resBody = await req.json();
        if (resBody.success) {
          console.log(`[FlowZap Bot] ✨ Resposta Inteligente Enviada Silenciosamente via API Baileys para ${senderName}!`);
          // Garante que o Kanban avance se houver regra de "Mensagem enviada por mim"
          tryAutoAddKanban(senderName, responseText, 'message_sent');
          return; // Sucesso com a API, ignora totalmente a injeção em tela! (Não atrapalha o usuário)
        }
      } catch (e) {
        console.log(`[FlowZap Bot] Fallback para navegação local. A API Baileys não estava pingável:`, e.message);
      }
    }

    console.log(`[FlowZap Bot] ⚠️ Solicitando abertura física/mouse de chat para: "${senderName}"`);
    const cleanNumber = senderName.replace(/[\s\-\(\)\.]/g, '');
    const isPhoneNumber = /^\+?\d{8,15}$/.test(cleanNumber);
    if (isPhoneNumber) {
      console.log(`[FlowZap Bot] 📱 Buscando contato por número: ${cleanNumber}`);
      searchAndOpenChat(cleanNumber, responseText);
    } else {
      const savedChat = document.querySelector('#main header span[title]')?.getAttribute('title') ||
        document.querySelector('#main header span[title]')?.textContent?.trim();
      openChatInWa(senderName);
      setTimeout(() => {
        console.log(`[FlowZap Bot] 💬 Chat aberto, enviando mensagem...`);
        sendWhatsAppMessage(responseText);
        if (savedChat && savedChat !== senderName) {
          setTimeout(() => {
            console.log(`[FlowZap Bot] 🔙 Voltando ao chat: "${savedChat}"`);
            openChatInWa(savedChat, true);
          }, 3000);
        }
      }, 2800);
    }
  }

  function searchAndOpenChat(phoneNumber, messageText) {
    let searchInput = document.querySelector('[contenteditable="true"][data-tab="3"]') ||
      document.querySelector('div[role="textbox"][data-tab="3"]');
    if (!searchInput) {
      const searchBtn = document.querySelector('[data-testid="chat-list-search"]') ||
        document.querySelector('[data-icon="search"]')?.closest('button') ||
        document.querySelector('#side [data-icon="search"]')?.parentElement;
      if (searchBtn) searchBtn.click();
    }
    setTimeout(() => {
      searchInput = document.querySelector('[contenteditable="true"][data-tab="3"]') ||
        document.querySelector('div[role="textbox"][data-tab="3"]');
      if (!searchInput) {
        console.error('[FlowZap Bot] ❌ Barra de busca não encontrada');
        openChatInWa(phoneNumber);
        setTimeout(() => sendWhatsAppMessage(messageText), 3000);
        return;
      }
      searchInput.focus();
      searchInput.textContent = '';
      // Usar ClipboardEvent (paste) para forçar o React/Lexical a reconhecer a mudança
      const dt = new DataTransfer();
      dt.setData('text/plain', phoneNumber);
      searchInput.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));
      console.log(`[FlowZap Bot] 🔍 Pesquisando: ${phoneNumber}`);
      let searchAttempts = 0;
      const checkResults = setInterval(() => {
        searchAttempts++;
        const pane = document.querySelector('#pane-side');
        if (!pane) return;
        const items = pane.querySelectorAll('[data-testid="cell-frame-container"]');
        if (items && items.length > 0) {
          clearInterval(checkResults);
          const firstItem = items[0];
          const titleEl = firstItem.querySelector('span[title]');
          const clickTarget = titleEl ? titleEl.closest('div') : firstItem;
          clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          const contactName = titleEl?.getAttribute('title') || 'contato';
          console.log(`[FlowZap Bot] ✅ Contato selecionado: ${contactName}`);
          let waitCount = 0;
          const waitForChat = setInterval(() => {
            waitCount++;
            const inputField = document.querySelector('#main footer [contenteditable="true"]') ||
              document.querySelector('[data-testid="conversation-compose-box-input"]');
            if (inputField) {
              clearInterval(waitForChat);
              setTimeout(() => {
                inputField.focus();
                sendWhatsAppMessage(messageText);
                console.log(`[FlowZap Bot] 📤 Mensagem enviada para ${phoneNumber}!`);
              }, 600);
            } else if (waitCount >= 20) {
              clearInterval(waitForChat);
              console.error('[FlowZap Bot] ❌ Chat não carregou');
            }
          }, 400);
        } else if (searchAttempts >= 15) {
          clearInterval(checkResults);
          console.error(`[FlowZap Bot] ❌ Nenhum resultado para: ${phoneNumber}`);
          searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      }, 500);
    }, 600);
  }

  // ===== MESSAGE LISTENER (do Popup) =====
  function setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
          case 'OPEN_DASHBOARD': openDashboard(); break;
          case 'OPEN_FUNIS': openFunis(); break;
          case 'OPEN_CAMPANHAS': openCampanhas(); break;
          case 'OPEN_BOT': openAutoAtendimento(); break;
          case 'OPEN_RELATORIOS': openRelatorios(); break;
          case 'OPEN_CALENDAR': openCalendario(); break;
          case 'OPEN_SETTINGS': openConfiguracoes(); break;
        }
      });
    } catch (e) { }
  }

  // ===== ATALHOS GLOBAIS =====
  function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Atalho: Alt + K para abrir ou fechar o Kanban
      if (e.altKey && e.key.toLowerCase() === 'k') {
        const modal = document.getElementById('crm-kanban-modal');
        if (modal && modal.classList.contains('visible')) {
          closeAll();
        } else {
          openFunis();
        }
      }
    });
  }

  // ===== AUTHENTICATION (Supabase Cloud Licencing) =====
  // 1. Instancie o Client com a chave PUBLICA anon.
  // IMPORTANTE: NÃO INCLUIR A SECRET KEY 'sb_secret_' NA EXTENSÃO DOS CLIENTES, APENAS A KEY 'sb_publishable'. 
  // O SUPABASE LIDA COM LOGIN SÓ COM ELA!
  const SUPA_URL = 'https://jrqwakwdvzeuqynesqbn.supabase.co';
  const SUPA_ANON = 'sb_publishable_au8p1IQ4X6e3PyBvapcsrQ_qYBNfpFv';

  // Usa o pacote do Supabase ou fetch manual para Rest API
  // Como as extensões de Chrome podem ter problema de Content-Security-Policy com scripts CDN do supabase-js,
  // Para evitar dor de cabeça com os clientes e Manifest V3 injetado, vamos usar chamadas HTTPS limpas pra Res API deles, 
  // copiando o comportamento da lib nativa (Zero Bytes a mais na extensão! Zero Erros CORS!)

  async function apiSupabase(endpoint, method = 'GET', bodyObj = null, authToken = null) {
    const headers = {
      'apikey': SUPA_ANON,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'Cache-Control': 'no-cache'
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
      const res = await fetch(`${SUPA_URL}${endpoint}`, {
        method,
        headers,
        cache: 'no-store',
        body: bodyObj ? JSON.stringify(bodyObj) : null
      });
      const data = await res.json();
      if (!res.ok) {
        data.status = res.status;
        data.isHttpError = true;
        if (data.error === undefined || data.error === null) {
          data.error = true;
        }
      }
      return data;
    } catch (e) {
      console.error('[FlowZap HTTP Erro]', e);
      return { error: true, message: e.message };
    }
  }

  function getAuthErrorMessage(data, defaultMsg = 'Erro na operação.') {
    if (!data) return '❌ ' + defaultMsg;
    if (data.status === 429 || data.code === 429 ||
        (typeof data.msg === 'string' && data.msg.toLowerCase().includes('rate limit')) ||
        (typeof data.error_description === 'string' && data.error_description.toLowerCase().includes('rate limit'))) {
      return '⏱️ Muitas tentativas em pouco tempo. Aguarde cerca de 1 minuto antes de tentar novamente.';
    }
    
    const rawErr = data.error_description || data.msg || data.message || (typeof data.error === 'string' ? data.error : null);
    if (rawErr) {
      const lower = rawErr.toLowerCase();
      if (lower.includes('already') || lower.includes('registrado') || lower.includes('cadastrado')) {
        return '⚠️ Este e-mail já está cadastrado. Clique em "Fazer Login".';
      }
      if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
        return '❌ E-mail ou senha incorretos.';
      }
      if (lower.includes('email not confirmed') || lower.includes('confirm email') || lower.includes('email_not_confirmed')) {
        return '📧 E-mail ainda não confirmado. Verifique sua caixa de entrada ou desative "Confirm email" no Supabase.';
      }
      if (lower.includes('password should be at least')) {
        return '⚠️ A senha deve ter pelo menos 6 caracteres.';
      }
      return '❌ ' + rawErr;
    }
    return '❌ ' + defaultMsg;
  }

  function showResetPasswordScreen(recoveryToken) {
    if (document.getElementById('crm-reset-blocker')) return;

    const blocker = document.createElement('div');
    blocker.id = 'crm-reset-blocker';
    blocker.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(17, 27, 33, 0.95); z-index: 99999999;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #202c33; border-radius: 12px; padding: 30px;
      width: 350px; text-align: center; color: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #2a3942;
    `;

    box.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 15px;">🔑</div>
      <h2 style="font-size: 20px; font-weight: 500; margin-bottom: 5px;">Redefinir Senha</h2>
      <p style="font-size: 13px; color: #8696a0; margin-bottom: 20px;">Digite sua nova senha abaixo.</p>
      
      <div style="text-align: left; margin-bottom: 15px;">
        <label style="display: block; font-size: 12px; color: #00a884; margin-bottom: 5px;">NOVA SENHA</label>
        <input type="password" id="crm-reset-pass" placeholder="Nova senha (min. 6 caracteres)" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2a3942; background: #111b21; color: #fff; outline: none; font-size: 14px;">
      </div>

      <div style="text-align: left; margin-bottom: 20px;">
        <label style="display: block; font-size: 12px; color: #00a884; margin-bottom: 5px;">CONFIRMAR SENHA</label>
        <input type="password" id="crm-reset-pass-confirm" placeholder="Confirme a nova senha" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2a3942; background: #111b21; color: #fff; outline: none; font-size: 14px;">
      </div>

      <div id="crm-reset-err" style="color: #f15c6d; font-size: 13px; margin-bottom: 15px; min-height: 18px;"></div>
      
      <button id="crm-reset-save-btn" style="width: 100%; padding: 12px; border: none; border-radius: 20px; background: #00a884; color: #111b21; font-weight: bold; font-size: 14px; cursor: pointer; transition: 0.2s;">Salvar Nova Senha</button>
    `;

    blocker.appendChild(box);
    document.body.appendChild(blocker);

    const passEl = document.getElementById('crm-reset-pass');
    const passConfirmEl = document.getElementById('crm-reset-pass-confirm');
    const errEl = document.getElementById('crm-reset-err');
    const saveBtn = document.getElementById('crm-reset-save-btn');

    saveBtn.addEventListener('click', async () => {
      const pass = passEl.value?.trim();
      const passConfirm = passConfirmEl.value?.trim();

      errEl.style.color = '#f15c6d';
      if (!pass || !passConfirm) {
        errEl.textContent = 'Preencha todos os campos';
        return;
      }
      if (pass.length < 6) {
        errEl.textContent = 'A senha deve ter no mínimo 6 caracteres';
        return;
      }
      if (pass !== passConfirm) {
        errEl.textContent = 'As senhas não coincidem';
        return;
      }

      errEl.style.color = '#8696a0';
      errEl.textContent = 'Atualizando senha...';
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';

      try {
        const updateRes = await apiSupabase('/auth/v1/user', 'PUT', { password: pass }, recoveryToken);
        if (updateRes.error || updateRes.isHttpError || updateRes.status >= 400 || updateRes.code >= 400) {
          errEl.style.color = '#f15c6d';
          errEl.textContent = getAuthErrorMessage(updateRes, 'Erro ao redefinir a senha.');
          saveBtn.disabled = false;
          saveBtn.style.opacity = '1';
        } else {
          errEl.style.color = '#00a884';
          errEl.textContent = '✅ Senha atualizada com sucesso!';
          setTimeout(() => {
            blocker.remove();
            showLoginScreen('Senha alterada com sucesso! Faça login com a nova senha.');
          }, 1500);
        }
      } catch (e) {
        errEl.style.color = '#f15c6d';
        errEl.textContent = 'Erro de conexão ao redefinir senha.';
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
      }
    });
  }

  function performLogout(msg = 'Você saiu da sua conta.') {
    chrome.storage.local.remove(['FlowZap_token', 'FlowZap_user_id', 'FlowZap_refresh_token'], () => {
      if (typeof closeAll === 'function') closeAll();

      document.getElementById('crm-sidebar-container')?.remove();
      document.getElementById('crm-overlay')?.remove();
      document.getElementById('crm-pending-blocker')?.remove();
      document.getElementById('crm-checkout-blocker')?.remove();
      document.getElementById('crm-login-blocker')?.remove();
      document.querySelectorAll('.crm-panel, .crm-modal').forEach(el => el.remove());

      document.querySelectorAll('div[style*="z-index: 9999"]').forEach(el => {
        if (el.textContent && el.textContent.includes('FlowZap')) el.remove();
      });

      if (state) state.user = null;
      showLoginScreen(msg);
    });
  }

  async function checkAuthAndInit() {
    // Detecta token de recuperação de senha vindo do link do Supabase
    if (window.location.hash) {
      try {
        const hashStr = window.location.hash.substring(1);
        const params = new URLSearchParams(hashStr);
        if (params.get('type') === 'recovery' && params.get('access_token')) {
          const recToken = params.get('access_token');
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
          showResetPasswordScreen(recToken);
          return;
        }
      } catch (e) { }
    }

    // Detecta e LIMPA o parâmetro de retorno do InfinityPay imediatamente
    const justPaidFromRedirect = window.location.search.includes('FlowZap_paid=true');
    if (justPaidFromRedirect) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    chrome.storage.local.get(['FlowZap_token', 'FlowZap_user_id', 'FlowZap_refresh_token'], async (result) => {
      let token = result.FlowZap_token;
      const uuid = result.FlowZap_user_id;
      const refreshToken = result.FlowZap_refresh_token;

      if (!token || !uuid) {
        showLoginScreen();
        return;
      }

      try {
        console.log('[FlowZap Auth] Verificando token...');
        let userCtx = await apiSupabase('/auth/v1/user', 'GET', null, token);

        // Se o token expirou, tenta renovar usando o refresh_token
        if ((!userCtx || userCtx.error || userCtx.code || !userCtx.id) && refreshToken) {
          console.log('[FlowZap Auth] Token expirado, tentando refresh...');
          const refreshResult = await apiSupabase('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: refreshToken });
          if (refreshResult && refreshResult.access_token) {
            token = refreshResult.access_token;
            chrome.storage.local.set({
              FlowZap_token: refreshResult.access_token,
              FlowZap_refresh_token: refreshResult.refresh_token || refreshToken
            });
            console.log('[FlowZap Auth] ✅ Token renovado com sucesso!');
            userCtx = await apiSupabase('/auth/v1/user', 'GET', null, token);
          }
        }

        if (!userCtx || userCtx.error || userCtx.code || !userCtx.id) {
          console.log('[FlowZap Auth] Token rejeitado:', JSON.stringify(userCtx));
          chrome.storage.local.remove(['FlowZap_token', 'FlowZap_user_id', 'FlowZap_refresh_token']);
          showLoginScreen('Token expirado. Faça login novamente.');
          return;
        }

        console.log('[FlowZap Auth] Usuário OK:', userCtx.email);

        // Query licença: tenta com api_enabled, fallback para sem ela
        let licQuery = await apiSupabase('/rest/v1/licenses?user_id=eq.' + uuid + '&select=plan_expires_at,email,api_enabled', 'GET', null, token);

        if (!Array.isArray(licQuery)) {
          console.log('[FlowZap Auth] Fallback: query sem api_enabled');
          licQuery = await apiSupabase('/rest/v1/licenses?user_id=eq.' + uuid + '&select=plan_expires_at,email', 'GET', null, token);
        }

        console.log('[FlowZap Auth] Resultado licença:', JSON.stringify(licQuery));

        let hasValidLicense = false;
        let hadLicenseBefore = false;
        let expirationDate = null;
        let apiEnabled = false;
        const dtHoje = new Date();

        if (Array.isArray(licQuery) && licQuery.length > 0) {
          hadLicenseBefore = true; // Já teve (ou tem) uma licença
          const lic = licQuery[0];
          expirationDate = new Date(lic.plan_expires_at);
          if (!isNaN(expirationDate.getTime()) && expirationDate >= dtHoje) {
            hasValidLicense = true;
            apiEnabled = !!lic.api_enabled;
          }
        }

        if (hasValidLicense) {
          console.log('[FlowZap Auth] ✅ Licença válida!');
          initCRM(userCtx.email, expirationDate.toISOString(), false, apiEnabled);
        } else if (hadLicenseBefore) {
          // Já teve licença mas expirou → Verifica se acabou de pagar
          if (justPaidFromRedirect) {
            console.log('[FlowZap Auth] 🔄 Retorno pós-pagamento detectado! Aguardando confirmação...');
            showPaymentPendingScreen(token, uuid, userCtx.email);
          } else {
            console.log('[FlowZap Auth] ⏰ Licença expirada! Mostrando checkout...');
            showCheckoutScreen(token, userCtx.email);
          }
        } else {
          // Nunca teve licença → Trial de 3 dias
          const dtCriacao = new Date(userCtx.created_at);
          const dtTrialExp = new Date(dtCriacao.getTime() + (3 * 24 * 60 * 60 * 1000));
          console.log('[FlowZap Auth] Trial expira em:', dtTrialExp.toLocaleDateString());
          if (dtTrialExp >= dtHoje) {
            console.log('[FlowZap Auth] ✅ Trial ativo!');
            initCRM(userCtx.email, dtTrialExp.toISOString(), true, false);
          } else {
            if (justPaidFromRedirect) {
              showPaymentPendingScreen(token, uuid, userCtx.email);
            } else {
              showCheckoutScreen(token, userCtx.email);
            }
          }
        }
      } catch (err) {
        console.error('[FlowZap Auth] ❌ Erro:', err);
        chrome.storage.local.remove(['FlowZap_token', 'FlowZap_user_id', 'FlowZap_refresh_token']);
        showLoginScreen('Erro de conexão. Tente novamente.');
      }
    });
  }

  // Tela de "Processando Pagamento" com polling automático
  function showPaymentPendingScreen(token, uuid, email) {
    if (document.getElementById('crm-pending-blocker')) return;

    const blocker = document.createElement('div');
    blocker.id = 'crm-pending-blocker';
    blocker.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(17, 27, 33, 0.95); z-index: 99999999;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #202c33; border-radius: 12px; padding: 40px;
      width: 400px; text-align: center; color: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #2a3942;
    `;
    box.innerHTML = `
      <div style="font-size: 38px; margin-bottom: 15px; animation: spin 2s linear infinite;">⏳</div>
      <style>@keyframes spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }</style>
      <h2 style="font-size: 20px; margin-bottom: 10px;">Confirmando pagamento...</h2>
      <p id="crm-pending-status" style="font-size: 13px; color: #8696a0; line-height: 1.5;">
        Verificando com a InfinityPay. Isso pode levar alguns segundos.
      </p>
      <div id="crm-pending-actions" style="margin-top: 20px; display: none;">
        <button id="crm-pending-retry" style="padding: 10px 20px; border: 1px solid #00a884; border-radius: 20px; background: transparent; color: #00a884; font-weight: bold; font-size: 13px; cursor: pointer; margin-right: 10px;">🔄 Verificar Novamente</button>
        <button id="crm-pending-logout" style="padding: 10px 20px; border: 1px solid #667781; border-radius: 20px; background: transparent; color: #667781; font-size: 12px; cursor: pointer;">Sair</button>
      </div>
    `;
    blocker.appendChild(box);
    document.body.appendChild(blocker);

    const statusEl = document.getElementById('crm-pending-status');
    const actionsEl = document.getElementById('crm-pending-actions');
    let attempts = 0;
    const maxAttempts = 40; // 40 x 3s = 120 segundos (2 minutos)
    let pollInterval = null;

    async function checkLicense() {
      try {
        // Tenta ler a licença do banco
        let lic = await apiSupabase('/rest/v1/licenses?user_id=eq.' + uuid + '&select=plan_expires_at,email,api_enabled', 'GET', null, token);
        if (!Array.isArray(lic)) {
          lic = await apiSupabase('/rest/v1/licenses?user_id=eq.' + uuid + '&select=plan_expires_at,email', 'GET', null, token);
        }

        console.log(`[FlowZap Pay] Polling #${attempts} - Resultado:`, JSON.stringify(lic));

        if (Array.isArray(lic) && lic.length > 0) {
          const dtExp = new Date(lic[0].plan_expires_at);
          if (!isNaN(dtExp.getTime()) && dtExp >= new Date()) {
            // Pagamento confirmado no banco!
            if (pollInterval) clearInterval(pollInterval);
            console.log('[FlowZap Pay] ✅ Pagamento confirmado!');
            blocker.remove();
            initCRM(email, dtExp.toISOString(), false, !!lic[0].api_enabled);
            return true;
          } else {
            console.log(`[FlowZap Pay] Licença encontrada mas expirada: ${dtExp.toISOString()}`);
          }
        } else {
          console.log('[FlowZap Pay] Nenhuma licença encontrada ainda.');
        }
        return false;
      } catch (e) {
        console.error('[FlowZap Pay] Erro no polling:', e);
        return false;
      }
    }

    pollInterval = setInterval(async () => {
      attempts++;
      console.log(`[FlowZap Pay] Polling tentativa ${attempts}/${maxAttempts}...`);

      const found = await checkLicense();
      if (found) return;

      if (attempts >= 10 && actionsEl.style.display === 'none') {
        actionsEl.style.display = 'block';
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        statusEl.innerHTML = '⚠️ O pagamento ainda está sendo processado pela InfinityPay.<br/>Clique em "Verificar Novamente" ou recarregue a página em alguns minutos.';
        actionsEl.style.display = 'block';
      } else {
        statusEl.textContent = `Verificando... (${attempts}/${maxAttempts})`;
      }
    }, 3000);

    // Botão de retry manual
    document.getElementById('crm-pending-retry')?.addEventListener('click', async () => {
      statusEl.textContent = 'Verificando agora...';
      const found = await checkLicense();
      if (!found) {
        statusEl.textContent = '⏳ Pagamento ainda não confirmado. Tente em alguns segundos.';
      }
    });

    // Botão de logout
    document.getElementById('crm-pending-logout')?.addEventListener('click', () => {
      if (pollInterval) clearInterval(pollInterval);
      performLogout();
    });
  }

  function showLoginScreen(errorMsg = '') {
    if (document.getElementById('crm-login-blocker')) return;

    const blocker = document.createElement('div');
    blocker.id = 'crm-login-blocker';
    blocker.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(17, 27, 33, 0.95); z-index: 99999999;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #202c33; border-radius: 12px; padding: 30px;
      width: 350px; text-align: center; color: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #2a3942;
    `;

    box.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 15px;">🚀</div>
      <h2 style="font-size: 20px; font-weight: 500; margin-bottom: 5px;">FlowZap Trial</h2>
      <p style="font-size: 13px; color: #8696a0; margin-bottom: 20px;">Teste grátis por 3 dias e depois pague o que achar justo.</p>
      
      <div style="text-align: left; margin-bottom: 15px;">
        <label style="display: block; font-size: 12px; color: #00a884; margin-bottom: 5px;">E-MAIL</label>
        <input type="email" id="crm-login-email" placeholder="Seu email" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2a3942; background: #111b21; color: #fff; outline: none; font-size: 14px;">
      </div>
      
      <div style="text-align: left; margin-bottom: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
          <label style="font-size: 12px; color: #00a884;">SENHA</label>
          <a href="#" id="crm-forgot-pass-btn" style="font-size: 11px; color: #8696a0; text-decoration: none; transition: 0.2s;">Esqueceu a senha?</a>
        </div>
        <input type="password" id="crm-login-pass" placeholder="Sua senha" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2a3942; background: #111b21; color: #fff; outline: none; font-size: 14px;">
      </div>

      <div id="crm-login-err" style="color: #f15c6d; font-size: 13px; margin-bottom: 15px; min-height: 18px;">
        ${errorMsg}
      </div>
      
      <div style="display:flex; gap: 10px;">
        <button id="crm-register-btn" style="flex:1; padding: 12px; border: 1px solid #00a884; border-radius: 20px; background: transparent; color: #00a884; font-weight: bold; font-size: 12px; cursor: pointer; transition: 0.2s;">Criar Conta</button>
        <button id="crm-login-btn" style="flex:1; padding: 12px; border: none; border-radius: 20px; background: #00a884; color: #111b21; font-weight: bold; font-size: 12px; cursor: pointer; transition: 0.2s;">Fazer Login</button>
      </div>
    `;

    blocker.appendChild(box);
    document.body.appendChild(blocker);

    const emailEl = document.getElementById('crm-login-email');
    const passEl = document.getElementById('crm-login-pass');
    const errEl = document.getElementById('crm-login-err');
    const loginBtn = document.getElementById('crm-login-btn');
    const registerBtn = document.getElementById('crm-register-btn');
    const forgotBtn = document.getElementById('crm-forgot-pass-btn');

    function setAuthLoading(loading) {
      if (loading) {
        loginBtn.disabled = true;
        registerBtn.disabled = true;
        if (forgotBtn) forgotBtn.style.pointerEvents = 'none';
        loginBtn.style.opacity = '0.5';
        registerBtn.style.opacity = '0.5';
        loginBtn.style.cursor = 'not-allowed';
        registerBtn.style.cursor = 'not-allowed';
      } else {
        loginBtn.disabled = false;
        registerBtn.disabled = false;
        if (forgotBtn) forgotBtn.style.pointerEvents = 'auto';
        loginBtn.style.opacity = '1';
        registerBtn.style.opacity = '1';
        loginBtn.style.cursor = 'pointer';
        registerBtn.style.cursor = 'pointer';
      }
    }

    // FORGOT PASSWORD
    if (forgotBtn) {
      forgotBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailEl.value?.trim();
        if (!email) {
          errEl.style.color = '#f15c6d';
          errEl.textContent = 'Digite seu e-mail acima para recuperar a senha.';
          emailEl.focus();
          return;
        }

        errEl.style.color = '#8696a0';
        errEl.textContent = 'Enviando e-mail de recuperação...';
        setAuthLoading(true);
        try {
          const recoverData = await apiSupabase('/auth/v1/recover', 'POST', { email });
          if (recoverData.error || recoverData.isHttpError || recoverData.status >= 400 || recoverData.code >= 400) {
            errEl.style.color = '#f15c6d';
            errEl.textContent = getAuthErrorMessage(recoverData, 'Erro ao solicitar recuperação de senha.');
          } else {
            errEl.style.color = '#00a884';
            errEl.textContent = '📧 E-mail enviado! Verifique sua caixa de entrada e spam.';
          }
        } catch (err) {
          errEl.style.color = '#f15c6d';
          errEl.textContent = 'Erro de conexão ao solicitar recuperação.';
        } finally {
          setAuthLoading(false);
        }
      });
    }

    // LOGIN
    loginBtn.addEventListener('click', async () => {
      const email = emailEl.value?.trim();
      const pass = passEl.value?.trim();
      errEl.style.color = '#f15c6d';
      if (!email || !pass) { errEl.textContent = 'Preencha todos os campos'; return; }

      errEl.textContent = 'Entrando...';
      setAuthLoading(true);
      try {
        const loginData = await apiSupabase('/auth/v1/token?grant_type=password', 'POST', { email, password: pass });
        if (loginData.error || loginData.isHttpError || !loginData.access_token) {
          errEl.textContent = getAuthErrorMessage(loginData, 'Senha incorreta ou conta ausente');
          setAuthLoading(false);
          return;
        }

        chrome.storage.local.set({
          FlowZap_token: loginData.access_token,
          FlowZap_user_id: loginData.user.id,
          FlowZap_refresh_token: loginData.refresh_token
        }, () => {
          blocker.remove();
          checkAuthAndInit(); // Reload logic to check trial or redirect to checkout
        });
      } catch (e) {
        errEl.textContent = 'Erro de Rede.';
        setAuthLoading(false);
      }
    });

    // REGISTER
    registerBtn.addEventListener('click', async () => {
      const email = emailEl.value?.trim();
      const pass = passEl.value?.trim();
      errEl.style.color = '#f15c6d';
      if (!email || !pass) { errEl.textContent = 'Preencha todos os campos'; return; }

      errEl.textContent = 'Criando conta...';
      setAuthLoading(true);
      try {
        const signUpData = await apiSupabase('/auth/v1/signup', 'POST', { email, password: pass });
        if (signUpData.error || signUpData.isHttpError || signUpData.status >= 400 || signUpData.code >= 400) {
          errEl.textContent = getAuthErrorMessage(signUpData, 'Erro ao criar conta.');
          setAuthLoading(false);
          return;
        }

        // Se a conta for criada sem confirmar e já retornar sessão validada:
        if (signUpData.access_token) {
          chrome.storage.local.set({
            FlowZap_token: signUpData.access_token,
            FlowZap_user_id: signUpData.user.id,
            FlowZap_refresh_token: signUpData.refresh_token
          }, () => {
            blocker.remove();
            checkAuthAndInit(); // Reload pra ativar trial de 3 dias
          });
        } else {
          errEl.textContent = 'Conta criada! Clique em "Fazer Login" (ou confirme no e-mail se exigido pelo Supabase).';
          errEl.style.color = '#00a884';
          setAuthLoading(false);
        }
      } catch (e) {
        errEl.textContent = 'Erro de Rede.';
        setAuthLoading(false);
      }
    });
  }

  function showCheckoutScreen(token, email) {
    if (document.getElementById('crm-checkout-blocker')) return;

    const blocker = document.createElement('div');
    blocker.id = 'crm-checkout-blocker';
    blocker.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(17, 27, 33, 0.95); z-index: 99999999;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #202c33; border-radius: 12px; padding: 30px;
      width: 400px; text-align: center; color: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #2a3942;
    `;

    box.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 10px;">⭐</div>
      <h2 style="font-size: 22px; font-weight: 600; margin-bottom: 5px;">Sua avaliação terminou!</h2>
      <p style="font-size: 13px; color: #8696a0; margin-bottom: 25px;">
        Espero que tenha gostado do FlowZap. Para continuar usando, pague o valor que achar justo pela sua mensalidade.
      </p>
      
      <div style="background: #111b21; padding: 20px; border-radius: 10px; margin-bottom: 25px; border: 1px solid #2a3942;">
         <p style="font-size: 14px; margin-bottom: 15px; font-weight: 500;">O quanto vale esse CRM para você?</p>
         
         <div style="display:flex; align-items:center; justify-content:center; gap: 10px; margin-bottom: 15px;">
            <span style="font-size:28px; font-weight:bold; color:#00a884;">R$</span>
            <span id="crm-checkout-val" style="font-size:38px; font-weight:bold; color:#fff;">10,00</span>
         </div>
         
         <input type="range" id="crm-checkout-range" min="10" max="150" step="5" value="10" style="width: 100%; accent-color: #00a884; margin-bottom: 15px;">
         
         <div id="crm-checkout-api-badge" style="font-size: 12px; padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.05); color: #8696a0;">
            <span style="color: #00a884; font-weight: bold;">Plano Padrão Selecionado:</span>
            <div style="margin-top:5px; font-size:11px;">🤖 Dá direito a <b>4</b> disparos no Motor de Inteligência Artificial para resumo.</div>
            <div style="margin-top:5px; font-size:10px;">Dica: Pague R$ 50 ou mais para destravar a API Externa e N8N.</div>
         </div>
      </div>
      
      <button id="crm-pay-btn" style="width: 100%; padding: 14px; border: none; border-radius: 20px; background: #00a884; color: #111b21; font-weight: bold; font-size: 15px; cursor: pointer; transition: 0.2s;">GERAR BOLETO/PIX (InfinityPay)</button>
      
      <div style="margin-top: 15px;">
         <a href="#" id="crm-logout-checkout" style="color: #8696a0; font-size: 12px; text-decoration: underline;">Sair desta conta (${email})</a>
      </div>
    `;

    blocker.appendChild(box);
    document.body.appendChild(blocker);

    const range = document.getElementById('crm-checkout-range');
    const valDisplay = document.getElementById('crm-checkout-val');
    const apiBadge = document.getElementById('crm-checkout-api-badge');
    const payBtn = document.getElementById('crm-pay-btn');

    range.addEventListener('input', () => {
      const v = parseInt(range.value, 10);
      valDisplay.textContent = v.toFixed(2).replace('.', ',');

      const disparos = 4 + Math.floor((v - 10) / 5);

      if (v >= 50) {
        apiBadge.innerHTML = `<span style="color: #00a884; font-weight:bold;">✨ API Externa + N8N Destravado!</span>
            <div style="margin-top:5px; font-size:11px;">O FlowZap se conectará com a nuvem através de Webhooks!</div>
            <div style="margin-top:5px; font-size:11px;">🤖 Direito incluído à <b>${disparos}</b> disparos de Inteligência Artificial!</div>`;
        apiBadge.style.background = 'rgba(0,168,132,0.1)';
      } else {
        apiBadge.innerHTML = `<span style="color: #00a884; font-weight:bold;">Plano Padrão:</span> Acesso ao Funil, Etapas e Bots Locais.
            <div style="margin-top:5px; font-size:11px; color:white;">🤖 Direito incluído à <b>${disparos}</b> disparos de Inteligência Artificial!</div>
            <div style="margin-top:5px; font-size:10px;">Dica: Pague R$ 50 ou mais para destravar a API Externa e N8N.</div>`;
        apiBadge.style.background = 'rgba(255,255,255,0.05)';
      }
    });

    document.getElementById('crm-logout-checkout').addEventListener('click', (e) => {
      e.preventDefault();
      performLogout();
    });

    payBtn.addEventListener('click', async () => {
      payBtn.textContent = 'Aguarde... Montando Pagamento';
      payBtn.style.opacity = '0.7';
      payBtn.style.pointerEvents = 'none';

      try {
        const resp = await fetch(`${SUPA_URL}/functions/v1/infinitepay-checkout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ amount: parseInt(range.value, 10) })
        });

        // Se for erro JSON
        if (resp.headers.get('content-type')?.includes('application/json')) {
          const data = await resp.json();
          if (resp.ok && data.url) {
            window.location.href = data.url;
            return;
          }
          alert('Erro ao gerar checkout: ' + (data.error || 'Falha na requisição'));
        } else {
          alert('Houve um erro no Edge Function da InfinitePay.');
        }
      } catch (e) {
        alert('Erro de conexão ao requisitar link.');
      } finally {
        payBtn.textContent = 'GERAR BOLETO/PIX (InfinityPay)';
        payBtn.style.opacity = '1';
        payBtn.style.pointerEvents = 'auto';
      }
    });
  }

  // ===== INIT VERDADEIRO =====
  function initCRM(userEmail, expirationIso, isTrial, apiEnabled) {
    if (document.getElementById('crm-sidebar-container')) return; // Já iniciou

    // Armazena dados do usuário autenticado para uso em outras funções (API Baileys, etc.)
    if (!state.user) state.user = {};
    state.user.email = userEmail;
    state.user.phone = userEmail; // Usamos o email como session ID do Baileys

    loadData();
    createOverlay();
    createSidebar();
    setupMessageListener();
    setupBotListener();
    setupShortcuts();

    const dt = new Date(expirationIso).toLocaleDateString('pt-BR');
    console.log(`[FlowZap] ✅ v${CRM_VERSION} autenticado | ${isTrial ? 'Trial 3 Dias' : 'Licença Ouro'} até: ${dt} | API Liberada: ${apiEnabled}`);

    // Adiciona badge de logado à tela do WhatsApp
    const badge = document.createElement('div');
    badge.innerHTML = `🟢 FlowZap ${isTrial ? 'Trial Libre' : (apiEnabled ? 'PRO API' : 'Padrão')} (Exp. ${dt})`;
    badge.style.cssText = 'position:fixed; bottom: 5px; right: 5px; background: rgba(0,0,0,0.6); color: #00a884; font-size: 10px; padding: 2px 6px; border-radius: 4px; pointer-events: none; z-index: 9999;';
    document.body.appendChild(badge);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkAuthAndInit, 2000));
  } else {
    setTimeout(checkAuthAndInit, 2000);
  }

})();