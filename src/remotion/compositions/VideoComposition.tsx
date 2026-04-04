import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import BrollOverlay from './BrollOverlay';
import CaptionRenderer from './CaptionRenderer';
import ZoomAnimation from './ZoomAnimation';
import type { ClipConfig, TransitionType, VideoCompositionProps } from './types';

interface ClipWithTimeline extends ClipConfig {
  from: number;
  durationInFrames: number;
  index: number;
  transition: TransitionType;
}

const getTransitionType = (clip: ClipConfig, globalTransition: TransitionType): TransitionType => {
  if (clip.transition === 'slide' || clip.transition === 'zoom-in' || clip.transition === 'fade') {
    return clip.transition;
  }

  return globalTransition;
};

const ClipLayer: React.FC<{ clip: ClipWithTimeline; videoUrl: string }> = ({ clip, videoUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const transitionFrames = Math.max(2, Math.round(0.35 * fps));

  const opacity =
    clip.index === 0
      ? 1
      : interpolate(frame, [0, transitionFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const transitionTransform = (() => {
    if (clip.index === 0) return 'none';

    if (clip.transition === 'slide') {
      const x = interpolate(frame, [0, transitionFrames], [18, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      return `translateX(${x}%)`;
    }

    if (clip.transition === 'zoom-in') {
      const scale = interpolate(frame, [0, transitionFrames], [1.08, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      return `scale(${scale})`;
    }

    return 'none';
  })();

  const startFrom = Math.max(0, Math.round(clip.startTime * fps));
  const endAt = Math.max(startFrom + 1, Math.round(clip.endTime * fps));

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        opacity,
        transform: transitionTransform,
      }}
    >
      <ZoomAnimation
        startScale={clip.zoom?.startScale ?? 1}
        endScale={clip.zoom?.endScale ?? clip.zoom?.startScale ?? 1}
        focusX={clip.zoom?.focusX ?? 50}
        focusY={clip.zoom?.focusY ?? 50}
      >
        <OffthreadVideo
          src={videoUrl}
          startFrom={startFrom}
          endAt={endAt}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </ZoomAnimation>
    </AbsoluteFill>
  );
};

export const VideoComposition: React.FC<VideoCompositionProps> = ({
  videoUrl,
  clips,
  captions,
  brolls,
  transitions,
  duration,
}) => {
  const { fps } = useVideoConfig();

  const safeClips = useMemo<ClipConfig[]>(() => {
    if (Array.isArray(clips) && clips.length > 0) return clips;
    return [{ startTime: 0, endTime: Math.max(1, duration || 30) }];
  }, [clips, duration]);

  const timelineClips = useMemo<ClipWithTimeline[]>(() => {
    let cursor = 0;

    return safeClips.map((clip, index) => {
      const clipDuration = Math.max(0.1, clip.endTime - clip.startTime);
      const durationInFrames = Math.max(1, Math.round(clipDuration * fps));
      const from = Math.round(cursor * fps);
      cursor += clipDuration;

      return {
        ...clip,
        from,
        durationInFrames,
        index,
        transition: getTransitionType(clip, transitions || 'fade'),
      };
    });
  }, [safeClips, fps, transitions]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {timelineClips.map((clip) => (
        <Sequence
          key={`${clip.startTime}-${clip.endTime}-${clip.index}`}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
        >
          <ClipLayer clip={clip} videoUrl={videoUrl} />
        </Sequence>
      ))}

      <BrollOverlay brolls={brolls || []} />
      <CaptionRenderer captions={captions} />
    </AbsoluteFill>
  );
};

export default VideoComposition;
