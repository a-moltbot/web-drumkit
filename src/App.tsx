import { Navigate, Route, Routes } from 'react-router-dom';
import DrumkitPage from './pages/DrumkitPage';
import PianoPage from './pages/PianoPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/drum" replace />} />
      <Route path="/drum" element={<DrumkitPage />} />
      <Route path="/piano" element={<PianoPage />} />
      <Route path="*" element={<Navigate to="/drum" replace />} />
    </Routes>
  );
}
