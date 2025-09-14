const express = require("express");
const router = express.Router();
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

router.post("/extract-events", async (req, res) => {
  const { videoPath } = req.body;
  if (!videoPath) return res.status(400).json({ message: "No video path provided" });

  const io = req.app.get("io");
  const eventsDir = path.join("uploads", `events_${Date.now()}`);
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });

  const thumbnailsDir = path.join(eventsDir, "thumbs");
  if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir);

  const gifsDir = path.join(eventsDir, "gifs");
  if (!fs.existsSync(gifsDir)) fs.mkdirSync(gifsDir);

  // Step 1: Detect scenes
  const detectCmd = spawn("ffmpeg", [
    "-i", videoPath,
    "-filter:v", "select='gt(scene,0.3)',showinfo",
    "-f", "null", "-"
  ]);

  let stderrData = "";
  detectCmd.stderr.on("data", data => stderrData += data.toString());

  detectCmd.on("close", async () => {
    const sceneList = [];
    const regex = /pts_time:(\d+\.\d+)/g;
    let match;
    while ((match = regex.exec(stderrData)) !== null) sceneList.push(parseFloat(match[1]));

    if (sceneList.length === 0) return res.status(200).json({ message: "No events detected", clips: [] });

    // Step 2: Generate clips, thumbnails, GIFs with limited concurrency
    const clips = [];
    const concurrencyLimit = 4;
    let active = 0;
    let index = 0;

    const processNext = () => {
      if (index >= sceneList.length) return Promise.resolve();
      const i = index++;
      const startTime = sceneList[i];
      const endTime = sceneList[i + 1] || startTime + 10;
      const duration = endTime - startTime;
      const clipPath = path.join(eventsDir, `clip_${i + 1}.mp4`);
      const thumbPath = path.join(thumbnailsDir, `thumb_${i + 1}.jpg`);
      const gifPath = path.join(gifsDir, `preview_${i + 1}.gif`);

      active++;
      return new Promise((resolve, reject) => {
        const ffmpegClip = spawn("ffmpeg", [
          "-y",
          "-i", videoPath,
          "-ss", startTime.toString(),
          "-to", endTime.toString(),
          "-c", "copy",
          clipPath
        ]);

        ffmpegClip.stderr.on("data", data => {
          const line = data.toString();
          const timeMatch = line.match(/time=(\d+:\d+:\d+\.\d+)/);
          if (timeMatch) {
            const parts = timeMatch[1].split(":").map(parseFloat);
            const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            let clipProgress = Math.min(seconds / duration, 1);
            let totalProgress = (i + clipProgress) / sceneList.length;

            io.emit("event-progress", {
              current: totalProgress * sceneList.length,
              total: sceneList.length,
              clipPath
            });
          }
        });

        ffmpegClip.on("close", async code => {
          // Generate thumbnail
          await new Promise((r, rej) => {
            const ffThumb = spawn("ffmpeg", ["-y", "-i", clipPath, "-ss", "0.5", "-vframes", "1", thumbPath]);
            ffThumb.on("close", () => r());
            ffThumb.on("error", err => rej(err));
          });

          // Generate GIF preview
          await new Promise((r, rej) => {
            const ffGif = spawn("ffmpeg", [
              "-y",
              "-t", "3",
              "-i", clipPath,
              "-vf", "fps=10,scale=320:-1:flags=lanczos",
              "-loop", "0",
              gifPath
            ]);
            ffGif.on("close", () => r());
            ffGif.on("error", err => rej(err));
          });

          clips[i] = { clipPath, thumbPath, gifPath };

          io.emit("event-generated", {
            index: i,
            clipPath,
            thumbPath,
            gifPath
          });

          active--;
          processNext().then(resolve);
        });

        ffmpegClip.on("error", err => reject(err));
      });
    };

    const runners = [];
    for (let i = 0; i < concurrencyLimit; i++) runners.push(processNext());
    await Promise.all(runners);

    res.status(200).json({ message: "All clips generated", clips });
  });

  detectCmd.on("error", err => res.status(500).json({ message: "Error detecting scenes", error: err.message }));
});

module.exports = router;
