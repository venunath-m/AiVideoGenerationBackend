// controllers/uploadController.js
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const slugify = require("slugify");
const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");
const { EventEmitter } = require("events");

// --- Utilities ---
const ensureDirExists = dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

async function waitForFile(filePath, retries = 10, delay = 500) {
    for (let i = 0; i < retries; i++) {
        if (fs.existsSync(filePath)) return true;
        await new Promise(res => setTimeout(res, delay));
    }
    return false;
}

function makeSafeFileName(originalName) {
    const base = path.basename(originalName, path.extname(originalName));
    const safeBase = slugify(base, { lower: true, strict: true });
    return `${safeBase}_${Date.now()}.mp4`;
}

function safeUnlink(file) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { console.warn("⚠️ Could not delete file:", file); }
}

// --- FFmpeg with progress ---
function runFFmpegJobWithProgress(args, duration = 60, stepName = "FFmpeg") {
    const emitter = new EventEmitter();
    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stderr.on("data", chunk => {
        const text = chunk.toString();
        process.stdout.write(text);
        const match = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (match) {
            const [_, h, m, s] = match;
            const seconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
            const percent = Math.min(100, (seconds / duration) * 100);
            emitter.emit("progress", { stepName, percent });
        }
    });

    ffmpeg.on("close", code => {
        if (code === 0) emitter.emit("done", args[args.length - 1]);
        else emitter.emit("error", new Error(`${stepName} exited with code ${code}`));
    });

    ffmpeg.on("error", err => emitter.emit("error", err));

    return emitter;
}

function runFFmpegJob(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn("ffmpeg", args, { stdio: "inherit" });
        proc.on("close", code => (code === 0 ? resolve(args[args.length - 1]) : reject(new Error(`FFmpeg exited with code ${code}`))));
        proc.on("error", reject);
    });
}

// --- Video utilities ---
async function convertToMp4(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${inputPath}" -c:v libx264 -c:a aac -y "${outputPath}"`, (err) => {
            if (err) return reject(err);
            resolve(outputPath);
        });
    });
}

async function waitForFile(filePath, retries = 10, delay = 500) {
    for (let i = 0; i < retries; i++) {
        if (fs.existsSync(filePath)) return true;
        await new Promise(res => setTimeout(res, delay));
    }
    return false;
}

async function getVideoDuration(videoPath) {
    const fullPath = path.resolve(videoPath); // No replace
    const exists = await waitForFile(fullPath, 10, 500);
    if (!exists) throw new Error(`Video file does not exist: ${fullPath}`);

    try {
        // Pass path safely to ffprobe
        const info = await ffprobe(fullPath, { path: ffprobeStatic.path });
        const duration = parseFloat(info.streams[0]?.duration || info.format.duration || 0);
        if (isNaN(duration) || duration <= 0) throw new Error("Invalid video duration");
        return duration;
    } catch (err) {
        console.error("❌ ffprobe failed:", err.message);
        throw new Error(`Failed to get video duration for: ${fullPath}`);
    }
}
// --- Music / transitions ---
function pickRandomMusic() {
    const musicFolder = path.join(__dirname, "../music");
    const files = fs.readdirSync(musicFolder).filter(f => f.endsWith(".mp3"));
    if (!files.length) return null;
    return path.join(musicFolder, files[Math.floor(Math.random() * files.length)]);
}

function randomTransition() {
    const transitions = ["fade", "smoothleft", "smoothright", "squeezeh", "squeezev", "circleopen", "circleclose", "fadeblack", "fadewhite"];
    return transitions[Math.floor(Math.random() * transitions.length)];
}

// --- Merge multiple videos ---
const mergeVideos = (videoPaths, outputPath) => {
    return new Promise((resolve, reject) => {
        const uploadDir = path.dirname(outputPath);
        const listFile = path.join(uploadDir, `list_${Date.now()}.txt`);
        fs.writeFileSync(listFile, videoPaths.map(p => `file '${path.resolve(p).replace(/\\/g, "/")}'`).join("\n"));

        const args = ["-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-pix_fmt", "yuv420p", "-y", outputPath];
        const ffmpegEmitter = runFFmpegJobWithProgress(args, 60, "Merging Videos");

        ffmpegEmitter.on("done", () => { safeUnlink(listFile); resolve(outputPath); });
        ffmpegEmitter.on("error", err => { safeUnlink(listFile); reject(err); });
    });
};

// --- Ensure audio ---
async function ensureAudio(filePath) {
    const temp = filePath.replace(".mp4", "_audio.mp4");
    await runFFmpegJob([
        "-y", "-i", filePath, "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
        "-c:v", "copy", "-c:a", "aac", "-shortest", temp
    ]);
    safeUnlink(filePath);
    fs.renameSync(temp, filePath);
}

