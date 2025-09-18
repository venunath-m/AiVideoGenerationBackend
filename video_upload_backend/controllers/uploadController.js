// controllers/uploadController.js
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const slugify = require("slugify");

// Convert to MP4
async function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i "${inputPath}" -c:v libx264 -c:a aac -y "${outputPath}"`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

// Make safe file names
function makeSafeFileName(originalName) {
  const base = path.basename(originalName, path.extname(originalName));
  const safeBase = slugify(base, { lower: true, strict: true });
  return `${safeBase}_${Date.now()}.mp4`;
}

// Merge multiple videos
async function mergeVideos(videoPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listFile = path.join(path.dirname(outputPath), `list_${Date.now()}.txt`);
    fs.writeFileSync(listFile, videoPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const cmd = `ffmpeg -f concat -safe 0 -i "${listFile}" -c copy -y "${outputPath}"`;
    exec(cmd, (err) => {
      fs.unlinkSync(listFile);
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

// Run FFmpeg command
const runFFmpegJob = (args) => new Promise((resolve, reject) => {
  const ffmpeg = spawn("ffmpeg", args);
  ffmpeg.stderr.on("data", chunk => process.stdout.write(chunk.toString()));
  ffmpeg.on("close", code => {
    if (code === 0 && fs.existsSync(args[args.length - 1]) && fs.statSync(args[args.length - 1]).size > 0) resolve();
    else reject(new Error(`FFmpeg exited ${code}`));
  });
  ffmpeg.on("error", err => reject(err));
});

// Detect motion segments
const detectMotionSegments = (videoPath) => {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const ffmpeg = spawn("ffmpeg", [
      "-i", videoPath,
      "-filter_complex", "tblend=all_mode=difference,blackframe=amount=0.02:threshold=32,metadata=print",
      "-f", "null", "-"
    ]);
    ffmpeg.stderr.on("data", chunk => stderr += chunk.toString());
    ffmpeg.on("close", code => {
      if (code === 0) {
        const motionTimes = [];
        const regex = /pts_time:(\d+\.\d+)/g;
        let match;
        while ((match = regex.exec(stderr))) {
          motionTimes.push(parseFloat(match[1]));
        }
        resolve(motionTimes);
      } else {
        reject(new Error("Motion detection failed"));
      }
    });
  });
};


// Pick random music
function pickRandomMusic() {
  const musicFolder = path.join(__dirname, "../music");
  const files = fs.readdirSync(musicFolder).filter(f => f.endsWith(".mp3"));
  if (!files.length) return null;
  const choice = files[Math.floor(Math.random() * files.length)];
  return path.join(musicFolder, choice);
}

// Generate cinematic highlight reel with fast-forward effect
async function generateHighlightReel(videoPath, outputPath) {
  const uploadDir = path.dirname(outputPath);
  const motionTimes = await detectMotionSegments(videoPath);
  if (!motionTimes.length) throw new Error("No motion detected");

  const segments = [];
  for (let i = 0; i < motionTimes.length - 1; i++) {
    const start = motionTimes[i];
    const end = motionTimes[i + 1];
    const duration = end - start;
    // Speed adjustment: fast-forward slow segments
    const speed = duration > 5 ? 4 : duration > 2 ? 2 : 1;
    segments.push({ start, duration: Math.min(duration, 5), speed });
  }

  const tempFiles = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const tempPath = path.join(uploadDir, `seg_${i}_${Date.now()}.mp4`);
    const speedFilter = `setpts=${1 / seg.speed}*PTS`;
    const filters = [
      "scale=1920:1080:force_original_aspect_ratio=increase",
      "crop=1920:1080",
      "eq=brightness=0.05:contrast=1.2:saturation=1.15",
      "unsharp=5:5:1.0:5:5:0.0",
      speedFilter,
      "format=yuv420p"
    ];


    await runFFmpegJob([
      "-y", "-i", videoPath,
      "-ss", seg.start.toString(),
      "-t", seg.duration.toString(),
      "-vf", filters.join(","),
      "-c:v", "libx264", "-preset", "fast", "-b:v", "5M",
      "-c:a", "aac", "-b:a", "128k",
      tempPath
    ]);
    tempFiles.push(tempPath);
  }

  // Merge segments
  const listFile = path.join(uploadDir, `concat_list_${Date.now()}.txt`);
  fs.writeFileSync(listFile, tempFiles.map(f => `file '${f}'`).join("\n"));
  const finalMusic = pickRandomMusic();

  const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
  if (finalMusic) {
    args.push("-i", finalMusic, "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest", "-c:a", "aac");
  }
  args.push("-c:v", "copy", outputPath);

  await runFFmpegJob(args);

  fs.unlinkSync(listFile);
  tempFiles.forEach(f => fs.unlinkSync(f));
}

// Upload video endpoint
exports.uploadVideo = async (req, res) => {
  try {
    const files = req.files;
    if (!files || !files.length) return res.status(400).json({ message: "No files uploaded" });

    const host = req.get("host");
    const uploadDir = path.dirname(files[0].path);

    // Convert & merge
    const mp4Paths = [];
    for (const file of files) {
      const safePath = path.join(uploadDir, makeSafeFileName(file.originalname));
      if (path.extname(file.path).toLowerCase() === ".mp4") fs.renameSync(file.path, safePath);
      else { await convertToMp4(file.path, safePath); fs.unlinkSync(file.path); }
      mp4Paths.push(safePath);
    }

    let finalVideoPath = mp4Paths[0];
    if (mp4Paths.length > 1) {
      finalVideoPath = path.join(uploadDir, `merged_${Date.now()}.mp4`);
      await mergeVideos(mp4Paths, finalVideoPath);
      mp4Paths.forEach(p => fs.unlinkSync(p));
    }

    // Generate cinematic highlight reel
    const highlightPath = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
    await generateHighlightReel(finalVideoPath, highlightPath);

    res.status(200).json({
      message: "Video uploaded & cinematic highlight reel generated successfully",
      original: `/uploads/${path.basename(finalVideoPath)}`,
      highlight: `http://${host}/${highlightPath.replace(/\\/g, "/")}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error processing video", error: err.message });
  }
};
