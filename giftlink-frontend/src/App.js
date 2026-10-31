import React, { useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import MainPage from './components/MainPage/MainPage';
import DetailsPage from './components/DetailsPage/DetailsPage';
import SearchPage from './components/SearchPage/SearchPage';
import LoginPage from './components/LoginPage/LoginPage';
import RegisterPage from './components/RegisterPage/RegisterPage';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import RequireAuth from './components/RequireAuth';
import Profile from './components/Profile/Profile';
import Navbar from './components/Navbar/Navbar';
import { MyPlans, CreatePlan, PlanDetail, EditPlan } from './components/MoveOutPlans/Plans';
import Inventory from './components/Inventory/Inventory';
import PublicItems from './components/Inventory/PublicItems';
import { RequestPickup, PickupDashboard, PickupDetail } from './components/Pickups/Pickups';
import Home from './components/Journeys/Home';

function RouteFocus() {
  const { pathname } = useLocation(); const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname) document.getElementById('main-content')?.focus();
    previous.current = pathname;
  }, [pathname]);
  return null;
}

function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Navbar />
      <RouteFocus />
      <div id="main-content" tabIndex={-1}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/home.html" element={<Home />} />
        <Route path="/app" element={<MainPage />} />
        <Route path="/app/product/:productId" element={<DetailsPage />} />
        <Route path="/app/search" element={<SearchPage />} />
        <Route path="/app/login" element={<LoginPage />} />
        <Route path="/app/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/app/register" element={<RegisterPage />} />
        <Route path="/app/plans" element={<RequireAuth><MyPlans /></RequireAuth>} />
        <Route path="/app/plans/new" element={<RequireAuth><CreatePlan /></RequireAuth>} />
        <Route path="/app/plans/:planId" element={<RequireAuth><PlanDetail /></RequireAuth>} />
        <Route path="/app/plans/:planId/edit" element={<RequireAuth><EditPlan /></RequireAuth>} />
        <Route path="/app/plans/:planId/items" element={<RequireAuth><Inventory /></RequireAuth>} />
        <Route path="/app/items" element={<PublicItems />} />
        <Route path="/app/items/:itemId" element={<PublicItems />} />
        <Route path="/app/items/:itemId/edit" element={<RequireAuth><Inventory /></RequireAuth>} />
        <Route path="/app/items/:itemId/request" element={<RequireAuth><RequestPickup /></RequireAuth>} />
        <Route path="/app/pickups" element={<RequireAuth><PickupDashboard key="sent" /></RequireAuth>} />
        <Route path="/app/pickups/incoming" element={<RequireAuth><PickupDashboard key="incoming" incoming /></RequireAuth>} />
        <Route path="/app/pickups/:requestId" element={<RequireAuth><PickupDetail /></RequireAuth>} />
      </Routes>
      </div>
      <footer className="site-footer"><p>Useful things, shared freely. One account for giving and finding.</p>
      </footer>
    </>
  );
}

export default App;
