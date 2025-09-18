const { exec } = require("child_process");
const path = require("path");

const generateImageFromPrompt = (prompt, outputPath) => {
  return new Promise((resolve, reject) => {
    // Call Python script (local Stable Diffusion)
    const pyScript = path.join(__dirname, "generate_sd_image.py");
    const cmd = `python "${pyScript}" "${prompt}" "${outputPath}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(error);
      console.log("[AI Image Service]", stdout);
      resolve(outputPath);
    });
  });
};

module.exports = { generateImageFromPrompt };
