import { Config } from '@remotion/cli/config';

// Optimized Render configuration for maximum speed and compatibility
Config.setCodec('h264');
Config.setCrf(20); // Optimized for text/scroll videos (visually identical, faster encoding, smaller file size)
Config.setPixelFormat('yuv420p'); // GPU hardware acceleration friendly (NVENC) and fully compatible with all players
Config.setVideoImageFormat('jpeg'); // Save memory during rendering
