const { Client, GatewayIntentBits } = require('discord.js');
const { 
  joinVoiceChannel, 
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const express = require('express');

/* =========================
   VARIABLES
========================= */

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

/* =========================
   CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

let connection;

/* =========================
   MINI WEB PARA RAILWAY
========================= */

const app = express();
app.get('/', (req, res) => {
  res.send('Bot activo 24/7 🔥');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Web activa en puerto " + PORT);
});

/* =========================
   FUNCIÓN PARA CONECTAR
========================= */

function connectToVoice() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return console.log("Servidor no encontrado");

  const channel = guild.channels.cache.get(CHANNEL_ID);
  if (!channel) return console.log("Canal no encontrado");

  connection = joinVoiceChannel({
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfMute: true,
    selfDeaf: false
  });

  connection.on('stateChange', async (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
      } catch {
        console.log("Reconectando...");
        connectToVoice();
      }
    }
  });

  console.log("Conectado al canal 🔊");
}

/* =========================
   READY
========================= */

client.once('ready', () => {
  console.log(`Bot listo como ${client.user.tag}`);
  connectToVoice();
});

/* =========================
   SI LO SACAN, VUELVE
========================= */

client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.id === client.user.id && !newState.channelId) {
    console.log("Me sacaron, volviendo...");
    setTimeout(() => {
      connectToVoice();
    }, 2000);
  }
});

/* =========================
   ANTI CRASH
========================= */

process.on('unhandledRejection', error => {
  console.error(error);
});

process.on('uncaughtException', error => {
  console.error(error);
});

client.login(TOKEN);
