import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitOnEnter } from '../src/desktop/composer';

function keyEvent(input: { key: string; shiftKey?: boolean; composing?: boolean }) {
  let prevented = false;
  return {
    event: {
      key: input.key,
      shiftKey: !!input.shiftKey,
      nativeEvent: { isComposing: !!input.composing },
      preventDefault: () => { prevented = true; }
    },
    prevented: () => prevented
  };
}

test('composer Enter submits and prevents newline', () => {
  let submitted = 0;
  const item = keyEvent({ key: 'Enter' });
  submitOnEnter(item.event as any, () => { submitted++; });
  assert.equal(submitted, 1);
  assert.equal(item.prevented(), true);
});

test('composer Shift+Enter allows newline', () => {
  let submitted = 0;
  const item = keyEvent({ key: 'Enter', shiftKey: true });
  submitOnEnter(item.event as any, () => { submitted++; });
  assert.equal(submitted, 0);
  assert.equal(item.prevented(), false);
});

test('composer does not submit while IME composition is active', () => {
  let submitted = 0;
  const item = keyEvent({ key: 'Enter', composing: true });
  submitOnEnter(item.event as any, () => { submitted++; });
  assert.equal(submitted, 0);
  assert.equal(item.prevented(), false);
});

test('composer multiple Shift+Enter inserts newlines without submitting', () => {
  let submitted = 0;
  for (let i = 0; i < 5; i++) {
    const item = keyEvent({ key: 'Enter', shiftKey: true });
    submitOnEnter(item.event as any, () => { submitted++; });
    assert.equal(item.prevented(), false);
  }
  assert.equal(submitted, 0);
});

test('composer non-Enter keys do not trigger submission', () => {
  let submitted = 0;
  for (const key of ['a', ' ', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown']) {
    const item = keyEvent({ key });
    submitOnEnter(item.event as any, () => { submitted++; });
    assert.equal(item.prevented(), false);
  }
  assert.equal(submitted, 0);
});

test('composer submit callback is only invoked once per Enter', () => {
  let count = 0;
  const item = keyEvent({ key: 'Enter' });
  submitOnEnter(item.event as any, () => { count++; });
  assert.equal(count, 1);
});

test('composer empty draft does not affect submitOnEnter behavior', () => {
  let submitted = 0;
  const item = keyEvent({ key: 'Enter' });
  submitOnEnter(item.event as any, () => { submitted++; });
  assert.equal(submitted, 1);
  assert.equal(item.prevented(), true);
});

test('composer Enter after composition end does submit', () => {
  let submitted = 0;
  const composing = keyEvent({ key: 'Enter', composing: true });
  submitOnEnter(composing.event as any, () => { submitted++; });
  assert.equal(submitted, 0);
  const after = keyEvent({ key: 'Enter', composing: false });
  submitOnEnter(after.event as any, () => { submitted++; });
  assert.equal(submitted, 1);
  assert.equal(after.prevented(), true);
});
