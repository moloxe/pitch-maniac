export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: number;
  vocals_path: string;
  no_vocals_path: string;
  pitch_path: string;
  thumb_path?: string | null;
  lyrics?: string | null;
}

export interface PitchFrame {
  t: number;
  hz: number;
  midi: number;
  voiced: boolean;
}

export interface PitchData {
  version: number;
  frames: PitchFrame[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  duration?: number;
  uploader?: string;
  url: string;
}

export interface ProgressEventPayload {
  percent: number;
  message: string;
}
