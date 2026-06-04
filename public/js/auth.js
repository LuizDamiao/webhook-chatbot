const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000'
  : 'https://webhook-chatbot-v2.onrender.com';

function checkAuth() {
  const token = localStorage.getItem('dashboard_token');
  if (token && window.location.pathname.includes('login.html')) {
    window.location.href = '/';
    return false;
  }
  return !!token;
}

async function login(username, password) {
  const response = await fetch(`${API_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erro ao fazer login');
  }

  localStorage.setItem('dashboard_token', data.token);
  localStorage.setItem('dashboard_user', username);
  return data;
}

function logout() {
  localStorage.removeItem('dashboard_token');
  localStorage.removeItem('dashboard_user');
  window.location.href = '/login.html';
}

function getToken() {
  return localStorage.getItem('dashboard_token');
}

function isAuthenticated() {
  return !!localStorage.getItem('dashboard_token');
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const btn = form.querySelector('button[type="submit"]');
      const btnText = btn.querySelector('.btn-text');
      const btnLoading = btn.querySelector('.btn-loading');
      const errorDiv = document.getElementById('errorMessage');
      
      btn.disabled = true;
      btnText.style.display = 'none';
      btnLoading.style.display = 'inline-flex';
      errorDiv.style.display = 'none';
      
      try {
        await login(username, password);
        window.location.href = '/';
      } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.style.display = 'block';
      } finally {
        btn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
      }
    });
  }
});

window.auth = {
  getToken,
  isAuthenticated,
  logout,
  API_URL
};
