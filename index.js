const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const express = require('express');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

let connection;
let startTime = null;
let timerInterval = null;
const DATA_FILE = './data.json';

// --- MINI WEB PARA RAILWAY
const app = express();
app.get('/', (req, res) => res.send('Bot activo 24/7 🔥'));
app.listen(process.env.PORT || 3000, () => console.log('Web activa'));

// --- FUNCIONES AUXILIARES
function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ totalMilliseconds: 0 }));
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- FUNCION CONECTAR A VOZ
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

  startTime = Date.now();

  // Limpiar intervalos previos
  if (timerInterval) clearInterval(timerInterval);

  // Contador segundo a segundo
  timerInterval = setInterval(() => {
    const diff = Date.now() - startTime;

    // Actualizar nickname con el tiempo de la sesión actual
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    const guildMe = guild.members.me;
    guildMe.setNickname(`AFK | ${hours}h ${minutes}m ${seconds}s`).catch(() => {});

    // Actualizar tiempo acumulado en data.json
    const data = loadData();
    data.totalMilliseconds = diff; // Esto suma solo la sesión actual
    saveData(data);
  }, 1000);

  console.log("Conectado y contador iniciado 🔥");

  // Reconexión automática si se desconecta
  connection.on('stateChange', async (_, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await entersState(connection, VoiceConnectionStatus.Connecting, 5000);
      } catch {
        console.log("Reconectando...");
        connectToVoice();
      }
    }
  });
}

// --- DETECTAR SI LO SACAN DEL CANAL
client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.id === client.user.id && !newState.channelId) {
    console.log("Me sacaron, volviendo...");
    setTimeout(connectToVoice, 2000);
  }
});

// --- COMANDOS SLASH
client.once('ready', async () => {
  console.log(`Bot listo como ${client.user.tag}`);
  connectToVoice();

  // Registrar comando /time all
  const commands = [
    new SlashCommandBuilder().setName('time').setDescription('Ver tiempo total en voz')
      .addStringOption(option => option.setName('all').setDescription('Ver todo el tiempo').setRequired(true))
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Comando /time registrado');
  } catch (error) { console.error(error); }
});

// --- EJECUTAR COMANDO /time
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'time') {
    const option = interaction.options.getString('all');

    if (option !== 'all') return interaction.reply('Debes usar `/time all`');

    // Leer tiempo acumulado
    const data = loadData();
    const totalMs = data.totalMilliseconds + (startTime ? (Date.now() - startTime) : 0);

    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);

    interaction.reply(`🕒 Tiempo total en voz: **${hours}h ${minutes}m ${seconds}s**`);
  }
});

// --- ANTI CRASH
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);
