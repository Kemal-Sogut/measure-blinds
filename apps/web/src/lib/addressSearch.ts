// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Address search / geocoding helper backed by Photon
 * (https://photon.komoot.io) — a free, key-less OpenStreetMap
 * geocoder. Powers the search-as-you-type address autocomplete on the
 * customer forms (`AddressAutocomplete`), turning a free-text query
 * into structured, form-ready fields (line 1, city, province code,
 * postal code) so the consultant does not retype the whole address.
 *
 * Why Photon: it needs no API key and no billing (unlike Google
 * Places), which keeps the frontend free of secrets per the project's
 * security invariants — this is a public geocoding endpoint hit
 * directly from the browser, NOT a data call through the Worker API.
 *
 * Results are biased toward southern Ontario (the business's service
 * area) and filtered to Canadian addresses, since every customer is
 * Canadian. Photon's rich hierarchy (housenumber/street/city/state/
 * postcode) is normalised here so callers stay ignorant of the raw
 * GeoJSON shape.
 */

/** Raw GeoJSON feature shape returned by the Photon `/api` endpoint. */
interface PhotonFeature {
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    locality?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_id?: number;
    osm_type?: string;
  };
}

/**
 * A normalised, form-ready address suggestion. `label` is the human
 * string shown in the dropdown; the remaining fields map 1:1 onto the
 * customer form's shipping/billing inputs.
 */
export interface AddressSuggestion {
  /** Stable key for React lists (OSM type+id, falling back to label). */
  id: string;
  /** One-line human label for the dropdown, e.g. "12 King St W, Toronto, ON". */
  label: string;
  /** Street address (house number + street), for Address Line 1. */
  line1: string;
  /** City / town / locality name. */
  city: string;
  /** Two-letter province/territory code (e.g. "ON"), '' when unknown. */
  province: string;
  /** Postal code as returned by OSM (may be '' — not all rows carry one). */
  postal_code: string;
}

/** Canadian province / territory full-name → official two-letter code. */
const PROVINCE_CODES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'nova scotia': 'NS',
  'northwest territories': 'NT',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  'québec': 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
};

/** Maps a Photon `state` string to a two-letter code (passthrough if already a code). */
function provinceCode(state: string | undefined): string {
  if (!state) return '';
  const trimmed = state.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return PROVINCE_CODES[trimmed.toLowerCase()] ?? '';
}

/** Normalises one Photon feature into a form-ready {@link AddressSuggestion}. */
function toSuggestion(f: PhotonFeature): AddressSuggestion {
  const p = f.properties;
  const line1 = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || '';
  const city = p.city || p.locality || p.district || p.county || '';
  const province = provinceCode(p.state);
  const postal_code = p.postcode ?? '';
  const label = [line1, city, province].filter(Boolean).join(', ') || p.name || 'Unknown address';
  const id = p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : label;
  return { id, label, line1, city, province, postal_code };
}

/** Photon endpoint, biased toward southern Ontario (business service area). */
const PHOTON_URL = 'https://photon.komoot.io/api';
const BIAS_LAT = 43.7;
const BIAS_LON = -79.4;

/**
 * Queries Photon for address suggestions matching `query`, returning
 * normalised, Canada-only results (max ~6). Returns an empty array for
 * short/empty queries or on any network/parse error — autocomplete is
 * a convenience, never a hard dependency, so failures degrade to plain
 * manual entry rather than surfacing an error.
 *
 * @param query  Raw text the user has typed into the address field.
 * @param signal Optional AbortSignal so stale in-flight requests can be cancelled.
 */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    q,
    lang: 'en',
    limit: '8',
    lat: String(BIAS_LAT),
    lon: String(BIAS_LON),
  });

  try {
    const res = await fetch(`${PHOTON_URL}/?${params}`, { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const features = body.features ?? [];
    return features
      .filter((f) => (f.properties.countrycode ?? '').toUpperCase() === 'CA')
      .map(toSuggestion)
      // Keep only rows with a usable street line, de-duplicated by label.
      .filter((s, i, arr) => s.line1 && arr.findIndex((o) => o.label === s.label) === i)
      .slice(0, 6);
  } catch {
    // Aborted or offline — degrade silently to manual entry.
    return [];
  }
}
