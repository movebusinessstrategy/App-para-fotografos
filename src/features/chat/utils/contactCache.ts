interface CachedContact {
  phone: string;
  name?: string;
  avatar?: string;
  updatedAt: number;
}

const CACHE_KEY = 'wa_contact_cache_v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function loadCache(): Record<string, CachedContact> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCache(cache: Record<string, CachedContact>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function getCachedContact(phone: string): CachedContact | null {
  if (!phone) return null;
  const cache = loadCache();
  const entry = cache[phone];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > CACHE_TTL) {
    delete cache[phone];
    saveCache(cache);
    return null;
  }
  return entry;
}

export function updateCachedContact(phone: string, data: Partial<CachedContact>) {
  if (!phone) return;
  const cache = loadCache();
  const existing = cache[phone] || { phone, updatedAt: 0 };
  cache[phone] = {
    ...existing,
    phone,
    name: (data.name && data.name.trim()) ? data.name : existing.name,
    avatar: data.avatar || existing.avatar,
    updatedAt: Date.now(),
  };
  saveCache(cache);
}

export function clearContactCache() {
  localStorage.removeItem(CACHE_KEY);
}
