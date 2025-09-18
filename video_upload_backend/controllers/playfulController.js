const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { generateImageFromPrompt } = require("./aiImageService");

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

    // 2️⃣ Prepare output and music
    const outputPath = path.join(uploadDir, `playful_${Date.now()}.mp4`);
    const music = getRandomMusic();
    if (!music) return res.status(500).json({ error: "No music available" });

    const fontPath = "C:/Windows/Fonts/arial.ttf";

    // 3️⃣ Windows-safe drawtext with line breaks
    const maxCharsPerLine = 25; // adjust as needed
    const wrappedText = prompt.match(new RegExp(`.{1,${maxCharsPerLine}}`, "g")).join("\\n");

    // 4️⃣ FFmpeg filter string (Windows-safe)
    const vfArg = `zoompan=z=min(zoom+0.0015\\,1.1):d=125,drawtext=text=${wrappedText}:fontfile=${fontPath}:fontcolor=yellow:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2`;

    const args = [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-i", music,
      "-t", "10",
      "-vf", vfArg,
      "-shortest",
      "-c:v", "libx264",
      "-c:a", "aac",
      outputPath
    ];

    console.log("FFmpeg args:", args);
    const io = req.app.get("io");
    io.emit("videoStage", { stage: "🎬 Starting video generation..." });

    // 5️⃣ Spawn FFmpeg
    const ffmpeg = spawn("ffmpeg", args, { shell: true });
    ffmpeg.stderr.on("data", (data) => console.log("[FFmpeg]", data.toString()));
    ffmpeg.on("close", (code) => {
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
