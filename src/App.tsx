import { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { VehicleSimulatorPage } from "./pages/VehicleSimulatorPage";
import { HomeOfficeSimulatorPage } from "./pages/HomeOfficeSimulatorPage";
import { RemunerationSimulatorPage } from "./pages/RemunerationSimulatorPage";
import { MaterielSimulatorPage } from "./pages/MaterielSimulatorPage";
import { RulesPage } from "./pages/RulesPage";

export type Page = "home" | "vehicle" | "homeOffice" | "remuneration" | "materiel" | "rules";

function App() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div className="app">
      <header className="app__header">
        <button type="button" className="app__brand" onClick={() => setPage("home")}>
          🇫🇷 Simulateurs de coûts d'entreprise
        </button>
        <nav className="app__nav">
          <button type="button" className={page === "vehicle" ? "active" : ""} onClick={() => setPage("vehicle")}>
            🚗 Véhicule
          </button>
          <button type="button" className={page === "homeOffice" ? "active" : ""} onClick={() => setPage("homeOffice")}>
            🏠 Bureau à domicile
          </button>
          <button type="button" className={page === "remuneration" ? "active" : ""} onClick={() => setPage("remuneration")}>
            💰 Rémunération
          </button>
          <button type="button" className={page === "materiel" ? "active" : ""} onClick={() => setPage("materiel")}>
            💻 Matériel
          </button>
          <button type="button" className={page === "rules" ? "active" : ""} onClick={() => setPage("rules")}>
            📚 Règles fiscales
          </button>
        </nav>
      </header>

      <main className="app__main">
        {page === "home" && <HomePage onNavigate={setPage} />}
        {page === "vehicle" && <VehicleSimulatorPage />}
        {page === "homeOffice" && <HomeOfficeSimulatorPage />}
        {page === "remuneration" && <RemunerationSimulatorPage />}
        {page === "materiel" && <MaterielSimulatorPage />}
        {page === "rules" && <RulesPage />}
      </main>

      <footer className="app__footer">
        <p>
          Outil d'aide à la décision — ne remplace pas l'avis d'un expert-comptable. Toutes les règles utilisées et
          leurs sources sont listées dans la page « Règles fiscales ».
        </p>
      </footer>
    </div>
  );
}

export default App;
