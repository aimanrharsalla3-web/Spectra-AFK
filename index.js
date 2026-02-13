// index.js
const { Client, GatewayIntentBits, Partials, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel]
});

// ===== BASE DE DATOS =====
let data = {};
if (fs.existsSync('data.json')) {
    data = JSON.parse(fs.readFileSync('data.json'));
}

function saveData() {
    fs.writeFileSync('data.json', JSON.stringify(data, null, 4));
}

// ===== VARIABLES AFK =====
let afkChannelId = process.env.AFK_CHANNEL_ID; // ID del canal de voz para AFK
let afkConnection = null;
let afkStart = null;

// ===== MAPAS DEFENSA =====
const spamMap = new Map();
const joinMap = new Map();
const channelMap = new Map();
const linkRegex = /(https?:\/\/|www\.|discord\.gg)/i;

// ===== FUNCIONES =====
function log(guild, message) {
    if (data[guild.id] && data[guild.id].logs) {
        const channel = guild.channels.cache.get(data[guild.id].logs);
        if (channel) channel.send(`📜 ${message}`);
    }
}

// ===== AFK VOICE =====
async function joinAFK() {
    if (!afkChannelId) return;
    for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.get(afkChannelId);
        if (channel && channel.isVoiceBased()) {
            try {
                afkConnection = await channel.join();
                afkStart = Date.now();
                console.log(`Conectado al canal AFK: ${channel.name}`);
            } catch (err) {
                console.log('Error al unirse al canal AFK:', err);
            }
        }
    }
}

// ===== EVENTOS =====
client.on('ready', async () => {
    console.log(`Bot AFK listo como ${client.user.tag}`);
    await joinAFK();

    // Registrar comandos slash
    const commands = [
        {
            name: 'announce',
            description: 'Anunciar en un canal',
            options: [
                { name: 'canal', type: 7, description: 'Canal donde enviar el anuncio', required: true },
                { name: 'mensaje', type: 3, description: 'Mensaje del anuncio', required: true }
            ]
        },
        {
            name: 'setlogs',
            description: 'Configurar canal de logs',
            options: [
                { name: 'canal', type: 7, description: 'Canal de logs', required: true }
            ]
        },
        {
            name: 'autorole',
            description: 'Configurar autorole',
            options: [
                { name: 'rol', type: 8, description: 'Rol a asignar', required: true },
                { name: 'accion', type: 3, description: 'add o remove', required: true }
            ]
        },
        {
            name: 'whitelist',
            description: 'Permitir dominio en anti-links',
            options: [
                { name: 'dominio', type: 3, description: 'Dominio permitido', required: true }
            ]
        }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('Registrando comandos slash...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Comandos slash listos.');
    } catch (err) {
        console.log('Error al registrar comandos:', err);
    }
});

// ===== ON MESSAGE =====
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // Ignorar administradores
    if (message.member.permissions.has('Administrator')) return;

    const guildId = message.guild.id;
    const userId = message.author.id;
    const now = Date.now();

    // --- ANTI SPAM ---
    if (!spamMap.has(userId)) spamMap.set(userId, []);
    let userTimes = spamMap.get(userId).filter(t => now - t < 5000);
    userTimes.push(now);
    spamMap.set(userId, userTimes);
    if (userTimes.length >= 6) {
        message.member.timeout(10000, 'Spam detectado').catch(() => {});
        message.channel.send(`⚠️ ${message.author} spam detectado.`);
        log(message.guild, `Spam detectado: ${message.author.tag}`);
        spamMap.set(userId, []);
    }

    // --- ANTI MASS MENTION ---
    if (message.mentions.members.size >= 5) {
        message.reply('⚠️ No menciones a tantas personas.');
    }

    // --- ANTI LINKS ---
    if (linkRegex.test(message.content)) {
        let whitelist = (data[guildId] && data[guildId].whitelist) || [];
        if (!whitelist.some(d => message.content.includes(d))) {
            message.delete().catch(() => {});
            const warnMsg = await message.channel.send(`🚫 ${message.author} no se permiten enlaces.`);
            log(message.guild, `Link eliminado de ${message.author.tag}: ${message.content}`);
            message.member.timeout(5000).catch(() => {});
            setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        }
    }
});

// ===== ANTI RAID / AUTOROLE =====
client.on('guildMemberAdd', member => {
    const guildId = member.guild.id;
    const now = Date.now();

    if (!joinMap.has(guildId)) joinMap.set(guildId, []);
    let times = joinMap.get(guildId).filter(t => now - t < 10000);
    times.push(now);
    joinMap.set(guildId, times);

    if (times.length >= 5) {
        if (member.guild.systemChannel) member.guild.systemChannel.send('🚨 Posible RAID detectado.');
        log(member.guild, '🚨 Posible RAID detectado.');
    }

    // --- AUTOROLE ---
    if (data[guildId] && data[guildId].autorole) {
        const role = member.guild.roles.cache.get(data[guildId].autorole);
        if (role) member.roles.add(role).catch(() => {});
    }
});

// ===== ANTI NUKE =====
client.on('channelCreate', channel => handleChannel(channel.guild));
client.on('channelDelete', channel => handleChannel(channel.guild));
function handleChannel(guild) {
    const guildId = guild.id;
    const now = Date.now();

    if (!channelMap.has(guildId)) channelMap.set(guildId, []);
    let times = channelMap.get(guildId).filter(t => now - t < 10000);
    times.push(now);
    channelMap.set(guildId, times);

    if (times.length >= 5) {
        if (guild.systemChannel) guild.systemChannel.send('🚨 Posible NUKE detectado.');
        log(guild, '🚨 Posible NUKE detectado.');
    }
}

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;

    if (interaction.commandName === 'announce') {
        const canal = interaction.options.getChannel('canal');
        const mensaje = interaction.options.getString('mensaje');
        canal.send(`📢 **ANUNCIO**\n${mensaje}`);
        interaction.reply({ content: '✅ Anuncio enviado.', ephemeral: true });
    }

    if (interaction.commandName === 'setlogs') {
        const canal = interaction.options.getChannel('canal');
        if (!data[guildId]) data[guildId] = {};
        data[guildId].logs = canal.id;
        saveData();
        interaction.reply({ content: '✅ Canal de logs configurado.', ephemeral: true });
    }

    if (interaction.commandName === 'autorole') {
        const rol = interaction.options.getRole('rol');
        const accion = interaction.options.getString('accion');
        if (!data[guildId]) data[guildId] = {};
        if (accion.toLowerCase() === 'add') data[guildId].autorole = rol.id;
        else delete data[guildId].autorole;
        saveData();
        interaction.reply({ content: '✅ Configuración de autorole actualizada.', ephemeral: true });
    }

    if (interaction.commandName === 'whitelist') {
        const dominio = interaction.options.getString('dominio').toLowerCase();
        if (!data[guildId]) data[guildId] = {};
        if (!data[guildId].whitelist) data[guildId].whitelist = [];
        data[guildId].whitelist.push(dominio);
        saveData();
        interaction.reply({ content: `✅ Dominio permitido: ${dominio}`, ephemeral: true });
    }
});

// ===== TASK PARA AFK TIMER =====
setInterval(() => {
    if (afkStart) {
        const elapsed = Math.floor((Date.now() - afkStart) / 1000);
        // console.log(`Tiempo AFK: ${elapsed}s`);
    }
}, 5000);

// ===== LOGIN =====
client.login(process.env.TOKEN);
