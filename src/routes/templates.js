import { Router } from 'express';
import { authJWT } from '../middleware/auth.js';
import { templateService } from '../services/templateService.js';
import { categoryService } from '../services/categoryService.js';

const router = Router();

// GET /api/templates — retorna todos os templates
router.get('/', authJWT, (req, res) => {
  const templates = templateService.getAllTemplates();
  res.json({ templates });
});

// GET /api/templates/:event — retorna template de um evento
router.get('/:event', authJWT, (req, res) => {
  const template = templateService.getTemplate(req.params.event);
  if (!template) {
    return res.status(404).json({ error: 'Template não encontrado' });
  }
  res.json({ template });
});

// PUT /api/templates/:event — atualiza template de um evento
router.put('/:event', authJWT, async (req, res) => {
  const { event } = req.params;
  const { message, category } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Mensagem é obrigatória' });
  }

  await templateService.updateTemplate(event, { message, category: category || 'default' });
  res.json({ success: true });
});

// POST /api/templates — cria novo evento de template
router.post('/', authJWT, async (req, res) => {
  const { event, message, label } = req.body;
  if (!event || !message) {
    return res.status(400).json({ error: 'Event e message são obrigatórios' });
  }
  await templateService.updateTemplate(event, { message, category: 'default', label });
  res.json({ success: true });
});

// DELETE /api/templates/:event — remove template de um evento
router.delete('/:event', authJWT, async (req, res) => {
  const { event } = req.params;
  await templateService.deleteTemplate(event);
  res.json({ success: true });
});

// POST /api/templates/test — testa renderização de template
router.post('/test', authJWT, (req, res) => {
  const { event, data } = req.body;
  const template = templateService.getTemplate(event);

  if (!template) {
    return res.status(404).json({ error: 'Template não encontrado' });
  }

  const rendered = templateService.renderTemplate(template.message, data);
  res.json({ message: rendered });
});

// GET /api/templates/categories — retorna categorias
router.get('/categories', authJWT, (req, res) => {
  const categories = categoryService.getCategories();
  res.json({ categories });
});

// POST /api/templates/categories — adiciona categoria
router.post('/categories', authJWT, async (req, res) => {
  const { key, keywords } = req.body;
  if (!key || !keywords) {
    return res.status(400).json({ error: 'Key e keywords são obrigatórios' });
  }
  await categoryService.addCategory(key, keywords);
  res.json({ success: true });
});

export default router;