const express = require("express");
const router = express.Router();
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

router.post("/extract-events", async (req, res) => {
  const { videoPath } = req.body;
  if (!videoPath) return res.status(400).json({ message: "No video path provided" });

  const io = req.app.get("io"); // Get Socket.IO instance
  const eventsDir = path.join("uploads", `events_${Date.now()}`);
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });

  // Detect scenes
  const cmd = `ffmpeg -i "${videoPath}" -filter:v "select='gt(scene,0.3)',showinfo" -f null - 2>&1`;
  exec(cmd, async (error, stdout, stderr) => {
    if (error) return res.status(500).json({ message: "Error detecting scenes", error });

    const sceneList = [];
    const regex = /pts_time:(\d+\.\d+)/g;
    let match;
    while ((match = regex.exec(stderr)) !== null) sceneList.push(parseFloat(match[1]));

    if (sceneList.length === 0) return res.status(200).json({ message: "No events detected", clips: [] });

    // Generate clips one by one and emit progress
    const clips = [];
    for (let i = 0; i < sceneList.length; i++) {
      const startTime = sceneList[i];
      const endTime = sceneList[i + 1] || startTime + 10;
      const clipPath = path.join(eventsDir, `clip_${i + 1}.mp4`);

      await new Promise((resolve, reject) => {
        const clipCmd = `ffmpeg -y -i "${videoPath}" -ss ${startTime} -to ${endTime} -c copy "${clipPath}"`;
        exec(clipCmd, (err) => (err ? reject(err) : resolve()));
      });

      clips.push(clipPath);

      // Emit live progress
      io.emit("event-progress", {
        current: i + 1,
        total: sceneList.length,
        clipPath,
      });
    }

    // Done
    res.status(200).json({ message: "All clips generated", clips });
  });
});

module.exports = router;
