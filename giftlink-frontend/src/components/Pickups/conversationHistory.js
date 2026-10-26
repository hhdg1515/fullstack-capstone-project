export const roles = ['giver', 'receiver'];
export const openStates = ['pending', 'accepted'];
export const closedStates = ['completed', 'cancelled', 'declined', 'no_show'];
export const validMessage = message => message && typeof message.id === 'string' && /^[a-f0-9]{24}$/.test(message.id) &&
  roles.includes(message.sender) && typeof message.text === 'string' && typeof message.createdAt === 'string' &&
  Number.isFinite(Date.parse(message.createdAt)) && new Date(message.createdAt).toISOString() === message.createdAt;
export const validPage = page => page && Array.isArray(page.messages) && page.messages.length <= 50 && page.messages.every(validMessage) &&
  (page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 256));
export const mergeMessages = (...groups) => [...new Map(groups.flat().map(message => [message.id, message])).values()]
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

// Newest range first. Refresh may jump over more than one page of new messages;
// retain the old history and its cursor, and expose the gap for bounded loading.
export function mergeRanges(ranges) {
  const result = [];
  for (const range of ranges) {
    const previous = result[result.length - 1];
    if (previous && (previous.nextCursor === null || range.messages.some(message => previous.messages.some(value => value.id === message.id)))) {
      result[result.length - 1] = { messages: mergeMessages(range.messages, previous.messages),
        nextCursor: previous.nextCursor === null ? null : range.nextCursor };
    } else result.push(range);
  }
  return result;
}