// --- Python motion detection ---
async function detectMotionSegmentsPython(videoPath) {
    return new Promise((resolve, reject) => {
        const pyProcess = spawn("python", [path.join(__dirname, "motion_detect.py"), videoPath]);
        let output = "";

        pyProcess.stdout.on("data", chunk => output += chunk.toString());
        pyProcess.stderr.on("data", chunk => console.error(chunk.toString()));

        pyProcess.on("close", code => {
            if (code !== 0) return reject(new Error("Python motion_detect.py failed"));
            try {
                const jsonOutput = JSON.parse(output);

                if (jsonOutput.scenes) {
                    // For scenedetect output
                    const times = jsonOutput.scenes.map(s => ({
                        start_time: parseFloat(s.start_time.split(":").reduce((acc, t) => acc * 60 + parseFloat(t), 0)),
                        end_time: parseFloat(s.end_time.split(":").reduce((acc, t) => acc * 60 + parseFloat(t), 0))
                    }));
                    resolve(times);

                } else if (jsonOutput.motion_segments) {
                    // For dense optical flow motion segments
                    resolve(jsonOutput.motion_segments);

                } else if (jsonOutput.motion_times) {
                    // fallback (old motion_times array)
                    const segments = jsonOutput.motion_times.map(t => ({ start_time: t, end_time: t + 0.5 }));
                    resolve(segments);

                } else {
                    resolve([]);
                }

            } catch (err) {
                reject(err);
            }
        });
    });
}


// --- Generate cinematic highlight ---
// --- Generate cinematic highlight with first/middle/last portions ---
async function generateCinematicHighlight(videoPaths, outputPath) {
    const uploadDir = path.dirname(outputPath);
    const logoPath = path.join(__dirname, "../assets/logo.png");
    const watermarkText = "SafaNaga.ai";
    const tempFiles = [];

    const MAX_HIGHLIGHT = 60; // Max highlight length in seconds
    const START_END_PORTION = 3; // seconds for first & last portion

    for (const videoPath of videoPaths) {
        const videoDuration = await getVideoDuration(videoPath);

        // Motion-based segment detection
        let motionSegments;
        try {
            motionSegments = await detectMotionSegmentsPython(videoPath);
        } catch (err) {
            console.warn("Python motion detection failed, using fallback:", err.message);
            motionSegments = [{ start_time: 0, end_time: videoDuration }];
        }

        // Validate & sort segments
        motionSegments = motionSegments
            .map(s => ({
                start: Math.max(0, s.start_time || s.start || 0),
                end: Math.min(videoDuration, s.end_time || s.end || videoDuration)
            }))
            .filter(s => s.end - s.start > 0.5)
            .sort((a, b) => a.start - b.start);

        const MIN_SEG_DURATION = 1; 
        const MAX_SEG_DURATION = Math.max(4, videoDuration * 0.25);

        const segments = [];

        // --- 1. Add start portion ---
        segments.push({ start: 0, duration: Math.min(START_END_PORTION, videoDuration), speed: 1 });

        // --- 2. Add motion-based middle segments ---
        const middleDuration = MAX_HIGHLIGHT - 2 * START_END_PORTION;
        let totalMiddle = 0;

        for (const seg of motionSegments) {
            let dur = Math.min(seg.end - seg.start, MAX_SEG_DURATION);
            dur = Math.max(dur, MIN_SEG_DURATION);

            if (totalMiddle + dur > middleDuration) {
                dur = middleDuration - totalMiddle;
                if (dur <= 0) break;
            }

            segments.push({ start: seg.start, duration: dur, speed: dur > 8 ? 1.5 : 1 });
            totalMiddle += dur;

            if (totalMiddle >= middleDuration) break;
        }

        // --- 3. Add end portion ---
        segments.push({ start: Math.max(0, videoDuration - START_END_PORTION), duration: Math.min(START_END_PORTION, videoDuration), speed: 1 });

        // --- Generate clips ---
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const tempPath = path.join(uploadDir, `seg_${i}_${Date.now()}.mp4`);

            let filters = [
                "scale=1080:1920:force_original_aspect_ratio=increase",
                "crop=1080:1920",
                "eq=brightness=0.05:contrast=1.2:saturation=1.15",
                "unsharp=5:5:1.0:5:5:0.0"
            ];
            if (seg.speed !== 1) filters.push(`setpts=${1 / seg.speed}*PTS`);

            const filterComplex = `[0:v]${filters.join(",")}[vid];` +
                                  `[1:v]scale=150:-1[logo];` +
                                  `[vid][logo]overlay=main_w-overlay_w-20:20,` +
                                  `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${watermarkText}':fontcolor=white:fontsize=36:alpha=0.7:x=20:y=main_h-60`;

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
    }

    // --- Merge all segments with transitions ---
    
    let finalMergedPath = await mergeSegmentsWithTransition(tempFiles, uploadDir);

    // --- Add background music if available ---
    const musicPath = pickRandomMusic();
    if (musicPath) {
        const finalWithMusic = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
        await runFFmpegJob([
            "-y",
            "-i", finalMergedPath,
            "-i", musicPath,
            "-c:v", "copy",
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            finalWithMusic
        ]);
        safeUnlink(finalMergedPath);
        finalMergedPath = finalWithMusic;
    }

    return finalMergedPath;
}


