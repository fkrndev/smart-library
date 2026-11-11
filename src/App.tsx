import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { useTheme } from "./store/theme";
import { useLibrary } from "./store/library";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";

export default function App() {
  const initTheme = useTheme((s) => s.init);
  const refresh = useLibrary((s) => s.refresh);

  useEffect(() => {
    initTheme().then(() => refresh()).catch(() => refresh());
  }, [initTheme, refresh]);

  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/read/:bookId" element={<ReaderPage />} />
    </Routes>
  );
}
