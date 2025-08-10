import "./App.css";
import MusicVisualizer from "./MusicVisualizer";

function App() {
  // You can replace this with your own audio file URL
  const sampleAudioUrl =
    "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav";

  return (
    <>
      <MusicVisualizer audioUrl={sampleAudioUrl} />
    </>
  );
}

export default App;
