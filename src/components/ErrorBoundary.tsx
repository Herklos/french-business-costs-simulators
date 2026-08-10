import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Appelé quand une erreur est capturée — utilisé pour ramener l'app à un état sain (ex. retour à l'accueil). */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Filet de sécurité pour toute la partie applicative (cf. App.tsx) : sans lui, une erreur de rendu
 * dans un simulateur (ex. un lien de partage corrompu qui échappe à mergeSharedInputs, un bug de
 * calcul) fait planter l'intégralité de la page — React démonte tout l'arbre, l'utilisateur se
 * retrouve devant un écran blanc sans aucune indication. Affiche à la place un message récupérable
 * et un bouton de retour à l'accueil.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erreur non interceptée dans l'application :", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="page error-boundary">
          <h2>⚠️ Une erreur inattendue s'est produite</h2>
          <p className="page__intro">
            Ce simulateur a rencontré un problème de calcul ou d'affichage. Vos autres simulations
            sauvegardées ne sont pas affectées (elles restent dans le stockage local du navigateur).
          </p>
          <p className="warning-block">{this.state.error.message}</p>
          <button type="button" className="btn btn--primary" onClick={this.handleReset}>
            ← Retour à l'accueil
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
