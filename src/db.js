import Database from 'better-sqlite3';

const db = new Database('activebot.sqlite');

// Guild settings: threshold, role, timezone, week start
db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  role_id TEXT,
  threshold INTEGER NOT NULL DEFAULT 10,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  week_start TEXT NOT NULL DEFAULT 'MON' -- MON or SUN
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS weekly_counts (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  week_start_iso TEXT NOT NULL, -- e.g. 2025-08-11
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, week_start_iso)
);
`);

export const getSettings = db.prepare(`
  SELECT role_id, threshold, timezone, week_start FROM guild_settings WHERE guild_id = ?
`);

export const upsertSettings = db.prepare(`
  INSERT INTO guild_settings (guild_id, role_id, threshold, timezone, week_start)
  VALUES (@guild_id, @role_id, @threshold, @timezone, @week_start)
  ON CONFLICT(guild_id) DO UPDATE SET
    role_id=excluded.role_id,
    threshold=excluded.threshold,
    timezone=excluded.timezone,
    week_start=excluded.week_start
`);

export const ensureSettings = (guild_id) => {
  const row = getSettings.get(guild_id);
  if (!row) {
    upsertSettings.run({
      guild_id,
      role_id: null,
      threshold: 10,
      timezone: 'America/Los_Angeles',
      week_start: 'MON'
    });
  }
};

export const incCount = db.prepare(`
  INSERT INTO weekly_counts (guild_id, user_id, week_start_iso, count)
  VALUES (@guild_id, @user_id, @week_start_iso, 1)
  ON CONFLICT (guild_id, user_id, week_start_iso)
  DO UPDATE SET count = count + 1
`);

export const getWeekCounts = db.prepare(`
  SELECT user_id, count FROM weekly_counts
  WHERE guild_id = ? AND week_start_iso = ?
`);

export const getTopThisWeek = db.prepare(`
  SELECT user_id, count FROM weekly_counts
  WHERE guild_id = ? AND week_start_iso = ?
  ORDER BY count DESC
  LIMIT 10
`);

export const getAllGuilds = db.prepare(`SELECT guild_id FROM guild_settings`);

export default db;
