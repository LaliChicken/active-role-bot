import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('active-setup')
    .setDescription('Configure the Active role settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(opt => opt.setName('role').setDescription('Role to assign to active members').setRequired(true))
    .addIntegerOption(opt => opt.setName('threshold').setDescription('Messages per week (default 10)').setMinValue(1))
    .addStringOption(opt => opt.setName('timezone').setDescription('IANA timezone, e.g. America/Los_Angeles'))
    .addStringOption(opt => opt.setName('week_start').setDescription('Start of week: MON or SUN')),
  new SlashCommandBuilder()
    .setName('active-status')
    .setDescription('Show current config and this week’s progress.'),
  new SlashCommandBuilder()
    .setName('active-leaderboard')
    .setDescription('Top 10 message counts for the current week.')
].map(c => c.toJSON());
