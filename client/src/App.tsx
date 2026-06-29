import { Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login          from './pages/Login';
import Dashboard      from './pages/Dashboard';
import AppDeployments from './pages/AppDeployments';
import DeploymentView from './pages/DeploymentView';
import UserManagement from './pages/UserManagement';
import Containers     from './pages/Containers';
import ContainerView  from './pages/ContainerView';

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={300}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <ProtectedRoute><Dashboard /></ProtectedRoute>
          } />
          <Route path="/apps/:uuid" element={
            <ProtectedRoute><AppDeployments /></ProtectedRoute>
          } />
          <Route path="/deployments/:uuid" element={
            <ProtectedRoute><DeploymentView /></ProtectedRoute>
          } />
          <Route path="/users" element={
            <ProtectedRoute><UserManagement /></ProtectedRoute>
          } />
          <Route path="/containers" element={
            <ProtectedRoute><Containers /></ProtectedRoute>
          } />
          <Route path="/containers/:id" element={
            <ProtectedRoute><ContainerView /></ProtectedRoute>
          } />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  );
}
