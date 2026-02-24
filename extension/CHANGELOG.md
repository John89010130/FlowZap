# FlowZap - Histórico de Versões

## v1.0.3 (2026-02-21)
### Novidades:
- **Auto Atendimento agora responde mensagens!** Implementação real com `MutationObserver`
- **`setupBotListener()`:** Monitora o DOM do WhatsApp Web em tempo real detectando novas mensagens recebidas
- **`checkBotResponse()`:** Compara o texto da mensagem com os gatilhos dos bots ativos:
  - `Palavra-chave`: verifica se qualquer keyword (separada por vírgula) aparece na mensagem
  - `Qualquer mensagem`: responde a tudo que chegar
  - `Primeira mensagem`: responde à primeira mensagem de qualquer conversa
- **`sendWhatsAppMessage()`:** Digita a resposta no campo do WhatsApp e clica no botão Enviar
- **Delay natural:** Resposta com atraso de 1.5s a 3s aleatório para simular comportamento humano
- **Controle de horário:** Respeita configuração de horário (Sempre / Comercial / Fora do comercial)
- **Anti-loop:** IDs únicos por mensagem evitam duplo processamento
- **Reinício automático:** Observer se reconecta ao mudar de conversa

---

### Novidades:
- **Editar Auto Atendimento:** Botão ✏️ adicionado em cada bot da lista - abre formulário pré-preenchido com todos os dados
- **Campos editáveis:** Nome, Gatilho (palavra-chave), Tipo de gatilho, Mensagem de resposta e Horário de funcionamento
- **Accordions abertos:** Na tela de edição, "Acionamento" e "Ação" já vêm expandidos para facilitar
- **Pré-visualização:** Mostra o gatilho atual e a resposta antes de editar
- **Persistência:** Alterações são salvas no chrome.storage.local
- Bot na lista agora exibe: nome, gatilho, tipo e horário em uma visualização expandida

---

## v1.0.1 (2026-02-21)
### Correções:
- **Fix crítico:** Removidos todos os `onclick` inline dos HTMLs — eram bloqueados pela CSP (Content Security Policy) do WhatsApp Web
- **Fix botões fechar/cancelar/criar:** Agora criados 100% via `createElement` + `addEventListener`, sem nenhum string HTML com evento
- **Fix Auto Atendimento:** Botão "Criar Auto Atendimento" agora aparece sempre no footer, mesmo sem bots criados
- **Fix footer oculto:** Removida a regra CSS `footer:empty { display: none }` que escondia os botões de ação
- **Fix pointer-events:** Adicionada regra CSS global forçando `pointer-events: auto !important` em todos os elementos `.crm-modal *` e `.crm-panel *`
- **Fix z-index:** Overlay em 999998 e modais/panels em 999999 para garantir que apareçam acima do WhatsApp
- **Melhoria closeAll:** Botões de fechar agora usam `e.stopPropagation()` para evitar que o click propague acidentalmente

---

## v1.0.0 (2026-02-21)
### Lançamento inicial
- Sidebar lateral com ícones (Dashboard, Campanhas, Calendário, Funis, Auto Atendimento, Notificações, Configurações)
- Dashboard com estatísticas e gráfico de funis
- Campanhas: create/list, agendamento de data e intervalo
- Calendário: visão mensal, eventos por dia, navegação por mês/ano
- Funis CRM: Kanban com drag & drop entre colunas, adicionar/remover contatos
- Auto Atendimento: criação de bots com gatilhos, ações e regras de horário
- Notificações: painel com tabs (Inbox, Comunicado, Atualizações, Pendentes)
- Configurações: modo escuro, idioma, backup JSON, exportar CSV
- Popup da extensão com estatísticas e atalhos rápidos
- Persistência de dados via chrome.storage.local
- Service Worker para alarmes e notificações
