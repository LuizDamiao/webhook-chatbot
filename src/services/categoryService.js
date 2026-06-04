import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CATEGORIES = {
  ebook: {
    keywords: ['e-book', 'ebook', 'guia', 'pdf', 'download'],
    name: 'E-book'
  },
  curso: {
    keywords: ['curso', 'treinamento', 'workshop', 'aula'],
    name: 'Curso'
  },
  consultoria: {
    keywords: ['consultoria', 'mentoria', 'assessoria'],
    name: 'Consultoria'
  },
  default: {
    keywords: [],
    name: 'Outros'
  }
};

const CONFIG_PATH = join(__dirname, '../../config/categories.json');

class CategoryService {
  constructor() {
    this.categories = {};
    this.loaded = false;
  }

  async load() {
    try {
      const data = await readFile(CONFIG_PATH, 'utf-8');
      this.categories = JSON.parse(data);
      this.loaded = true;
    } catch (error) {
      this.categories = { ...DEFAULT_CATEGORIES };
      this.loaded = true;
    }
  }

  async save() {
    try {
      await writeFile(CONFIG_PATH, JSON.stringify(this.categories, null, 2));
    } catch (error) {
      throw new Error(`Failed to save categories: ${error.message}`);
    }
  }

  reset() {
    this.categories = { ...DEFAULT_CATEGORIES };
    return this.save();
  }

  matchProduct(productName) {
    if (!this.loaded) {
      throw new Error('Categories not loaded. Call load() first.');
    }

    const normalizedName = productName.toLowerCase();

    for (const [key, category] of Object.entries(this.categories)) {
      if (key === 'default') continue;

      for (const keyword of category.keywords) {
        if (normalizedName.includes(keyword.toLowerCase())) {
          return key;
        }
      }
    }

    return 'default';
  }

  getCategories() {
    if (!this.loaded) {
      throw new Error('Categories not loaded. Call load() first.');
    }

    return Object.keys(this.categories);
  }

  addCategory(key, keywords) {
    if (!this.loaded) {
      throw new Error('Categories not loaded. Call load() first.');
    }

    this.categories[key] = {
      keywords: keywords,
      name: key.charAt(0).toUpperCase() + key.slice(1)
    };

    return this.save();
  }
}

export const categoryService = new CategoryService();