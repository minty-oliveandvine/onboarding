// Country / currency reference data from the Module 1 backend registries
// (pettycashv2.country_info / currency_info). Rows carry the uuid PKs the
// entities table references — dropdowns show the names but submit the uuids.
// Fetches are cached module-wide so Step 1 and the amount-prefix display
// share one request; a failed fetch clears the cache so the next call retries.

const base = () =>
  (process.env.NEXT_PUBLIC_MODULE1_API_URL || 'http://localhost:5001').replace(/\/$/, '');

let countriesPromise = null;
let currenciesPromise = null;

// -> [{ country_id, country_name_en, country_code }] ordered by name
export function fetchCountries() {
  if (!countriesPromise) {
    countriesPromise = fetch(`${base()}/api/onboarding/countries`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (Array.isArray(data?.countries) ? data.countries : []))
      .catch(() => {
        countriesPromise = null;
        return [];
      });
  }
  return countriesPromise;
}

// -> [{ currency_id, currency_name, iso_code }] ordered by name
export function fetchCurrencies() {
  if (!currenciesPromise) {
    currenciesPromise = fetch(`${base()}/api/onboarding/currencies`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (Array.isArray(data?.currencies) ? data.currencies : []))
      .catch(() => {
        currenciesPromise = null;
        return [];
      });
  }
  return currenciesPromise;
}
