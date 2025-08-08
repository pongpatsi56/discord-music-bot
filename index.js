import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import play from "play-dl";
import dotenv from "dotenv";

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
play.authorization()

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.split(" ");
  const command = args.shift().toLowerCase();

  const serverQueue = queue.get(message.guild.id);

  if (command === "!play") {
    const url = args[0];
    if (!url || !(await play.validate(url))) {
      return message.reply("❌ กรุณาใส่ลิงก์ YouTube ที่ถูกต้อง");
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply("❌ คุณต้องอยู่ใน voice channel ก่อน");
    }

    let connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    if (!serverQueue) {
      const player = createAudioPlayer();
      const queueContruct = {
        voiceChannel,
        connection,
        player,
        songs: [],
        playing: true,
      };

      queue.set(message.guild.id, queueContruct);

      queueContruct.songs.push(url);
      playSong(message.guild, queueContruct.songs[0]);

      player.on(AudioPlayerStatus.Idle, () => {
        queueContruct.songs.shift();
        if (queueContruct.songs.length > 0) {
          playSong(message.guild, queueContruct.songs[0]);
        } else {
          queue.delete(message.guild.id);
          connection.destroy();
        }
      });

      connection.subscribe(player);
    } else {
      serverQueue.songs.push(url);
      return message.reply(`✅ เพิ่มเข้า queue: ${url}`);
    }
  }

  if (command === "!pause") {
    if (serverQueue && serverQueue.player) {
      serverQueue.player.pause();
      return message.reply("⏸️ หยุดเพลงแล้ว");
    }
  }

  if (command === "!resume") {
    if (serverQueue && serverQueue.player) {
      serverQueue.player.unpause();
      return message.reply("▶️ เล่นเพลงต่อแล้ว");
    }
  }

  if (command === "!queue") {
    if (!serverQueue || serverQueue.songs.length === 0) {
      return message.reply("📭 ไม่มีเพลงในคิว");
    }
    return message.reply(
      "📜 คิวเพลง:\\n" +
        serverQueue.songs.map((song, i) => `${i + 1}. ${song}`).join("\\n")
    );
  }
});

async function playSong(guild, query) {
  if (!query) return;

  try {
    const results = await play.search(query, { limit: 1 });
    if (!results.length) return console.log("ไม่พบเพลง");

    const song = results[0];
    console.log("เล่นเพลง:", song.title, song.url);

    // ส่ง video_info เข้า play.stream()
    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });
    play.play(resource);
  } catch (error) {
    console.error("เกิดข้อผิดพลาดตอนดึง stream:", error);
  }
}

client.login(process.env.TOKEN);
