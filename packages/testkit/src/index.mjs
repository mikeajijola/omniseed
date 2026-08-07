export const fixedTime='2026-01-01T00:00:00.000Z';
export function active(resourceIds){return {version:1,resources:Object.fromEntries(resourceIds.map(id=>[id,{status:'active',providerId:`mock:${id}`}]))}}
