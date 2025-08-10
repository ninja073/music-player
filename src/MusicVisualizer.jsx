// MusicVisualizer.jsx
import React, { useRef, useEffect, useState } from "react";

/**
 * MusicVisualizer
 * - Plays a local audio file chosen by the user.
 * - Circular bars + circular waveform.
 * - Embedded smoky particle cloud that slowly rotates and subtly pulses with the bass.
 * - Full screen design with custom controls and progress bar.
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fileName, setFileName] = useState("");

  // particles kept in a ref so animation loop doesn't re-create them each frame
  const particlesRef = useRef([]);
  const lastBassRef = useRef(0);

  // --- resize helper ---
  const resizeCanvas = (canvas) => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
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

  // Update progress bar
  useEffect(() => {
    if (!audioRef.current) return;

    const audio = audioRef.current;
    
    const updateProgress = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
    };

    const handleTimeUpdate = () => updateProgress();
    const handleLoadedMetadata = () => updateProgress();
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioFile]);

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
    if (!audioRef.current) return;
    
    setIsPlaying(true);
    try {
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      audioRef.current.play();
    } catch (e) {
      console.error('Error playing audio:', e);
      setIsPlaying(false);
    }
  };

  const handlePause = () => {
    if (!audioRef.current) return;
    
    setIsPlaying(false);
    audioRef.current.pause();
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
    setFileName(f.name.replace(/\.[^/.]+$/, "")); // Remove file extension
    // set audio element src immediately
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.load();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  };

  const handleProgressClick = (e) => {
    if (!audioRef.current || !duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)",
        color: "#ddd",
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioFile}
        preload="metadata"
        style={{ display: 'none' }}
      />

      {/* Top Left - File Selector */}
      <div style={{ 
        position: 'absolute',
        top: '30px',
        left: '30px',
        zIndex: 10,
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '15px',
          padding: '20px',
          minWidth: '200px'
        }}>
          <h3 style={{ 
            margin: '0 0 15px 0', 
            fontSize: '18px',
            fontWeight: '400',
            color: '#fff',
            textAlign: 'center'
          }}>
            SELECT AUDIO
          </h3>
          <input 
            type="file" 
            accept="audio/*" 
            onChange={handleFileChange}
            style={{
              width: '100%',
              padding: '10px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          />
        </div>
      </div>

      {/* Center Canvas Container */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        position: 'relative'
      }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '80vh',
            height: '80vh',
            maxWidth: '80vw',
            maxHeight: '80vh',
            borderRadius: '50%',
            boxShadow: '0 20px 80px rgba(0,0,0,0.8)',
            background: "#000",
          }}
        />
      </div>

      {/* Bottom Center - Player Controls */}
      <div style={{ 
        position: 'absolute',
        bottom: '50px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        textAlign: 'center',
        minWidth: '400px'
      }}>
        {/* Track Title */}
        {fileName && (
          <div style={{
            marginBottom: '25px',
            fontSize: '24px',
            fontWeight: '300',
            color: '#fff',
            textShadow: '0 2px 10px rgba(0,0,0,0.8)'
          }}>
            {fileName}
          </div>
        )}

        {/* Playback Controls */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'center',
          gap: '30px',
          marginBottom: '25px'
        }}>
          {/* Skip Backward */}
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '10px',
              borderRadius: '50%',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255,255,255,0.1)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'none';
            }}
          >
            ⏮️
          </button>

          {/* Play/Pause Button */}
          <button
            onClick={isPlaying ? handlePause : handlePlay}
            style={{
              width: '70px',
              height: '70px',
              borderRadius: '50%',
              border: 'none',
              background: isPlaying 
                ? 'linear-gradient(135deg, #ff6b6b, #ee5a24)' 
                : 'linear-gradient(135deg, #4ecdc4, #44a08d)',
              color: 'white',
              fontSize: '28px',
              cursor: 'pointer',
              boxShadow: '0 8px 25px rgba(0,0,0,0.3)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'scale(1.1)';
              e.target.style.boxShadow = '0 12px 35px rgba(0,0,0,0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'scale(1)';
              e.target.style.boxShadow = '0 8px 25px rgba(0,0,0,0.3)';
            }}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>

          {/* Skip Forward */}
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '10px',
              borderRadius: '50%',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255,255,255,0.1)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'none';
            }}
          >
            ⏭️
          </button>
        </div>

        {/* Progress Bar */}
        {audioFile && (
          <div style={{ 
            width: '100%',
            marginBottom: '20px'
          }}>
            <div
              onClick={handleProgressClick}
              style={{
                width: '100%',
                height: '6px',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '3px',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                marginBottom: '10px'
              }}
            >
              <div
                style={{
                  width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #4ecdc4, #44a08d)',
                  borderRadius: '3px',
                  transition: 'width 0.1s ease',
                  position: 'relative'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${duration ? (currentTime / duration) * 100 : 0}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '14px',
                  height: '14px',
                  background: '#fff',
                  borderRadius: '50%',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  cursor: 'pointer'
                }}
              />
            </div>
            
            {/* Time Display */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              fontSize: '14px',
              color: 'rgba(255,255,255,0.8)'
            }}>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}
      </div>

      {/* File Selection Prompt */}
      {!audioFile && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.6)',
          fontSize: '18px',
          zIndex: 5,
          background: 'rgba(0,0,0,0.5)',
          padding: '30px',
          borderRadius: '15px',
          backdropFilter: 'blur(10px)'
        }}>
          Choose an audio file to visualize
        </div>
      )}
    </div>
  );
}
