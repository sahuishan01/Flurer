/**
 * Pure helper for sorting plugins according to a custom order array of plugin IDs.
 * Separated from plugins.ts to allow pure unit testing in environments without JSX runtimes.
 */
export function getOrderedPlugins<T extends { id: string }>(plugins: T[], customOrder?: string[]): T[] {
  if (!customOrder || customOrder.length === 0) return plugins;
  const orderMap = new Map(customOrder.map((id, index) => [id, index]));
  return [...plugins].sort((a, b) => {
    const aIndex = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity;
    const bIndex = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity;
    if (aIndex === bIndex) return 0;
    return aIndex - bIndex;
  });
}
