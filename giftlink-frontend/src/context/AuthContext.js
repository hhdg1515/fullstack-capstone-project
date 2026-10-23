import React, { createContext, useState, useContext } from 'react';

const AppContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(sessionStorage.getItem('auth-token')));
  const [userName, setUserName] = useState(() => sessionStorage.getItem('name') || '');

  return (
    <AppContext.Provider value={{ isLoggedIn, setIsLoggedIn, userName, setUserName }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
