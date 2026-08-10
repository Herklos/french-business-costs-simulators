import { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { VehicleSimulatorPage } from "./pages/VehicleSimulatorPage";
import { HomeOfficeSimulatorPage } from "./pages/HomeOfficeSimulatorPage";
import { RemunerationSimulatorPage } from "./pages/RemunerationSimulatorPage";
import { MaterielSimulatorPage } from "./pages/MaterielSimulatorPage";
import { MutuellePrevoyanceSimulatorPage } from "./pages/MutuellePrevoyanceSimulatorPage";
import { RetraiteSimulatorPage } from "./pages/RetraiteSimulatorPage";
import { HoldingSimulatorPage } from "./pages/HoldingSimulatorPage";
import { ConsolidatedPage } from "./pages/ConsolidatedPage";
import { RulesPage } from "./pages/RulesPage";
import { clearShareFromUrl, readShareFromUrl } from "./lib/urlShare";

export type Page =
  | "home"
  | "vehicle"
  | "homeOffice"
  | "remuneration"
  | "materiel"
  | "mutuelle"
  | "retraite"
  | "holding"
  | "consolidated"
  | "rules";

const VALID_PAGES: Page[] = [
  "home",
  "vehicle",
  "homeOffice",
  "remuneration",
  "materiel",
  "mutuelle",
  "retraite",
  "holding",
  "consolidated",
  "rules",
];

// Lue une seule fois, avant le premier rendu : si l'URL contient un lien de partage
// (?page=...&data=...), on démarre directement sur la page concernée — le simulateur ciblé lit
// ensuite lui-même `initialShareData` pour pré-remplir son formulaire. cf. lib/urlShare.ts.
const initialShare = readShareFromUrl();
const initialPage: Page =
  initialShare && VALID_PAGES.includes(initialShare.page as Page) ? (initialShare.page as Page) : "home";
if (initialShare) clearShareFromUrl();

// Ne renvoie les données partagées QUE pour la page qu'elles ciblent — sinon, en cas de navigation
// ultérieure vers un autre simulateur, ce dernier tenterait de décoder un objet de forme différente
// (ex. un partage "matériel" injecté dans le formulaire "véhicule"), silencieusement corrompu.
function shareDataFor(kind: Page): string | undefined {
  return initialShare?.page === kind ? initialShare.data : undefined;
}

function App() {
  const [page, setPage] = useState<Page>(initialPage);

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
          <button type="button" className={page === "mutuelle" ? "active" : ""} onClick={() => setPage("mutuelle")}>
            🩺 Mutuelle
          </button>
          <button type="button" className={page === "retraite" ? "active" : ""} onClick={() => setPage("retraite")}>
            🏦 Retraite
          </button>
          <button type="button" className={page === "holding" ? "active" : ""} onClick={() => setPage("holding")}>
            🏛️ Holding
          </button>
          <button type="button" className={page === "consolidated" ? "active" : ""} onClick={() => setPage("consolidated")}>
            📊 Vue consolidée
          </button>
          <button type="button" className={page === "rules" ? "active" : ""} onClick={() => setPage("rules")}>
            📚 Règles fiscales
          </button>
        </nav>
      </header>

      <main className="app__main">
        {page === "home" && <HomePage onNavigate={setPage} />}
        {page === "vehicle" && <VehicleSimulatorPage initialShareData={shareDataFor("vehicle")} />}
        {page === "homeOffice" && <HomeOfficeSimulatorPage initialShareData={shareDataFor("homeOffice")} />}
        {page === "remuneration" && <RemunerationSimulatorPage initialShareData={shareDataFor("remuneration")} />}
        {page === "materiel" && <MaterielSimulatorPage initialShareData={shareDataFor("materiel")} />}
        {page === "mutuelle" && <MutuellePrevoyanceSimulatorPage initialShareData={shareDataFor("mutuelle")} />}
        {page === "retraite" && <RetraiteSimulatorPage initialShareData={shareDataFor("retraite")} />}
        {page === "holding" && <HoldingSimulatorPage initialShareData={shareDataFor("holding")} />}
        {page === "consolidated" && <ConsolidatedPage onNavigate={setPage} />}
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
