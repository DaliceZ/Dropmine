// Local-only browser reproduction of unsolicited-request availability findings.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { WebSocket } from 'ws';
import { createApp } from '../../backend/src/app.ts';

const app = createApp({ staticDir: resolve('frontend/dist') });
await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ headless: true });
let attacker;
try {
  const sender = await browser.newPage();
  const receiver = await browser.newPage();
  for (const [page, name] of [[sender, 'Honest sender'], [receiver, 'Audit receiver']]) {
    await page.goto(origin);
    await page.locator('.app-shell[data-connection="online"]').waitFor();
    await page.getByLabel('ชื่ออุปกรณ์', { exact: true }).fill(name);
    await page.getByLabel('ชื่ออุปกรณ์', { exact: true }).blur();
  }
  await sender.getByLabel('เลือกไฟล์ที่จะส่ง').setInputFiles({ name: 'unsaved-private.txt', mimeType: 'text/plain', buffer: Buffer.from('unsaved private contents') });
  await sender.getByRole('button', { name: /Audit receiver/ }).click();
  await sender.getByRole('button', { name: 'ยืนยันการส่ง', exact: true }).click();
  await receiver.getByRole('button', { name: 'ยอมรับไฟล์', exact: true }).click();
  const previousDownload = receiver.getByRole('link', { name: 'บันทึก unsaved-private.txt', exact: true });
  await previousDownload.waitFor();
  assert.match(await previousDownload.getAttribute('href'), /^blob:/);

  const events = [];
  attacker = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin });
  attacker.on('message', data => events.push(JSON.parse(data.toString())));
  const until = async predicate => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Expected audit event did not arrive');
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
  };
  await until(() => events.some(event => event.type === 'hello'));
  attacker.send(JSON.stringify({ type: 'profile', name: '<img src=x onerror="window.auditXss=1">', visible: true, kind: 'desktop' }));
  await until(() => events.some(event => event.type === 'peers' && event.peers.some(peer => peer.name === 'Audit receiver')));
  const target = events.filter(event => event.type === 'peers').at(-1).peers.find(peer => peer.name === 'Audit receiver').id;
  const files = Array.from({ length: 50 }, (_, index) => ({ name: `${index}-<img src=x onerror="window.auditXss=1">.txt`, size: 0 }));
  const sendRequest = id => attacker.send(JSON.stringify({ type: 'request', target, id, files }));
  sendRequest('browser-audit-0');
  await receiver.getByRole('dialog', { name: 'คำขอรับไฟล์', exact: true }).waitFor();
  assert.equal(await previousDownload.count(), 0);
  console.log(JSON.stringify({ id: 'F1-BROWSER', browser: 'Chromium', honest_transfer_completed: true, unsolicited_request_received: true, new_request_accepted: false, old_download_link_removed: true }));
  assert.equal(await receiver.locator('.receive-sender h3').textContent(), '<img src=x onerror="window.auditXss=1">');
  assert.equal(await receiver.getByRole('dialog').locator('img').count(), 0);
  assert.equal(await receiver.evaluate(() => window.auditXss), undefined);
  console.log(JSON.stringify({ id: 'CONTROL-XSS', device_and_file_names_rendered_as_text: true, injected_script_executed: false }));

  for (let index = 0; index < 25; index++) {
    const id = `browser-audit-${index}`;
    if (index) sendRequest(id);
    attacker.send(JSON.stringify({ type: 'cancel', id }));
    await until(() => events.some(event => event.type === 'ended' && event.id === id));
  }
  await receiver.locator('[data-transfer-id="browser-audit-24"]').waitFor();
  // Wait for the terminal event so no receive dialog obscures the screenshot.
  await receiver.getByRole('dialog', { name: 'คำขอรับไฟล์', exact: true }).waitFor({ state: 'hidden' });
  const historyRows = await receiver.locator('[data-transfer-id]').count();
  assert.equal(historyRows, 26);
  console.log(JSON.stringify({ id: 'F2-BROWSER', unsolicited_cancelled_requests: 25, receiver_acceptances_of_attacker_requests: 0, history_DOM_entries: historyRows }));
  const emptyMessageBytes = await receiver.evaluate(async () => {
    const first = new RTCPeerConnection({ iceServers: [] });
    const second = new RTCPeerConnection({ iceServers: [] });
    let timer;
    const data = new Promise((resolveMessage, reject) => {
      timer = setTimeout(() => reject(new Error('Empty DataChannel message timed out')), 8000);
      second.ondatachannel = event => {
        event.channel.binaryType = 'arraybuffer';
        event.channel.onmessage = message => resolveMessage(message.data.byteLength);
      };
    });
    const channel = first.createDataChannel('audit-empty-buffer');
    channel.onopen = () => channel.send(new ArrayBuffer(0));
    async function gather(connection, description) {
      await connection.setLocalDescription(description);
      if (connection.iceGatheringState !== 'complete') await new Promise(resolveGathering => {
        connection.onicegatheringstatechange = () => {
          if (connection.iceGatheringState === 'complete') resolveGathering();
        };
      });
    }
    try {
      await gather(first, await first.createOffer());
      await second.setRemoteDescription(first.localDescription);
      await gather(second, await second.createAnswer());
      await first.setRemoteDescription(second.localDescription);
      return await data;
    } finally { clearTimeout(timer); first.close(); second.close(); }
  });
  assert.equal(emptyMessageBytes, 0);
  console.log(JSON.stringify({ id: 'F3-TRANSPORT', browser: 'Chromium', real_WebRTC_delivers_zero_byte_binary_message: true, receiver_message_bytes: emptyMessageBytes }));
  await receiver.screenshot({ path: 'test-results/security-audit-browser.png' });
} finally {
  if (attacker) {
    const closed = once(attacker, 'close'); attacker.terminate(); await closed;
  }
  await browser.close();
  await app.close();
}
