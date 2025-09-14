const path = require("path");
const { generateClip, createReel, createYoutubeClip, extractThumbnail, addWatermark, extractThumbnails, createGifPreview, generateResolutions } = require("../services/videoProcessingService");

exports.uploadVideo = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    const videoPath = file.path;

    // Paths
    const clipPath = path.join("uploads", `clip_${Date.now()}.mp4`);
    const reelPath = path.join("uploads", `reel_${Date.now()}.mp4`);
    const ytClipPath = path.join("uploads", `yt_${Date.now()}.mp4`);
    const thumbnailPath = path.join("uploads", `thumb_${Date.now()}.jpg`);
    const thumbnailsDir = path.join("uploads", `thumbs_${Date.now()}`);
    const gifPath = path.join("uploads", `preview_${Date.now()}.gif`);
    const resolutionsDir = path.join("uploads", `resolutions_${Date.now()}`);

    // Process video
    await generateClip(videoPath, clipPath, 0, 10);
    await createReel(videoPath, reelPath, 15);
    await createYoutubeClip(videoPath, ytClipPath, 15);
    await extractThumbnail(videoPath, thumbnailPath, 2);
    await extractThumbnails(videoPath, thumbnailsDir, 5);
    await createGifPreview(videoPath, gifPath, 5, 320);

    // Generate multiple resolutions
    const resolutionFiles = await generateResolutions(videoPath, resolutionsDir);

    const host = req.get("host"); // localhost:3000
    res.status(200).json({
      message: "Video uploaded and processed successfully",
      original: `/uploads/${file.filename}`,
      outputs: {
        clip: `http://${host}/${clipPath}`,
        reel: `http://${host}/${reelPath}`,
        youtubeStyle: `http://${host}/${ytClipPath}`,
        thumbnail: `http://${host}/${thumbnailPath}`,
        gifPreview: `http://${host}/${gifPath}`,
        resolutions: resolutionFiles.map(f => `http://${host}/${f}`)
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error processing video", error: err.message });
  }
};
