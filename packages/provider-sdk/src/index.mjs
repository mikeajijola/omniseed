export function assertProvider(provider) {
  for (const operation of ['validate','plan','apply','observe']) if (typeof provider?.[operation] !== 'function') throw new Error(`Provider must implement ${operation}`);
  return provider;
}

export const providerOperations={required:['validate','plan','apply','observe'],optional:['discover','import','destroy','health']};
