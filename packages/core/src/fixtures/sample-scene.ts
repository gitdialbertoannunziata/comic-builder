import { SceneSchema, type Scene } from "../schema/scenes.js";

/**
 * Scena di esempio: il risultato che lo spoglio (F1) deve produrre da un
 * capitolo di prosa. Serve a esercitare la catena scene → pagine → SVG senza
 * dipendere da un modello linguistico, e a vedere che documento ne esce.
 *
 * Dodici beat: `paginateBeats` li dispone in due pagine da sei.
 */
export const sampleScene: Scene = SceneSchema.parse({
  id: "s001",
  title: "La lanterna spenta",
  location: "faro di Capo Vento",
  time_of_day: "alba",
  characters: ["sara", "elio"],
  beats: [
    {
      id: "s001-b1",
      function: "establish",
      summary: "Il faro sulla scogliera, la lanterna spenta contro il cielo che schiarisce.",
      source: { file: "script/cap-001.md", from_line: 1, to_line: 6 },
    },
    {
      id: "s001-b2",
      function: "entrance",
      summary: "Sara arriva dal sentiero, la borsa degli attrezzi in spalla.",
      source: { file: "script/cap-001.md", from_line: 7, to_line: 11 },
    },
    {
      id: "s001-b3",
      function: "dialogue",
      summary: "Sara chiama Elio dal piazzale; lui risponde dalla porta.",
      source: { file: "script/cap-001.md", from_line: 12, to_line: 19 },
      lines: [
        { speaker: "sara", text: "È spenta da quanto?", type: "speech" },
        { speaker: "elio", text: "Dalle due. Ho provato di tutto.", type: "speech" },
      ],
    },
    {
      id: "s001-b4",
      function: "dialogue",
      summary: "Elio le mostra il quadro elettrico annerito.",
      source: { file: "script/cap-001.md", from_line: 20, to_line: 26 },
      lines: [{ speaker: "elio", text: "Guarda qui. Non è il generatore.", type: "speech" }],
    },
    {
      id: "s001-b5",
      function: "reaction",
      summary: "Sara riconosce la bruciatura: l'ha già vista, altrove.",
      source: { file: "script/cap-001.md", from_line: 27, to_line: 31 },
    },
    {
      id: "s001-b6",
      function: "action",
      summary: "Sara sale la scala a chiocciola due gradini alla volta.",
      source: { file: "script/cap-001.md", from_line: 32, to_line: 38 },
    },
    {
      id: "s001-b7",
      function: "reveal",
      summary: "In cima, la lente della lanterna è stata smontata e portata via.",
      intense: true,
      source: { file: "script/cap-001.md", from_line: 39, to_line: 45 },
    },
    {
      id: "s001-b8",
      function: "reaction",
      summary: "Elio, arrivato dopo, resta sulla soglia senza parlare.",
      source: { file: "script/cap-001.md", from_line: 46, to_line: 50 },
    },
    {
      id: "s001-b9",
      function: "dialogue",
      summary: "Sara constata che chi l'ha smontata sapeva come farlo.",
      source: { file: "script/cap-001.md", from_line: 51, to_line: 58 },
      lines: [
        { speaker: "sara", text: "Nessun segno di scasso.", type: "speech" },
        { speaker: "elio", text: "Aveva le chiavi.", type: "speech" },
      ],
    },
    {
      id: "s001-b10",
      function: "dialogue",
      summary: "Elio ammette che le chiavi di riserva mancano da settimane.",
      source: { file: "script/cap-001.md", from_line: 59, to_line: 66 },
      lines: [{ speaker: "elio", text: "Te lo dovevo dire prima.", type: "whisper" }],
    },
    {
      id: "s001-b11",
      function: "action",
      summary: "Sara si affaccia al parapetto e guarda la strada costiera.",
      intense: true,
      source: { file: "script/cap-001.md", from_line: 67, to_line: 72 },
    },
    {
      id: "s001-b12",
      function: "close",
      summary: "Il faro visto dal mare, cieco, mentre il sole si alza.",
      intense: true,
      source: { file: "script/cap-001.md", from_line: 73, to_line: 78 },
    },
  ],
});
