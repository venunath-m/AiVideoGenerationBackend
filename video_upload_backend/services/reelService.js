const { exec } = require("child_process");
const path = require("path");

async function createReel(inputPath, outputPath, duration = 15) {
  return new Promise((resolve, reject) => {
    // Reel = 9:16 crop, first X seconds, re-encoded
    const cmd = `ffmpeg -y -i "${inputPath}" -t ${duration} \
      -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -preset fast -crf 23 -c:a aac "${outputPath}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      resolve(outputPath);
    });
  });
}

module.exports = { createReel };
