const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// Python command to run Stable Diffusion (CPU)
const generateLocalImage = (prompt, outputPath) => {
  return new Promise((resolve, reject) => {
    // Call Python script
    const cmd = `python generate_sd_image.py "${prompt}" "${outputPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(error);
      console.log(stdout);
      resolve(outputPath);
    });
  });
};

module.exports = { generateLocalImage };
