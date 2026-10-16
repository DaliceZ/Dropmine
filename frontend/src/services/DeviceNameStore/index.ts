const storageKey = "dropmine.device-name";

export function normalizeDeviceName(name: string) {
  return name
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 40);
}

export function loadDeviceName() {
  try {
    const name = normalizeDeviceName(localStorage.getItem(storageKey) || "");
    return name || null;
  } catch {
    return null;
  }
}

export function saveDeviceName(name: string) {
  const normalized = normalizeDeviceName(name);
  if (!normalized) return false;
  try {
    localStorage.setItem(storageKey, normalized);
    return true;
  } catch {
    return false;
  }
}
