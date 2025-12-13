import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import DeputiesTable from "./components/DeputiesTable.jsx";
import InitiativesTable from "./components/InitiativesTable.jsx";
import "./index.css";

function Router() {
  const [route, setRoute] = useState(window.location.hash || '');

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (route === '#/diputados') {
    return <DeputiesTable onBack={() => {
      window.location.hash = '';
      window.location.reload();
    }} />;
  }

  if (route === '#/iniciativas') {
    return <InitiativesTable onBack={() => {
      window.location.hash = '';
      window.location.reload();
    }} />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
