const { createReel } = require("../services/reelService");

router.post("/create-reel", async (req, res) => {
  try {
    const { videoPath, prompt } = req.body;
    if (!videoPath) {
      return res.status(400).json({ message: "No video path provided" });
    }

    const reelPath = path.join("uploads", `reel_${Date.now()}.mp4`);
    await createReel(videoPath, reelPath);

    res.status(200).json({
      message: "Reel created successfully",
      reelPath,
      prompt, // save prompt if you want
    });
  } catch (err) {
    res.status(500).json({ message: "Error creating reel", error: err.message });
  }
});
