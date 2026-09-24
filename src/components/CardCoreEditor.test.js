import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardCoreEditor from './CardCoreEditor.svelte';

const base = {
  id: 10193,
  title: 'Original title',
  description: '',
  duedate: null,
};

function setup(props = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  const result = render(CardCoreEditor, { props: { card: base, ...props, onSave } });
  return { ...result, onSave };
}

describe('CardCoreEditor', () => {
  it('saves a multiline description only on explicit Save', async () => {
    const { onSave } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Fügen Sie eine detailliertere Beschreibung hinzu' }));
    const area = screen.getByLabelText('Beschreibung der Karte');
    await fireEvent.input(area, { target: { value: 'Line 1\nLine 2' } });
    expect(onSave).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ description: 'Line 1\nLine 2' });
  });

  it('reports an unsaved description draft so the modal can block closing', async () => {
    const onDraftChange = vi.fn();
    setup({ onDraftChange });

    await fireEvent.click(screen.getByRole('button', { name: 'Fügen Sie eine detailliertere Beschreibung hinzu' }));
    await fireEvent.input(screen.getByLabelText('Beschreibung der Karte'), {
      target: { value: 'unsaved work' },
    });

    expect(onDraftChange).toHaveBeenLastCalledWith({ description: 'unsaved work' });

    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  it('reports no pending draft when an edit is cancelled', async () => {
    const onDraftChange = vi.fn();
    setup({ onDraftChange });

    await fireEvent.click(screen.getByRole('button', { name: 'Fügen Sie eine detailliertere Beschreibung hinzu' }));
    await fireEvent.input(screen.getByLabelText('Beschreibung der Karte'), {
      target: { value: 'abandoned' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  it('preserves line breaks and renders markup as text, never HTML', () => {
    setup({ card: { ...base, description: 'Line 1\n<b>not bold</b>' } });

    const desc = screen.getByTestId('description');
    expect(desc.querySelector('br')).not.toBeNull();
    expect(desc.textContent).toContain('<b>not bold</b>');
    expect(desc.querySelector('b')).toBeNull();
    expect(desc.innerHTML).not.toContain('<b>');
  });

  it('converts a local due date to ISO-8601 without timezone drift', async () => {
    const { onSave } = setup();

    // The native datetime-local input this replaced was unstyleable: browsers
    // draw the calendar button and the TT.MM.JJJJ placeholder themselves, in
    // light chrome, on a dark card. The conversion it guarded is unchanged and
    // still asserted below.
    await fireEvent.click(screen.getByLabelText('Ablaufdatum'));
    await fireEvent.input(screen.getByLabelText('Fälligkeitsdatum'), {
      target: { value: '2030-04-05' },
    });
    await fireEvent.input(document.querySelector('.time-input'), { target: { value: '14:30' } });
    await fireEvent.submit(document.querySelector('.popover-body'));

    const [[payload]] = onSave.mock.calls;
    // Round-tripping through Date proves the wall-clock time survives the
    // conversion in whatever zone the test host runs in.
    const local = new Date(payload.duedate);
    expect(local.getFullYear()).toBe(2030);
    expect(local.getMonth()).toBe(3);
    expect(local.getDate()).toBe(5);
    expect(local.getHours()).toBe(14);
    expect(local.getMinutes()).toBe(30);
  });

  it('renders an existing due date into the pill and back into the picker', async () => {
    const iso = new Date(2030, 3, 5, 14, 30).toISOString();
    setup({ card: { ...base, duedate: iso } });

    const pill = screen.getByLabelText('Ablaufdatum');
    expect(pill.textContent).toContain('5');
    expect(pill.textContent).toContain('14:30');

    // Reopening must show the stored time rather than resetting it to noon,
    // which would move the deadline the moment the user pressed Speichern.
    await fireEvent.click(pill);
    expect(screen.getByLabelText('Fälligkeitsdatum')).toHaveValue('2030-04-05');
    expect(document.querySelector('.time-input')).toHaveValue('14:30');
  });

  it('clears a due date', async () => {
    const iso = new Date(2030, 3, 5, 14, 30).toISOString();
    const { onSave } = setup({ card: { ...base, duedate: iso } });

    await fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(onSave).toHaveBeenCalledWith({ duedate: null });
  });

  it('marks a past due date as overdue', () => {
    setup({ card: { ...base, duedate: new Date(2020, 0, 1, 9, 0).toISOString() } });

    expect(screen.getByText('Überfällig')).toBeInTheDocument();
  });
});

it('renders headings, paragraphs and lists and leaves the Markdown unchanged on Save', async () => {
  const description = '## Rahmen\n\nEin **wichtiger** Absatz.\nZweite Zeile.\n\n- Erwachsene\n- Kinder\n\n1. Feldberg\n2. Oberstdorf';
  const { onSave } = setup({ card: { ...base, description } });
  const content = screen.getByTestId('description');
  expect(content.querySelector('h2')).toHaveTextContent('Rahmen');
  expect(content.querySelectorAll('ul > li')).toHaveLength(2);
  expect(content.querySelectorAll('ol > li')).toHaveLength(2);
  expect(content.querySelector('strong')).toHaveTextContent('wichtiger');
  await fireEvent.click(screen.getByRole('button', { name: 'Beschreibung bearbeiten' }));
  expect(screen.getByLabelText('Beschreibung der Karte')).toHaveValue(description);
  await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(onSave).not.toHaveBeenCalled();
});

it('saves edited Markdown without flattening lists or whitespace', async () => {
  const original = '## Rahmen\n\n- Erwachsene\n- Kinder';
  const { onSave } = setup({ card: { ...base, description: original } });
  await fireEvent.click(screen.getByRole('button', { name: 'Beschreibung bearbeiten' }));
  const changed = original + '\n\nWeitere Angaben.\n';
  await fireEvent.input(screen.getByLabelText('Beschreibung der Karte'), { target: { value: changed } });
  await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(onSave).toHaveBeenCalledWith({ description: changed });
});

it('does not turn a link click into description editing', async () => {
  setup({ card: { ...base, description: '[Unterkunft](https://example.com)' } });
  const link = screen.getByRole('link', { name: 'Unterkunft' });
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await fireEvent.click(link);
  expect(screen.queryByLabelText('Beschreibung der Karte')).not.toBeInTheDocument();
});
