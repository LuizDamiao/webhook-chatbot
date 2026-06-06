import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { flowEngine } from './flowEngine.js';
import { searchChunks } from './knowledge.js';
import { messageStore } from './messageStore.js';

const API_TIMEOUT = 30000;
const TOP_K_CHUNKS = 3;
const MAX_HISTORY_MESSAGES = 10;
const MAX_SUGGESTIONS = 2;
const DEFAULT_CONFIDENCE = 0.8;
const CONFIDENCE_PER_CHUNK = 0.05;
const MAX_CONFIDENCE = 0.95;
const GEMINI_RETRIES = 2;
const GEMINI_RETRY_DELAY_MS = 2000;

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
- Link para compra: https://lastlink.com/p/C3B759A85/

REGRAS CRÍTICAS:
1. Suas respostas devem ter NO MÁXIMO 2-3 frases curtas
2. Seja direta e objetiva - nada de textão
3. Use os gatilhos de persuasão naturalmente (não force)
4. Se não souber algo, diga "Deixa eu verificar com a equipe"
5. Nunca invente informações
6. Seja empática - entenda a dor da cliente
7. Sempre leve para ação (compra)
8. Use prova social quando possível
9. Ancore o preço em custo diário
10. Quando falar do produto ou quando a cliente demonstrar interesse em comprar, SEMPRE inclua o link: https://lastlink.com/p/C3B759A85/`;

const FALLBACK_RESPONSES = {
  attention: 'Oi! Tudo bem? 😊 Sou a Carina, da LipedemaCare! Como posso te ajudar?',
  interest: 'Entendo! O lipedema é difícil mesmo. Me conta mais? 💚',
  desire: 'O LipedemaCare pode te ajudar muito! Videoaulas, exercícios e comunidade. Quer saber mais? 😊',
  action: 'R$37,90/mês — menos de R$1,30 por dia! Cancele quando quiser. Confira: https://lastlink.com/p/C3B759A85/ 💚'
};

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
  try {
    stmtInsertNotification.run(phone, message, reason);
  } catch (err) {
    console.error('[AI] Failed to create notification:', err.message);
  }
}

function buildPrompt({ systemPrompt, knowledgeContext, phase, persuasionSuggestions, message, history }) {
  return `${systemPrompt}

FASE ATUAL: ${phase}

CONHECIMENTO RELEVANTE:
${knowledgeContext || 'Nenhum conhecimento encontrado na base.'}

TÉCNICAS DE PERSUASÃO SUGERIDAS:
${persuasionSuggestions.join(', ') || 'Nenhuma'}

HISTÓRICO DA CONVERSA:
${history || '(Início de conversa)'}

MENSAGEM DO CLIENTE: ${message}

Responda de forma natural, empática e persuasiva. Use o conhecimento acima para fundamentar sua resposta. Aplique as técnicas de persuasão de forma orgânica (não force). Responda em português brasileiro. MÁXIMO 2-3 frases curtas. NUNCA texts longos.`;
}

