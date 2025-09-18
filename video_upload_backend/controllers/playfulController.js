const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { generateImageFromPrompt } = require("./aiImageService");
const slugify = require("slugify");

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

// --- Zoom video generation (single filter, no filter_complex) ---
function generateZoomVideo(imagePath, outputPath, zoom = 1.5, duration = 10, fps = 25) {
  return new Promise((resolve, reject) => {
    const zoomFilter = `zoompan=z='if(lte(on,${fps*duration}),(on/${fps*duration})*${zoom}+1,${zoom})':d=${fps}:fps=${fps}:s=1920x1080`;

    const ffmpegArgs = [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-vf", zoomFilter,
      "-t", duration.toString(),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      outputPath
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs, { shell: true });

    ffmpeg.stderr.on("data", (data) => console.log("[FFmpeg]", data.toString()));
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg failed with code " + code));
    });
  });
}

// --- Overlay text on video ---
function overlayTextOnVideo(videoPath, outputPath, text, fontPath) {
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      "-y",
      "-i", videoPath,
      "-vf", `drawtext=text='${text}':fontfile='${fontPath.replace(/\\/g, '/')}'` +
             `:fontsize=40:fontcolor=yellow:x=(w-text_w)/2:y=(h-text_h)/2`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      outputPath
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs, { shell: true });
    ffmpeg.stderr.on("data", (data) => console.log("[FFmpeg]", data.toString()));
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg failed with code " + code));
    });
  });
}

// --- Main function ---
exports.generatePlayfulVideo = async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const uploadDir = path.join(__dirname, "../uploads/playful");
    ensureDirExists(uploadDir);
    const tempDir = path.join(__dirname, "../uploads/temp");
    ensureDirExists(tempDir);

    const imagePath = path.join(tempDir, `bg_${Date.now()}.png`);
    console.log("Generating AI image...");
    await generateImageFromPrompt(prompt, imagePath);
    console.log("AI image saved:", imagePath);

    const rawTitle = "playful_video";
    let safeTitle = slugify(rawTitle, { lower: true, strict: true });
    if (!safeTitle) safeTitle = "playful_video";

    const zoomVideoPath = path.join(tempDir, `${safeTitle}_zoom_${Date.now()}.mp4`);
    const finalVideoPath = path.join(uploadDir, `${safeTitle}_final_${Date.now()}.mp4`);

    const music = getRandomMusic();
    if (!music) return res.status(500).json({ error: "No music available" });

    // 1️⃣ Generate zoom video
    await generateZoomVideo(imagePath, zoomVideoPath, 1.2, 10, 25);

    // 2️⃣ Overlay text (optional)
    const wrappedText = prompt.match(/.{1,25}/g).join("\\n");
    const fontPath = path.join(__dirname, "../assets/fonts/NotoSans-Regular.ttf");
    await overlayTextOnVideo(zoomVideoPath, finalVideoPath, wrappedText, fontPath);

    // 3️⃣ Add music
    const ffmpegArgs = [
      "-y",
      "-i", finalVideoPath,
      "-i", music,
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      finalVideoPath
    ];

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ffmpegArgs, { shell: true });
      ffmpeg.stderr.on("data", (data) => console.log("[FFmpeg]", data.toString()));
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error("FFmpeg failed adding music"))));
    });

    const io = req.app.get("io");
    io.emit("videoStage", { stage: "✅ Video ready!" });
    io.emit("videoCompleted", { prompt, output: `/uploads/playful/${path.basename(finalVideoPath)}` });
    res.json({ message: "Playful video generated", output: `/uploads/playful/${path.basename(finalVideoPath)}` });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
};
