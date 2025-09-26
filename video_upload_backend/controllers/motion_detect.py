import sys
import json
import cv2
import numpy as np

def detect_scenes_scenedetect(video_path, threshold=30.0):
    try:
        from scenedetect import VideoManager, SceneManager
        from scenedetect.detectors import ContentDetector
    except ImportError:
        return {"error": "scenedetect not installed"}

    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold))

    video_manager.start()
    scene_manager.detect_scenes(frame_source=video_manager)

    scene_list = scene_manager.get_scene_list()
    results = []

    for i, scene in enumerate(scene_list):
        start, end = scene
        results.append({
            "scene": i,
            "start_time": start.get_timecode(),
            "end_time": end.get_timecode(),
            "start_frame": start.get_frames(),
            "end_frame": end.get_frames()
        })

    return {"scenes": results}


def detect_motion_segments(video_path, motion_threshold=1.0, min_scene_gap=0.3, min_segment_duration=0.5):
    """
    Detect motion segments using dense optical flow.
    motion_threshold: average flow magnitude to consider motion (tune this!)
    min_scene_gap: minimum time in seconds between consecutive motion segments
    min_segment_duration: minimum duration for a segment to be valid
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": "Cannot open video"}

    fps = cap.get(cv2.CAP_PROP_FPS)
    ret, prev_frame = cap.read()
    if not ret:
        return {"error": "Cannot read video"}

    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)

    segments = []
    segment_start = None
    frame_idx = 1

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        flow = cv2.calcOpticalFlowFarneback(prev_gray, gray,
                                            None, 0.5, 3, 15, 3, 5, 1.2, 0)
        mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        avg_motion = np.mean(mag)

        timestamp = frame_idx / fps

        if avg_motion > motion_threshold:
            if segment_start is None:
                # Start a new segment
                segment_start = timestamp
        else:
            if segment_start is not None:
                # End the segment
                segment_end = timestamp
                if segment_end - segment_start >= min_segment_duration:
                    # Only store if duration is enough
                    if not segments or segment_start - segments[-1]['end_time'] >= min_scene_gap:
                        segments.append({"start_time": segment_start, "end_time": segment_end})
                segment_start = None

        prev_gray = gray
        frame_idx += 1

    # Close any ongoing segment at the end
    if segment_start is not None:
        segment_end = frame_idx / fps
        if segment_end - segment_start >= min_segment_duration:
            if not segments or segment_start - segments[-1]['end_time'] >= min_scene_gap:
                segments.append({"start_time": segment_start, "end_time": segment_end})

    cap.release()
    return {"motion_segments": segments, "fps": fps}


def detect_scenes(video_path, threshold_sc=30.0, motion_threshold=1.0):
    # Try scenedetect first
    result_sc = detect_scenes_scenedetect(video_path, threshold_sc)
    if "scenes" in result_sc and len(result_sc["scenes"]) >= 2:
        return result_sc
    else:
        # Fallback to dense optical flow motion segments
        return detect_motion_segments(video_path, motion_threshold)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python motion_detect.py <video_path>"}))
        sys.exit(1)

    video_path = sys.argv[1]
    result = detect_scenes(video_path)
    print(json.dumps(result, indent=2))
