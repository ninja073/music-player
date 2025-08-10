// MusicVisualizer.jsx
import React, { useRef, useEffect, useState } from "react";

/**
 * MusicVisualizer
 * - Plays a local audio file chosen by the user.
 * - Circular bars + circular waveform.
 * - Embedded smoky particle cloud that slowly rotates and subtly pulses with the bass.
 *
 * Notes:
 * - Works with local files (input type="file").
 * - No external libs. Uses Web Audio API + Canvas.
 */

export default function MusicVisualizer() {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);

  const [audioFile, setAudioFile] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // particles kept in a ref so animation loop doesn't re-create them each frame
  const particlesRef = useRef([]);
  const lastBassRef = useRef(0);

  // --- resize helper ---
  const resizeCanvas = (canvas) => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(200, rect.width);
    const height = Math.max(200, rect.height);
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${Math.round(width)}px`;
      canvas.style.height = `${Math.round(height)}px`;
    }
  };

  // initialize particles
  const initParticles = (count, radius) => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        baseAngle: Math.random() * Math.PI * 2,
        distance: radius + 20 + Math.random() * 240,
        size: 6 + Math.random() * 30,
        baseAlpha: 0.06 + Math.random() * 0.22,
        rotationSpeed: (Math.random() - 0.5) * 0.002, // slow independent drift
        pulseMul: 0.6 + Math.random() * 1.4,
      });
    }
    return arr;
  };

  // Cleanly shutdown audio nodes + animation
  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    try {
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect();
        } catch {}
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect();
        } catch {}
        analyserRef.current = null;
      }
      if (audioCtxRef.current) {
        const a = audioCtxRef.current;
        audioCtxRef.current = null;
        // close context if allowed
        try {
          a.close();
        } catch {}
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    // cleanup on unmount
    return () => {
      cleanup();
      // revoke object URL if any
      if (audioFile && audioFile.startsWith("blob:"))
        URL.revokeObjectURL(audioFile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!audioFile) return;

    cleanup(); // remove previous context/raf if any

    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    const ctx = canvas.getContext("2d");

    // Size canvas initially
    resizeCanvas(canvas);

    // Create audio context + analyser
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    // create analyser
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048; // good balance; gives finer low-frequency resolution
    analyser.smoothingTimeConstant = 0.85;
    analyserRef.current = analyser;

    // create source (disconnect previous if any)
    try {
      if (sourceRef.current) sourceRef.current.disconnect();
    } catch {}
    const source = audioCtx.createMediaElementSource(audioEl);
    sourceRef.current = source;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const bufferLength = analyser.frequencyBinCount; // fftSize/2
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(analyser.fftSize);

    // geometry params
    const dpr = window.devicePixelRatio || 1;
    let centerX = canvas.width / 2;
    let centerY = canvas.height / 2;
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.12; // dynamic radius
    let rotation = 0;

    // initialize particles
    particlesRef.current = initParticles(70, baseRadius);

    // handle resize
    const handleResize = () => {
      resizeCanvas(canvas);
      centerX = canvas.width / 2;
      centerY = canvas.height / 2;
    };
    window.addEventListener("resize", handleResize);

    // smoothing for bass
    lastBassRef.current = 0;

    // animation loop
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      // update sizes in case canvas changed
      const W = canvas.width;
      const H = canvas.height;
      centerX = W / 2;
      centerY = H / 2;

      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      // compute bass energy: average of lowest N bins
      const bassBinCount = Math.max(4, Math.floor(bufferLength * 0.06)); // ~6% of bins
      let bassSum = 0;
      for (let i = 0; i < bassBinCount; i++) bassSum += freqData[i];
      const bassAvg = bassSum / bassBinCount / 255; // normalized 0..1

      // smooth bass (EMA) to avoid jitter
      const smoothFactor = 0.08; // smaller => smoother
      const last = lastBassRef.current;
      const smoothedBass = last * (1 - smoothFactor) + bassAvg * smoothFactor;
      lastBassRef.current = smoothedBass;

      // normalized value used for pulsing
      const pulse = Math.min(1, smoothedBass * 1.6); // clamp and amplify a bit

      // clear canvas
      ctx.clearRect(0, 0, W, H);

      // subtle radial background
      const bgGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.5,
        centerX,
        centerY,
        Math.max(W, H) * 0.7
      );
      bgGrad.addColorStop(0, `rgba(20,24,40,${0.25 + pulse * 0.12})`);
      bgGrad.addColorStop(1, `rgba(4,6,10,0.95)`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // center transform
      ctx.save();
      ctx.translate(centerX, centerY);

      // rotate slowly; rotation speeds up subtly with bass
      rotation += 0.0009 + pulse * 0.006;

      // --- Draw smoky particles (lighter blending for glow) ---
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];
        // update particle angle slightly
        p.baseAngle += p.rotationSpeed + pulse * 0.0008;
        const ang = p.baseAngle + rotation * (0.6 + (i % 5) * 0.02);

        // pulse affects size and alpha but subtly
        const size = p.size * (1 + pulse * 0.9 * p.pulseMul);
        const alpha = Math.min(1, p.baseAlpha * (0.6 + pulse * 1.5));

        const x = Math.cos(ang) * p.distance;
        const y = Math.sin(ang) * p.distance;

        ctx.beginPath();
        ctx.fillStyle = `rgba(120,160,255,${alpha})`; // cool-blue smoke
        ctx.shadowBlur = 28 + pulse * 40;
        ctx.shadowColor = `rgba(120,160,255,${alpha})`;
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      // reset composite + shadow
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";

      // --- Circular Bars ---
      const barsCount = 128;
      const step = Math.floor(bufferLength / barsCount);
      const maxBarLen = Math.min(W, H) * 0.28 + pulse * Math.min(W, H) * 0.18; // responsive to bass
      for (let i = 0; i < barsCount; i++) {
        // average a small block for smoother bars
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freqData[i * step + j] || 0;
        const v = sum / step / 255;
        const barLen = v * maxBarLen;

        const angle = (i / barsCount) * Math.PI * 2;
        const x = Math.cos(angle) * baseRadius;
        const y = Math.sin(angle) * baseRadius;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        // color mapped to position and bass
        const hue = Math.round((i / barsCount) * 320);
        ctx.fillStyle = `hsla(${hue}, 80%, ${45 + v * 20}%, ${0.95})`;
        // draw rectangle outward (slightly rounded by drawing a small rect)
        const bw = Math.max(1.6, Math.min(W, H) / 300);
        ctx.fillRect(-bw / 2, 0, bw, barLen);
        ctx.restore();
      }

      // --- Circular waveform (time domain) ---
      ctx.beginPath();
      const wavePoints = 256; // number of points sampled for the waveform
      const waveAmp = Math.min(W, H) * 0.06 + pulse * Math.min(W, H) * 0.08;
      for (let i = 0; i < wavePoints; i++) {
        // sample timeData at scaled indices
        const idx = Math.floor((i / wavePoints) * timeData.length);
        const val = (timeData[idx] - 128) / 128; // -1..1
        const r = baseRadius + val * waveAmp;
        const angle = (i / wavePoints) * Math.PI * 2;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = 2 + pulse * 2;
      ctx.strokeStyle = `rgba(230,240,255,${0.55 + pulse * 0.25})`;
      ctx.shadowBlur = 14 + pulse * 30;
      ctx.shadowColor = "rgba(200,220,255,0.75)";
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.restore(); // restore after translate

      // small center glow
      ctx.save();
      ctx.translate(centerX, centerY);
      const glowRadius = Math.max(
        8,
        baseRadius * 0.2 + pulse * baseRadius * 0.25
      );
      const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius * 2);
      coreGrad.addColorStop(
        0,
        `rgba(255,255,255,${0.9 * (0.6 + pulse * 0.4)})`
      );
      coreGrad.addColorStop(1, `rgba(120,160,255,0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, glowRadius * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // start loop
    draw();

    // cleanup + listeners on effect teardown
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      try {
        if (sourceRef.current) {
          sourceRef.current.disconnect();
          sourceRef.current = null;
        }
        if (analyser) analyser.disconnect();
        if (audioCtx) audioCtx.close();
      } catch (e) {}
    };
    // audioFile intentionally controls re-run when changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioFile]);

  // ensure audioContext resumes on user play action (autoplay policies)
  const handlePlay = async () => {
    setIsPlaying(true);
    try {
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
    } catch (e) {}
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (audioFile && audioFile.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(audioFile);
      } catch (e) {}
    }
    const url = URL.createObjectURL(f);
    setAudioFile(url);
    // set audio element src immediately
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.load();
    }
  };

  return (
    <div
      style={{
        textAlign: "center",
        padding: 16,
        background: "#000",
        color: "#ddd",
        minHeight: 480,
      }}
    >
      <h3 style={{ margin: "8px 0 12px 0" }}>
        Circular Music Visualizer — smoky, bass-reactive
      </h3>

      <div style={{ marginBottom: 12 }}>
        <input type="file" accept="audio/*" onChange={handleFileChange} />
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {audioFile ? (
          <audio
            ref={audioRef}
            src={audioFile}
            controls
            onPlay={handlePlay}
            onPause={handlePause}
            style={{ width: "100%", marginBottom: 12 }}
          />
        ) : (
          <div style={{ color: "#888", marginBottom: 12 }}>
            Choose an audio file to visualize (mp3/wav/etc.)
          </div>
        )}
        <div
          style={{ width: "100%", display: "flex", justifyContent: "center" }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: 500,
              height: 500,
              borderRadius: "50%",
              boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
              background: "#000",
            }}
          />
        </div>
      </div>
    </div>
  );
}
