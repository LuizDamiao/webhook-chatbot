import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { flowEngine } from './flowEngine.js';
import { searchChunks } from './knowledge.js';
import { messageStore } from './messageStore.js';

const DB_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'messages.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    reason TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULT_SYSTEM_PROMPT = `Você é a Carina, atendente virtual da LipedemaCare.

SOBRE VOCÊ:
- Simpática, acolhedora, usa emoji
- Tom informal mas profissional
- Fala como uma amiga que entende o problema
- Nunca é robótica ou repetitiva

SOBRE O PRODUTO:
- LipedemaCare: plataforma de tratamento para lipedema
- Preço: R$37,90/mês (menos que R$1,30 por dia)
- Cancelamento: sem multa, quando quiser
- Benefícios: redução de dor, recuperação de mobilidade, comunidade, autoestima
- Inclui: videoaulas, exercícios guiados, receitas, comunidade, lembretes

REGRAS:
1. Use os gatilhos de persuasão naturalmente (não force)
2. Se não souber algo, diga "Deixa eu verificar com a equipe"
3. Nunca invente informações
4. Seja empática - entenda a dor da cliente
5. Sempre leve para ação (compra)
6. Use prova social quando possível
7. Ancore o preço em custo diário`;

const stmtGetConfig = db.prepare('SELECT value FROM ai_config WHERE key = ?');
const stmtSetConfig = db.prepare('INSERT OR REPLACE INTO ai_config (key, value) VALUES (?, ?)');
const stmtInsertNotification = db.prepare('INSERT INTO ai_notifications (phone, message, reason) VALUES (?, ?, ?)');
const stmtGetNotifications = db.prepare('SELECT * FROM ai_notifications WHERE resolved = 0 ORDER BY created_at DESC');
const stmtResolveNotification = db.prepare('UPDATE ai_notifications SET resolved = 1 WHERE id = ?');

export function getConfig(key) {
  const row = stmtGetConfig.get(key);
  return row ? row.value : null;
}

export function setConfig(key, value) {
  stmtSetConfig.run(key, String(value));
}

export function isEnabled() {
  const val = getConfig('enabled');
  return val === 'true' || val === null;
}

export function getNotifications() {
  return stmtGetNotifications.all();
}

export function resolveNotification(id) {
  stmtResolveNotification.run(id);
}

function createNotification(phone, message, reason) {
  stmtInsertNotification.run(phone, message, reason);
}

function buildPrompt({ systemPrompt, knowledgeContext, phase, persuasionSuggestions, message, history }) {
  return `${systemPrompt}

FASE ATUAL: ${phase}

CONHECIMENTO RELEVANTE:
${knowledgeContext || 'Nenhum conhecimento encontrado na base.'}

TÉCNICAS DE PERSUASÃO SUGERIDAS:
${persuasionSuggestions.join(', ') || 'Nenhuma'}

HISTÓRICO DA CONVERSA:
${history}

MENSAGEM DO CLIENTE: ${message}

Responda de forma natural, empática e persuasiva. Use o conhecimento acima para fundamentar sua resposta. Aplique as técnicas de persuasão de forma orgânica (não force).`;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            topP: 0.8,
            topK: 40
          }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Desculpe, não consegui gerar uma resposta.';
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Gemini API timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRecentHistory(phone, count) {
  const messages = messageStore.getByPhone(phone);
  return messages.slice(-count).map(m =>
    `${m.direction === 'incoming' ? 'Cliente' : 'Bot'}: ${m.body}`
  ).join('\n');
}

function checkNeedsHuman(response) {
  const indicators = ['não sei', 'verificar com a equipe', 'não tenho certeza', 'transferir', 'atendente'];
  return indicators.some(indicator => response.toLowerCase().includes(indicator));
}

export async function processMessage(phone, message) {
  if (!isEnabled()) return null;

  let state = flowEngine.getConversationState(phone);

  const newPhase = flowEngine.identifyPhase(message, state);
  if (newPhase !== state.phase) {
    flowEngine.advancePhase(phone, newPhase);
    state = flowEngine.getConversationState(phone);
  }

  const relevantChunks = await searchChunks(message, 3);

  const usedTechniques = state.persuasionUsed || [];
  const suggestions = flowEngine.getPersuasionSuggestions(newPhase, usedTechniques);

  const systemPrompt = getConfig('system_prompt') || DEFAULT_SYSTEM_PROMPT;
  const knowledgeContext = relevantChunks.map(c => c.content).join('\n\n');

  const prompt = buildPrompt({
    systemPrompt,
    knowledgeContext,
    phase: newPhase,
    persuasionSuggestions: suggestions.slice(0, 2),
    message,
    history: await getRecentHistory(phone, 10)
  });

  const geminiResponse = await callGemini(prompt);

  const needsHuman = checkNeedsHuman(geminiResponse);
  if (needsHuman) {
    createNotification(phone, message, 'AI could not handle this message');
  }

  if (suggestions.length > 0) {
    flowEngine.trackPersuasion(phone, suggestions[0].name || suggestions[0]);
  }

  messageStore.add({
    from: 'bot',
    to: phone,
    body: geminiResponse,
    direction: 'outgoing',
    status: 'sent',
    type: 'text',
    customerName: `AI → ${phone}`
  });

  return {
    response: geminiResponse,
    phase: newPhase,
    confidence: 0.8,
    needsHuman
  };
}

export function reset() {
  db.exec('DELETE FROM ai_notifications');
  db.exec('DELETE FROM ai_config');
}

export const aiAgent = {
  processMessage,
  getNotifications,
  resolveNotification,
  getConfig,
  setConfig,
  isEnabled,
  reset
};
