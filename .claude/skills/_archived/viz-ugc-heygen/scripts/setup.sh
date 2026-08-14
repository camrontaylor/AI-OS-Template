#!/bin/bash
# Auto-setup for viz-ugc-heygen skill dependencies
# Installs ffmpeg (with libass for .ass subtitle burning)

set -e

echo "=== viz-ugc-heygen: Checking dependencies ==="

# ffmpeg (includes ffprobe)
if command -v ffmpeg &>/dev/null; then
    # Check if libass is supported
    if ffmpeg -filters 2>/dev/null | grep -q "ass"; then
        echo "✓ ffmpeg installed (with libass/ass filter support)"
    else
        echo "✗ ffmpeg found but missing libass support. Reinstalling from homebrew-ffmpeg tap..."
        if command -v brew &>/dev/null; then
            brew tap homebrew-ffmpeg/ffmpeg 2>/dev/null
            brew uninstall ffmpeg 2>/dev/null
            brew install homebrew-ffmpeg/ffmpeg/ffmpeg
        else
            echo "  Please install ffmpeg with libass support manually"
            exit 1
        fi
    fi
else
    echo "✗ ffmpeg not found. Installing (with libass for subtitle rendering)..."
    if command -v brew &>/dev/null; then
        brew tap homebrew-ffmpeg/ffmpeg 2>/dev/null
        brew install homebrew-ffmpeg/ffmpeg/ffmpeg
    else
        echo "  Homebrew not found. Please install ffmpeg manually:"
        echo "  https://ffmpeg.org/download.html"
        exit 1
    fi
    echo "✓ ffmpeg installed"
fi

echo ""
echo "=== All dependencies ready ==="
