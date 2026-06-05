// ─── Config ──────────────────────────────────────────────────
// API_URL and BASE_URL are defined in auth.js (const in global scope)

const EVENT_LABELS = {
    Abandoned_Cart: 'Carrinho Abandonado',
    Purchase_Order_Confirmed: 'Compra Completa',
    Purchase_Request_Canceled: 'Pedido Cancelado',
    Purchase_Request_Confirmed: 'Fatura Criada'
};

const EVENT_ICONS = {
    Abandoned_Cart: '🛒',
    Purchase_Order_Confirmed: '✅',
    Purchase_Request_Canceled: '❌',
    Purchase_Request_Confirmed: '💳'
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
let selectedContact = null;
let allMessages = [];
let refreshMessages = null;
let refreshContacts = null;
let refreshStatus = null;
let replyingTo = null;
let mediaRecorder = null;
let audioChunks = [];

// ─── API Helper ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const token = localStorage.getItem('dashboard_token');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${window.API_URL}${path}`, { ...options, headers });
    if (response.status === 401) {
        localStorage.removeItem('dashboard_token');
        window.location.href = window.BASE_URL + '/login.html';
        return null;
    }
    return response;
}

// ─── Tab Navigation ─────────────────────────────────────────
window.switchTab = function(tab) {
    try {
        const chatView = document.getElementById('viewChat');
        const templatesView = document.getElementById('viewTemplates');
        const navChat = document.getElementById('navChat');
        const navTemplates = document.getElementById('navTemplates');

        if (chatView) chatView.style.display = tab === 'chat' ? 'flex' : 'none';
        if (templatesView) templatesView.style.display = tab === 'templates' ? 'grid' : 'none';
        if (navChat) navChat.classList.toggle('active', tab === 'chat');
        if (navTemplates) navTemplates.classList.toggle('active', tab === 'templates');

        if (tab === 'templates') {
            loadTemplates().catch(err => console.error('Erro ao carregar templates:', err));
        }
    } catch (err) {
        console.error('Erro no switchTab:', err);
    }
};

