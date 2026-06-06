// API_URL and BASE_URL are defined in auth.js (const in global scope)

const EVENT_LABELS = {
  Abandoned_Cart: 'Carrinho Abandonado',
  Purchase_Order_Confirmed: 'Compra Completa',
  Purchase_Request_Canceled: 'Pedido Cancelado',
  Purchase_Request_Confirmed: 'Fatura Criada'
};

const EVENT_ICONS = {
  Abandoned_Cart: '\u{1F6D2}',
  Purchase_Order_Confirmed: '\u{2705}',
  Purchase_Request_Canceled: '\u{274C}',
  Purchase_Request_Confirmed: '\u{1F4B3}'
};

const SAMPLE_DATA = {
  nome: 'Maria',
  produto: 'Curso de Marketing Digital',
  preco: 'R$ 197,00',
  email: 'maria@email.com',
  oferta: '10% de desconto'
};

let templates = {};
let currentEvent = null;

function getToken() {
  return localStorage.getItem('dashboard_token');
}

function checkAuth() {
  if (!getToken()) {
    window.location.href = window.BASE_URL + '/login.html';
    return false;
  }
  return true;
}

function showToast(message, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${window.API_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    localStorage.removeItem('dashboard_token');
    window.location.href = window.BASE_URL + '/login.html';
    return null;
  }

  return response;
}

async function loadTemplates() {
  const response = await apiFetch('/api/templates');
  if (!response) return;

  const data = await response.json();
  templates = data.templates || {};

  const list = document.getElementById('templateList');
  list.innerHTML = '';

  const events = Object.keys(EVENT_LABELS);
  events.forEach(event => {
    const li = document.createElement('li');
    li.className = 'template-item';
    li.dataset.event = event;
    li.innerHTML = `
      <span class="icon">${EVENT_ICONS[event] || '\u{1F4DD}'}</span>
      <div class="info">
        <div class="name">${EVENT_LABELS[event] || event}</div>
        <div class="event-key">${event}</div>
      </div>
    `;
    li.addEventListener('click', () => selectTemplate(event));
    list.appendChild(li);
  });
}

function selectTemplate(event) {
  currentEvent = event;

  document.querySelectorAll('.template-item').forEach(item => {
    item.classList.toggle('active', item.dataset.event === event);
  });

  document.getElementById('editorPlaceholder').classList.add('hidden');
  document.getElementById('editorPanel').classList.remove('hidden');

  document.getElementById('editorTitle').textContent = EVENT_LABELS[event] || event;
  document.getElementById('editorEvent').textContent = event;

  const template = templates[event];
  document.getElementById('messageInput').value = template ? template.message : '';

  updatePreview();
}

function updatePreview() {
  const message = document.getElementById('messageInput').value;
  let rendered = message;

  Object.entries(SAMPLE_DATA).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  });

  document.getElementById('previewBubble').textContent = rendered || 'Nenhuma mensagem definida...';

  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('previewTime').textContent = `${hours}:${minutes}`;
}

