// controllers/uploadController.js
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const slugify = require("slugify");
const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");

// Ensure folder exists
const ensureDirExists = dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

async function waitForFile(filePath, retries = 10, delay = 500) {
    for (let i = 0; i < retries; i++) {
        if (fs.existsSync(filePath)) return true;
        await new Promise(res => setTimeout(res, delay));
    }
    return false;
}
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

// Safe unlink
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

// Random transition helper
function randomTransition() {
    const transitions = [
        "fade",        // classic crossfade
        "smoothleft",  // cinematic slide left
        "smoothright", // cinematic slide right
        "squeezeh",    // horizontal squeeze
        "squeezev",    // vertical squeeze
        "circleopen",  // circle reveal
        "circleclose", // circle close
        "fadeblack",   // fade through black
        "fadewhite"    // fade through white
    ];
    return transitions[Math.floor(Math.random() * transitions.length)];
}
// Detect motion segments efficiently
const detectMotionSegmentsEfficient = async (videoPath, chunkSeconds = 300) => {
    const videoDuration = await getVideoDuration(videoPath);
    const motionTimes = [];
    const numChunks = Math.ceil(videoDuration / chunkSeconds);

    for (let i = 0; i < numChunks; i++) {
        const startTime = i * chunkSeconds;
        const duration = Math.min(chunkSeconds, videoDuration - startTime);
        let stderr = "";

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", [
                "-ss", startTime.toString(),
                "-t", duration.toString(),
                "-i", videoPath,
                "-filter_complex", "tblend=all_mode=difference,blackframe=amount=0.02:threshold=32,metadata=print",
                "-f", "null", "-"
            ]);
            ffmpeg.stderr.on("data", chunk => (stderr += chunk.toString()));
            ffmpeg.on("close", code => {
                if (code !== 0) return reject(new Error(`FFmpeg exited with code ${code} on chunk ${i}`));
                const regex = /pts_time:(\d+\.\d+)/g;
                let match;
                while ((match = regex.exec(stderr))) {
                    const pts = parseFloat(match[1]) + startTime;
                    motionTimes.push(pts);
                }
                resolve();
            });
            ffmpeg.on("error", err => reject(err));
        });
    }

    const deduped = motionTimes.filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1);
    return deduped;
};

// Ensure video has audio
async function ensureAudio(filePath) {
    const temp = filePath.replace(".mp4", "_audio.mp4");
    await runFFmpegJob([
        "-y",
        "-i", filePath,
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        temp
    ]);
    safeUnlink(filePath);
    fs.renameSync(temp, filePath);
}
function getZoomFilter(motionScore) {
    if (motionScore > 0.6) {
        return "zoompan=z='min(zoom+0.002,1.5)':d=125";
    } else if (motionScore < 0.3) {
        return "zoompan=z='max(zoom-0.002,1.0)':d=125";
    }
    return ""; // no zoom
}

// Merge multiple MP4 files safely
const mergeVideos = (videoPaths, outputPath) => {
    return new Promise((resolve, reject) => {
        const uploadDir = path.dirname(outputPath);
        const listFile = path.join(uploadDir, `list_${Date.now()}.txt`);
        // inside mergeVideos
        fs.writeFileSync(
            listFile,
            videoPaths
                .map(p => {
                    const safePath = path.resolve(p).replace(/\\/g, "/"); // ✅ normalize slashes
                    return `file '${safePath}'`;
                })
                .join("\n")
        );

        const ffmpegArgs = [
            "-f", "concat",
            "-safe", "0",
            "-i", listFile,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-y",
            outputPath
        ];
        const ffmpeg = spawn("ffmpeg", ffmpegArgs);
        ffmpeg.stderr.on("data", chunk => process.stdout.write(chunk.toString()));
        ffmpeg.on("error", err => reject(err));
        ffmpeg.on("close", code => {
            safeUnlink(listFile);
            if (code === 0) resolve(outputPath);
            else reject(new Error(`FFmpeg exited with code ${code}`));
        });
    });
};

