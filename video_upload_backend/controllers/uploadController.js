// controllers/uploadController.js
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const slugify = require("slugify");
const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");

// Convert any file to MP4
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

// Merge multiple videos (if multiple uploads)
async function mergeVideos(videoPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listFile = path.join(path.dirname(outputPath), `list_${Date.now()}.txt`);
    fs.writeFileSync(
      listFile,
      videoPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
    );
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

// Get video duration
async function getVideoDuration(videoPath) {
  const info = await ffprobe(videoPath, { path: ffprobeStatic.path });
  return parseFloat(info.streams[0]?.duration || info.format.duration || 1);
}

// Pick random music
function pickRandomMusic() {
  const musicFolder = path.join(__dirname, "../music");
  const files = fs.readdirSync(musicFolder).filter(f => f.endsWith(".mp3"));
  if (!files.length) return null;
  const choice = files[Math.floor(Math.random() * files.length)];
  return path.join(musicFolder, choice);
}

// Helper: pick a random transition type
function randomTransition() {
  const transitions = ["fade", "wipeleft", "wiperight", "fadeblack", "fadewhite", "circleopen", "circleclose", "radial"];
  return transitions[Math.floor(Math.random() * transitions.length)];
}

// ✅ Safe unlink helper
function safeUnlink(file) {
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log("🗑 Deleted temp file:", file);
    }
  } catch (e) {
    console.warn("⚠️ Could not delete file:", file, e.message);
  }
}

// ✅ Updated cinematic highlight generator with logs
async function generateCinematicHighlight(videoPath, outputPath) {
  const uploadDir = path.dirname(outputPath);
  const videoDuration = await getVideoDuration(videoPath);
  console.log("🎥 Video duration:", videoDuration, "seconds");

  let motionTimes = await detectMotionSegments(videoPath);
  console.log("📊 Raw motion timestamps:", motionTimes);

  // 🌀 Deduplicate close timestamps (<1s apart)
  motionTimes = motionTimes.filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1);
  console.log("🌀 Deduped motion timestamps:", motionTimes);

  // If no motion → fallback to whole video
  if (!motionTimes.length || motionTimes.length < 2) {
    motionTimes = [0, videoDuration];
    console.log("⚠️ No motion found → using full video");
  } else {
    motionTimes = [0, ...motionTimes, videoDuration];
  }

  // ⏱ Limit total highlight duration
  const MAX_HIGHLIGHT = 60; // seconds
  let total = 0;
  const segments = [];

  for (let i = 0; i < motionTimes.length - 1; i++) {
    const start = motionTimes[i];
    let duration = motionTimes[i + 1] - start;
    duration = Math.max(Math.min(duration, 5), 1); // min 1s, max 5s

    if (total + duration > MAX_HIGHLIGHT) {
      console.log("⏹ Stopping, max highlight reached at", total, "seconds");
      break;
    }

    const speed = duration > 5 ? 4 : duration > 2 ? 2 : 1;
    segments.push({ start, duration, speed });
    total += duration;

    console.log(`🎬 Segment ${i}: start=${start}s, duration=${duration}s, speed=${speed}x`);
  }

  const tempFiles = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const tempPath = path.join(uploadDir, `seg_${i}_${Date.now()}.mp4`);
    const speedFilter = `setpts=${1 / seg.speed}*PTS`;

    const filters = [
      "scale=1080:1920:force_original_aspect_ratio=increase",
      "crop=1080:1920",
      "eq=brightness=0.05:contrast=1.2:saturation=1.15",
      "unsharp=5:5:1.0:5:5:0.0",
      speedFilter,
      "format=yuv420p"
    ];

    console.log("⚙️ Running FFmpeg for segment", i, "→", tempPath);

    await runFFmpegJob([
      "-y",
      "-i", videoPath,
      "-ss", seg.start.toString(),
      "-t", seg.duration.toString(),
      "-vf", filters.join(","),
      "-c:v", "libx264",
      "-preset", "fast",
      "-b:v", "5M",
      "-c:a", "aac",
      "-b:a", "128k",
      tempPath
    ]);

    tempFiles.push(tempPath);
  }

  // Merge segments with transitions
  let mergedSegments = [...tempFiles];
  while (mergedSegments.length > 1) {
    const batchMerged = [];
    for (let i = 0; i < mergedSegments.length; i += 2) {
      if (i + 1 >= mergedSegments.length) {
        batchMerged.push(mergedSegments[i]);
        continue;
      }

      const outPath = path.join(uploadDir, `merged_${Date.now()}_${i}.mp4`);
      const seg1Duration = Math.max(1, segments[i].duration);
      const seg2Duration = Math.max(1, segments[i + 1].duration);

      const transitionType = Math.min(seg1Duration, seg2Duration) < 2 ? "fade" : randomTransition();
      const offset = Math.min(seg1Duration, seg2Duration) - 0.1;

      console.log(`🔗 Merging segments ${i} & ${i + 1} with transition=${transitionType}, offset=${offset}s`);

      const filterComplex = `[0:v][1:v]xfade=transition=${transitionType}:duration=0.8:offset=${offset}[v];[0:a][1:a]acrossfade=d=0.8[a]`;

      await runFFmpegJob([
        "-y",
        "-i", mergedSegments[i],
        "-i", mergedSegments[i + 1],
        "-filter_complex", filterComplex,
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-b:v", "5M",
        "-c:a", "aac",
        "-b:a", "128k",
        outPath
      ]);

      batchMerged.push(outPath);
      safeUnlink(mergedSegments[i]);
      safeUnlink(mergedSegments[i + 1]);
    }
    mergedSegments = batchMerged;
  }

  let finalPath = mergedSegments[0];
  console.log("✅ Segments merged into:", finalPath);

  // Optional: add random music
  const musicPath = pickRandomMusic();
  if (musicPath) {
    console.log("🎵 Adding background music:", musicPath);
    const finalWithMusic = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
    await runFFmpegJob([
      "-y",
      "-i", finalPath,
      "-i", musicPath,
      "-c:v", "copy",
      "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest",
      "-c:a", "aac",
      "-b:a", "128k",
      finalWithMusic
    ]);
    safeUnlink(finalPath);
    finalPath = finalWithMusic;
  } else {
    console.log("🎵 No music found, skipping");
  }

  console.log("🏁 Final cinematic highlight generated:", finalPath);
  return finalPath;
}


// Upload video endpoint
exports.uploadVideo = async (req, res) => {
  try {
    const files = req.files;
    if (!files || !files.length) return res.status(400).json({ message: "No files uploaded" });

    const host = req.get("host");
    const uploadDir = path.dirname(files[0].path);

    // Convert & make safe names
    const mp4Paths = [];
    for (const file of files) {
      const safePath = path.join(uploadDir, makeSafeFileName(file.originalname));
      if (path.extname(file.path).toLowerCase() === ".mp4") fs.renameSync(file.path, safePath);
      else { await convertToMp4(file.path, safePath); fs.unlinkSync(file.path); }
      mp4Paths.push(safePath);
    }

    // Merge if multiple files
    let finalVideoPath = mp4Paths[0];
    if (mp4Paths.length > 1) {
      finalVideoPath = path.join(uploadDir, `merged_${Date.now()}.mp4`);
      await mergeVideos(mp4Paths, finalVideoPath);
      mp4Paths.forEach(p => fs.unlinkSync(p));
    }

    // Generate cinematic highlight reel
    const highlightPath = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
    await generateCinematicHighlight(finalVideoPath, highlightPath);

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
