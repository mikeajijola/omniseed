export function assertProvider(provider) {
  for (const operation of ['validate','plan','apply','observe']) if (typeof provider?.[operation] !== 'function') throw new Error(`Provider must implement ${operation}`);
  return provider;
}

export const providerOperations={required:['validate','plan','apply','observe'],optional:['discover','import','destroy','health']};

export function providerCapabilityOfferings(provider) {
  assertProvider(provider);
  return (provider.capabilityOfferings||[]).map(item=>({available:true,...item,provider:provider.id||item.provider}));
}

export function evidenceReference({provider,type,id,observedAt,attributes={}}) {
  if (!provider || !type || !id || !observedAt) throw new Error('Provider evidence requires provider, type, id, and observedAt');
  return {id:`provider:${provider}:${type}:${id}`,provider,type,externalId:id,observedAt,attributes};
}
