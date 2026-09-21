/**
 * Terza interfaccia di servizio del piano (§11.1): filesystem e dialoghi.
 *
 * Il Core non scrive file — non può, glielo vieta la regola di dipendenza
 * verificata dal lint (§11.2). Dichiara però *cosa* significa scrivere, così
 * la stessa UI funziona sopra un browser, sopra Tauri o sopra Electron senza
 * accorgersene, e la scelta fra i due "smette di essere irreversibile".
 *
 * Qui c'è solo il contratto: le implementazioni stanno dove possono toccare
 * l'host.
 */

export interface ExportFile {
  /**
   * Nome relativo del file. Chi lo compone deve seguire l'ordine di lettura del
   * documento, non quello del filesystem (Appendice C, regola 1): un
   * ordinamento alfabetico che non corrisponde alla lettura è un errore che si
   * scopre solo quando qualcuno apre l'archivio.
   */
  name: string;
  data: Uint8Array | string;
  mediaType: string;
}

export interface WriteOutcome {
  written: number;
  /** Dove sono finiti, in forma leggibile: una cartella, "download", il nome di un archivio. */
  destination: string;
}

export interface PlatformService {
  readonly name: string;
  /**
   * Se l'host sa farsi indicare una cartella. Dove non può (un browser senza
   * l'API di accesso al filesystem), i file escono comunque — ma la
   * destinazione la decide l'host, e la UI deve dirlo invece di promettere
   * un percorso che non controlla.
   */
  readonly canChooseDestination: boolean;
  /** Chiede all'utente dove scrivere. Restituisce un'etichetta leggibile, o null se annulla. */
  chooseDestination(): Promise<string | null>;
  write(files: readonly ExportFile[]): Promise<WriteOutcome>;
}
