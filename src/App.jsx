import { AppProvider } from './state/AppContext';
import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import TelemetrySidebar from './components/TelemetrySidebar';

// The map fills the viewport (z-0); overlays float above it. The overlay wrapper
// is pointer-events-none so map interactions pass through except on the panels.
export default function App() {
  return (
    <AppProvider>
      <main className="relative h-screen w-screen overflow-hidden bg-black">
        <MapView />
        <div className="pointer-events-none fixed inset-0 z-10">
          <ControlPanel />
          <TelemetrySidebar />
        </div>
      </main>
    </AppProvider>
  );
}