// Merge segments with transitions
// Merge segments with transitions safely
async function mergeSegmentsWithTransition(tempFiles, uploadDir) {
    let mergedSegments = [...tempFiles];

    while (mergedSegments.length > 1) {
        const batchMerged = [];

        for (let i = 0; i < mergedSegments.length; i += 2) {
            if (i + 1 >= mergedSegments.length) {
                // Odd segment out, just push
                batchMerged.push(mergedSegments[i]);
                continue;
            }

            const file1 = mergedSegments[i];
            const file2 = mergedSegments[i + 1];

            // Ensure audio exists
            await ensureAudio(file1);
            await ensureAudio(file2);

            const dur1 = await getVideoDuration(file1);
            const dur2 = await getVideoDuration(file2);

            // Skip xfade if too short
            if (dur1 < 1 || dur2 < 1) {
                console.warn(`⚠️ Segment too short for xfade: ${file1}, ${file2}. Using concat fallback.`);
                const fallbackOut = path.join(uploadDir, `concat_${Date.now()}_${i}.mp4`);
                await mergeVideos([file1, file2], fallbackOut);
                safeUnlink(file1);
                safeUnlink(file2);
                batchMerged.push(fallbackOut);
                continue;
            }

            const outPath = path.join(uploadDir, `merged_${Date.now()}_${i}.mp4`);
            const transitionType = mergedSegments.length <= 6 ? randomTransition() : "fade";
            const offset = Math.max(0.1, Math.min(0.8, dur1, dur2) - 0.1);

            const filterComplex = `
  [0:v:0][1:v:0]xfade=transition=${transitionType}:duration=1.5:offset=${offset}[v];
  [0:a:0][1:a:0]acrossfade=d=1.5[a]
`;


            try {
                await runFFmpegJob([
                    "-y",
                    "-i", file1,
                    "-i", file2,
                    "-filter_complex", filterComplex,
                    "-map", "[v]",
                    "-map", "[a]",
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-b:v", "5M",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-pix_fmt", "yuv420p",
                    outPath
                ]);

                safeUnlink(file1);
                safeUnlink(file2);
                batchMerged.push(outPath);

            } catch (err) {
                console.warn(`⚠️ Xfade failed for ${file1} & ${file2}: ${err.message}. Using concat fallback.`);
                const fallbackOut = path.join(uploadDir, `concat_${Date.now()}_${i}.mp4`);
                await mergeVideos([file1, file2], fallbackOut);
                safeUnlink(file1);
                safeUnlink(file2);
                batchMerged.push(fallbackOut);
            }
        }

        mergedSegments = batchMerged;
    }

    return mergedSegments[0];
}

async function generateCinematicHighlight(videoPath, outputPath) {
    const uploadDir = path.dirname(outputPath);
    const videoDuration = await getVideoDuration(videoPath);
    const logoPath = path.join(__dirname, "../assets/logo.png");
    const watermarkText = "SafaNaga.ai";

    // --- Detect motion/action segments ---
    let motionTimes = await detectMotionSegmentsEfficient(videoPath);

    // Fallback if detection fails
    if (!motionTimes || motionTimes.length < 2) {
        motionTimes = Array.from({ length: 10 }, (_, i) => i * (videoDuration / 10));
    }

    // Ensure start & end
    motionTimes = [0, ...motionTimes, videoDuration];

    // --- Convert to segments ---
    let segments = [];
    for (let i = 0; i < motionTimes.length - 1; i++) {
        const start = motionTimes[i];
        const duration = motionTimes[i + 1] - start;
        if (duration >= 1.0) { // skip micro fragments
            segments.push({ start, duration });
        }
    }

    // --- Sort by action priority (longer = more likely intense) ---
    segments.sort((a, b) => b.duration - a.duration);

    const MAX_HIGHLIGHT = 60; // total max highlight length
    const selectedSegments = [];
    let total = 0;

    for (const seg of segments) {
        if (total >= MAX_HIGHLIGHT) break;

        let duration = Math.min(seg.duration, 8); // cap max segment length
        if (total + duration > MAX_HIGHLIGHT) {
            duration = MAX_HIGHLIGHT - total;
        }

        // Speed up filler, keep long fights normal
        const speed = duration > 6 ? 1.5 : 1;

        selectedSegments.push({ start: seg.start, duration, speed });
        total += duration / speed; // account for speed-up
    }

    // --- Process each segment ---
    const tempFiles = [];
    for (let i = 0; i < selectedSegments.length; i++) {
        const seg = selectedSegments[i];
        const tempPath = path.join(uploadDir, `seg_${i}_${Date.now()}.mp4`);
        const speedFilter = `setpts=${1 / seg.speed}*PTS`;

        const filterComplex = `
            [0:v]scale=1080:1920:force_original_aspect_ratio=increase,
            crop=1080:1920,
            eq=brightness=0.05:contrast=1.2:saturation=1.15,
            unsharp=5:5:1.0:5:5:0.0,
            ${speedFilter}[vid];
            [1:v]scale=150:-1[logo];
            [vid][logo]overlay=main_w-overlay_w-20:20,
            drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${watermarkText}':fontcolor=white:fontsize=36:alpha=0.7:x=20:y=main_h-60
        `;

        await runFFmpegJob([
            "-y",
            "-i", videoPath,
            "-i", logoPath,
            "-ss", seg.start.toString(),
            "-t", seg.duration.toString(),
            "-filter_complex", filterComplex,
            "-c:v", "libx264",
            "-preset", "fast",
            "-b:v", "5M",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            tempPath
        ]);

        tempFiles.push(tempPath);
    }

    // --- Merge with transitions ---
    let finalMergedPath = await mergeSegmentsWithTransition(tempFiles, uploadDir);

    // --- Add background music ---
    let finalPath = finalMergedPath;
    const musicPath = pickRandomMusic();
    if (musicPath) {
        const finalWithMusic = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
        await runFFmpegJob([
            "-y",
            "-i", finalPath,
            "-i", musicPath,
            "-c:v", "copy",
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            finalWithMusic
        ]);
        safeUnlink(finalPath);
        finalPath = finalWithMusic;
    }

    return finalPath;
}



