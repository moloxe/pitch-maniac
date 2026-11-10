import { useEffect, useRef, useState, useCallback } from "react";
import { detectPitchYIN } from "./yin";

export function useMicrophonePitch(active: boolean = true) {
  const [pitch, setPitch] = useState<{ hz: number; midi: number; voiced: boolean }>({
    hz: 0,
    midi: 0,
    voiced: false,
  });
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const startMic = useCallback(async () => {
    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        streamRef.current = stream;
      }

      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      const ctx = audioCtxRef.current;
      const source = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      setHasMicPermission(true);

      const buffer = new Float32Array(analyser.fftSize);

      const loop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(buffer);

        const result = detectPitchYIN(buffer, ctx.sampleRate, 0.15, 65, 1000);
        setPitch(result);

        animFrameRef.current = requestAnimationFrame(loop);
      };

      loop();
    } catch (err) {
      console.warn("Could not access microphone:", err);
      setHasMicPermission(false);
    }
  }, []);

  const stopMic = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setPitch({ hz: 0, midi: 0, voiced: false });
  }, []);

  useEffect(() => {
    if (active) {
      startMic();
    } else {
      stopMic();
    }
    return () => {
      stopMic();
    };
  }, [active, startMic, stopMic]);

  return { pitch, hasMicPermission, startMic, stopMic };
}
