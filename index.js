import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  generateDependencyReport,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import { PassThrough } from "stream";
import dotenv from "dotenv";
import ytSearch from "yt-search";
import youtubedl from "youtube-dl-exec"; // ใช้แทน execa yt-dlp

// ✅ เรียก dotenv config
dotenv.config();

console.log(generateDependencyReport());

// ✅ สร้าง Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = new Map();

// ✅ บอทออนไลน์
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ✅ คำสั่งทั้งหมด
const aliases = {
  play: ["!play", "!p"],
  pause: ["!pause", "!pa"],
  resume: ["!resume", "!r"],
  stop: ["!stop", "!s"],
  skip: ["!skip", "!sk"],
  queue: ["!queue", "!q"],
  volume: ["!volume", "!v"],
};

function getCommandName(cmd) {
  for (const key in aliases) {
    if (aliases[key].includes(cmd)) return key;
  }
  return null;
}

// ✅ รับข้อความ
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.split(" ");
  const cmdName = args.shift().toLowerCase();
  const command = getCommandName(cmdName);
  if (!command) return;

  const serverQueue = queue.get(message.guild.id);

  // ✅ คำสั่ง !play / !p
  if (command === "play") {
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
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });

      const queueConstruct = {
        voiceChannel,
        connection,
        player,
        songs: [],
        playing: true,
        volume: 1,
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

  // ✅ หยุด
  else if (command === "stop") {
    if (!serverQueue) return message.reply("❌ ไม่มีเพลงที่กำลังเล่น");
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    return message.reply("⏹️ หยุดเพลงและออกจากห้องเสียงแล้ว");
  }

  // ✅ หยุดชั่วคราว
  else if (command === "pause") {
    if (!serverQueue || !serverQueue.playing)
      return message.reply("❌ ไม่มีเพลงที่กำลังเล่น");
    serverQueue.player.pause();
    serverQueue.playing = false;
    return message.reply("⏸️ หยุดเพลงชั่วคราว");
  }

  // ✅ เล่นต่อ
  else if (command === "resume") {
    if (!serverQueue || serverQueue.playing)
      return message.reply("❌ ไม่มีเพลงที่หยุดไว้");
    serverQueue.player.unpause();
    serverQueue.playing = true;
    return message.reply("▶️ เล่นเพลงต่อ");
  }

  // ✅ ข้าม
  else if (command === "skip") {
    if (!serverQueue || serverQueue.songs.length === 0)
      return message.reply("❌ ไม่มีเพลงในคิว");
    serverQueue.player.stop();
    return message.reply("⏭️ ข้ามเพลง");
  }

  // ✅ Queue
  else if (command === "queue") {
    if (!serverQueue || serverQueue.songs.length === 0) {
      return message.reply("📭 ไม่มีเพลงในคิวตอนนี้");
    }

    const queueMessage = serverQueue.songs
      .map((song, index) => {
        return index === 0
          ? `🎶 กำลังเล่น: **${song}**`
          : `🎵 ${index}. ${song}`;
      })
      .join("\n");

    return message.reply(`📜 คิวเพลง:\n${queueMessage}`);
  }

  // ✅ Volume
  else if (command === "volume") {
    if (!serverQueue) return message.reply("❌ ยังไม่มีเพลงที่กำลังเล่น");

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100)
      return message.reply("🔊 ใส่ระดับเสียงระหว่าง 0 ถึง 100");

    serverQueue.volume = vol / 100;
    serverQueue.player.state.resource.volume.setVolume(serverQueue.volume);
    return message.reply(`🔊 ปรับระดับเสียงเป็น ${vol}%`);
  }
});

// ✅ ฟังก์ชันเล่นเพลง
async function playSong(guild, query) {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue) return;

  let videoUrl = query;

  // ✅ ถ้าไม่ใช่ URL ให้ search
  if (!/^https?:\/\//i.test(query)) {
    const result = await ytSearch(query);
    const video = result.videos[0];
    if (!video) return console.log("❌ ไม่พบเพลง");
    videoUrl = video.url;
  }

  console.log("🎶 Playing:", videoUrl);

  const subprocess = youtubedl(
    videoUrl,
    {
      output: "-",
      format: "bestaudio",
      quiet: true,
    },
    { stdio: ["ignore", "pipe", "ignore"] }
  );

  const stream = new PassThrough();
  subprocess.stdout.pipe(stream);

  const resource = createAudioResource(stream, {
    inlineVolume: true,
  });
  resource.volume.setVolume(serverQueue.volume);

  serverQueue.player.play(resource);
}

console.log("process.env.TOKEN=>", process?.env?.TOKEN);
if (!process.env.TOKEN) {
  console.error("❌ TOKEN is missing in environment variables.");
  process.exit(1);
}
client.login(process.env.TOKEN);

//
// ✅ ส่วนนี้สำหรับ Render: เปิด Web Server Dummy
//
import express from "express";
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_, res) => {
  res.send("Discord bot is running!");
});

app.listen(PORT, () => {
  console.log(`🌐 Dummy web server running on port ${PORT}`);
});
