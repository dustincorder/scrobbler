import test from 'node:test';
import assert from 'node:assert/strict';
import { plural, plays, escapeHtml, initials, num } from '../src/format.js';

test('russian plural rules', () => {
  assert.equal(plural(1, 'трек', 'трека', 'треков'), 'трек');
  assert.equal(plural(2, 'трек', 'трека', 'треков'), 'трека');
  assert.equal(plural(5, 'трек', 'трека', 'треков'), 'треков');
  assert.equal(plural(11, 'трек', 'трека', 'треков'), 'треков');
  assert.equal(plural(21, 'трек', 'трека', 'треков'), 'трек');
  assert.equal(plural(112, 'трек', 'трека', 'треков'), 'треков');
});

test('plays output', () => {
  assert.match(plays(1234), /1[\s\u00a0]234/);
});

test('html escaping', () => {
  assert.equal(escapeHtml('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});

test('initials', () => {
  assert.equal(initials('slutvibe'), 'S');
  assert.equal(initials('Daft Punk'), 'DP');
});

test('numbers are localized', () => {
  assert.equal(num(1000), '1\u00a0000');
});
