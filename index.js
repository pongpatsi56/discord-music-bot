import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  generateDependencyReport,
} from "@discordjs/voice";
import { execa } from "execa";
import { PassThrough } from "stream";
import ytSearch from "yt-search";
import dotenv from "dotenv";

console.log(generateDependencyReport());

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = new Map();

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.split(" ");
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  if (command === "!play") {
    const query = args.join(" ");
    if (!query) return message.reply("❌ กรุณาใส่ชื่อเพลงหรือ URL");

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("❌ เข้าห้องเสียงก่อน!");

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    if (!serverQueue) {
      const player = createAudioPlayer();
      const queueConstruct = {
        voiceChannel,
        connection,
        player,
        songs: [],
        playing: true,
      };

      queue.set(message.guild.id, queueConstruct);
      queueConstruct.songs.push(query);
      await playSong(message.guild, queueConstruct.songs[0]);

      player.on(AudioPlayerStatus.Idle, () => {
        queueConstruct.songs.shift();
        if (queueConstruct.songs.length > 0) {
          playSong(message.guild, queueConstruct.songs[0]);
        } else {
          queue.delete(message.guild.id);
          connection.destroy();
        }
      });

      connection.subscribe(player);
    } else {
      serverQueue.songs.push(query);
      return message.reply(`✅ เพิ่มเข้า queue: ${query}`);
    }
  }
});

async function playSong(guild, query) {
  try {
    const serverQueue = queue.get(guild.id);
    if (!serverQueue) return;

    const result = await ytSearch(query);
    const video = result.videos[0];
    if (!video) return console.log("❌ ไม่พบเพลง");

    console.log("🎶 Playing:", video.title);

    const subprocess = execa(
      "yt-dlp",
      [
        "-f",
        "bestaudio",
        "-o",
        "-", // stream to stdout
        "--quiet",
        "--no-warnings",
        video.url,
      ],
      {
        stdout: "pipe",
      }
    );

    const stream = new PassThrough();
    subprocess.stdout.pipe(stream);

    const resource = createAudioResource(stream);
    serverQueue.player.play(resource);
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาด:", err);
  }
}

client.login(process.env.TOKEN);
