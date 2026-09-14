import { urlFor } from './apiRoutes';

// Country / currency reference data from the Module 1 backend registries
// (pettycashv2.country_info / currency_info). Rows carry the uuid PKs the
// entities table references — dropdowns show the names but submit the uuids.
// Fetches are cached module-wide so Step 1 and the amount-prefix display
// share one request; a failed fetch clears the cache so the next call retries.
//
// Routed through `urlFor` rather than reading the env var here: which service
// answers a path is one decision, and it lives in lib/apiRoutes.

export type CountryRow = { country_id: string; country_name_en: string; country_code: string };
export type CurrencyRow = { currency_id: string; currency_name: string; iso_code: string };

// Build a module-wide cached fetcher for one `/api/onboarding/<key>` registry.
// Each fetcher closes over its own promise slot, so the two lists cache
// independently — one failing does not evict or retry the other.
//
// Generic over the row: the response is keyed by the SAME name as the path segment
// (`{ countries: [...] }` for `/countries`), which is why `data?.[key]` is read.
function cachedListFetch<Row>(key: string): () => Promise<Row[]> {
  let promise: Promise<Row[]> | null = null;
  return function fetchList() {
    if (!promise) {
      promise = fetch(urlFor(`/api/onboarding/${key}`))
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Record<string, unknown> | null) =>
          Array.isArray(data?.[key]) ? (data[key] as Row[]) : [],
        )
        .catch(() => {
          promise = null;
          return [];
        });
    }
    return promise;
  };
}

// -> [{ country_id, country_name_en, country_code }] ordered by name
export const fetchCountries = cachedListFetch<CountryRow>('countries');

// -> [{ currency_id, currency_name, iso_code }] ordered by name
export const fetchCurrencies = cachedListFetch<CurrencyRow>('currencies');
