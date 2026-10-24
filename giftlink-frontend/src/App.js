import React from 'react';
import { Routes, Route } from 'react-router-dom';
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

function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<MainPage />} />
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
      </Routes>
    </>
  );
}

export default App;
