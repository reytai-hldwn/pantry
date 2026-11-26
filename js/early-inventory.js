import { fetchGooglePublicData, validateGoogleScriptUrl } from './google-read.js';

const config = globalThis.DRINKS_CONFIG;
const hash = location.hash;
const action = hash === '#snack-drawer' ? 'warehouse' :
  ['', '#overview', '#overview-history', '#archive', '#wishes', '#snack-wishes'].includes(hash) ? 'public' : '';
if (config?.provider === 'google' && action) {
  try {
    const endpoint = validateGoogleScriptUrl(config.googleScriptUrl);
    const request = fetchGooglePublicData(endpoint, { action });
    request.catch(() => {});
    globalThis.pantryEarlyInventory = { endpoint, action, request, startedAt: Date.now() };
  } catch { /* The application handles invalid shared configuration. */ }
}
