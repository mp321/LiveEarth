import { AppProvider } from './state/AppContext';
import GlobeView from './components/GlobeView';
import ControlPanel from './components/ControlPanel';
import TelemetrySidebar from './components/TelemetrySidebar';

// -----------------------------------------------------------------------------
// App shell
// -----------------------------------------------------------------------------
// AppProvider supplies the shared state. The GlobeView fills the viewport as a
// fixed background layer (z-0); the overlays float above it (z-20). The wrapper
// is pointer-events-none so globe interactions pass through everywhere except
// the panels, which re-enable pointer events on themselves.
// -----------------------------------------------------------------------------

export default function App() {
  return (
    <AppProvider>
      <main className="relative h-screen w-screen overflow-hidden bg-black">
        <GlobeView />
        <div className="pointer-events-none fixed inset-0 z-10">
          <ControlPanel />
          <TelemetrySidebar />
        </div>
      </main>
    </AppProvider>
  );
}
