import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'messages.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_conversation_state (
    phone TEXT PRIMARY KEY,
    aida_phase TEXT NOT NULL DEFAULT 'attention',
    persuasion_used TEXT DEFAULT '[]',
    message_count INTEGER DEFAULT 0,
    last_phase_change TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_flow_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase TEXT NOT NULL,
    trigger_keywords TEXT NOT NULL DEFAULT '[]',
    response_template TEXT NOT NULL,
    persuasion_techniques TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER DEFAULT 1
  );
`);

const VALID_PHASES = ['attention', 'interest', 'desire', 'action'];

const DEFAULT_RULES = [
  {
    phase: 'attention',
    trigger_keywords: ['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hello', 'hi'],
    response_template: 'saudacao',
    persuasion_techniques: ['affinity', 'commitment']
  },
  {
    phase: 'interest',
    trigger_keywords: ['dor', 'inchaço', 'perna', 'lipedema', 'sintoma', 'problema', 'sofrimento'],
    response_template: 'interesse',
    persuasion_techniques: ['authority', 'reciprocity']
  },
  {
    phase: 'desire',
    trigger_keywords: ['funciona', 'quero', 'como', 'beneficio', 'resultado', 'ajuda'],
    response_template: 'desejo',
    persuasion_techniques: ['social_proof', 'loss_aversion', 'anchoring', 'reciprocity']
  },
  {
    phase: 'action',
    trigger_keywords: ['comprar', 'preço', 'valor', 'pagar', 'assinar', 'link', 'quero comprar', 'como assinar'],
    response_template: 'acao',
    persuasion_techniques: ['urgency', 'ease']
  }
];

const PHASE_KEYWORDS = {};
for (const rule of DEFAULT_RULES) {
  PHASE_KEYWORDS[rule.phase] = rule.trigger_keywords;
}

const HESITATION_KEYWORDS = ['não sei', 'depois', 'vou pensar', 'talvez', 'não tenho certeza'];

const PERSUASION_TECHNIQUES = {
  affinity: { name: 'Afinidade', description: 'Empatia genuína com o problema da cliente', examples: ['Nossa, eu imagino como deve ser difícil...', 'Entendo sua frustração...'] },
  social_proof: { name: 'Prova Social', description: 'Mostrar que outras pessoas usam o produto', examples: ['Mais de 500 mulheres já estão cuidando', 'Muitas clientes nos relatam melhora'] },
  loss_aversion: { name: 'Aversão à Perda', description: 'Lembrar do que ela já perdeu/sofreu', examples: ['Quanto tempo você já gastou tentando resolver isso?', 'Cada dia sem tratamento é mais um dia com dor'] },
  anchoring: { name: 'Ancoragem', description: 'Comparar custo com algo menor', examples: ['R$37,90/mês são R$1,30 por dia. Menos que um café!'] },
  authority: { name: 'Autoridade', description: 'Mostrar credibilidade do produto', examples: ['Foi criado por mulheres que entendem EXATAMENTE o que você passa'] },
  reciprocity: { name: 'Reciprocidade', description: 'Dar algo antes de pedir', examples: ['Posso te mandar um exercício que alivia a dor?'] },
  urgency: { name: 'Urgência', description: 'Criar urgência gentil para agir', examples: ['Quanto antes você começar, mais rápido vai sentir alívio'] },
  ease: { name: 'Facilidade', description: 'Mostrar que é fácil e sem compromisso', examples: ['Cancela quando quiser, sem multa'] },
  commitment: { name: 'Compromisso', description: 'Pedir "sim" pequeno antes do grande "sim"', examples: ['Você quer se sentir melhor?'] }
};

const stmtGetState = db.prepare('SELECT * FROM ai_conversation_state WHERE phone = ?');
const stmtUpsertState = db.prepare(`
  INSERT OR REPLACE INTO ai_conversation_state (phone, aida_phase, persuasion_used, message_count, last_phase_change)
  VALUES (?, ?, ?, ?, datetime('now'))
