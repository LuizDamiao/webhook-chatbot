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

export default router;
