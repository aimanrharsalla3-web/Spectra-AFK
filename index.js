import discord
from discord.ext import commands, tasks
from discord import app_commands
import json
import os
import time
import re
from datetime import timedelta

# ===== TOKEN =====
# Pon tu token en variable de entorno: TOKEN
TOKEN = os.getenv("TOKEN")

# ===== INTENTS =====
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.guilds = True
intents.voice_states = True

bot = commands.Bot(command_prefix="!", intents=intents)

# ===== BASE DE DATOS =====
if os.path.exists("data.json"):
    with open("data.json", "r") as f:
        data = json.load(f)
else:
    data = {}

def save_data():
    with open("data.json", "w") as f:
        json.dump(data, f, indent=4)

# ===== CONFIG ANTI LINKS =====
link_regex = re.compile(r"(https?:\/\/|www\.|discord\.gg)", re.IGNORECASE)

# ===== MAPAS PARA DEFENSA =====
spam_map = {}
join_map = {}
channel_map = {}

# ===== AFK / LLAMADA =====
afk_channel_id = int(os.getenv("AFK_CHANNEL_ID", 0))  # pon el ID del canal de voz
afk_member = None
afk_start = None

@bot.event
async def on_ready():
    global afk_member, afk_start
    print(f"Bot conectado como {bot.user}")
    # Intentar unirse al canal AFK
    guilds = bot.guilds
    if afk_channel_id != 0:
        for g in guilds:
            channel = g.get_channel(afk_channel_id)
            if channel:
                afk_member = await channel.connect()
                afk_start = time.time()
                print(f"Conectado al canal AFK: {channel.name}")
    await bot.tree.sync()
    print("Slash commands sincronizados.")

# ===== MENSAJES =====
@bot.event
async def on_message(message):
    if message.author.bot or not message.guild:
        return

    # Ignorar admins
    if message.author.guild_permissions.administrator:
        await bot.process_commands(message)
        return

    user_id = message.author.id
    guild_id = str(message.guild.id)
    now = time.time()

    # ===== ANTI SPAM =====
    if user_id not in spam_map:
        spam_map[user_id] = []
    spam_map[user_id].append(now)
    spam_map[user_id] = [t for t in spam_map[user_id] if now - t < 5]

    if len(spam_map[user_id]) >= 6:
        await message.author.timeout(discord.utils.utcnow() + timedelta(seconds=10))
        await message.channel.send(f"⚠️ {message.author.mention} spam detectado.")
        log(message.guild, f"Spam detectado: {message.author}")
        spam_map[user_id] = []

    # ===== ANTI MASS MENTION =====
    if len(message.mentions) >= 5:
        await message.reply("⚠️ No menciones a tantas personas.")

    # ===== ANTI LINKS =====
    if link_regex.search(message.content):
        whitelist = data.get(guild_id, {}).get("whitelist", [])
        if not any(domain in message.content for domain in whitelist):
            await message.delete()
            warn_msg = await message.channel.send(
                f"🚫 {message.author.mention} no se permiten enlaces."
            )
            log(message.guild, f"Link eliminado de {message.author}: {message.content}")
            await message.author.timeout(discord.utils.utcnow() + timedelta(seconds=5))
            await warn_msg.delete(delay=5)

    await bot.process_commands(message)

# ===== ANTI RAID =====
@bot.event
async def on_member_join(member):
    guild_id = str(member.guild.id)
    now = time.time()

    if guild_id not in join_map:
        join_map[guild_id] = []
    join_map[guild_id].append(now)
    join_map[guild_id] = [t for t in join_map[guild_id] if now - t < 10]

    if len(join_map[guild_id]) >= 5:
        if member.guild.system_channel:
            await member.guild.system_channel.send("🚨 Posible RAID detectado.")
        log(member.guild, "🚨 Posible RAID detectado.")

    # AUTOROLE
    if guild_id in data and "autorole" in data[guild_id]:
        role = member.guild.get_role(data[guild_id]["autorole"])
        if role:
            await member.add_roles(role)

# ===== ANTI NUKE =====
@bot.event
async def on_guild_channel_create(channel):
    await handle_channel(channel.guild)
@bot.event
async def on_guild_channel_delete(channel):
    await handle_channel(channel.guild)

async def handle_channel(guild):
    guild_id = str(guild.id)
    now = time.time()
    if guild_id not in channel_map:
        channel_map[guild_id] = []
    channel_map[guild_id].append(now)
    channel_map[guild_id] = [t for t in channel_map[guild_id] if now - t < 10]
    if len(channel_map[guild_id]) >= 5:
        if guild.system_channel:
            await guild.system_channel.send("🚨 Posible NUKE detectado.")
        log(guild, "🚨 Posible NUKE detectado.")

# ===== LOGS =====
def log(guild, mensaje):
    guild_id = str(guild.id)
    if guild_id in data and "logs" in data[guild_id]:
        channel = guild.get_channel(data[guild_id]["logs"])
        if channel:
            bot.loop.create_task(channel.send(f"📜 {mensaje}"))

# ===== SLASH COMMANDS =====
@bot.tree.command(name="announce", description="Anunciar en un canal")
@app_commands.checks.has_permissions(administrator=True)
async def announce(interaction: discord.Interaction, canal: discord.TextChannel, mensaje: str):
    await canal.send(f"📢 **ANUNCIO**\n{mensaje}")
    await interaction.response.send_message("✅ Anuncio enviado.", ephemeral=True)

@bot.tree.command(name="setlogs", description="Configurar canal de logs")
@app_commands.checks.has_permissions(administrator=True)
async def setlogs(interaction: discord.Interaction, canal: discord.TextChannel):
    guild_id = str(interaction.guild.id)
    if guild_id not in data:
        data[guild_id] = {}
    data[guild_id]["logs"] = canal.id
    save_data()
    await interaction.response.send_message("✅ Canal de logs configurado.", ephemeral=True)

@bot.tree.command(name="autorole", description="Configurar autorole")
@app_commands.checks.has_permissions(administrator=True)
async def autorole(interaction: discord.Interaction, rol: discord.Role, accion: str):
    guild_id = str(interaction.guild.id)
    if guild_id not in data:
        data[guild_id] = {}
    if accion.lower() == "add":
        data[guild_id]["autorole"] = rol.id
    else:
        data[guild_id].pop("autorole", None)
    save_data()
    await interaction.response.send_message("✅ Configuración actualizada.", ephemeral=True)

@bot.tree.command(name="whitelist", description="Permitir dominio en anti links")
@app_commands.checks.has_permissions(administrator=True)
async def whitelist(interaction: discord.Interaction, dominio: str):
    guild_id = str(interaction.guild.id)
    if guild_id not in data:
        data[guild_id] = {}
    if "whitelist" not in data[guild_id]:
        data[guild_id]["whitelist"] = []
    data[guild_id]["whitelist"].append(dominio.lower())
    save_data()
    await interaction.response.send_message(f"✅ Dominio permitido: {dominio}", ephemeral=True)

# ===== TASK PARA CONTAR TIEMPO AFK =====
@tasks.loop(seconds=5)
async def afk_timer():
    global afk_start
    if afk_start:
        elapsed = int(time.time() - afk_start)
        # Aquí puedes usar el tiempo para mostrarlo en algún embed o logs si quieres
        # print(f"Tiempo AFK: {elapsed} segundos")
afk_timer.start()

bot.run(TOKEN)