`);
const stmtGetActiveRules = db.prepare('SELECT * FROM ai_flow_rules WHERE is_active = 1');
const stmtAddRule = db.prepare('INSERT INTO ai_flow_rules (phase, trigger_keywords, response_template, persuasion_techniques) VALUES (?, ?, ?, ?)');
const stmtGetRule = db.prepare('SELECT * FROM ai_flow_rules WHERE id = ?');
const stmtUpdateRule = db.prepare('UPDATE ai_flow_rules SET phase = ?, trigger_keywords = ?, response_template = ?, persuasion_techniques = ?, is_active = ? WHERE id = ?');
const stmtDeleteRule = db.prepare('DELETE FROM ai_flow_rules WHERE id = ?');
const stmtCountRules = db.prepare('SELECT COUNT(*) as count FROM ai_flow_rules');

function initDefaultRules() {
  const { count } = stmtCountRules.get();
  if (count === 0) {
    const insertMany = db.transaction((rules) => {
      for (const rule of rules) {
        stmtAddRule.run(
          rule.phase,
          JSON.stringify(rule.trigger_keywords),
          rule.response_template,
          JSON.stringify(rule.persuasion_techniques)
        );
      }
    });
    insertMany(DEFAULT_RULES);
  }
}

function rowToState(row) {
  return {
    phone: row.phone,
    phase: row.aida_phase,
    persuasionUsed: JSON.parse(row.persuasion_used || '[]'),
    messageCount: row.message_count,
    lastPhaseChange: row.last_phase_change
  };
}

function rowToRule(row) {
  return {
    id: row.id,
    phase: row.phase,
    triggerKeywords: JSON.parse(row.trigger_keywords || '[]'),
    responseTemplate: row.response_template,
    persuasionTechniques: JSON.parse(row.persuasion_techniques || '[]'),
    isActive: row.is_active
  };
}

function identifyPhase(message, currentState) {
  if (!message || typeof message !== 'string') return currentState.phase;

  const msg = message.toLowerCase();

  if (currentState.phase === 'attention') {
    if (PHASE_KEYWORDS.interest?.some(k => msg.includes(k))) return 'interest';
  }

  if (currentState.phase === 'interest') {
    if (PHASE_KEYWORDS.desire?.some(k => msg.includes(k))) return 'desire';
  }

  if (currentState.phase === 'desire') {
    if (PHASE_KEYWORDS.action?.some(k => msg.includes(k))) return 'action';
    if (HESITATION_KEYWORDS.some(k => msg.includes(k))) return 'desire';
  }

  if (currentState.phase === 'action') {
    if (HESITATION_KEYWORDS.some(k => msg.includes(k))) return 'desire';
  }

  return currentState.phase;
}

initDefaultRules();

export const flowEngine = {
  getConversationState(phone) {
    const row = stmtGetState.get(phone);
    if (row) return rowToState(row);

    const newState = {
      phone,
      phase: 'attention',
      persuasionUsed: [],
      messageCount: 0,
      lastPhaseChange: new Date().toISOString()
    };
    stmtUpsertState.run(phone, 'attention', '[]', 0);
    return newState;
  },

  advancePhase(phone, newPhase) {
    if (!VALID_PHASES.includes(newPhase)) {
      throw new Error(`Invalid phase: ${newPhase}. Must be one of: ${VALID_PHASES.join(', ')}`);
    }
    const current = this.getConversationState(phone);
    stmtUpsertState.run(phone, newPhase, JSON.stringify(current.persuasionUsed), current.messageCount);
    return this.getConversationState(phone);
  },

  identifyPhase,

  getActiveRules() {
    return stmtGetActiveRules.all().map(rowToRule);
  },

  addRule(phase, triggerKeywords, responseTemplate, persuasionTechniques) {
    if (!VALID_PHASES.includes(phase)) {
      throw new Error(`Invalid phase: ${phase}. Must be one of: ${VALID_PHASES.join(', ')}`);
    }
    const result = stmtAddRule.run(phase, JSON.stringify(triggerKeywords), responseTemplate, JSON.stringify(persuasionTechniques));
    return stmtGetRule.get(result.lastInsertRowid);
  },

  updateRule(id, updates) {
    const existing = stmtGetRule.get(id);
    if (!existing) throw new Error(`Rule not found: ${id}`);
    const phase = updates.phase ?? existing.phase;
    const triggerKeywords = updates.trigger_keywords ? JSON.stringify(updates.trigger_keywords) : existing.trigger_keywords;
    const responseTemplate = updates.response_template ?? existing.response_template;
    const persuasionTechniques = updates.persuasion_techniques ? JSON.stringify(updates.persuasion_techniques) : existing.persuasion_techniques;
    const isActive = updates.is_active ?? existing.is_active;
    stmtUpdateRule.run(phase, triggerKeywords, responseTemplate, persuasionTechniques, isActive, id);
    return stmtGetRule.get(id);
  },

  deleteRule(id) {
    const existing = stmtGetRule.get(id);
    if (!existing) throw new Error(`Rule not found: ${id}`);
    stmtDeleteRule.run(id);
  },

  trackPersuasion(phone, technique) {
    if (!(technique in PERSUASION_TECHNIQUES)) {
      throw new Error(`Invalid persuasion technique: ${technique}. Must be one of: ${Object.keys(PERSUASION_TECHNIQUES).join(', ')}`);
    }
    const state = this.getConversationState(phone);
    if (state.persuasionUsed.includes(technique)) return state;
    const updated = [...state.persuasionUsed, technique];
    stmtUpsertState.run(phone, state.phase, JSON.stringify(updated), state.messageCount);
    return this.getConversationState(phone);
  },

  getPersuasionSuggestions(phase, usedTechniques) {
    const rules = this.getActiveRules();
    const phaseRule = rules.find(r => r.phase === phase);
    if (!phaseRule) return [];
    return phaseRule.persuasionTechniques.filter(t => !usedTechniques.includes(t));
  },

  reset() {
    db.exec('DELETE FROM ai_conversation_state');
    db.exec('DELETE FROM ai_flow_rules');
    initDefaultRules();
  },

  PERSUASION_TECHNIQUES
};
