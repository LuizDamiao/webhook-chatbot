/**
 * Formats a cart abandonment message
 * @param {string} name - Customer name
 * @param {string} product - Product name
 * @returns {string} Formatted message
 */
export function formatCartMessage(name, product) {
  if (!name) throw new Error('Name is required');
  if (!product) throw new Error('Product is required');

  return `Olá ${name}! 👋

Notamos que você deixou o produto ${product} no carrinho.

Precisa de ajuda? Estamos aqui para você!

Responda esta mensagem para falar conosco.`;
}
