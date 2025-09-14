
const { exec } = require("child_process");
const path = require("path");

// ... keep your existing functions

/**
 * Generate multiple resolutions for a video
 * @param {string} inputPath - original video path
 * @param {string} outputDir - directory to store encoded videos
 * @param {Array} resolutions - array of resolutions, e.g., [{width: 1920, height:1080}, ...]
 */
const generateResolutions = (inputPath, outputDir, resolutions = [
  { width: 1920, height: 1080 }, 
  { width: 1280, height: 720 }, 
  { width: 854, height: 480 }
]) => {
  return new Promise((resolve, reject) => {
    const fs = require("fs");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const commands = resolutions.map(r => {
      const outputPath = path.join(outputDir, `video_${r.height}p.mp4`);
      return new Promise((res, rej) => {
        const cmd = `ffmpeg -y -i "${inputPath}" -vf "scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset fast -crf 23 -c:a aac "${outputPath}"`;
        exec(cmd, (err) => (err ? rej(err) : res(outputPath)));
      });
    });

    Promise.all(commands)
      .then(results => resolve(results))
      .catch(err => reject(err));
  });
};

// Short clip
const generateClip = (inputPath, outputPath, start = 0, duration = 10) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -ss ${start} -t ${duration} -c copy "${outputPath}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputPath)));
  });

// 9:16 reel
const createReel = (inputPath, outputPath, duration = 15) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -t ${duration} \
      -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -preset fast -crf 23 -c:a aac "${outputPath}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputPath)));
  });

// 16:9 YouTube-style clip
const createYoutubeClip = (inputPath, outputPath, duration = 15) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -t ${duration} \
      -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -preset fast -crf 23 -c:a aac "${outputPath}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputPath)));
  });

// Extract a thumbnail at a specific time (default 2 sec)
const extractThumbnail = (inputPath, outputPath, time = 2) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -ss ${time} -vframes 1 "${outputPath}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputPath)));
  });

// Add a watermark/logo image at bottom-right
const addWatermark = (inputPath, outputPath, watermarkPath) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -i "${watermarkPath}" -filter_complex "overlay=W-w-10:H-h-10" "${outputPath}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputPath)));
  });

  // Extract multiple thumbnails at regular intervals
const extractThumbnails = (inputPath, outputDir, count = 5) =>
  new Promise((resolve, reject) => {
    // Ensure outputDir exists
    const fs = require("fs");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Build ffmpeg command
    const cmd = `ffmpeg -y -i "${inputPath}" -vf "select='not(mod(n,ceil(n/${count})))',scale=320:-1" -vsync vfr "${outputDir}/thumb_%03d.jpg"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputDir)));
  });

// Create animated GIF preview from first few seconds
const createGifPreview = (inputPath, outputPath, duration = 5, scale = 320) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -t ${duration} -i "${inputPath}" -vf "fps=10,scale=${scale}:-1:flags=lanczos" -loop 0 "${outputPath}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve(outputPath)));
  });


module.exports = {
  generateClip,
  createReel,
  createYoutubeClip,
  extractThumbnail,
  addWatermark,
  extractThumbnails,
  createGifPreview,
  generateResolutions,
};
