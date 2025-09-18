// controllers/uploadController.js
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const getVideoResolution = (videoPath) => new Promise((resolve, reject) => {
  const ffprobe = spawn("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    videoPath
  ]);

  let output = "";
  ffprobe.stdout.on("data", d => output += d.toString());
  ffprobe.stderr.on("data", d => console.error(`[FFprobe STDERR] ${d.toString()}`));
  ffprobe.on("close", code => {
    if (code === 0 && output.includes("x")) {
      const [width, height] = output.trim().split("x").map(Number);
      resolve({ width, height });
    } else reject(new Error("FFprobe failed"));
  });
});

const runFFmpegJob = (args, index, duration, io) => new Promise((resolve, reject) => {
  const ffmpeg = spawn("ffmpeg", args);

  ffmpeg.stderr.on("data", chunk => {
    const str = chunk.toString();
    process.stdout.write(`[FFmpeg ${index}] ${str}`);
    const timeMatch = str.match(/time=(\d+):(\d+):(\d+.\d+)/);
    if (timeMatch) {
      const seconds = (+timeMatch[1])*3600 + (+timeMatch[2])*60 + (+timeMatch[3]);
      const progress = Math.min(100, (seconds/duration)*100);
      io.emit("short-progress", { index, progress });
    }
  });

  ffmpeg.on("close", code => {
    if (code === 0) {
      if (fs.existsSync(args[args.length-1]) && fs.statSync(args[args.length-1]).size > 0) {
        resolve();
      } else {
        reject(new Error(`[FFmpeg ${index}] Output file is empty or corrupted`));
      }
    } else reject(new Error(`[FFmpeg ${index}] exited ${code}`));
  });

  ffmpeg.on("error", err => reject(err));
});

const makeArgsCPU = (filters, outputPath, startTime, duration, videoPath, musicPath) => {
  const safeFilters = filters.filter(f => f && f !== "");
  const args = ["-y", "-i", videoPath, "-ss", startTime.toString(), "-t", duration.toString()];

  if (musicPath) {
    args.push("-i", musicPath);

    const audioFilters = `[0:a]volume=1[a0];[1:a]volume=0.3,apad,afade=t=out:st=${duration-2}:d=2[a1];[a0][a1]amix=inputs=2:duration=first[aout]`;
    args.push("-filter_complex", `[0:v]${safeFilters.join(",")}[vout];${audioFilters}`);
    args.push("-map", "[vout]", "-map", "[aout]");
  } else {
    args.push("-vf", safeFilters.join(","));
  }

  args.push("-c:v", "libx264", "-preset", "fast", "-b:v", "5M");
  args.push("-c:a", "aac", "-b:a", "128k");
  args.push(outputPath);

  return args;
};

