import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './command.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering application (global) commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Done (it can take a minute to propagate globally)');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
