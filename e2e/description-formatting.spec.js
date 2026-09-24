import { test, expect } from './hermetic.js';

const description = `Empfehlung: **Feldberg** – kurze Anreise.
Eine zweite Zeile bleibt sichtbar.

## Rahmen

- Vier Erwachsene
- Drei Schlafzimmer
  - Zwei getrennte Einzelzimmer

## Vergleich

1. Feldberg
2. Oberstdorf

[Unterkunft](https://example.com/unterkunft)

| Ort | Kosten |
| --- | --- |
| Feldberg | 698,76 € |

### Packliste
- [ ] Ausrüstung prüfen`;

test('description keeps paragraphs, lists and links when opened, edited and reopened', async ({ page, backend }, testInfo) => {
  for (const stack of backend.stacks) {
    for (const card of stack.cards) {
      card.description = description;
      card.title = 'Skiwochenende – Entscheidungsvorlage';
    }
  }
  await page.goto('/');
  await page.locator('.card').first().click();
  const rendered = page.getByTestId('description');
  await expect(rendered.locator('h2')).toHaveText(['Rahmen', 'Vergleich']);
  await expect(rendered.locator('ul > li')).toHaveCount(3);
  await expect(rendered.locator('ol > li')).toHaveCount(2);
  await expect(rendered.locator('br')).toHaveCount(1);
  await expect(rendered.getByRole('link', { name: 'Unterkunft' })).toHaveAttribute('href', 'https://example.com/unterkunft');
  await expect(rendered.locator('table')).toBeVisible();
  const heading = await rendered.locator('h2').first().boundingBox();
  const paragraph = await rendered.locator('p').first().boundingBox();
  expect(heading.y).toBeGreaterThan(paragraph.y + paragraph.height);
  await page.screenshot({ path: testInfo.outputPath('description-formatting.png') });

  await page.getByRole('button', { name: 'Beschreibung bearbeiten' }).click();
  const editor = page.getByLabel('Beschreibung der Karte');
  await expect(editor).toHaveValue(description.split('\n### Packliste')[0].trim());
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect(backend.find('/cards/', 'PUT')).toHaveLength(0);

  await page.getByRole('button', { name: 'Beschreibung bearbeiten' }).click();
  await editor.fill(description.split('\n### Packliste')[0].trim() + '\n\nZusatzinformation.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(rendered).toContainText('Zusatzinformation.');
  await expect.poll(() => backend.find('/cards/', 'PUT').length).toBe(1);
  const saved = backend.find('/cards/', 'PUT').at(-1).body.description;
  expect(saved).toContain('## Rahmen\n\n- Vier Erwachsene');
  expect(saved).toContain('- [ ] Ausrüstung prüfen');
  await page.getByRole('button', { name: 'Kartendetails schließen' }).click();
  await page.locator('.card').first().click();
  await expect(rendered.locator('h2')).toHaveText(['Rahmen', 'Vergleich']);
  await expect(rendered).toContainText('Zusatzinformation.');
});
