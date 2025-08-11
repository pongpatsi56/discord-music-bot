import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  generateDependencyReport,
  NoSubscriberBehavior,
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

// ✅ ฟังก์ชันเช็คว่าเป็น URL หรือไม่
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.split(" ");
  const cmdName = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  const aliases = {
    play: ["!play", "!p"],
    pause: ["!pause", "!pa", "!ps"],
    resume: ["!resume", "!r", "!res"],
    stop: ["!stop", "!st"],
    skip: ["!skip", "!sk"],
    volume: ["!volume", "!vol", "!v"],
    queue: ["!queue", "!q"],
  };

  function getCommandName(cmd) {
    for (const key in aliases) {
      if (aliases[key].includes(cmd)) return key;
    }
    return null;
  }

  const command = getCommandName(cmdName);
  if (!command) return;

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

    let video;

    if (isValidUrl(query)) {
      // ลิงก์ไม่ต้องค้นหา → ให้ใช้ URL เป็นชื่อชั่วคราว
      video = { title: query, url: query };
    } else {
      const result = await ytSearch(query);
      video = result.videos[0];
      if (!video) return message.reply("❌ ไม่พบเพลง");
    }

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
        volume: 0.5, // default 100%
      };

      queue.set(message.guild.id, queueConstruct);
      queueConstruct.songs.push({
        title: video.title,
        url: video.url,
      });

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

      return message.reply(`🎶 เริ่มเล่น: **${video.title}**`);
    } else {
      serverQueue.songs.push({
        title: video.title,
        url: video.url,
      });

      return message.reply(`✅ เพิ่มเข้า queue: **${video.title}**`);
    }
  }

  // ✅ STOP
  else if (command === "stop") {
    if (!serverQueue) return message.reply("❌ ไม่มีเพลงที่กำลังเล่น");
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    return message.reply("⏹️ หยุดเพลงและออกจากห้องเสียงแล้ว");
  }

  // ✅ PAUSE
  else if (command === "pause") {
    if (!serverQueue || !serverQueue.playing)
      return message.reply("❌ ไม่มีเพลงที่กำลังเล่น");
    serverQueue.player.pause();
    serverQueue.playing = false;
    return message.reply("⏸️ หยุดเพลงชั่วคราว");
  }

  // ✅ RESUME
  else if (command === "resume") {
    if (!serverQueue || serverQueue.playing)
      return message.reply("❌ ไม่มีเพลงที่หยุดไว้");
    serverQueue.player.unpause();
    serverQueue.playing = true;
    return message.reply("▶️ เล่นเพลงต่อ");
  }

  // ✅ SKIP
  else if (command === "skip") {
    if (!serverQueue || serverQueue.songs.length === 0)
      return message.reply("❌ ไม่มีเพลงในคิว");
    serverQueue.player.stop(); // trigger idle → play next
    return message.reply("⏭️ ข้ามเพลง");
  }

  // ✅ VOLUME
  else if (command === "volume") {
    if (!serverQueue) return message.reply("❌ ยังไม่มีเพลงที่กำลังเล่น");

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100)
      return message.reply("🔊 ใส่ระดับเสียงระหว่าง 0 ถึง 100");

    serverQueue.volume = vol / 100;

    if (
      serverQueue.player.state.resource &&
      serverQueue.player.state.resource.volume
    ) {
      serverQueue.player.state.resource.volume.setVolume(serverQueue.volume);
    }

    return message.reply(`🔊 ปรับระดับเสียงเป็น ${vol}%`);
  }

  // ✅ QUEUE
  else if (command === "queue") {
    if (!serverQueue || serverQueue.songs.length === 0) {
      return message.reply("📭 ไม่มีเพลงในคิวตอนนี้");
    }

    const queueMessage = serverQueue.songs
      .map((song, index) => {
        if (index === 0) {
          return `🎶 กำลังเล่น: **${song.title}**`;
        } else {
          return `🎵 ${index}. ${song.title}`;
        }
      })
      .join("\n");

    return message.reply(`📜 คิวเพลง:\n${queueMessage}`);
  }
});

// ✅ ฟังก์ชันเล่นเพลง
async function playSong(guild, song) {
  try {
    const serverQueue = queue.get(guild.id);
    if (!serverQueue) return;

    console.log("🎶 Playing:", song.title);

    const subprocess = execa(
      "yt-dlp",
      ["-f", "bestaudio", "-o", "-", "--quiet", "--no-warnings", song.url],
      { stdout: "pipe" }
    );

    const stream = new PassThrough();
    subprocess.stdout.pipe(stream);

    const resource = createAudioResource(stream, {
      inlineVolume: true,
    });

    resource.volume.setVolume(serverQueue.volume);
    serverQueue.player.play(resource);
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาด:", err);
  }
}

client.login(process.env.TOKEN);
