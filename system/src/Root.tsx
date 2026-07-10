import React from 'react';
import { Composition, getInputProps } from 'remotion';
import { MainVideo } from './Video';
import lineCache from './lineCache.json';

export const Root: React.FC = () => {
  const props = getInputProps() as any;

  const names = (props && props.names) || ['ÖRNEK İSİM 1', 'ÖRNEK İSİM 2', 'ÖRNEK İSİM 3'];
  const fps = (props && props.fps) || 60;
  const nameHeight = (props && props.nameHeight) || 160;
  const height = (props && props.height) || 1080;
  // scrollSpeed = pixels per frame (higher = faster scroll). Default 3px/frame.
  const scrollSpeed = (props && props.scrollSpeed) || 3;

  // Use pre-calculated total list height from canvas cache
  const totalListHeight = lineCache.totalListHeight;

  // Scroll: start at bottom of screen, scroll until entire list passes top
  const totalScrollDistance = height + totalListHeight;
  const pixelsPerSecond = scrollSpeed * fps; // px/frame × fps = px/s
  const scrollDurationSec = totalScrollDistance / pixelsPerSecond;

  const introSec = 2;
  const outroSec = 5;
  // SAFETY BUFFER: multiply by 1.30 (30% extra) so that even if the canvas
  // font measurement differs slightly from Chromium's real rendering,
  // the video always has enough frames for ALL names to scroll through.
  // The extra time shows only the background (sablon.jpg) — same as the outro.
  const SAFETY_FACTOR = 1.30;
  const durationInFrames = Math.ceil((introSec + scrollDurationSec + outroSec) * fps * SAFETY_FACTOR);

  return (
    <>
      <Composition
        id="Graduation"
        component={MainVideo}
        durationInFrames={durationInFrames}
        fps={fps}
        width={(props && props.width) || 1920}
        height={height}
        defaultProps={{
          names: names as string[],
          showBackground: true,
        }}
      />
      <Composition
        id="GraduationNoBg"
        component={MainVideo}
        durationInFrames={durationInFrames}
        fps={fps}
        width={(props && props.width) || 1920}
        height={height}
        defaultProps={{
          names: names as string[],
          showBackground: false,
        }}
      />
    </>
  );
};
