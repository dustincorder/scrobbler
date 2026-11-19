import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseScrobblesCsv, detectDelimiter } from '../src/csv.js';

test('detects semicolon delimiter', () => {
  assert.equal(detectDelimiter('uts;artist;track;album'), ';');
  assert.equal(detectDelimiter('uts\tartist\ttrack\talbum'), '\t');
});

test('parses quoted fields with commas and newlines', () => {
  const rows = parseCsv('a,b\n"hello, world","line1\nline2"\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['hello, world', 'line1\nline2']]);
});

test('parses lastfm style csv with uts', () => {
  const csv = [
    'uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid',
    '1700000000,2023-11-14 22:13:20,Radiohead,,In Rainbows,,15 Step,',
    '1700000100,2023-11-14 22:15:00,"Godspeed You! Black Emperor",,Lift Your Skinny Fists,,Storm,',
  ].join('\n');

  const rows = parseScrobblesCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].artist, 'Radiohead');
  assert.equal(rows[0].album, 'In Rainbows');
  assert.equal(rows[0].track, '15 Step');
  assert.equal(rows[0].played_at, 1700000000);
  assert.equal(rows[1].artist, 'Godspeed You! Black Emperor');
});

test('parses semicolon csv and ms duration', () => {
  const csv = [
    'timestamp;artist;track;album;duration',
    '1700000000;A;B;C;215000',
  ].join('\n');
  const [row] = parseScrobblesCsv(csv);
  assert.equal(row.duration, 215);
  assert.equal(row.album, 'C');
});

test('throws on missing required headers', () => {
  assert.throws(() => parseScrobblesCsv('foo,bar\n1,2'), /artist/);
});