// ─── Toast ──────────────────────────────────────────────────
function showToast(message, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ─── Chat Functions ─────────────────────────────────────────
async function loadContacts() {
    try {
        const response = await apiFetch('/api/contacts');
        if (!response || !response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : (data.contacts || []);
    } catch { return []; }
}

async function forceLoadChats() {
    try {
        showToast('Carregando conversas...', 'success');
        const response = await apiFetch('/api/whatsapp/load-chats', { method: 'POST' });
        if (response && response.ok) {
            const data = await response.json();
            showToast(`${data.loaded || 0} conversas carregadas`, 'success');
            const contacts = await loadContacts();
            renderContacts(contacts);
        } else {
            showToast('Erro ao carregar conversas', 'error');
        }
    } catch { showToast('Erro de conexão', 'error'); }
}

async function loadChatHistoryForContact(phone) {
    try {
        const response = await apiFetch(`/api/whatsapp/load-chat/${encodeURIComponent(phone)}`, { method: 'POST' });
        if (response && response.ok) {
            const data = await response.json();
            showToast(`${data.loaded || 0} mensagens carregadas`, 'success');
            if (selectedContact === phone) {
                const messages = await loadMessages(phone);
                allMessages = messages;
                renderMessages(messages);
            }
        }
    } catch {}
}

async function loadMessages(phone) {
    try {
        let url = '/api/messages';
        if (phone) url = `/api/messages/phone/${encodeURIComponent(phone)}`;
        const response = await apiFetch(url);
        if (!response || !response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : (data.messages || []);
    } catch { return []; }
}

function renderContacts(contacts) {
    const container = document.getElementById('contactsList');
    if (!container) return;
    if (!contacts.length) {
        container.innerHTML = '<div class="no-contacts">Nenhum contato encontrado</div>';
        return;
    }
    container.innerHTML = contacts.map(contact => {
        const phone = contact.phone || contact.telefone || '';
        const name = contact.name || contact.nome || phone;
        const initials = name.substring(0, 2).toUpperCase();
        const lastMsg = contact.lastMessage || '';
        const isActive = selectedContact === phone;
        return `
            <div class="contact-item ${isActive ? 'active' : ''}" data-phone="${escapeHtml(phone)}">
                <div class="contact-avatar">${initials}</div>
                <div class="contact-info">
                    <div class="contact-name">${escapeHtml(name)}</div>
                    <div class="contact-phone">${escapeHtml(phone)}</div>
                    ${lastMsg ? `<div class="contact-time">${escapeHtml(lastMsg.substring(0, 40))}${lastMsg.length > 40 ? '...' : ''}</div>` : ''}
                </div>
            </div>`;
    }).join('');
}

function renderMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    if (!messages.length) {
        container.innerHTML = '<div class="empty-chat"><div class="empty-chat-icon">💬</div><h3>Selecione um contato</h3><p>Escolha uma conversa para ver as mensagens</p></div>';
        return;
    }
    let html = '';
    let lastDate = '';
    messages.forEach(msg => {
        const timestamp = msg.timestamp || msg.created_at || msg.createdAt || '';
        const date = timestamp ? new Date(timestamp).toLocaleDateString('pt-BR') : '';
        const time = timestamp ? new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        const text = msg.text || msg.body || msg.message || msg.content || '';
        const isSent = msg.direction === 'outgoing' || msg.direction === 'sent';
        const status = msg.status || '';
        let statusIcon = '';
        if (isSent) {
            if (status === 'read') statusIcon = '<span class="message-status read">✓✓</span>';
            else if (status === 'delivered') statusIcon = '<span class="message-status delivered">✓✓</span>';
            else statusIcon = '<span class="message-status sent">✓</span>';
        }
        if (date && date !== lastDate) { lastDate = date; html += `<div class="message-date-divider"><span>${date}</span></div>`; }
        const quoted = msg.quotedText ? `<div class="quoted-message"><div class="quoted-text">${escapeHtml(msg.quotedText.substring(0, 80))}</div></div>` : '';
        const media = msg.type === 'audio' ? '<div class="message-audio">🎵 Áudio</div>' :
                      msg.type === 'image' ? `<div class="message-image">📷 Imagem</div>` :
                      msg.type === 'document' ? `<div class="message-doc">📄 ${escapeHtml(msg.fileName || 'Arquivo')}</div>` : '';
        html += `<div class="message-bubble ${isSent ? 'message-sent' : 'message-received'}" data-id="${msg.id || ''}" onclick="startReply('${(msg.id || '').replace(/'/g, "\\'")}', '${escapeHtml((text || '').substring(0, 50).replace(/'/g, "\\'"))}')">${quoted}${media}<div class="message-text">${escapeHtml(text)}</div><div class="message-meta"><span class="message-time">${time}</span>${statusIcon}</div></div>`;
    });
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

function selectContact(phone) {
    selectedContact = phone;
    document.querySelectorAll('.contact-item').forEach(el => {
        if (el.dataset.phone === phone) {
            const headerName = document.getElementById('chatAreaName');
            const headerStatus = document.getElementById('chatAreaStatus');
            if (headerName) headerName.textContent = phone;
            if (headerStatus) headerStatus.textContent = 'online';
        }
    });
    loadMessages(phone).then(messages => { allMessages = messages; renderMessages(messages); });
    apiFetch('/api/messages/read', { method: 'POST', body: JSON.stringify({ phone }) }).catch(() => {});
}
window.selectContact = selectContact;

async function updateWhatsAppStatus() {
    try {
        const response = await apiFetch('/api/status');
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        if (!response || !response.ok) {
            if (dot) dot.className = 'status-dot';
            if (text) text.textContent = 'Desconectado';
            return;
        }
        const data = await response.json();
        const connected = data.connected || data.status === 'connected';
        if (dot) dot.className = connected ? 'status-dot online' : 'status-dot';
        if (text) text.textContent = connected ? 'WhatsApp Conectado' : 'WhatsApp Desconectado';
    } catch {
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        if (dot) dot.className = 'status-dot';
        if (text) text.textContent = 'Erro ao verificar status';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function startAutoRefresh() {
    refreshMessages = setInterval(() => {
        if (selectedContact) loadMessages(selectedContact).then(m => { allMessages = m; renderMessages(m); });
    }, 5000);
    refreshContacts = setInterval(async () => { const c = await loadContacts(); renderContacts(c); }, 30000);
    refreshStatus = setInterval(updateWhatsAppStatus, 30000);
}

function stopAutoRefresh() {
    if (refreshMessages) clearInterval(refreshMessages);
    if (refreshContacts) clearInterval(refreshContacts);
    if (refreshStatus) clearInterval(refreshStatus);
}

// ─── Template Functions ─────────────────────────────────────
async function loadTemplates() {
    try {
        const response = await apiFetch('/api/templates');
        if (!response) return;
        const data = await response.json();
        templates = data.templates || {};
        renderTemplateList();
    } catch (err) {
        console.error('Erro ao carregar templates:', err);
    }
}

function renderTemplateList() {
    const list = document.getElementById('templateList');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(templates).forEach(event => {
        const li = document.createElement('li');
        li.className = 'template-item';
        li.dataset.event = event;
        li.innerHTML = `
            <span class="icon">${EVENT_ICONS[event] || '📝'}</span>
            <div class="info">
                <div class="name">${EVENT_LABELS[event] || event}</div>
                <div class="event-key">${event}</div>
            </div>`;
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
    document.getElementById('btnDeleteEvent').style.display = isDefaultEvent(event) ? 'none' : 'block';
    updatePreview();
}
window.selectTemplate = selectTemplate;

function isDefaultEvent(event) {
    return ['Abandoned_Cart', 'Purchase_Order_Confirmed', 'Purchase_Request_Canceled', 'Purchase_Request_Confirmed'].includes(event);
}

function updatePreview() {
    const message = document.getElementById('messageInput')?.value || '';
    let rendered = message;
    Object.entries(SAMPLE_DATA).forEach(([key, value]) => {
        rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    });
    const bubble = document.getElementById('previewBubble');
    const time = document.getElementById('previewTime');
    if (bubble) bubble.textContent = rendered || 'Nenhuma mensagem definida...';
    if (time) {
        const now = new Date();
        time.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
}

async function saveTemplate() {
    if (!currentEvent) return;
    const message = document.getElementById('messageInput').value.trim();
    if (!message) { showToast('A mensagem não pode estar vazia', 'error'); return; }
    const btn = document.getElementById('saveBtn');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
        const response = await apiFetch(`/api/templates/${currentEvent}`, {
            method: 'PUT',
            body: JSON.stringify({ message, category: templates[currentEvent]?.category || 'default' })
        });
        if (response && response.ok) {
            templates[currentEvent].message = message;
            showToast('Template salvo com sucesso!', 'success');
        } else {
            const data = response ? await response.json() : {};
            showToast(data.error || 'Erro ao salvar template', 'error');
        }
    } catch { showToast('Erro de conexão', 'error'); }
    finally { btn.classList.remove('loading'); btn.disabled = false; }
}

async function deleteEvent() {
    if (!currentEvent || isDefaultEvent(currentEvent)) return;
    if (!confirm(`Excluir evento "${EVENT_LABELS[currentEvent] || currentEvent}"?`)) return;
    delete templates[currentEvent];
    await apiFetch(`/api/templates/${currentEvent}`, { method: 'DELETE' });
    currentEvent = null;
    document.getElementById('editorPlaceholder').classList.remove('hidden');
    document.getElementById('editorPanel').classList.add('hidden');
    renderTemplateList();
    showToast('Evento excluído', 'success');
}

// ─── New Event Modal ────────────────────────────────────────
function openNewEventModal() {
    document.getElementById('newEventModal').classList.remove('hidden');
    document.getElementById('newEventKey').value = '';
    document.getElementById('newEventLabel').value = '';
    document.getElementById('newEventMessage').value = 'Olá {nome}! {mensagem}';
    document.getElementById('newEventKey').focus();
}
window.openNewEventModal = openNewEventModal;

function closeNewEventModal() {
    document.getElementById('newEventModal').classList.add('hidden');
}
window.closeNewEventModal = closeNewEventModal;

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

// ─── Categories ─────────────────────────────────────────────
async function loadCategories() {
    const response = await apiFetch('/api/templates/categories');
    if (!response) return;
    const data = await response.json();
    const categories = data.categories || {};
    const grid = document.getElementById('categoriesGrid');
    const keys = Object.keys(categories);
    if (!keys.length) { grid.innerHTML = '<div class="empty-state">Nenhuma categoria encontrada</div>'; return; }
    grid.innerHTML = '';
    keys.forEach(key => {
        const cat = categories[key];
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
            <div class="cat-name">${cat.name || key}</div>
            <div class="cat-key">${key}</div>
            <div class="cat-keywords">${(cat.keywords || []).map(kw => `<span class="keyword-tag">${kw}</span>`).join('')}</div>`;
        grid.appendChild(card);
    });
}

async function addCategory() {
    const key = document.getElementById('catKey').value.trim();
    const name = document.getElementById('catName').value.trim();
    const keywordsRaw = document.getElementById('catKeywords').value.trim();
    if (!key) { showToast('Chave da categoria é obrigatória', 'error'); return; }
    if (!keywordsRaw) { showToast('Insira pelo menos uma palavra-chave', 'error'); return; }
    const keywords = keywordsRaw.split(',').map(k => k.trim()).filter(Boolean);
    const btn = document.getElementById('addCatBtn');
    btn.disabled = true;
    try {
        const response = await apiFetch('/api/templates/categories', {
            method: 'POST',
            body: JSON.stringify({ key, keywords, name: name || key })
        });
        if (response && response.ok) {
            showToast('Categoria adicionada!', 'success');
            document.getElementById('catKey').value = '';
            document.getElementById('catName').value = '';
            document.getElementById('catKeywords').value = '';
            loadCategories();
        } else {
            const data = response ? await response.json() : {};
            showToast(data.error || 'Erro ao adicionar', 'error');
        }
    } catch { showToast('Erro de conexão', 'error'); }
    finally { btn.disabled = false; }
}

// ─── DELETE template route (for custom events) ──────────────
async function deleteTemplateAPI(event) {
    await apiFetch(`/api/templates/${event}`, { method: 'DELETE' });
}

// ─── Reply ─────────────────────────────────────────────────
window.startReply = function(msgId, text) {
    if (!msgId) return;
    replyingTo = msgId;
    document.getElementById('replyBar').classList.remove('hidden');
    document.getElementById('replyText').textContent = text || '...';
    document.getElementById('chatInput').focus();
};

function cancelReply() {
    replyingTo = null;
    document.getElementById('replyBar').classList.add('hidden');
}

// ─── Audio Recording ───────────────────────────────────────
async function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        document.getElementById('micBtn').classList.remove('recording');
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            if (!selectedContact || audioChunks.length === 0) return;
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = async () => {
                showToast('Enviando áudio...', 'success');
                const res = await apiFetch('/api/messages/audio', {
                    method: 'POST',
                    body: JSON.stringify({ phone: selectedContact, audio: reader.result })
                });
                if (res && res.ok) {
                    const messages = await loadMessages(selectedContact);
                    allMessages = messages;
                    renderMessages(messages);
                } else {
                    const err = res ? await res.json().catch(() => ({})) : {};
                    showToast(err.error || 'Erro ao enviar áudio', 'error');
                }
            };
            reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        document.getElementById('micBtn').classList.add('recording');
        showToast('Gravando áudio... clique novamente para enviar', 'success');
    } catch (err) {
        showToast('Erro ao acessar microfone: ' + err.message, 'error');
    }
}

// ─── File/Image Send ───────────────────────────────────────
function triggerFileInput(accept, type) {
    const input = document.getElementById('fileInput');
    input.accept = accept;
    input.dataset.sendType = type;
    input.click();
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !selectedContact) return;
    const type = e.target.dataset.sendType || 'document';

    if (type === 'image' && file.size > 5 * 1024 * 1024) {
        showToast('Imagem muito grande (máx 5MB)', 'error');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
        const base64 = reader.result;
        const endpoint = type === 'image' ? '/api/messages/image' : '/api/messages/document';
        const body = type === 'image'
            ? { phone: selectedContact, image: base64, caption: '' }
            : { phone: selectedContact, file: base64, fileName: file.name, mimeType: file.type || 'application/octet-stream' };
        showToast(`Enviando ${type === 'image' ? 'imagem' : 'arquivo'}...`, 'success');
        const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
        if (res && res.ok) {
            const messages = await loadMessages(selectedContact);
            allMessages = messages;
            renderMessages(messages);
        } else {
            const err = res ? await res.json().catch(() => ({})) : {};
            showToast(err.error || 'Erro ao enviar', 'error');
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

// ─── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.auth.isAuthenticated()) { window.location.href = window.BASE_URL + '/login.html'; return; }

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('dashboard_token');
        localStorage.removeItem('dashboard_user');
        window.location.href = window.BASE_URL + '/login.html';
    });

    // Chat events
    const contactsList = document.getElementById('contactsList');
    if (contactsList) contactsList.addEventListener('click', e => {
        const item = e.target.closest('.contact-item');
        if (item?.dataset.phone) {
            selectContact(item.dataset.phone);
            loadChatHistoryForContact(item.dataset.phone);
        }
    });

    document.getElementById('refreshChatsBtn')?.addEventListener('click', forceLoadChats);

    const searchInput = document.getElementById('contactSearch');
    if (searchInput) searchInput.addEventListener('input', async e => {
        const term = e.target.value.toLowerCase();
        const contacts = await loadContacts();
        renderContacts(contacts.filter(c => {
            const name = (c.name || c.nome || '').toLowerCase();
            const phone = (c.phone || c.telefone || '').toLowerCase();
            return name.includes(term) || phone.includes(term);
        }));
    });

    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    if (chatInput && sendBtn) {
        const sendMessage = async () => {
            if (!selectedContact || !chatInput.value.trim()) return;
            const text = chatInput.value.trim();
            chatInput.value = '';
            cancelReply();
            try {
                const body = { phone: selectedContact, text };
                if (replyingTo) body.quoted = replyingTo;
                const response = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify(body) });
                if (!response) return;
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    showToast(err.error || 'Erro ao enviar mensagem', 'error');
                    return;
                }
                const messages = await loadMessages(selectedContact);
                allMessages = messages;
                renderMessages(messages);
            } catch (err) { console.error('Erro ao enviar:', err); showToast('Erro de conexão', 'error'); }
        };
        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    }

    // Audio, file, image, reply buttons
    document.getElementById('micBtn')?.addEventListener('click', startRecording);
    document.getElementById('attachBtn')?.addEventListener('click', () => triggerFileInput('*/*', 'document'));
    document.getElementById('imageBtn')?.addEventListener('click', () => triggerFileInput('image/*', 'image'));
    document.getElementById('fileInput')?.addEventListener('change', handleFileSelect);
    document.getElementById('replyClose')?.addEventListener('click', cancelReply);

    // Template events
    document.getElementById('messageInput')?.addEventListener('input', updatePreview);
    document.getElementById('saveBtn')?.addEventListener('click', saveTemplate);
    document.getElementById('btnNewEvent')?.addEventListener('click', openNewEventModal);
    document.getElementById('btnCreateEvent')?.addEventListener('click', createEvent);
    document.getElementById('btnDeleteEvent')?.addEventListener('click', deleteEvent);
    document.getElementById('addCatBtn')?.addEventListener('click', addCategory);

    // Close modal on overlay click
    document.getElementById('newEventModal')?.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeNewEventModal();
    });

    // Load data
    const contacts = await loadContacts();
    renderContacts(contacts);
    await updateWhatsAppStatus();
    startAutoRefresh();
});

window.addEventListener('beforeunload', stopAutoRefresh);
