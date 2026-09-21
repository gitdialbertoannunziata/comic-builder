/**
 * Istruzioni di sistema per lo spoglio.
 *
 * Il piano è esplicito su cosa funziona: "la tabella beat→camera qui sotto è
 * più efficace di qualsiasi istruzione in prosa" (§6.2). Qui la lezione è
 * applicata al contrario — visto che la camera la deriviamo noi, al modello
 * non si chiede nulla di cinematografico se non scegliere fra sette funzioni
 * di beat, ognuna definita da cosa *fa* nella scena, non da come va ripresa.
 */

const BEAT_FUNCTIONS = [
  ["establish", "stabilisce dove siamo: luogo, ora, atmosfera. Di solito apre una scena."],
  ["entrance", "un personaggio entra in scena o si rivela presente."],
  ["dialogue", "uno scambio di battute fra personaggi."],
  ["reaction", "un personaggio reagisce senza parlare: capisce, ricorda, si spaventa."],
  ["reveal", "emerge un'informazione che cambia la scena."],
  ["action", "qualcuno fa qualcosa di fisico che sposta la situazione."],
  ["close", "chiude la scena o le dà una pausa."],
] as const;

export function breakdownSystemPrompt(): string {
  const functions = BEAT_FUNCTIONS.map(([id, meaning]) => `- ${id}: ${meaning}`).join("\n");

  return [
    "Sei uno spogliatore di sceneggiature per fumetti. Dividi il testo in scene e, dentro ogni scena, in beat.",
    "",
    "Un beat è la più piccola unità che merita una vignetta: un'azione, uno scambio, una reazione.",
    "Non descrivere inquadrature, angoli o obiettivi: non è compito tuo, vengono derivati dalla funzione del beat.",
    "",
    "Funzioni di beat ammesse:",
    functions,
    "",
    "Regole:",
    "- Una scena è un blocco continuo di luogo e tempo. Se cambia il luogo o passa del tempo, è una scena nuova.",
    "- Da 3 a 12 beat per scena. Se una scena ne richiede di più, dividila.",
    "- `summary` descrive cosa si vede, in una frase, al presente. È la specifica per chi disegna.",
    "- `lines` contiene solo le battute effettivamente pronunciate, con il testo esatto. Se il beat non ha dialogo, lascia la lista vuota.",
    "- `speaker` è un ref breve e stabile dello stesso personaggio in tutte le scene: minuscolo, senza spazi né accenti (es. `marco`, `la_dottoressa`). Usa null per didascalie e voce fuori campo.",
    "- `characters` della scena elenca i ref di tutti i personaggi che vi compaiono, con la stessa forma usata in `speaker`.",
    "- `intense` è true solo per i beat che sono il picco della scena. In una scena normale sono zero o uno.",
    "- `type` di ogni battuta: `speech` per il parlato normale, `whisper` se sussurrata, `shout` se urlata, `thought` se pensata, `caption` per la voce narrante (speaker null), `offpanel` per chi parla da fuori campo o al telefono, `sfx` per un effetto sonoro scritto.",
    "- `characters` del beat elenca chi si vede davvero nella vignetta, con l'espressione se il testo la suggerisce (altrimenti stringa vuota). Lista vuota se la vignetta non mostra nessuno, per esempio un paesaggio. Chi parla fuori campo non ci va.",
    "- `mood` e `lighting` della scena si scelgono dai valori ammessi: `lighting` dall'ora e dal luogo (alba o tramonto → golden, notte → night, interno illuminato da lampade → practical).",
    "- `mood` del beat è null, salvo quando il tono di quel momento si discosta da quello della scena.",
    "- `props` elenca gli oggetti che la vignetta deve mostrare. Lista vuota se non ce ne sono.",
    "- `from_line` e `to_line` sono le righe dello script da cui il beat nasce, numerate da 1.",
    "",
    "Rispondi esclusivamente con JSON conforme allo schema richiesto, senza commenti né testo attorno.",
  ].join("\n");
}

export interface UserPromptOptions {
  /** Numero della prima riga nel copione intero: una parte mantiene i numeri originali. */
  firstLine?: number;
  /** Ref dei personaggi già incontrati nelle parti precedenti: si riusano, non si reinventano. */
  knownCharacters?: readonly string[];
  /** Quale parte del capitolo è, se è stato diviso. */
  part?: { index: number; total: number; continuation: boolean };
}

export function breakdownUserPrompt(script: string, options: UserPromptOptions = {}): string {
  const first = options.firstLine ?? 1;
  const numbered = script
    .split("\n")
    .map((line, i) => `${first + i}\t${line}`)
    .join("\n");

  // Le righe sono numerate nel prompt perché la provenienza (§10.1) chiede
  // numeri di riga: chiederli su un testo non numerato è chiedere al modello
  // di contare, che è il modo più sicuro per ottenerli sbagliati.
  const header: string[] = [];
  if (options.part && options.part.total > 1) {
    header.push(
      `Questa è la parte ${options.part.index + 1} di ${options.part.total} del capitolo.` +
        (options.part.continuation ? " Continua la scena della parte precedente: non ripetere ciò che c'era prima." : ""),
    );
  }
  if (options.knownCharacters && options.knownCharacters.length > 0) {
    header.push(`Personaggi già incontrati, da chiamare con questi ref se ricompaiono: ${options.knownCharacters.join(", ")}.`);
  }
  const intro = header.length > 0 ? `${header.join("\n")}\n\n` : "";
  return `${intro}Spoglia questo capitolo. Le righe sono numerate per riferimento.\n\n${numbered}`;
}
