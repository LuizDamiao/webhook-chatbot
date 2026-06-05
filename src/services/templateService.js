import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(process.env.SESSION_DIR || join(__dirname, '../../config'), 'templates.json');

const DEFAULT_TEMPLATES = {
  Abandoned_Cart: {
    message: 'Olá {nome}! Notamos que você deixou {produto} no carrinho. Precisa de ajuda? Estamos aqui para você! Responda esta mensagem para falar conosco.',
    category: 'default',
    variables: ['nome', 'produto', 'preco']
  },
  Purchase_Order_Confirmed: {
    message: 'Olá {nome}! Sua compra de {produto} foi confirmada com sucesso! Obrigado pela preferência. Em caso de dúvidas, responda esta mensagem.',
    category: 'default',
    variables: ['nome', 'produto', 'preco']
  },
  Purchase_Request_Canceled: {
    message: 'Olá {nome}, seu pedido de {produto} foi cancelado. Se mudar de ideia, estamos à disposição. Responda esta mensagem para falar conosco.',
    category: 'default',
    variables: ['nome', 'produto', 'preco']
  },
  Purchase_Request_Confirmed: {
    message: 'Olá {nome}! Sua fatura para {produto} no valor de {preco} foi gerada. Acesse o link de pagamento ou responda esta mensagem para mais informações.',
    category: 'default',
    variables: ['nome', 'produto', 'preco']
  }
};

export class TemplateService {
  #templates = {};

  constructor() {
    this.load();
  }

  load() {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        this.#templates = JSON.parse(raw);
      } else {
        this.#templates = structuredClone(DEFAULT_TEMPLATES);
      }
    } catch {
      this.#templates = structuredClone(DEFAULT_TEMPLATES);
    }
  }

  save() {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(this.#templates, null, 2), 'utf-8');
  }

  reset() {
    this.#templates = structuredClone(DEFAULT_TEMPLATES);
    this.save();
  }

  getTemplate(event) {
    return this.#templates[event] || null;
  }

  getTemplateByCategory(event, category) {
    const tpl = this.#templates[event];
    if (!tpl) return null;
    if (tpl.category === category) return tpl;
    return null;
  }

  renderTemplate(message, data) {
    return message.replace(/\{(\w+)\}/g, (match, key) => {
      return data[key] !== undefined ? data[key] : match;
    });
  }

  updateTemplate(event, updates) {
    if (!this.#templates[event]) {
      this.#templates[event] = {};
    }
    this.#templates[event] = { ...this.#templates[event], ...updates };
    this.save();
    return this.#templates[event];
  }

  deleteTemplate(event) {
    delete this.#templates[event];
    this.save();
  }

  getAllTemplates() {
    return { ...this.#templates };
  }
}

export const templateService = new TemplateService();
