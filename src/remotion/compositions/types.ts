export type SubtitleStyle = 'karaoke' | 'highlight' | 'bounce' | 'none';
export type TransitionType = 'fade' | 'slide' | 'zoom-in';

export interface ZoomConfig {
  startScale?: number;
  endScale?: number;
  focusX?: number;
  focusY?: number;
}

export interface ClipConfig {
  startTime: number;
  endTime: number;
  zoom?: ZoomConfig;
  transition?: TransitionType;
}

export interface CaptionWordSegment {
  word: string;
  start: number;
  end: number;
}

export interface CaptionConfig {
  enabled: boolean;
  style: SubtitleStyle;
  segments: CaptionWordSegment[];
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  strokeColor?: string;
  strokeWidth?: string;
  position?: string;
  maxLength?: number;
}

export interface BrollItem {
  url: string;
  startTime: number;
  endTime: number;
  query?: string;
}

export interface OutputFormat {
  width: number;
  height: number;
  fps: number;
}

export interface VideoCompositionProps {
  videoUrl: string;
  clips: ClipConfig[];
  captions: CaptionConfig;
  brolls: BrollItem[];
  transitions: TransitionType;
  duration: number;
  outputFormat: OutputFormat;
}
