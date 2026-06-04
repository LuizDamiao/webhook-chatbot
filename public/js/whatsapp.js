const API_URL = window.API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://webhook-chatbot-v2.onrender.com');
const BASE_URL = window.BASE_URL || (window.location.hostname === 'localhost' ? '' : '/webhook-chatbot');

let pollInterval = null;

function getToken() {
    return localStorage.getItem('dashboard_token');
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (response.status === 401) {
        localStorage.removeItem('dashboard_token');
        window.location.href = BASE_URL + '/login.html';
        return null;
    }
    return response;
}

async function checkStatus() {
    try {
        const response = await apiFetch('/api/status');
        if (!response || !response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function getQRCode() {
    try {
        const response = await apiFetch('/api/qrcode');
        if (!response || !response.ok) return null;
        return await response.json();
    } catch { return null; }
}

function showConnected() {
    document.getElementById('waConnect').classList.add('hidden');
    document.getElementById('waConnected').classList.remove('hidden');
}

function showDisconnected() {
    document.getElementById('waConnect').classList.remove('hidden');
    document.getElementById('waConnected').classList.add('hidden');
}

function showLoading() {
    document.getElementById('waQrContainer').classList.add('hidden');
    document.getElementById('waLoading').classList.remove('hidden');
    document.getElementById('waError').classList.add('hidden');
    document.getElementById('waRefreshBtn').classList.add('hidden');
}

function showQR() {
    document.getElementById('waQrContainer').classList.remove('hidden');
    document.getElementById('waLoading').classList.add('hidden');
    document.getElementById('waError').classList.add('hidden');
    document.getElementById('waRefreshBtn').classList.remove('hidden');
}

function showError(msg) {
    document.getElementById('waQrContainer').classList.add('hidden');
    document.getElementById('waLoading').classList.add('hidden');
    document.getElementById('waError').classList.remove('hidden');
    document.getElementById('waErrorMsg').textContent = msg;
    document.getElementById('waRefreshBtn').classList.remove('hidden');
}

function renderQR(qrData) {
    const container = document.getElementById('qrContainer');
    if (!container) return;
    container.innerHTML = '';
    new QRCode(container, {
        text: qrData,
        width: 260,
        height: 260,
        colorDark: '#1f2c34',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
}

async function loadQRCode() {
    showLoading();

    const status = await checkStatus();
    if (status?.whatsapp?.connected) {
        showConnected();
        document.getElementById('waSessionInfo').textContent = status.whatsapp.sessionDir || '-';
        updateStatusDot(true);
        return;
    }

    updateStatusDot(false);

    const data = await getQRCode();
    if (!data) {
        showError('Erro ao conectar ao servidor');
        return;
    }

    if (data.qr) {
        renderQR(data.qr);
        showQR();
        startPolling();
    } else {
        showError(data.message || 'Nenhum QR Code disponível. Aguarde ou tente novamente.');
        startPolling();
    }
}

function startPolling() {
    stopPolling();
    pollInterval = setInterval(async () => {
        const status = await checkStatus();
        if (status?.whatsapp?.connected) {
            stopPolling();
            showConnected();
            document.getElementById('waSessionInfo').textContent = status.whatsapp.sessionDir || '-';
            updateStatusDot(true);
        } else {
            const data = await getQRCode();
            if (data?.qr) {
                renderQR(data.qr);
                showQR();
            }
        }
    }, 3000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

function updateStatusDot(connected) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (dot) dot.className = connected ? 'status-dot online' : 'status-dot';
    if (text) text.textContent = connected ? 'WhatsApp Conectado' : 'WhatsApp Desconectado';
}

document.addEventListener('DOMContentLoaded', () => {
    if (!window.auth.isAuthenticated()) {
        window.location.href = BASE_URL + '/login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('dashboard_token');
        localStorage.removeItem('dashboard_user');
        window.location.href = BASE_URL + '/login.html';
    });

    document.getElementById('waRefreshBtn').addEventListener('click', loadQRCode);
    document.getElementById('waRefreshStatus').addEventListener('click', loadQRCode);
    document.getElementById('waRetryBtn').addEventListener('click', loadQRCode);

    loadQRCode();
});

window.addEventListener('beforeunload', stopPolling);
