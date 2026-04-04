import React from 'react';
import { AbsoluteFill, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BrollItem } from './types';

interface BrollOverlayProps {
  brolls: BrollItem[];
}

export const BrollOverlay: React.FC<BrollOverlayProps> = ({ brolls }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = frame / fps;

  const active = brolls.find((item) => now >= item.startTime && now <= item.endTime);
  if (!active) return null;

  const fadeDuration = 0.3;
  const fadeInEnd = Math.min(active.endTime, active.startTime + fadeDuration);
  const fadeOutStart = Math.max(active.startTime, active.endTime - fadeDuration);

  const fadeIn = interpolate(now, [active.startTime, fadeInEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(now, [fadeOutStart, active.endTime], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.max(0, Math.min(1, Math.min(fadeIn, fadeOut)));

  return (
    <AbsoluteFill style={{ opacity, zIndex: 25 }}>
      <OffthreadVideo
        src={active.url}
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </AbsoluteFill>
  );
};

export default BrollOverlay;