exports.uploadVideo = async (req, res) => {
    try {
        const files = req.files;
        if (!files || !files.length) return res.status(400).json({ message: "No files uploaded" });

        const host = req.get("host");
        const uploadDir = path.join(__dirname, "../uploads");
        ensureDirExists(uploadDir);

        const mp4Paths = [];

        for (const file of files) {
            const safePath = path.join(uploadDir, makeSafeFileName(file.originalname));

            if (!fs.existsSync(file.path)) {
                console.warn(`⚠️ Source file not found, skipping: ${file.path}`);
                continue; // Skip missing file
            }

            if (path.extname(file.path).toLowerCase() === ".mp4") {
                try {
                    const safeSource = path.resolve(file.path);
                    const safeDest = path.resolve(safePath);
                    fs.copyFileSync(safeSource, safeDest);

                } catch (err) {
                    console.warn(`⚠️ Failed to copy file ${file.path}: ${err.message}`);
                    continue;
                }
            } else {
                try {
                    await convertToMp4(file.path, safePath);
                    safeUnlink(file.path);
                } catch (err) {
                    console.warn(`⚠️ Failed to convert file ${file.path}: ${err.message}`);
                    continue;
                }
            }

            if (fs.existsSync(safePath)) mp4Paths.push(safePath);
        }

        if (!mp4Paths.length) {
            return res.status(400).json({ message: "No valid video files to process" });
        }

        // Merge multiple MP4s safely
        let finalVideoPath = mp4Paths[0];
        if (mp4Paths.length > 1) {
            finalVideoPath = path.join(uploadDir, `merged_${Date.now()}.mp4`);
            try {
                await mergeVideos(mp4Paths, finalVideoPath);
            } catch (err) {
                console.warn(`⚠️ Failed to merge videos: ${err.message}`);
                finalVideoPath = mp4Paths[0]; // fallback to first video
            }
            mp4Paths.forEach(p => safeUnlink(p));
        }

        const highlightPath = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
        let cinematicPath;
        try {
            cinematicPath = await generateCinematicHighlight(finalVideoPath, highlightPath);
        } catch (err) {
            console.warn(`⚠️ Failed to generate cinematic highlight: ${err.message}`);
            cinematicPath = finalVideoPath; // fallback to merged/original video
        }

        res.status(200).json({
            message: "Video uploaded & cinematic highlight reel processed successfully",
            original: `/uploads/${path.basename(finalVideoPath)}`,
            highlight: `http://${host}/uploads/${path.basename(cinematicPath)}`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error processing video", error: err.message });
    }
};

