/**
 * Formats a cart abandonment message
 * @param {string} name - Customer name
 * @param {string} product - Product name
 * @returns {string} Formatted message
 */
export function formatCartMessage(name, product) {
  if (!name || !name.trim()) throw new Error('Name is required');
  if (!product || !product.trim()) throw new Error('Product is required');

  const safeName = name.normalize('NFC');
  const safeProduct = product.normalize('NFC');

  return `Olá ${safeName}! 👋

Notamos que você deixou o produto ${safeProduct} no carrinho.

Precisa de ajuda? Estamos aqui para você!

Responda esta mensagem para falar conosco.`;
}