exports.extractEvents = async (req, res) => {
  try {
    const { videoPath, duration = 30, musicPath } = req.body;
    if (!videoPath) return res.status(400).json({ message: "No video path" });

    const io = req.app.get("io");
    const outputDir = path.join("uploads", `videos_${Date.now()}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const finalMusic = musicPath || null;
    const lutPath = path.join(__dirname, "../lut.cube");
    const logoPath = path.join(__dirname, "../logo.png");
    const sparklePath = path.join(__dirname, "../sparkle.mp4");
    const useLUT = fs.existsSync(lutPath);

    // -------- Scene Detection --------
    let stderrData = "";
    await new Promise((resolve, reject) => {
      const detect = spawn("ffmpeg", [
        "-i", videoPath,
        "-filter:v", "select='gt(scene,0.15)',showinfo",
        "-f", "null", "-"
      ]);
      detect.stderr.on("data", chunk => stderrData += chunk.toString());
      detect.on("close", code => code === 0 ? resolve() : reject(new Error("Scene detection failed")));
      detect.on("error", err => reject(err));
    });

    const sceneList = [];
    const regex = /pts_time:(\d+(\.\d+)?)/g;
    let match;
    while ((match = regex.exec(stderrData)) !== null) sceneList.push(parseFloat(match[1]));
    if (sceneList[0] !== 0) sceneList.unshift(0);

    const { width: inW, height: inH } = await getVideoResolution(videoPath);

    // Extend last scene for safety
    const videoDuration = sceneList[sceneList.length-1] + duration;
    sceneList.push(videoDuration);

    const jobs = [];
    let start = 0, clipIndex = 1;

    // -------- Per-scene clips --------
    for (let i = 0; i < sceneList.length - 1; i++) {
      const end = sceneList[i + 1];
      let clipDuration = end - start;
      if (clipDuration < 1) { start = end; continue; }

      const shortPath = path.resolve(outputDir, `clip_${clipIndex}_shorts.mp4`).replace(/\\/g, "/");
      const landPath = path.resolve(outputDir, `clip_${clipIndex}_landscape.mp4`).replace(/\\/g, "/");

      const commonFilters = [
        "eq=brightness=0.05:contrast=1.2:saturation=1.2,unsharp=5:5:1.0:5:5:0.0",
        `fade=t=in:st=0:d=1,fade=t=out:st=${clipDuration-1}:d=1`,
        "vignette=PI/4:eval=frame",
        useLUT ? `lut3d='${lutPath.replace(/\\/g,"/")}'` : "",
        fs.existsSync(logoPath) ? `movie=${logoPath.replace(/\\/g,"/")} [watermark];[in][watermark]overlay=W-w-20:H-h-20` : "",
        fs.existsSync(sparklePath) ? `movie=${sparklePath.replace(/\\/g,"/")} [sparkle];[in][sparkle]overlay=0:0:enable='between(t,0,${clipDuration})':format=auto` : ""
      ].filter(f => f !== "");

      const shortFilters = [
        `zoompan=z='min(zoom+0.0005,1.05)':d=30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920,fps=30`,
        ...commonFilters,
        "format=yuv420p"
      ];

      const landFilters = [
        `zoompan=z='min(zoom+0.0005,1.05)':d=30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,fps=30`,
        ...commonFilters,
        "format=yuv420p"
      ];

      jobs.push({ ffmpegArgs: makeArgsCPU(shortFilters, shortPath, start, clipDuration, videoPath, finalMusic), index: `${clipIndex}-S`, duration: clipDuration, path: shortPath });
      jobs.push({ ffmpegArgs: makeArgsCPU(landFilters, landPath, start, clipDuration, videoPath, finalMusic), index: `${clipIndex}-L`, duration: clipDuration, path: landPath });

      start = end;
      clipIndex++;
    }

    const outputs = [];
    for (const job of jobs) {
      try { await runFFmpegJob(job.ffmpegArgs, job.index, job.duration, io); outputs.push(job.path); }
      catch (err) { console.error(`⚠️ Clip ${job.index} failed but skipped:`, err.message); }
    }

    // -------- Final consolidated 30–60s short --------
    const finalShortDuration = Math.min(60, videoDuration);
    const finalShortPath = path.join(outputDir, `final_short_${Date.now()}.mp4`).replace(/\\/g, "/");

    const finalFilters = [
      `zoompan=z='min(zoom+0.0005,1.05)':d=30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920,fps=30`,
      "eq=brightness=0.05:contrast=1.2:saturation=1.2,unsharp=5:5:1.0:5:5:0.0",
      `fade=t=in:st=0:d=1,fade=t=out:st=${finalShortDuration-1}:d=1`,
      "vignette=PI/4:eval=frame",
      useLUT ? `lut3d='${lutPath.replace(/\\/g,"/")}'` : "",
      fs.existsSync(logoPath) ? `movie=${logoPath.replace(/\\/g,"/")} [watermark];[in][watermark]overlay=W-w-20:H-h-20` : "",
      fs.existsSync(sparklePath) ? `movie=${sparklePath.replace(/\\/g,"/")} [sparkle];[in][sparkle]overlay=0:0:enable='between(t,0,${finalShortDuration})':format=auto` : "",
      "format=yuv420p"
    ].filter(f => f !== "");

    await runFFmpegJob(makeArgsCPU(finalFilters, finalShortPath, 0, finalShortDuration, videoPath, finalMusic), "FINAL-SHORT", finalShortDuration, io);

    const host = req.get("host");
    res.status(200).json({
      message: "Clips + Landscape + Final 30–60s Short generated successfully",
      clips: outputs.map(f => `http://${host}/${f.replace(/\\/g, "/")}`),
      finalShort: `http://${host}/${finalShortPath.replace(/\\/g, "/")}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
