import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentContext, detectMimeType, MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS, processedAttachmentSchema, processorForAttachment } from '../src/shared/attachments';

test('attachment router detects image and document attachments', () => {
  assert.equal(detectMimeType('screen.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(processorForAttachment('screen.png', 'image/png'), 'image');
  assert.equal(detectMimeType('brief.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46])), 'application/pdf');
  assert.equal(processorForAttachment('brief.pdf', 'application/pdf'), 'document');
});

test('attachment router treats code and spreadsheets as structured context', () => {
  assert.equal(processorForAttachment('model.inp', 'application/octet-stream'), 'code');
  assert.equal(processorForAttachment('table.csv', 'text/csv'), 'spreadsheet');
});

test('attachment schema rejects unsupported sizes and normalizes context', () => {
  assert.throws(() => processedAttachmentSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'huge.txt', mimeType: 'text/plain', size: MAX_ATTACHMENT_SIZE + 1, source: 'huge.txt', status: 'ready', processorType: 'document' }));
  const context = attachmentContext([processedAttachmentSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'notes.txt', mimeType: 'text/plain', size: 12, source: 'notes.txt', status: 'ready', processorType: 'document', extractedContent: 'Hello file' })]);
  assert.match(context, /notes\.txt/);
  assert.match(context, /Hello file/);
});

test('unknown attachments route to safe fallback', () => {
  assert.equal(detectMimeType('binary.bin'), 'application/octet-stream');
  assert.equal(processorForAttachment('binary.bin', 'application/octet-stream'), 'fallback');
});

test('valid image attachment with multiple supported types', () => {
  assert.equal(processorForAttachment('photo.jpg', 'image/jpeg'), 'image');
  assert.equal(processorForAttachment('banner.gif', 'image/gif'), 'image');
  assert.equal(processorForAttachment('design.webp', 'image/webp'), 'image');
  assert.equal(processorForAttachment('scan.tiff', 'image/tiff'), 'image');
});

test('valid document attachment routes correctly', () => {
  assert.equal(processorForAttachment('report.doc', 'application/msword'), 'document');
  assert.equal(processorForAttachment('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'document');
  assert.equal(processorForAttachment('readme.md', 'text/markdown'), 'document');
  assert.equal(processorForAttachment('notes.txt', 'text/plain'), 'document');
});

test('audio and video attachments route to correct processors', () => {
  assert.equal(processorForAttachment('voice.mp3', 'audio/mpeg'), 'audio');
  assert.equal(processorForAttachment('recording.wav', 'audio/wav'), 'audio');
  assert.equal(processorForAttachment('clip.mp4', 'video/mp4'), 'video');
  assert.equal(processorForAttachment('screen.webm', 'video/webm'), 'video');
});

test('code files route to code processor', () => {
  assert.equal(processorForAttachment('app.ts', 'text/typescript'), 'code');
  assert.equal(processorForAttachment('main.py', 'text/x-python'), 'code');
  assert.equal(processorForAttachment('style.css', 'text/css'), 'code');
  assert.equal(processorForAttachment('config.json', 'application/json'), 'code');
});

test('attachment context returns empty string for no ready attachments', () => {
  const context = attachmentContext([]);
  assert.equal(context, '');
});

test('attachment context filters out non-ready attachments', () => {
  const attachments = [
    processedAttachmentSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'ready.txt', mimeType: 'text/plain', size: 10, source: 'ready.txt', status: 'ready', processorType: 'document', extractedContent: 'visible' }),
    processedAttachmentSchema.parse({ id: '22222222-2222-4222-8222-222222222222', name: 'pending.txt', mimeType: 'text/plain', size: 10, source: 'pending.txt', status: 'processing', processorType: 'document' }),
    processedAttachmentSchema.parse({ id: '33333333-3333-4333-8333-333333333333', name: 'failed.txt', mimeType: 'text/plain', size: 10, source: 'failed.txt', status: 'error', processorType: 'document', error: 'Parse failed' })
  ];
  const context = attachmentContext(attachments);
  assert.match(context, /ready\.txt/);
  assert.match(context, /visible/);
  assert.doesNotMatch(context, /pending/);
  assert.doesNotMatch(context, /failed/);
});

test('attachment context handles multiple ready attachments', () => {
  const attachments = [
    processedAttachmentSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'first.png', mimeType: 'image/png', size: 100, source: 'first.png', status: 'ready', processorType: 'image' }),
    processedAttachmentSchema.parse({ id: '22222222-2222-4222-8222-222222222222', name: 'second.pdf', mimeType: 'application/pdf', size: 200, source: 'second.pdf', status: 'ready', processorType: 'document', extractedContent: 'PDF text' })
  ];
  const context = attachmentContext(attachments);
  assert.match(context, /first\.png/);
  assert.match(context, /second\.pdf/);
  assert.match(context, /PDF text/);
});

test('attachment context shows fallback text when no extracted content', () => {
  const attachments = [
    processedAttachmentSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'photo.jpg', mimeType: 'image/jpeg', size: 500, source: 'photo.jpg', status: 'ready', processorType: 'image' })
  ];
  const context = attachmentContext(attachments);
  assert.match(context, /No textual extraction/);
});

test('MAX_ATTACHMENTS constant is defined', () => {
  assert.equal(MAX_ATTACHMENTS, 20);
  assert.ok(MAX_ATTACHMENTS > 0);
});

test('attachment schema rejects oversized file', () => {
  assert.throws(() => processedAttachmentSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'large.bin',
    mimeType: 'application/octet-stream',
    size: MAX_ATTACHMENT_SIZE + 1,
    source: 'large.bin',
    status: 'ready',
    processorType: 'fallback'
  }));
});

test('attachment schema accepts file at max size', () => {
  const attachment = processedAttachmentSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'max.txt',
    mimeType: 'text/plain',
    size: MAX_ATTACHMENT_SIZE,
    source: 'max.txt',
    status: 'ready',
    processorType: 'document'
  });
  assert.equal(attachment.size, MAX_ATTACHMENT_SIZE);
});

test('attachment schema rejects zero-length name', () => {
  assert.throws(() => processedAttachmentSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: '',
    mimeType: 'text/plain',
    size: 10,
    source: 'file.txt',
    status: 'ready',
    processorType: 'document'
  }));
});

test('attachment schema validates status values', () => {
  for (const status of ['queued', 'processing', 'ready', 'error']) {
    const attachment = processedAttachmentSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 10,
      source: 'test.txt',
      status,
      processorType: 'document'
    });
    assert.equal(attachment.status, status);
  }
});

test('attachment schema rejects invalid status', () => {
  assert.throws(() => processedAttachmentSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'test.txt',
    mimeType: 'text/plain',
    size: 10,
    source: 'test.txt',
    status: 'invalid',
    processorType: 'document'
  }));
});

test('processorType covers all supported types', () => {
  const types = ['image', 'document', 'audio', 'video', 'code', 'spreadsheet', 'fallback'];
  for (const type of types) {
    const attachment = processedAttachmentSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 10,
      source: 'test.txt',
      status: 'ready',
      processorType: type
    });
    assert.equal(attachment.processorType, type);
  }
});

test('detectMimeType uses extension when no header available', () => {
  assert.equal(detectMimeType('file.png'), 'image/png');
  assert.equal(detectMimeType('file.mp3'), 'audio/mpeg');
  assert.equal(detectMimeType('file.yaml'), 'application/yaml');
});

test('detectMimeType signature overrides extension for zip-based formats', () => {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(detectMimeType('file.docx', header), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
