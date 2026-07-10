import React from 'react';
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  getInputProps,
} from 'remotion';

import config from './config.json';
import lineCache from './lineCache.json';

const localFontFace = `
  @font-face {
    font-family: 'Optima Nova LT Pro';
    src: url(${staticFile('fonts/OptimaNovaLTProRegular.otf')}) format('opentype');
    font-weight: normal;
    font-style: normal;
  }
`;

const googleFontsImport = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cinzel:wght@400;700&family=Montserrat:wght@400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Outfit:wght@400;700&family=Inter:wght@400;700&family=Roboto:wght@400;700&display=swap');
`;

interface MainVideoProps {
  names: string[];
  showBackground?: boolean;
}

export const MainVideo: React.FC<MainVideoProps> = ({ names, showBackground = true }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = getInputProps() as any;

  const introSec = 2;
  const introFrames = Math.round(introSec * fps);

  // Dynamic parameters from props (with safe fallbacks to config or default)
  const baseFontSize = (props && props.fontSize) || config.fontSize || 80;
  const nameHeight = (props && props.nameHeight) || config.nameHeight || 160;
  const textColor = (props && props.textColor) || config.textColor || '#ffffff';
  const fontWeight = (props && props.fontWeight) || config.fontWeight || 'normal';
  const letterSpacing = `${(props && props.letterSpacing) !== undefined ? props.letterSpacing : (config.letterSpacing || 1.5)}px`;
  const wrapNames = (props && props.wrapNames) !== undefined ? props.wrapNames : (config.wrapNames || false);
  const autoShrink = (props && props.autoShrink) !== undefined ? props.autoShrink : (config.autoShrink || false);
  const caseMode = (props && props.caseMode) || config.caseMode || 'uppercase';
  // scrollSpeed = pixels per frame (higher = faster). Default 3px/frame.
  const scrollSpeed = (props && props.scrollSpeed) || 3;
  const fontFamily = (props && props.fontFamily) || config.fontFamily || "'Optima Nova LT Pro', 'Optima LT Pro', Optima, Candara, Calibri, sans-serif";

  // Use pre-calculated heights and offsets from the pre-rendered canvas cache
  const itemHeights = lineCache.itemHeights;
  const yOffsets = lineCache.yOffsets;
  const totalListHeight = lineCache.totalListHeight;
  const listHeight = totalListHeight + 350; // Add safe overflow padding

  const pixelsPerFrame = scrollSpeed; // direct: px per frame

  const scrolledFrames = Math.max(0, frame - introFrames);
  const translateY = height - (scrolledFrames * pixelsPerFrame);

  // Masking
  const maskTop = (props && props.maskTopPercent) !== undefined ? props.maskTopPercent : (config.maskTopPercent || 20);
  const maskBottom = (props && props.maskBottomPercent) !== undefined ? props.maskBottomPercent : (config.maskBottomPercent || 80);
  const maskImage = `linear-gradient(to bottom, transparent 0%, transparent ${maskTop}%, black ${Math.min(maskTop + 5, maskBottom)}%, black ${Math.max(maskBottom - 5, maskTop)}%, transparent ${maskBottom}%, transparent 100%)`;

  return (
    <AbsoluteFill style={showBackground ? { backgroundColor: '#000814' } : {}}>
      <style>
        {googleFontsImport}
        {localFontFace}
      </style>

      {showBackground && (
        <AbsoluteFill>
          <Img
            src={staticFile('sablon.jpg')}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      )}

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: height,
          overflow: 'hidden',
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      >
        <div style={{ transform: `translateY(${translateY}px)`, width: '100%', position: 'relative', height: `${listHeight}px` }}>
          {names.map((name, index) => {
            const itemH = itemHeights[index] || nameHeight;
            const yOffset = yOffsets[index] || (index * nameHeight);
            
            // Check if item is in viewport (plus/minus 200px safety margin for masking/fading)
            const itemTopOnScreen = translateY + yOffset;
            const itemBottomOnScreen = itemTopOnScreen + itemH;
            const isVisible = itemBottomOnScreen >= -200 && itemTopOnScreen <= height + 200;
            
            if (!isVisible) {
              return null;
            }

            const trName = caseMode === 'original'
              ? name
              : name.toLocaleUpperCase('tr-TR');

            let size = baseFontSize;
            let whiteSpace: string = 'nowrap';
            let wordBreak: string = 'normal';

            if (wrapNames) {
              whiteSpace = 'normal';
              wordBreak = 'break-word';
            } else if (autoShrink) {
              const maxChars = Math.max(10, Math.floor((width * 0.9) / (baseFontSize * 0.65)));
              if (trName.length > maxChars) {
                const shrinkFactor = maxChars / trName.length;
                size = Math.max(24, Math.floor(baseFontSize * shrinkFactor));
              }
            }

            return (
              <div
                key={`${name}-${index}`}
                style={{
                  position: 'absolute',
                  top: `${yOffset}px`,
                  left: 0,
                  right: 0,
                  fontFamily,
                  fontSize: `${size}px`,
                  fontWeight,
                  color: textColor,
                  height: `${itemH}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  textAlign: 'center',
                  textShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                  letterSpacing,
                  whiteSpace,
                  wordBreak,
                  lineHeight: `${size * 1.25}px`,
                  paddingTop: `${nameHeight * 0.2}px`,
                  paddingBottom: `${nameHeight * 0.4}px`,
                  boxSizing: 'border-box',
                  maxWidth: '90%',
                  margin: '0 auto',
                  overflow: 'visible',
                }}
              >
                {trName}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