async function mergeSegmentsWithTransition(tempFiles, uploadDir) {
    if (tempFiles.length === 0) throw new Error("No segments to merge");

    if (tempFiles.length === 1) return tempFiles[0];

    // Preserve first and last
    const firstClip = tempFiles[0];
    const lastClip = tempFiles[tempFiles.length - 1];
    const middleClips = tempFiles.slice(1, -1);

    let mergedMiddle = middleClips;

    // Merge middle clips iteratively
    while (mergedMiddle.length > 1) {
        const batchMerged = [];

        for (let i = 0; i < mergedMiddle.length; i += 2) {
            if (i + 1 >= mergedMiddle.length) {
                batchMerged.push(mergedMiddle[i]);
                continue;
            }

            const file1 = mergedMiddle[i];
            const file2 = mergedMiddle[i + 1];
            const dur1 = await getVideoDuration(file1);
            const dur2 = await getVideoDuration(file2);

            const outPath = path.join(uploadDir, `merged_${Date.now()}_${i}.mp4`);
            const MIN_XFADE = 1.0;

            if (dur1 < MIN_XFADE || dur2 < MIN_XFADE) {
                await mergeVideos([file1, file2], outPath);
                safeUnlink(file1);
                safeUnlink(file2);
                batchMerged.push(outPath);
                continue;
            }

            const transitionType = mergedMiddle.length <= 6 ? randomTransition() : "fade";
            const transitionDuration = Math.min(MIN_XFADE, dur1, dur2) * 0.8;
            const offset = Math.max(0, (dur1 + dur2) / 2 - transitionDuration / 2);

            const filterComplex = `[0:v:0][1:v:0]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset}[v];[0:a:0][1:a:0]acrossfade=d=${transitionDuration}[a]`;

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
                    "-shortest",
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

        mergedMiddle = batchMerged;
    }

    // Merge first + middle + last
    const finalClips = [firstClip];
    if (mergedMiddle.length) finalClips.push(mergedMiddle[0]);
    finalClips.push(lastClip);

    const finalOutput = path.join(uploadDir, `final_${Date.now()}.mp4`);
    return await mergeVideos(finalClips, finalOutput);
}


// --- Upload endpoint ---
exports.uploadVideo = async (req, res) => {
    try {
        const io = req.app.get("io"); // Socket.IO
        const files = req.files;
        if (!files || !files.length) 
            return res.status(400).json({ message: "No files uploaded" });

        const host = req.get("host");
        const uploadDir = path.join(__dirname, "../uploads");
        ensureDirExists(uploadDir);

        const mp4Paths = [];

        // Convert all uploads to safe MP4s
        for (const file of files) {
            const safePath = path.join(uploadDir, makeSafeFileName(file.originalname));
            if (!fs.existsSync(file.path)) continue;

            if (path.extname(file.path).toLowerCase() === ".mp4") {
                fs.copyFileSync(file.path, safePath);
            } else {
                await convertToMp4(file.path, safePath);
                safeUnlink(file.path);
            }

            mp4Paths.push(safePath);
        }

        if (!mp4Paths.length) return res.status(400).json({ message: "No valid video files" });

        io.emit("videoProgress", { stepName: "Starting Highlight Generation", percent: 0 });

        // Generate cinematic highlight directly from all uploaded videos
        const highlightPath = path.join(uploadDir, `highlight_${Date.now()}.mp4`);
        let cinematicPath;
        try {
            cinematicPath = await generateCinematicHighlight(mp4Paths, highlightPath);
        } catch (err) {
            console.warn(err);
            cinematicPath = mp4Paths[0]; // fallback
        }

        res.status(200).json({
            message: "Video uploaded & cinematic highlight processed successfully",
            original: `/uploads/${path.basename(mp4Paths[0])}`,
            highlight: `http://${host}/uploads/${path.basename(cinematicPath)}`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error processing video", error: err.message });
    }
};
