import React from 'react';
import { Composition } from 'remotion';
import VideoComposition from './compositions/VideoComposition';
import type { VideoCompositionProps } from './compositions/types';

const defaultProps: VideoCompositionProps = {
  videoUrl: '',
  clips: [{ startTime: 0, endTime: 30, zoom: { startScale: 1, endScale: 1, focusX: 50, focusY: 50 } }],
  captions: {
    enabled: true,
    style: 'highlight',
    segments: [],
    fontFamily: 'Montserrat',
    fontWeight: '700',
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: '1.6 vmin',
    position: '80%',
    maxLength: 14,
  },
  brolls: [],
  transitions: 'fade',
  duration: 30,
  outputFormat: {
    width: 720,
    height: 1280,
    fps: 30,
  },
};

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoComposition"
        component={VideoComposition}
        durationInFrames={900}
        fps={30}
        width={720}
        height={1280}
        defaultProps={defaultProps}
      />
    </>
  );
};

export default RemotionRoot;
