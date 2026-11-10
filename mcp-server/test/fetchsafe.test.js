import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, fetchPublic } from '../src/fetchsafe.js';

test('private and metadata addresses are blocked', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.20.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1', 'fd00::1']) assert.equal(isBlockedAddress(a), true, a);
  for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isBlockedAddress(a), false, a);
});

test('fetchPublic refuses metadata and non-http URLs', async () => {
  await assert.rejects(fetchPublic('http://169.254.169.254/computeMetadata/v1/'));
  await assert.rejects(fetchPublic('http://localhost:1/'));
  await assert.rejects(fetchPublic('file:///etc/passwd'));
});
