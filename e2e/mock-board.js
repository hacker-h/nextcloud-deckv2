// e2e/mock-board.js
// Shared mock fixture for cross-browser testing with 15+ boards and realistic card layouts.

export const MOCK_BOARDS = Array.from({ length: 16 }, (_, i) => {
  const id = 100 + i;
  if (i === 0) {
    return {
      id,
      title: 'Essensplanung',
      color: '0082c9',
      archived: false,
    };
  }
  if (i === 1) {
    return {
      id,
      title: 'Project Roadmap 2026 — Long Title That Truncates In Menu',
      color: '31cc7c',
      archived: false,
    };
  }
  const titles = [
    'Einkaufsliste',
    'Hausarbeiten & Garten',
    'Reiseplanung Sommer',
    'Urlaub 2026',
    'Finanzen & Rechnungen',
    'Gesundheit & Fitness',
    'Bücher & Medien',
    'Technik & Infrastructure',
    'Auto & Mobilität',
    'Geschenke & Feiertage',
    'Workplace Operations',
    'DevOps Automation',
    'Design System Deck',
    'Archivierte Projekte',
  ];
  return {
    id,
    title: titles[i - 2] ?? `Board ${i + 1}`,
    color: ['ff7a00', 'a200ff', '00d084', 'eb144c', 'f5a623'][i % 5],
    archived: i === 15,
  };
});

export const MOCK_STACKS = [
  {
    id: 301,
    title: 'Essen',
    order: 0,
    cards: [
      {
        id: 1001,
        title: 'Pizza Margherita',
        order: 0,
        // Checklists live inside the description as markdown; the first card
        // carries one so the progress bar and its transition are reachable
        // without a spec having to create one first.
        description: 'Homemade dough\n\n### Zubereitung\n- [x] Teig ansetzen\n- [ ] Belegen\n- [ ] Backen',
        labels: [],
      },
      {
        id: 1002,
        title: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        order: 1,
        description: 'Very long word wrapping test card',
        labels: [],
      },
      {
        id: 1003,
        title: 'Pasta Carbonara mit frischem Parmigiano Reggiano und Guanciale vom Metzger',
        order: 2,
        description: 'Traditional recipe without cream',
        labels: [],
      },
    ],
  },
  {
    id: 302,
    title: 'Samstag',
    order: 1,
    cards: [
      { id: 1004, title: 'Brunch', order: 0, labels: [] },
      { id: 1005, title: 'Grillen im Garten', order: 1, labels: [] },
    ],
  },
  {
    id: 303,
    title: 'Sonntag',
    order: 2,
    cards: [{ id: 1006, title: 'Sonntagsbraten', order: 0, labels: [] }],
  },
  {
    id: 304,
    title: 'Montag',
    order: 3,
    cards: [
      { id: 1007, title: 'Salat mit Hähnchen', order: 0, labels: [] },
      { id: 1008, title: 'Suppe', order: 1, labels: [] },
      { id: 1009, title: 'Obstteller', order: 2, labels: [] },
      { id: 1010, title: 'Abendbrot', order: 3, labels: [] },
      { id: 1011, title: 'Mitternachtssnack', order: 4, labels: [] },
      { id: 1012, title: 'Protein Shake', order: 5, labels: [] },
    ],
  },
  {
    id: 305,
    title: 'Dienstag',
    order: 4,
    cards: [], // Empty stack test
  },
  {
    id: 306,
    title: 'Mittwoch',
    order: 5,
    cards: [{ id: 1013, title: 'Fisch mit Gemüsebett', order: 0, labels: [] }],
  },
  {
    id: 307,
    title: 'Donnerstag',
    order: 6,
    cards: [{ id: 1014, title: 'Vegetarisches Curry', order: 0, labels: [] }],
  },
  {
    id: 308,
    title: 'Freitag',
    order: 7,
    cards: [{ id: 1015, title: 'Sushi Night', order: 0, labels: [] }],
  },
];

export function createMockBoardState() {
  return {
    boards: MOCK_BOARDS,
    currentBoard: MOCK_BOARDS[0],
    stacks: MOCK_STACKS,
  };
}