async function callLLM(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  let lastError = null;

  for (let attempt = 0; attempt <= GEMINI_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 0.8
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`Groq API error (${response.status}): ${errorText}`);
        console.error(`[AI] Groq attempt ${attempt + 1} failed: ${lastError.message}`);

        if (attempt < GEMINI_RETRIES) {
          await new Promise(r => setTimeout(r, GEMINI_RETRY_DELAY_MS));
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Groq returned empty response');
      }
      return text;
    } catch (error) {
      clearTimeout(timeout);

      if (error.name === 'AbortError') {
        lastError = new Error('Groq API timeout');
        console.error(`[AI] Groq attempt ${attempt + 1} timed out`);
        if (attempt < GEMINI_RETRIES) {
          await new Promise(r => setTimeout(r, GEMINI_RETRY_DELAY_MS));
          continue;
        }
        throw lastError;
      }

      lastError = error;
      if (attempt < GEMINI_RETRIES) {
        console.error(`[AI] Groq attempt ${attempt + 1} error: ${error.message}, retrying...`);
        await new Promise(r => setTimeout(r, GEMINI_RETRY_DELAY_MS));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('Groq failed after retries');
}

async function getRecentHistory(phone, count) {
  try {
    const messages = messageStore.getByPhone(phone);
    return messages.slice(-count).map(m =>
      `${m.direction === 'incoming' ? 'Cliente' : 'Bot'}: ${m.body}`
    ).join('\n');
  } catch (err) {
    console.error(`[AI] Failed to get history for ${phone}: ${err.message}`);
    return '';
  }
}

function checkNeedsHuman(response) {
  if (!response) return false;
  const indicators = ['não sei', 'verificar com a equipe', 'não tenho certeza', 'transferir', 'atendente'];
  return indicators.some(indicator => response.toLowerCase().includes(indicator));
}

function getFallbackResponse(phase) {
  return FALLBACK_RESPONSES[phase] || FALLBACK_RESPONSES.attention;
}

export async function processMessage(phone, message) {
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    console.error('[AI] Invalid phone:', phone);
    return null;
  }
  if (typeof message !== 'string' || message.trim().length === 0) {
    console.error('[AI] Invalid message:', message);
    return null;
  }

  if (!isEnabled()) {
    console.log('[AI] Agent disabled, skipping');
    return null;
  }

  try {
    let state;
    try {
      state = flowEngine.getConversationState(phone);
    } catch (err) {
      console.error(`[AI] FlowEngine state error: ${err.message}`);
      state = { phone, phase: 'attention', persuasionUsed: [], messageCount: 0 };
    }

    let newPhase = state.phase;
    try {
      newPhase = flowEngine.identifyPhase(message, state);
      if (newPhase !== state.phase) {
        flowEngine.advancePhase(phone, newPhase);
        state = flowEngine.getConversationState(phone);
      }
    } catch (err) {
      console.error(`[AI] FlowEngine phase error: ${err.message}`);
    }

    let relevantChunks = [];
    try {
      relevantChunks = await searchChunks(message, TOP_K_CHUNKS);
    } catch (err) {
      console.error(`[AI] Knowledge search error: ${err.message}`);
    }

    let suggestions = [];
    try {
      const usedTechniques = state.persuasionUsed || [];
      suggestions = flowEngine.getPersuasionSuggestions(newPhase, usedTechniques);
    } catch (err) {
      console.error(`[AI] Persuasion suggestions error: ${err.message}`);
    }

    const systemPrompt = getConfig('system_prompt') || DEFAULT_SYSTEM_PROMPT;
    const knowledgeContext = relevantChunks.map(c => c.content).join('\n\n');

    const prompt = buildPrompt({
      systemPrompt,
      knowledgeContext,
      phase: newPhase,
      persuasionSuggestions: suggestions.slice(0, MAX_SUGGESTIONS),
      message,
      history: await getRecentHistory(phone, MAX_HISTORY_MESSAGES)
    });

    let geminiResponse;
    try {
      geminiResponse = await callLLM(prompt);
    } catch (err) {
      console.error(`[AI] Groq failed for ${phone}: ${err.message}`);
      geminiResponse = getFallbackResponse(newPhase);
    }

    const needsHuman = checkNeedsHuman(geminiResponse);
    if (needsHuman) {
      createNotification(phone, message, 'AI could not handle this message');
    }

    try {
      if (suggestions.length > 0) {
        flowEngine.trackPersuasion(phone, suggestions[0].name || suggestions[0]);
      }
    } catch (err) {
      console.error(`[AI] trackPersuasion error: ${err.message}`);
    }

    const confidence = relevantChunks.length > 0
      ? Math.min(DEFAULT_CONFIDENCE + (relevantChunks.length * CONFIDENCE_PER_CHUNK), MAX_CONFIDENCE)
      : DEFAULT_CONFIDENCE;

    messageStore.add({
      from: 'bot',
      to: phone,
      body: geminiResponse,
      direction: 'outgoing',
      status: 'sent',
      type: 'text',
      customerName: 'AI'
    });

    return {
      response: geminiResponse,
      phase: newPhase,
      confidence,
      needsHuman
    };
  } catch (error) {
    console.error(`[AI] processMessage CRITICAL failure for ${phone}:`, error.message);

    const fallback = getFallbackResponse('attention');
    try {
      messageStore.add({
        from: 'bot',
        to: phone,
        body: fallback,
        direction: 'outgoing',
        status: 'sent',
        type: 'text',
        customerName: 'AI'
      });
    } catch (e) {
      console.error('[AI] Failed to store fallback message:', e.message);
    }

    return {
      response: fallback,
      phase: 'attention',
      confidence: 0.5,
      needsHuman: false
    };
  }
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
