import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/error-boundary";
import { useLiveStore } from "./store/use-live-store";
import { WsClient } from "./lib/ws-client";
import { fetchTopology, fetchTraces } from "./lib/api";
import { Header } from "./components/header";
import { LivePage } from "./pages/live-page";
import { TracePage } from "./pages/trace-page";
import { HistoryPage } from "./pages/history-page";
import { DayPage } from "./pages/day-page";
import { SearchPage } from "./pages/search-page";
import { ErrorsPage } from "./pages/errors-page";
import { ServicePage } from "./pages/service-page";

export function App() {
  const location = useLocation();
  // The websocket + REST fallback live in the root layout so the connection
  // survives navigation between the live feed and trace-detail pages.
  useEffect(() => {
    const store = useLiveStore.getState();

    const client = new WsClient({
      onOpen: () => store.setConnected(true),
      onClose: () => store.setConnected(false),
      onMessage: (msg) => useLiveStore.getState().applyWsMessage(msg),
    });
    client.connect();

    // REST fallback so the UI has data even before the first ws frame.
    fetchTraces(100)
      .then((r) => {
        // only seed if the ws snapshot hasn't populated yet
        if (useLiveStore.getState().traces.length === 0) {
          useLiveStore.getState().applyTraces(r.traces);
        }
      })
      .catch(() => {});
    fetchTopology()
      .then((r) => {
        if (useLiveStore.getState().topology.nodes.length === 0) {
          useLiveStore.getState().applyTopology(r.topology, r.mermaidFlow);
        }
      })
      .catch(() => {});

    return () => client.close();
  }, []);

  return (
    <div className="app">
      <Header />
      <ErrorBoundary key={location.pathname}>
        <Routes>
          <Route path="/" element={<LivePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/day/:date" element={<DayPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/errors" element={<ErrorsPage />} />
          <Route path="/service/:name" element={<ServicePage />} />
          <Route path="/trace/:traceId" element={<TracePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
