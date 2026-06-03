// Configuration - Backend URL
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000'
  : 'https://webhook-chatbot-pmyi.onrender.com';
const REFRESH_INTERVAL = 30000;

const elements = {
    serverStatus: document.getElementById('serverStatus'),
    serverStatusText: document.getElementById('serverStatusText'),
    whatsappStatusText: document.getElementById('whatsappStatusText'),
    messageCount: document.getElementById('messageCount'),
    lastMessageTime: document.getElementById('lastMessageTime'),
    webhookForm: document.getElementById('webhookForm'),
    webhookResponse: document.getElementById('webhookResponse'),
    messageLog: document.getElementById('messageLog'),
    qrCodeContainer: document.getElementById('qrCodeContainer'),
    qrCodeImage: document.getElementById('qrCodeImage'),
    qrCodeSection: document.getElementById('qrCodeSection')
};

function getLogs() {
    try {
        return JSON.parse(localStorage.getItem('webhookLogs') || '[]');
    } catch {
        return [];
    }
}

function saveLogs(logs) {
    localStorage.setItem('webhookLogs', JSON.stringify(logs));
}

function addLog(entry) {
    const logs = getLogs();
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();
    saveLogs(logs);
    renderLogs();
}

function renderLogs() {
    const logs = getLogs();

    if (logs.length === 0) {
        elements.messageLog.innerHTML = `
            <tr class="empty-row">
                <td colspan="5">Nenhuma mensagem enviada ainda</td>
            </tr>`;
        return;
    }

    elements.messageLog.innerHTML = logs.map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString('pt-BR')}</td>
            <td>${escapeHtml(log.nome)}</td>
            <td>${escapeHtml(log.telefone)}</td>
            <td>${escapeHtml(log.produto)}</td>
            <td class="${log.success ? 'status-success' : 'status-error'}">
                ${log.success ? '✓ Sucesso' : '✗ Erro'}
            </td>
        </tr>`).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateStats() {
    const logs = getLogs();
    elements.messageCount.textContent = logs.length;

    if (logs.length > 0) {
        const lastTime = new Date(logs[0].timestamp);
        elements.lastMessageTime.textContent = lastTime.toLocaleString('pt-BR');
    } else {
        elements.lastMessageTime.textContent = 'Nunca';
    }
}

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            setServerStatus(true);
            await checkWhatsAppStatus();
            return true;
        }
        setServerStatus(false);
        return false;
    } catch {
        setServerStatus(false);
        return false;
    }
}

async function checkWhatsAppStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/status`, {
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            const data = await response.json();
            updateWhatsAppStatus(data.whatsapp);
        }
    } catch {
        // Ignore error
    }
}

function updateWhatsAppStatus(whatsapp) {
    if (whatsapp.connected) {
        elements.whatsappStatusText.textContent = 'Conectado';
        elements.whatsappStatusText.style.color = 'var(--success)';
        if (elements.qrCodeSection) {
            elements.qrCodeSection.style.display = 'none';
        }
    } else if (whatsapp.hasQRCode) {
        elements.whatsappStatusText.textContent = 'Aguardando scan';
        elements.whatsappStatusText.style.color = 'var(--warning)';
        fetchQRCode();
    } else {
        elements.whatsappStatusText.textContent = 'Desconectado';
        elements.whatsappStatusText.style.color = 'var(--error)';
        if (elements.qrCodeSection) {
            elements.qrCodeSection.style.display = 'none';
        }
    }
}

async function fetchQRCode() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/qrcode`, {
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            const data = await response.json();
            if (data.qr && elements.qrCodeImage && elements.qrCodeSection) {
                // Generate QR code image from data
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qr)}`;
                elements.qrCodeImage.src = qrUrl;
                elements.qrCodeSection.style.display = 'block';
            }
        }
    } catch {
        // Ignore error
    }
}

function setServerStatus(online) {
    const dot = elements.serverStatus.querySelector('.status-dot');
    const text = elements.serverStatus.querySelector('span:last-child');

    if (online) {
        dot.classList.add('online');
        text.textContent = 'Online';
        elements.serverStatusText.textContent = 'Online';
        elements.serverStatusText.style.color = 'var(--success)';
    } else {
        dot.classList.remove('online');
        text.textContent = 'Offline';
        elements.serverStatusText.textContent = 'Offline';
        elements.serverStatusText.style.color = 'var(--error)';
    }
}

async function submitWebhook(e) {
    e.preventDefault();

    const btn = elements.webhookForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Enviando...</span><span class="btn-icon">⏳</span>';
    btn.disabled = true;

    const data = {
        nome: document.getElementById('nome').value,
        telefone: document.getElementById('telefone').value,
        produto: document.getElementById('produto').value
    };

    try {
        const response = await fetch(`${API_BASE_URL}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        showResponse(
            response.ok,
            response.ok
                ? `✓ Mensagem enviada com sucesso para ${data.nome}`
                : `✗ Erro: ${result.error || 'Erro desconhecido'}`
        );

        addLog({
            ...data,
            success: response.ok,
            timestamp: new Date().toISOString()
        });

        updateStats();

        if (response.ok) {
            elements.webhookForm.reset();
        }
    } catch (error) {
        showResponse(false, `✗ Erro de conexão: ${error.message}`);
        addLog({
            ...data,
            success: false,
            timestamp: new Date().toISOString()
        });
        updateStats();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function showResponse(success, message) {
    elements.webhookResponse.textContent = message;
    elements.webhookResponse.className = `response-box ${success ? 'success' : 'error'}`;
    elements.webhookResponse.classList.remove('hidden');

    setTimeout(() => {
        elements.webhookResponse.classList.add('hidden');
    }, 8000);
}

elements.webhookForm.addEventListener('submit', submitWebhook);

async function init() {
    renderLogs();
    updateStats();
    await checkServerStatus();
    setInterval(checkServerStatus, REFRESH_INTERVAL);
}

init();