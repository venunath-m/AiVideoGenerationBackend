const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { generateImageFromPrompt } = require("./aiImageService");
const slugify = require("slugify");

// --- Utilities ---
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const getRandomMusic = () => {
  const musicDir = path.join(__dirname, "../music");
  if (!fs.existsSync(musicDir)) return null;
  const files = fs.readdirSync(musicDir).filter(f => f.endsWith(".mp3"));
  if (!files.length) return null;
  return path.join(musicDir, files[Math.floor(Math.random() * files.length)]);
};

// --- Main function ---
exports.generatePlayfulVideo = async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const uploadDir = path.join(__dirname, "../uploads/playful");
    ensureDirExists(uploadDir);
    const tempDir = path.join(__dirname, "../uploads/temp");
    ensureDirExists(tempDir);

    // 1️⃣ Generate AI image
    const imagePath = path.join(tempDir, `bg_${Date.now()}.png`);
    console.log("Generating AI image...");
    await generateImageFromPrompt(prompt, imagePath);
    console.log("AI image saved:", imagePath);

    // 2️⃣ Prepare output filename safely
    const rawTitle = "playful_video";
    let safeTitle = slugify(rawTitle, { lower: true, strict: true });
    if (!safeTitle || safeTitle.trim().length === 0) safeTitle = "playful_video";
    const outputPath = path.join(uploadDir, `${safeTitle}_${Date.now()}.mp4`);
    console.log("Final output path:", outputPath);

    // 3️⃣ Choose random music
    const music = getRandomMusic();
    if (!music) return res.status(500).json({ error: "No music available" });

    // 4️⃣ FFmpeg filter_complex (only zoom, no text)
    const filterComplex = `[0:v]scale=1080:1920,zoompan=z='min(zoom+0.0015,1.1)':d=25:fps=25[v]`;

    // 5️⃣ Spawn FFmpeg process
    const ffmpegArgs = [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-i", music,
      "-t", "10",
      "-filter_complex", filterComplex,
      "-map", "[v]",
      "-map", "1:a?",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      outputPath
    ];

    console.log("FFmpeg args:", ffmpegArgs);

    const ffmpeg = spawn("ffmpeg", ffmpegArgs, { shell: true });
    const io = req.app.get("io");
    io.emit("videoStage", { stage: "🎬 Starting video generation..." });

    ffmpeg.stderr.on("data", (data) => console.log("[FFmpeg]", data.toString()));

    ffmpeg.on("close", (code) => {
      // Cleanup temp image
      fs.unlinkSync(imagePath);

      console.log("FFmpeg process exited with code", code);
      if (code !== 0) return res.status(500).json({ error: "Failed to generate video" });

      io.emit("videoStage", { stage: "✅ Video ready!" });
      io.emit("videoCompleted", { prompt, output: `/uploads/playful/${path.basename(outputPath)}` });
      res.json({ message: "Playful video generated", output: `/uploads/playful/${path.basename(outputPath)}` });
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
