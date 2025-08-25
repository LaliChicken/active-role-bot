import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } from 'discord.js';
import cron from 'node-cron';
import { DateTime } from 'luxon';
import db, {
  ensureSettings, getSettings, upsertSettings,
  incCount, getWeekCounts, getTopThisWeek, getAllGuilds
} from './db.js';
import { currentWeekStartISO, previousWeekStartISO, weeklyCronExpr } from './time.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,        // needed to add/remove roles
    GatewayIntentBits.GuildMessages,       // to receive messageCreate
    GatewayIntentBits.MessageContent       // privileged intent, enable in portal
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  // Ensure defaults for all joined guilds
  for (const [id] of c.guilds.cache) {
    ensureSettings(id);
  }

  // Schedule one cron per distinct (week_start, timezone) combo used by guilds,
  // to run the weekly evaluation just after rollover.
  const combos = new Map(); // key: `${week_start}|${tz}` -> [guildIds]
  for (const row of getAllGuilds.all()) {
    const g = client.guilds.cache.get(row.guild_id);
    if (!g) continue;
    const s = getSettings.get(row.guild_id) || {};
    const weekStart = (s.week_start || 'MON').toUpperCase();
    const tz = s.timezone || process.env.DEFAULT_TZ || 'UTC';
    const key = `${weekStart}|${tz}`;
    if (!combos.has(key)) combos.set(key, []);
    combos.get(key).push(row.guild_id);
  }

  for (const [key, guildIds] of combos.entries()) {
    const [weekStart, tz] = key.split('|');
    const { expr, tz: cronTz } = weeklyCronExpr(weekStart, tz);
    cron.schedule(expr, async () => {
      for (const guildId of guildIds) {
        await evaluateAndAssign(guildId).catch(console.error);
      }
    }, { timezone: cronTz });
    console.log(`Scheduled weekly job for ${key} with cron "${expr}" tz=${cronTz}`);
  }
});

// Count messages per-user per-week (ignoring bots, DMs)
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    ensureSettings(msg.guild.id);
    const s = getSettings.get(msg.guild.id);
    const tz = s.timezone || process.env.DEFAULT_TZ || 'UTC';
    const weekStart = (s.week_start || 'MON').toUpperCase();
    const weekStartIso = currentWeekStartISO(tz, weekStart);
    incCount.run({
      guild_id: msg.guild.id,
      user_id: msg.author.id,
      week_start_iso: weekStartIso
    });
  } catch (e) {
    console.error('messageCreate error', e);
  }
});

// Slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'active-setup') {
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ content: 'You need **Manage Server** permission.', ephemeral: true });
    }
    const role = interaction.options.getRole('role', true);
    const threshold = interaction.options.getInteger('threshold') ?? 10;
    const timezone = interaction.options.getString('timezone') ?? process.env.DEFAULT_TZ ?? 'America/Los_Angeles';
    const week_start_in = (interaction.options.getString('week_start') || 'MON').toUpperCase();
    const weekStart = (week_start_in === 'SUN') ? 'SUN' : 'MON';

    upsertSettings.run({
      guild_id: interaction.guildId,
      role_id: role.id,
      threshold,
      timezone,
      week_start: weekStart
    });

    const nextRun = humanNextRun(timezone, weekStart);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Active Role Configured')
          .setDescription(`**Role:** <@&${role.id}>\n**Threshold:** ${threshold} msgs/week\n**Timezone:** \`${timezone}\`\n**Week starts:** \`${weekStart}\`\n**Next evaluation:** \`${nextRun}\``)
          .setColor(0x57F287)
      ],
      ephemeral: true
    });
  }

  if (interaction.commandName === 'active-status') {
    ensureSettings(interaction.guildId);
    const s = getSettings.get(interaction.guildId);
    const tz = s?.timezone || process.env.DEFAULT_TZ || 'America/Los_Angeles';
    const weekStart = (s?.week_start || 'MON').toUpperCase();
    const weekStartIso = currentWeekStartISO(tz, weekStart);
    const top = getTopThisWeek.all(interaction.guildId, weekStartIso);

    const lb = top.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${r.count}`).join('\n') || '_No messages yet this week_';
    const nextRun = humanNextRun(tz, weekStart);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Active Role Status')
          .setDescription(`**Role:** ${s?.role_id ? `<@&${s.role_id}>` : '_not set_'}\n**Threshold:** ${s?.threshold ?? 10}\n**Timezone:** \`${tz}\`\n**Week starts:** \`${weekStart}\`\n**Current week (from ${weekStartIso}):**\n${lb}\n\n**Next evaluation:** \`${nextRun}\``)
          .setColor(0x5865F2)
      ],
      ephemeral: true
    });
  }

  if (interaction.commandName === 'active-leaderboard') {
    ensureSettings(interaction.guildId);
    const s = getSettings.get(interaction.guildId);
    const tz = s?.timezone || process.env.DEFAULT_TZ || 'America/Los_Angeles';
    const weekStart = (s?.week_start || 'MON').toUpperCase();
    const weekStartIso = currentWeekStartISO(tz, weekStart);
    const top = getTopThisWeek.all(interaction.guildId, weekStartIso);
    const lb = top.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${r.count}`).join('\n') || '_No messages yet this week_';

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏆 This Week’s Top Chatters')
          .setDescription(lb)
          .setColor(0xF1C40F)
      ]
    });
  }
});

async function evaluateAndAssign(guildId) {
  const s = getSettings.get(guildId);
  if (!s?.role_id) return; // not configured
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const tz = s.timezone || process.env.DEFAULT_TZ || 'UTC';
  const weekStart = (s.week_start || 'MON').toUpperCase();
  const prevISO = previousWeekStartISO(tz, weekStart);

  const counts = getWeekCounts.all(guildId, prevISO);
  const winners = new Set(counts.filter(r => r.count >= s.threshold).map(r => r.user_id));

  // Fetch role
  const role = await guild.roles.fetch(s.role_id).catch(() => null);
  if (!role) return;

  // Fetch all members who currently have the role (to remove if needed)
  const currentWithRole = await guild.members.fetch().then(members => members.filter(m => m.roles.cache.has(role.id)));

  // Assign to winners
  for (const userId of winners) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Active: >=${s.threshold} msgs for week starting ${prevISO}`).catch(() => {});
    }
  }

  // Remove from those who didn’t meet threshold
  for (const [, member] of currentWithRole) {
    if (!winners.has(member.id)) {
      await member.roles.remove(role, `Inactive: <${s.threshold} msgs for week starting ${prevISO}`).catch(() => {});
    }
  }

  // Optional: announce in system channel if exists
  const sys = guild.systemChannel;
  if (sys) {
    const names = [...winners].slice(0, 20).map(id => `<@${id}>`).join(', ');
    await sys.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('Weekly Active Role Update')
          .setDescription(
            winners.size
              ? `Gave **${role}** to: ${names}${winners.size > 20 ? ' …' : ''}\nRemoved it from others who didn’t meet the threshold.`
              : `No one met the threshold this past week. Removed **${role}** from everyone who had it.`
          )
          .setFooter({ text: `Week starting ${prevISO} • Threshold ${s.threshold}` })
          .setColor(0x57F287)
      ]
    }).catch(() => {});
  }

  console.log(`[${guild.name}] Weekly evaluation done for ${prevISO}: winners=${winners.size}`);
}

function humanNextRun(tz, weekStart) {
  // Next MON or SUN at 00:05 local tz
  const now = DateTime.now().setZone(tz || 'UTC');
  const targetDow = (weekStart === 'SUN') ? 7 : 1; // Luxon: 1=Mon..7=Sun
  let next = now.set({ hour: 0, minute: 5, second: 0, millisecond: 0 });
  while (next.weekday !== targetDow || next <= now) {
    next = next.plus({ days: 1 });
  }
  return next.toFormat("EEE, MMM d yyyy HH:mm ZZZZ");
}

client.login(process.env.DISCORD_TOKEN);
