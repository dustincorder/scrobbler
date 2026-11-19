import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, href } from '../src/router.js';

test('home', () => {
  assert.deepEqual(pick(parseRoute('#/')), { name: 'home' });
  assert.deepEqual(pick(parseRoute('')), { name: 'home' });
});

test('profile root and tabs', () => {
  assert.deepEqual(pick(parseRoute('#/u/slutvibe')), { name: 'profile', username: 'slutvibe', tab: 'overview' });
  assert.deepEqual(pick(parseRoute('#/u/slutvibe/artists')), { name: 'profile', username: 'slutvibe', tab: 'artists' });
  assert.deepEqual(pick(parseRoute('#/u/slutvibe/charts')), { name: 'profile', username: 'slutvibe', tab: 'charts' });
});

test('artist / album / track with encoded names', () => {
  const artist = parseRoute(`#/u/slutvibe/artist/${encodeURIComponent('Godspeed You! Black Emperor')}`);
  assert.equal(artist.name, 'artist');
  assert.equal(artist.artist, 'Godspeed You! Black Emperor');

  const album = parseRoute(`#/u/slutvibe/album/${encodeURIComponent('Radiohead')}/${encodeURIComponent('In Rainbows')}`);
  assert.equal(album.name, 'album');
  assert.equal(album.artist, 'Radiohead');
  assert.equal(album.album, 'In Rainbows');

  const track = parseRoute(`#/u/slutvibe/track/${encodeURIComponent('a/b')}/${encodeURIComponent('c?d')}`);
  assert.equal(track.name, 'track');
  assert.equal(track.artist, 'a/b');
  assert.equal(track.track, 'c?d');
});

test('system routes', () => {
  assert.equal(parseRoute('#/login').name, 'login');
  assert.equal(parseRoute('#/join').name, 'join');
  assert.equal(parseRoute('#/settings').name, 'settings');
  assert.equal(parseRoute('#/import').name, 'import');
  assert.equal(parseRoute('#/connect?token=abc').token, 'abc');
  assert.equal(parseRoute('#/wat').name, 'notfound');
});

test('href builds encoded hash links', () => {
  assert.equal(href('u', 'slutvibe'), '#/u/slutvibe');
  assert.equal(href('u', 'slutvibe', 'artist', 'AC/DC'), '#/u/slutvibe/artist/AC%2FDC');
});

function pick(route) {
  const { query, next, ...rest } = route;
  return rest;
}
