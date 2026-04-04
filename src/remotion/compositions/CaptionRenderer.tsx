import React, { useMemo } from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionConfig, CaptionWordSegment } from './types';

interface CaptionRendererProps {
  captions: CaptionConfig;
}

interface CaptionLine {
  start: number;
  end: number;
  words: CaptionWordSegment[];
}

const buildCaptionLines = (segments: CaptionWordSegment[], maxWordsPerLine = 6): CaptionLine[] => {
  if (!segments.length) return [];

  const lines: CaptionLine[] = [];
  let currentWords: CaptionWordSegment[] = [];
  let lineStart = segments[0].start;

  for (let i = 0; i < segments.length; i++) {
    const word = segments[i];
    currentWords.push(word);

    const isLast = i === segments.length - 1;
    const nextGap = isLast ? 0 : (segments[i + 1].start - word.end);
    const shouldBreak = currentWords.length >= maxWordsPerLine || nextGap > 0.45 || isLast;

    if (shouldBreak) {
      lines.push({
        start: lineStart,
        end: word.end,
        words: currentWords,
      });
      currentWords = [];
      if (!isLast) lineStart = segments[i + 1].start;
    }
  }

  return lines;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const CaptionRenderer: React.FC<CaptionRendererProps> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = frame / fps;

  const lines = useMemo(() => buildCaptionLines(captions.segments || []), [captions.segments]);
  if (!captions.enabled || captions.style === 'none' || lines.length === 0) return null;

  const activeLine =
    lines.find((line) => now >= line.start && now <= line.end + 0.05) ||
    [...lines].reverse().find((line) => now > line.end) ||
    null;

  if (!activeLine) return null;

  const currentWordIndex = activeLine.words.findIndex((word) => now >= word.start && now <= word.end);
  const fallbackIndex = activeLine.words.findIndex((word) => now < word.start);
  const activeIndex = currentWordIndex >= 0
    ? currentWordIndex
    : (fallbackIndex >= 0 ? Math.max(0, fallbackIndex - 1) : activeLine.words.length - 1);

  const position = captions.position || '80%';
  const textColor = captions.color || '#ffffff';
  const strokeColor = captions.strokeColor || '#000000';

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: position,
        transform: 'translate(-50%, -50%)',
        width: '88%',
        textAlign: 'center',
        fontFamily: captions.fontFamily || 'Montserrat, sans-serif',
        fontWeight: Number(captions.fontWeight || 700),
        fontSize: '4.6vh',
        lineHeight: 1.15,
        color: textColor,
        textShadow: `0 0 18px rgba(0, 0, 0, 0.85), 0 4px 12px rgba(0, 0, 0, 0.9), -1px -1px 0 ${strokeColor}, 1px -1px 0 ${strokeColor}, -1px 1px 0 ${strokeColor}, 1px 1px 0 ${strokeColor}`,
        zIndex: 40,
      }}
    >
      {activeLine.words.map((word, index) => {
        const isPast = now > word.end;
        const isCurrent = index === activeIndex;
        const isFuture = index > activeIndex;

        const progress = isCurrent
          ? clamp((now - word.start) / Math.max(0.01, word.end - word.start))
          : isPast ? 1 : 0;

        const bounceScale = spring({
          fps,
          frame: frame - Math.round(word.start * fps),
          config: {
            damping: 13,
            stiffness: 180,
            mass: 0.4,
          },
        });

        const commonStyle: React.CSSProperties = {
          display: 'inline-block',
          marginRight: '0.22em',
          opacity: isFuture && captions.style !== 'karaoke' ? 0.95 : 1,
          color: textColor,
        };

        if (captions.style === 'karaoke') {
          if (isPast) {
            commonStyle.color = '#facc15';
          } else if (isCurrent) {
            const fillPercent = Math.round(progress * 100);
            commonStyle.background = `linear-gradient(90deg, #facc15 ${fillPercent}%, ${textColor} ${fillPercent}%)`;
            commonStyle.WebkitBackgroundClip = 'text';
            commonStyle.color = 'transparent';
          }
        }

        if (captions.style === 'highlight' && isCurrent) {
          commonStyle.color = '#facc15';
        }

        if (captions.style === 'bounce' && isCurrent) {
          commonStyle.color = '#facc15';
          commonStyle.transform = `translateY(${(1 - bounceScale) * 8}px) scale(${1 + bounceScale * 0.15})`;
        }

        return (
          <span key={`${word.word}-${word.start}-${index}`} style={commonStyle}>
            {word.word}
          </span>
        );
      })}
    </div>
  );
};

export default CaptionRenderer;