async function saveTemplate() {
  if (!currentEvent) return;

  const message = document.getElementById('messageInput').value.trim();
  if (!message) {
    showToast('A mensagem não pode estar vazia', 'error');
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const response = await apiFetch(`/api/templates/${currentEvent}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        category: templates[currentEvent]?.category || 'default'
      })
    });

    if (response && response.ok) {
      templates[currentEvent].message = message;
      showToast('Template salvo com sucesso!', 'success');
    } else {
      const data = response ? await response.json() : {};
      showToast(data.error || 'Erro ao salvar template', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão', 'error');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function loadCategories() {
  const response = await apiFetch('/api/templates/categories');
  if (!response) return;

  const data = await response.json();
  const categories = data.categories || {};
  const grid = document.getElementById('categoriesGrid');

  const keys = Object.keys(categories);
  if (keys.length === 0) {
    grid.innerHTML = '<div class="empty-state">Nenhuma categoria encontrada</div>';
    return;
  }

  grid.innerHTML = '';
  keys.forEach(key => {
    const cat = categories[key];
    const card = document.createElement('div');
    card.className = 'category-card';
    card.innerHTML = `
      <div class="cat-name">${cat.name || key}</div>
      <div class="cat-key">${key}</div>
      <div class="cat-keywords">
        ${(cat.keywords || []).map(kw => `<span class="keyword-tag">${kw}</span>`).join('')}
      </div>
    `;
    grid.appendChild(card);
  });
}

async function addCategory() {
  const key = document.getElementById('catKey').value.trim();
  const name = document.getElementById('catName').value.trim();
  const keywordsRaw = document.getElementById('catKeywords').value.trim();

  if (!key) {
    showToast('A chave da categoria é obrigatória', 'error');
    return;
  }

  if (!keywordsRaw) {
    showToast('Insira pelo menos uma palavra-chave', 'error');
    return;
  }

  const keywords = keywordsRaw.split(',').map(k => k.trim()).filter(Boolean);

  const btn = document.getElementById('addCatBtn');
  btn.disabled = true;

  try {
    const response = await apiFetch('/api/templates/categories', {
      method: 'POST',
      body: JSON.stringify({ key, keywords, name: name || key })
    });

    if (response && response.ok) {
      showToast('Categoria adicionada com sucesso!', 'success');
      document.getElementById('catKey').value = '';
      document.getElementById('catName').value = '';
      document.getElementById('catKeywords').value = '';
      loadCategories();
    } else {
      const data = response ? await response.json() : {};
      showToast(data.error || 'Erro ao adicionar categoria', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão', 'error');
  } finally {
    btn.disabled = false;
  }
}

function openNewEventModal() {
  const modal = document.getElementById('newEventModal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('newEventKey').value = '';
  document.getElementById('newEventLabel').value = '';
  document.getElementById('newEventMessage').value = 'Olá {nome}! {mensagem}';
  document.getElementById('newEventKey').focus();
}

function closeNewEventModal() {
  document.getElementById('newEventModal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function createEvent() {
  const key = document.getElementById('newEventKey').value.trim();
  const label = document.getElementById('newEventLabel').value.trim();
  const message = document.getElementById('newEventMessage').value.trim();
  if (!key) { showToast('Chave do evento é obrigatória', 'error'); return; }
  if (!label) { showToast('Nome exibido é obrigatório', 'error'); return; }
  if (!message) { showToast('Mensagem é obrigatória', 'error'); return; }
  if (templates[key]) { showToast('Este evento já existe', 'error'); return; }
  EVENT_LABELS[key] = label;
  templates[key] = { message, category: 'default', variables: ['nome', 'produto', 'preco'] };
  await apiFetch('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ event: key, message, label })
  });
  closeNewEventModal();
  renderTemplateList();
  selectTemplate(key);
  showToast('Evento criado com sucesso!', 'success');
}

async function deleteEvent() {
  if (!currentEvent) return;
  if (!confirm(`Excluir evento "${EVENT_LABELS[currentEvent] || currentEvent}"?`)) return;
  await apiFetch(`/api/templates/${currentEvent}`, { method: 'DELETE' });
  delete templates[currentEvent];
  currentEvent = null;
  document.getElementById('editorPlaceholder').classList.remove('hidden');
  document.getElementById('editorPanel').classList.add('hidden');
  renderTemplateList();
  showToast('Evento excluído', 'success');
}

// AI Agent functions
async function loadAiConfig() {
  const response = await apiFetch('/api/ai/config');
  const data = await response.json();
  const enabled = data.config?.enabled === true || data.config?.enabled === 'true';
  document.getElementById('aiEnabled').checked = enabled;
  document.getElementById('aiSystemPrompt').value = data.config?.system_prompt || '';
  document.getElementById('aiStatus').textContent = enabled ? 'Ligado' : 'Desligado';
}

async function toggleAiAgent() {
  const enabled = document.getElementById('aiEnabled').checked;
  await apiFetch('/api/ai/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  });
  document.getElementById('aiStatus').textContent = enabled ? 'Ligado' : 'Desligado';
}

async function saveAiPrompt() {
  const prompt = document.getElementById('aiSystemPrompt').value;
  await apiFetch('/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify({ key: 'system_prompt', value: prompt })
  });
  alert('Prompt salvo!');
}

async function addKnowledge() {
  const category = document.getElementById('knowledgeCategory').value;
  const aida_phase = document.getElementById('knowledgePhase').value;
  const content = document.getElementById('knowledgeContent').value;
  if (!content.trim()) return alert('Conteúdo é obrigatório');
  
  await apiFetch('/api/ai/knowledge', {
    method: 'POST',
    body: JSON.stringify({ category, aida_phase, content })
  });
  document.getElementById('knowledgeContent').value = '';
  loadKnowledge();
}

async function loadKnowledge() {
  const response = await apiFetch('/api/ai/knowledge');
  const data = await response.json();
  const list = document.getElementById('knowledgeList');
  list.innerHTML = data.chunks?.map(chunk => `
    <div class="knowledge-item">
      <span class="knowledge-badge">${chunk.category}</span>
      <span class="knowledge-badge">${chunk.aida_phase}</span>
      <p>${chunk.content}</p>
      <button class="btn-delete" onclick="deleteKnowledge(${chunk.id})">🗑️</button>
    </div>
  `).join('') || '<p>Nenhum conhecimento cadastrado</p>';
}

async function deleteKnowledge(id) {
  if (!confirm('Deletar este conhecimento?')) return;
  await apiFetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
  loadKnowledge();
}

async function loadAiNotifications() {
  const response = await apiFetch('/api/ai/notifications');
  const data = await response.json();
  const list = document.getElementById('aiNotifications');
  list.innerHTML = data.notifications?.map(n => `
    <div class="notification-item">
      <span>${n.phone}</span>
      <p>${n.message}</p>
      <small>${n.reason}</small>
      <button class="btn-save" onclick="resolveNotification(${n.id})">✓ Resolver</button>
    </div>
  `).join('') || '<p>Nenhuma notificação pendente</p>';
}

async function resolveNotification(id) {
  await apiFetch(`/api/ai/notifications/${id}/resolve`, { method: 'PUT' });
  loadAiNotifications();
}

async function loadAiRules() {
  const response = await apiFetch('/api/ai/rules');
  const data = await response.json();
  const list = document.getElementById('aiRules');
  list.innerHTML = data.rules?.map(rule => `
    <div class="rule-item">
      <span class="knowledge-badge">${rule.phase}</span>
      <p>Triggers: ${rule.trigger_keywords}</p>
      <p>Persuasão: ${rule.persuasion_techniques}</p>
    </div>
  `).join('') || '<p>Nenhuma regra configurada</p>';
}

// Tab switching
let currentTab = 'templates';

function switchTab(tab) {
  if (tab === currentTab) return;
  
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });
  
  const targetTab = document.getElementById(`tab-${tab}`);
  if (targetTab) {
    targetTab.style.display = tab === 'templates' ? '' : 'block';
  }
  
  currentTab = tab;
  
  if (tab === 'ai') {
    loadAiConfig();
    loadKnowledge();
    loadAiNotifications();
    loadAiRules();
  }
}

function init() {
  if (!checkAuth()) return;

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_user');
    window.location.href = window.BASE_URL + '/login.html';
  });

  document.getElementById('messageInput').addEventListener('input', updatePreview);
  document.getElementById('saveBtn').addEventListener('click', saveTemplate);
  document.getElementById('addCatBtn').addEventListener('click', addCategory);
  document.getElementById('btnNewEvent').addEventListener('click', openNewEventModal);
  document.getElementById('btnCreateEvent').addEventListener('click', createEvent);
  document.getElementById('btnDeleteEvent').addEventListener('click', deleteEvent);

  document.getElementById('newEventModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewEventModal();
  });

  // Tab switching
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(btn.dataset.tab);
    });
  });

  // AI Agent event listeners
  document.getElementById('aiEnabled')?.addEventListener('change', toggleAiAgent);
  document.getElementById('saveAiPrompt')?.addEventListener('click', saveAiPrompt);
  document.getElementById('addKnowledge')?.addEventListener('click', addKnowledge);

  loadTemplates();
  loadCategories();
}

document.addEventListener('DOMContentLoaded', init);
