const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://webhook-chatbot-v2.onrender.com';

let selectedContact = null;
let allMessages = [];
let refreshMessages = null;
let refreshContacts = null;
let refreshStatus = null;

async function authFetch(url, options = {}) {
    const token = localStorage.getItem('dashboard_token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers,
    };
    if (options.body && typeof options.body === 'string') {
        headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...options, headers });
}

async function loadContacts() {
    try {
        const response = await authFetch(`${API_URL}/api/contacts`);
        if (!response) return [];
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : (data.contacts || []);
    } catch {
        return [];
    }
}

async function loadMessages(phone) {
    try {
        let url = `${API_URL}/api/messages`;
        if (phone) {
            url = `${API_URL}/api/messages/phone/${encodeURIComponent(phone)}`;
        }
        const response = await authFetch(url);
        if (!response) return [];
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : (data.messages || []);
    } catch {
        return [];
    }
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
            </div>
        `;
    }).join('');
}

function renderMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (!messages.length) {
        container.innerHTML = `
            <div class="empty-chat">
                <div class="empty-chat-icon">💬</div>
                <h3>Selecione um contato</h3>
                <p>Escolha uma conversa para ver as mensagens</p>
            </div>
        `;
        return;
    }

    let html = '';
    let lastDate = '';

    messages.forEach(msg => {
        const timestamp = msg.timestamp || msg.created_at || msg.createdAt || '';
        const date = timestamp ? new Date(timestamp).toLocaleDateString('pt-BR') : '';
        const time = timestamp ? new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        const text = msg.text || msg.body || msg.message || msg.content || '';
        const direction = msg.direction || 'received';
        const isSent = direction === 'outgoing' || direction === 'sent';

        if (date && date !== lastDate) {
            lastDate = date;
            html += `<div class="message-date-divider"><span>${date}</span></div>`;
        }

        html += `
            <div class="message-bubble ${isSent ? 'message-sent' : 'message-received'}">
                <div class="message-text">${escapeHtml(text)}</div>
                <div class="message-meta">
                    <span class="message-time">${time}</span>
                    ${isSent ? '<span class="message-status">✓</span>' : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

function selectContact(phone) {
    selectedContact = phone;
    const headerName = document.getElementById('chatAreaName');
    const headerStatus = document.getElementById('chatAreaStatus');
    const contacts = document.querySelectorAll('.contact-item');

    contacts.forEach(el => {
        if (el.dataset.phone === phone) {
            if (headerName) headerName.textContent = phone;
            if (headerStatus) headerStatus.textContent = 'online';
        }
    });

    loadMessages(phone).then(messages => {
        allMessages = messages;
        renderMessages(messages);
    });
}

async function updateWhatsAppStatus() {
    try {
        const response = await authFetch(`${API_URL}/api/status`);
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        if (!response || !response.ok) {
            if (dot) dot.className = 'status-dot';
            if (text) text.textContent = 'Desconectado';
            return;
        }

        const data = await response.json();
        const connected = data.connected || data.status === 'connected';

        if (dot) {
            dot.className = connected ? 'status-dot online' : 'status-dot';
        }
        if (text) {
            text.textContent = connected ? 'WhatsApp Conectado' : 'WhatsApp Desconectado';
        }
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
        if (selectedContact) {
            loadMessages(selectedContact).then(messages => {
                allMessages = messages;
                renderMessages(messages);
            });
        }
    }, 5000);

    refreshContacts = setInterval(async () => {
        const contacts = await loadContacts();
        renderContacts(contacts);
    }, 30000);

    refreshStatus = setInterval(updateWhatsAppStatus, 30000);
}

function stopAutoRefresh() {
    if (refreshMessages) clearInterval(refreshMessages);
    if (refreshContacts) clearInterval(refreshContacts);
    if (refreshStatus) clearInterval(refreshStatus);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const contactsList = document.getElementById('contactsList');
    if (contactsList) {
        contactsList.addEventListener('click', (e) => {
            const contactItem = e.target.closest('.contact-item');
            if (contactItem && contactItem.dataset.phone) {
                selectContact(contactItem.dataset.phone);
            }
        });
    }

    const searchInput = document.getElementById('contactSearch');
    if (searchInput) {
        searchInput.addEventListener('input', async (e) => {
            const term = e.target.value.toLowerCase();
            const contacts = await loadContacts();
            const filtered = contacts.filter(c => {
                const name = (c.name || c.nome || '').toLowerCase();
                const phone = (c.phone || c.telefone || '').toLowerCase();
                return name.includes(term) || phone.includes(term);
            });
            renderContacts(filtered);
        });
    }

    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    if (chatInput && sendBtn) {
        const sendMessage = async () => {
            if (!selectedContact || !chatInput.value.trim()) return;
            try {
                await authFetch(`${API_URL}/api/messages`, {
                    method: 'POST',
                    body: JSON.stringify({
                        phone: selectedContact,
                        text: chatInput.value.trim()
                    })
                });
                chatInput.value = '';
                const messages = await loadMessages(selectedContact);
                allMessages = messages;
                renderMessages(messages);
            } catch (error) {
                console.error('Erro ao enviar mensagem:', error);
                alert('Erro ao enviar mensagem. Tente novamente.');
            }
        };
        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    const contacts = await loadContacts();
    renderContacts(contacts);
    await updateWhatsAppStatus();
    startAutoRefresh();
});

window.addEventListener('beforeunload', stopAutoRefresh);

window.chat = {
    API_URL,
    authFetch,
    loadContacts,
    loadMessages,
    renderContacts,
    renderMessages,
    selectContact,
    updateWhatsAppStatus
};
