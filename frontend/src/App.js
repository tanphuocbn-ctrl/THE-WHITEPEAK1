import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/AppShell";

import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";

import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import ProjectLayout from "@/pages/project/ProjectLayout";
import Structure from "@/pages/project/Structure";
import Board from "@/pages/project/Board";
import ScriptImport from "@/pages/project/ScriptImport";
import Members from "@/pages/project/Members";
import AuditLog from "@/pages/project/AuditLog";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:id" element={<ProjectLayout />}>
                <Route index element={<Structure />} />
                <Route path="board" element={<Board />} />
                <Route path="script" element={<ScriptImport />} />
                <Route path="members" element={<Members />} />
                <Route path="audit" element={<AuditLog />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
