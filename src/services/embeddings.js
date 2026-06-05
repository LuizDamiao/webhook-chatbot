const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';
const RETRY_DELAY_MS = 1000;
const EMBEDDING_DIMENSIONS = 768;
const BYTES_PER_FLOAT = 4;
const FETCH_TIMEOUT_MS = 30000;
const RATE_LIMIT_STATUS = 429;

export function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function fetchEmbedding(text, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${API_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] }
        }),
        signal: controller.signal
      }
    );
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Gemini API request timed out');
    }
    throw new Error(`Network error calling Gemini API: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateEmbedding(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text must be a non-empty string');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  let response = await fetchEmbedding(text, apiKey);

  if (response.status === RATE_LIMIT_STATUS) {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetchEmbedding(text, apiKey);
    if (response.status === RATE_LIMIT_STATUS) {
      throw new Error('Rate limit exceeded');
    }
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const values = data.embedding.values;

  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions but got ${values ? values.length : 0}`);
  }

  return new Float32Array(values);
}

export function embeddingToBuffer(embedding) {
  return Buffer.from(embedding.buffer);
}

export function bufferToEmbedding(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / BYTES_PER_FLOAT);
}
