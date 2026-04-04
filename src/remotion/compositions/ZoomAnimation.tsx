import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

interface ZoomAnimationProps {
  startScale?: number;
  endScale?: number;
  focusX?: number;
  focusY?: number;
  children: React.ReactNode;
}

const clampScale = (value?: number, fallback = 1) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (value > 10) return value / 100;
  return value;
};

export const ZoomAnimation: React.FC<ZoomAnimationProps> = ({
  startScale,
  endScale,
  focusX = 50,
  focusY = 50,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const start = clampScale(startScale, 1);
  const end = clampScale(endScale, start);
  const scale = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [start, end], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const normalizedX = (focusX - 50) / 50;
  const normalizedY = (focusY - 50) / 50;
  const translateX = -(scale - 1) * normalizedX * 50;
  const translateY = -(scale - 1) * normalizedY * 50;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform: `translate(${translateX}%, ${translateY}%) scale(${scale})`,
        transformOrigin: `${focusX}% ${focusY}%`,
      }}
    >
      {children}
    </div>
  );
};

export default ZoomAnimation;
