export function initUpgradeLimit(maxAttempts = 120, maxGroups = 2048) {
  const groups = new Map<string, { attempts: number; expires: number }>();
  return {
    allow(group: string, now = Date.now()) {
      const current = groups.get(group);
      if (current && current.expires > now) return ++current.attempts <= maxAttempts;
      if (!current && groups.size >= maxGroups) return false;
      groups.set(group, { attempts: 1, expires: now + 60_000 });
      return true;
    },
    expire(now = Date.now()) {
      for (const [group, limit] of groups) if (limit.expires <= now) groups.delete(group);
    },
  };
}
