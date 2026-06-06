import { Router } from 'express';
import { authJWT } from '../middleware/auth.js';
import * as knowledge from '../services/knowledge.js';
import * as aiAgent from '../services/aiAgent.js';
import { flowEngine } from '../services/flowEngine.js';

const router = Router();
router.use(authJWT);

// Knowledge Base Endpoints

router.get('/api/ai/knowledge', (req, res) => {
  const chunks = knowledge.getAllChunks();
  res.json({ chunks, count: chunks.length });
});

router.post('/api/ai/knowledge', async (req, res) => {
  const { category, aida_phase, content } = req.body;
  if (!category || !aida_phase || !content) {
    return res.status(400).json({ error: 'category, aida_phase, and content are required' });
  }
  const validPhases = ['attention', 'interest', 'desire', 'action', 'general'];
  if (!validPhases.includes(aida_phase)) {
    return res.status(400).json({ error: `aida_phase must be one of: ${validPhases.join(', ')}` });
  }
  try {
    const chunk = await knowledge.addChunk(category, aida_phase, content);
    res.json({ success: true, id: chunk.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/ai/knowledge/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  knowledge.deleteChunk(id);
  res.json({ success: true });
});

router.post('/api/ai/knowledge/search', async (req, res) => {
  const { query, limit } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }
  try {
    const results = await knowledge.searchChunks(query, limit || 3);
    res.json({ results, count: results.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Config Endpoints

router.get('/api/ai/config', (req, res) => {
  const config = {
    enabled: aiAgent.isEnabled(),
    system_prompt: aiAgent.getConfig('system_prompt') || ''
  };
  res.json({ config });
});

router.put('/api/ai/config', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }
  aiAgent.setConfig(key, value);
  res.json({ success: true });
});

// Toggle Endpoint

router.post('/api/ai/toggle', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  aiAgent.setConfig('enabled', String(enabled));
  res.json({ success: true, enabled });
});

// Notifications Endpoints

router.get('/api/ai/notifications', (req, res) => {
  const notifications = aiAgent.getNotifications();
  res.json({ notifications, count: notifications.length });
});

router.put('/api/ai/notifications/:id/resolve', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  aiAgent.resolveNotification(id);
  res.json({ success: true });
});

// Flow Rules Endpoints

router.get('/api/ai/rules', (req, res) => {
  const rules = flowEngine.getActiveRules();
  res.json({ rules });
});

router.post('/api/ai/rules', (req, res) => {
  const { phase, trigger_keywords, response_template, persuasion_techniques } = req.body;
  if (!phase || !trigger_keywords || !response_template) {
    return res.status(400).json({ error: 'phase, trigger_keywords, and response_template are required' });
  }
  try {
    const rule = flowEngine.addRule(phase, trigger_keywords, response_template, persuasion_techniques || []);
    res.json({ success: true, id: rule.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/api/ai/rules/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    flowEngine.deleteRule(id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Persuasion Techniques Endpoint

router.get('/api/ai/persuasion', (req, res) => {
  res.json({ techniques: flowEngine.PERSUASION_TECHNIQUES });
});

// Seed Endpoint - populate knowledge base with LipedemaCare data
router.post('/api/ai/seed', async (req, res) => {
  const KNOWLEDGE_DATA = [
    { category: 'produto', aida_phase: 'general', content: 'O LipedemaCare é uma plataforma completa de tratamento para lipedema. Foi criado por mulheres que entendem exatamente o que você está passando. Inclui videoaulas, exercícios guiados, receitas, comunidade de apoio e lembretes inteligentes.' },
    { category: 'produto', aida_phase: 'interest', content: 'O LipedemaCare oferece: Acompanhamento diário de sintomas, Exercícios guiados específicos para lipedema, Monitoramento de saúde (circunferência, peso, dor), Comunidade de apoio, Educação continuada com artigos e vídeos, Lembretes inteligentes para medicamentos e consultas.' },
    { category: 'beneficios', aida_phase: 'desire', content: 'Redução da Dor e Inchaço: Com técnicas de drenagem linfática e exercícios adaptados, você pode sentir alívio real e duradouro dos sintomas. Muitas pacientes relatam melhora significativa em poucas semanas.' },
    { category: 'beneficios', aida_phase: 'desire', content: 'Recuperação da Mobilidade: Volte a fazer as coisas que você amava. Caminhar, brincar, se movimentar livremente sem a constante dor te limitando. Exercícios progressivos que respeitam seu ritmo.' },
    { category: 'beneficios', aida_phase: 'desire', content: 'Comunidade Que Entende: Conecte-se com outras mulheres que vivem a mesma realidade. Compartilhe experiências, receba apoio e nunca mais se sinta sozinha. Mais de 500 mulheres já estão cuidando delas.' },
    { category: 'beneficios', aida_phase: 'desire', content: 'Recuperação da Autoestima: Aprenda a se amar novamente, aceitar seu corpo e focar no que realmente importa: sua saúde e seu bem-estar. O lipedema não define quem você é.' },
    { category: 'preco', aida_phase: 'action', content: 'O LipedemaCare custa R$37,90 por mês. São menos de R$1,30 por dia - menos que um café! Você pode cancelar a qualquer momento, sem multa ou burocracia.' },
    { category: 'preco', aida_phase: 'desire', content: 'Quanto tempo você já gastou tentando resolver o lipedema? Remédios, consultas, tratamentos que não funcionam? O LipedemaCare são R$37,90/mês, menos que R$1,30 por dia. Um investimento pequeno para uma grande mudança na sua qualidade de vida.' },
    { category: 'exercicios', aida_phase: 'interest', content: 'O LipedemaCare tem exercícios guiados específicos para lipedema, com vídeos e instruções passo a passo. São exercícios de baixo impacto que podem ser feitos em casa, respeitando os limites do seu corpo.' },
    { category: 'exercicios', aida_phase: 'desire', content: 'Posso te mandar um exercício que alivia a dor agora? É um exercício simples de drenagem linfática que nossas pacientes adoram. Não custa nada experimentar!' },
    { category: 'comunidade', aida_phase: 'desire', content: 'No LipedemaCare você encontra uma comunidade de mais de 500 mulheres que estão passando pelo mesmo que você. Compartilhem experiências, dicas e se apoiem mutuamente. Ninguém deveria enfrentar o lipedema sozinha.' },
    { category: 'faq', aida_phase: 'general', content: 'Pergunta: Funciona para varizes? Resposta: O LipedemaCare é focado em lipedema, mas os exercícios de drenagem linfática podem ajudar com a circulação em geral. Consulte seu médico para orientação específica.' },
    { category: 'faq', aida_phase: 'general', content: 'Pergunta: Preciso de equipamento? Resposta: Não! Todos os exercícios podem ser feitos em casa, sem equipamento especial. Você só precisa de um espaço confortável e roupas confortáveis.' },
    { category: 'faq', aida_phase: 'general', content: 'Pergunta: Em quanto tempo vou ver resultados? Resposta: Muitas pacientes relatam melhora em 2-4 semanas. Mas cada corpo é diferente. O importante é a consistência - continue praticando e você verá resultados.' },
    { category: 'urgencia', aida_phase: 'action', content: 'Quanto antes você começar o tratamento, mais rápido vai sentir alívio. Cada dia sem tratamento é mais um dia com dor e limitação. Não deixe para depois - seu corpo merece cuidado agora.' },
    { category: 'urgencia', aida_phase: 'action', content: 'O lipedema é progressivo - sem tratamento, piora com o tempo. Comece hoje para evitar complicações amanhã. O LipedemaCare é o caminho mais acessível e eficaz para cuidar de você.' }
  ];

  const existing = knowledge.getAllChunks();
  if (existing.length > 0) {
    return res.json({ success: true, message: `Knowledge base already has ${existing.length} chunks`, skipped: true });
  }

  let added = 0;
  let errors = 0;
  for (const item of KNOWLEDGE_DATA) {
    try {
      await knowledge.addChunk(item.category, item.aida_phase, item.content);
      added++;
    } catch (e) {
      console.error(`[SEED] Failed: ${e.message}`);
      errors++;
    }
  }
  res.json({ success: true, added, errors, total: KNOWLEDGE_DATA.length });
});

// Test endpoint - send a test message through AI agent
router.post('/api/ai/test', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const testPhone = 'test_' + Date.now();
  console.log(`[AI TEST] Testing with message: ${message}`);

  try {
    const result = await aiAgent.processMessage(testPhone, message);
    res.json({
      success: true,
      result: {
        response: result?.response || null,
        phase: result?.phase || null,
        confidence: result?.confidence || null,
        needsHuman: result?.needsHuman || false
      }
    });
  } catch (error) {
    console.error('[AI TEST] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
