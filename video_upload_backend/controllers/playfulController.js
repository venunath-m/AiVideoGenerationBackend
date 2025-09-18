const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Ensure folder exists
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// Escape text for ffmpeg drawtext filter
const escapeForDrawtext = (text) => {
  return text
    .replace(/:/g, "\\:")   // escape colons
    .replace(/'/g, "\\'")   // escape single quotes
    .replace(/"/g, '\\"');  // escape double quotes
};

// Pick a random music file from /music folder
const getRandomMusic = () => {
  const musicDir = path.join(__dirname, "../music");
  if (!fs.existsSync(musicDir)) {
    console.warn("⚠️ Music folder not found:", musicDir);
    return null;
  }
  const files = fs.readdirSync(musicDir).filter(f => f.endsWith(".mp3"));
  if (files.length === 0) {
    console.warn("⚠️ No mp3 files in music folder");
    return null;
  }
  const randomIndex = Math.floor(Math.random() * files.length);
  return path.join(musicDir, files[randomIndex]);
};

exports.generatePlayfulVideo = async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const uploadDir = path.join(__dirname, "../uploads/playful");
    ensureDirExists(uploadDir);

    const outputPath = path.join(uploadDir, `playful_${Date.now()}.mp4`);

    // Choose filter based on prompt
    let filter;
    if (/funny|joke|meme/i.test(prompt)) {
      filter = "hue=s=2,eq=contrast=1.5";
    } else if (/romantic|love/i.test(prompt)) {
      filter = "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131";
    } else {
      filter = "eq=brightness=0.06";
    }

    const bgVideo = "assets/background.mp4";
    const music = getRandomMusic(); // random music file
    if (!music) {
      return res.status(500).json({ error: "No music available" });
    }

    const safePrompt = escapeForDrawtext(prompt);

    const args = [
      "-y",
      "-i", bgVideo,
      "-i", music,
      "-vf", `drawtext=text='${safePrompt}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2,${filter}`,
      "-shortest",
      "-c:v", "libx264",
      "-c:a", "aac",
      outputPath
    ];

    const io = req.app.get("io");

    io.emit("videoStage", { stage: "🎬 Starting video generation..." });

    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stderr.on("data", (data) => {
      const msg = data.toString();

      if (msg.includes("frame=")) {
        io.emit("videoStage", { stage: "⚙️ Encoding video..." });
      }
      if (msg.includes("muxing overhead")) {
        io.emit("videoStage", { stage: "📦 Finalizing video..." });
      }

      const durationMatch = msg.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const [ , h, m, s ] = durationMatch;
        req.totalDuration = parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
      }

      const timeMatch = msg.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && req.totalDuration) {
        const [ , h, m, s ] = timeMatch;
        const current = parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
        const progress = current / req.totalDuration;

        io.emit("videoProgress", {
          prompt,
          progress: Math.min(progress, 1)
        });
      }
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        console.error("FFmpeg failed with code", code);
        return res.status(500).json({ error: "Failed to generate video" });
      }

      io.emit("videoStage", { stage: "✅ Video ready!" });
      io.emit("videoCompleted", {
        prompt,
        output: `/uploads/playful/${path.basename(outputPath)}`
      });

      res.json({
        message: "Playful video generated",
        output: `/uploads/playful/${path.basename(outputPath)}`
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
