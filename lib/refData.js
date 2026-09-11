import { urlFor } from './apiRoutes';

// Country / currency reference data from the Module 1 backend registries
// (pettycashv2.country_info / currency_info). Rows carry the uuid PKs the
// entities table references — dropdowns show the names but submit the uuids.
// Fetches are cached module-wide so Step 1 and the amount-prefix display
// share one request; a failed fetch clears the cache so the next call retries.
//
// Routed through `urlFor` rather than reading the env var here: which service
// answers a path is one decision, and it lives in lib/apiRoutes.js.

// Build a module-wide cached fetcher for one `/api/onboarding/<key>` registry.
// Each fetcher closes over its own promise slot, so the two lists cache
// independently — one failing does not evict or retry the other.
function cachedListFetch(key) {
  let promise = null;
  return function fetchList() {
    if (!promise) {
      promise = fetch(urlFor(`/api/onboarding/${key}`))
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (Array.isArray(data?.[key]) ? data[key] : []))
        .catch(() => {
          promise = null;
          return [];
        });
    }
    return promise;
  };
}

// -> [{ country_id, country_name_en, country_code }] ordered by name
export const fetchCountries = cachedListFetch('countries');

// -> [{ currency_id, currency_name, iso_code }] ordered by name
export const fetchCurrencies = cachedListFetch('currencies');
