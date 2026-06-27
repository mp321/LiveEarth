import { Suspense, lazy } from 'react';
import { AppProvider } from './state/AppContext';
import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import TelemetrySidebar from './components/TelemetrySidebar';
import { useRoute, navigateToGlobe } from './ground/route';

// Ground View is its own engine (street-level panorama) on its own route. It is
// lazy-loaded so mapillary-js stays out of the globe bundle and only downloads
// when a user actually opens it.
const GroundView = lazy(() => import('./ground/GroundView'));

// The globe and its floating overlays. The map fills the viewport (z-0); the
// overlay wrapper is pointer-events-none so map interactions pass through except
// on the panels.
function GlobeShell() {
  return (
    <>
      <MapView />
      <div className="pointer-events-none fixed inset-0 z-10">
        <ControlPanel />
        <TelemetrySidebar />
      </div>
    </>
  );
}

export default function App() {
  const route = useRoute();
  const onGround = route.name === 'ground';

  // AppProvider wraps both routes so the globe's layer/camera state survives a
  // Ground View round trip. Only the GLOBE (MapView's MapLibre canvas) unmounts
  // when Ground View opens — running two WebGL contexts at once is exactly what
  // this route avoids.
  return (
    <AppProvider>
      <main className="relative h-screen w-screen overflow-hidden bg-black">
        {onGround ? (
          <Suspense fallback={<GroundLoading />}>
            <GroundView lat={route.lat} lng={route.lng} onBack={navigateToGlobe} />
          </Suspense>
        ) : (
          <GlobeShell />
        )}
      </main>
    </AppProvider>
  );
}

function GroundLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center text-slate-400">
      Loading Ground View…
    </div>
  );
}
