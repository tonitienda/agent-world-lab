#!/usr/bin/env python3
"""Reject near-uniform MP4 footage (e.g. the viewer's blue background).

Uses only Python's standard library and FFmpeg; keeps the diagnostic artifact.
"""
import subprocess
import sys

if len(sys.argv) != 2:
    sys.exit("Usage: check-video.py <video.mp4>")
cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", sys.argv[1],
       "-vf", "fps=1,scale=64:36", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
result = subprocess.run(cmd, capture_output=True)
if result.returncode:
    sys.exit("FFmpeg could not decode video: " + result.stderr.decode(errors="replace"))
frame_bytes = 64 * 36 * 3
frames = len(result.stdout) // frame_bytes
if frames < 2:
    sys.exit(f"Recording contains too few decodable frames ({frames})")
rich = 0
for frame in range(frames):
    rgb = result.stdout[frame * frame_bytes:(frame + 1) * frame_bytes]
    samples = [tuple(rgb[i:i+3]) for i in range(0, len(rgb), 3)]
    colors = len(set(samples))
    brightness = [sum(p) for p in samples]
    spread = max(brightness) - min(brightness)
    if colors > 50 and spread > 65:
        rich += 1
print(f"Video content check: {frames} sampled frames, {rich} with visible spatial variation")
if rich < 2:
    sys.exit("Video appears blank/uniform; inspect viewer-debug.png and viewer console output")
